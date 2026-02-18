from __future__ import annotations

import contextlib
import os
import platform
import re
import tempfile
import time
from pathlib import Path
from typing import Any, List

from equation import EquationOptions, insert_equation_control, latex_to_hwpeqn


IS_WINDOWS = platform.system() == "Windows"


@contextlib.contextmanager
def _preserve_foreground():
    """Context manager that saves and restores the OS foreground window.

    Prevents HWP COM operations from stealing focus when the user is
    working in another application.
    """
    prev_hwnd = 0
    if IS_WINDOWS:
        try:
            import win32gui  # type: ignore

            prev_hwnd = win32gui.GetForegroundWindow()
        except Exception:
            pass
    try:
        yield
    finally:
        if prev_hwnd and IS_WINDOWS:
            try:
                import win32gui  # type: ignore

                if win32gui.GetForegroundWindow() != prev_hwnd:
                    win32gui.SetForegroundWindow(prev_hwnd)
            except Exception:
                pass


class HwpControllerError(RuntimeError):
    """Base exception for HWP automation failures."""


def _is_rpc_unavailable_error(exc: Exception) -> bool:
    msg = str(exc)
    return (
        "RPC 서버를 사용할 수 없습니다" in msg
        or "RPC server is unavailable" in msg
        or "0x800706BA" in msg
        or "-2147023174" in msg
    )


def _format_connect_error(primary_exc: Exception, secondary_exc: Exception | None) -> str:
    if _is_rpc_unavailable_error(primary_exc) or (
        secondary_exc is not None and _is_rpc_unavailable_error(secondary_exc)
    ):
        return (
            "HWP 연결 실패: RPC 서버를 사용할 수 없습니다. "
            "한글(HWP)을 완전히 종료했다가 다시 실행하고, "
            "LitePro와 HWP를 같은 권한(일반/관리자)으로 실행하세요."
        )
    return f"HWP 연결 실패: {primary_exc}"


class HwpController:
    _IMAGE_INSERT_SCALE = 0.3

    def __init__(self, visible: bool = True, register_module: bool = True) -> None:
        self._hwp: Any | None = None
        self._visible = visible
        self._register_module = register_module
        self._in_condition_box = False
        self._box_line_start = False
        self._line_start = True
        self._first_line_written = False
        self._align_right_next_line = False
        self._line_right_aligned = False
        self._align_justify_next_line = False
        self._line_justify_aligned = False
        self._line_center_aligned = False
        self._last_was_equation = False
        self._underline_active = False
        self._bold_active = False
        self._template_dir = Path(__file__).resolve().parent / "templates"

    @staticmethod
    def _is_hwp_title(title: str) -> bool:
        return bool(title and re.search(r"\b(한글|HWP|Hwp)\b", title))

    @staticmethod
    def _extract_doc_name_from_title(title: str) -> str:
        if not title:
            return ""
        match = re.search(r"([^\\/\-]+\.hwp[x]?)", title, re.IGNORECASE)
        if match:
            return match.group(1)
        # Unsaved docs like "빈 문서1 - 한글"
        m2 = re.search(r"^\s*(.*?)\s*-\s*(한글|HWP|Hwp)\s*$", title)
        if m2:
            return m2.group(1).strip()
        return ""

    @staticmethod
    def get_foreground_document_name() -> str:
        """Return the document name from the foreground HWP window."""
        if not IS_WINDOWS:
            return ""
        try:
            import win32gui  # type: ignore

            fg = win32gui.GetForegroundWindow()
            title = win32gui.GetWindowText(fg) if fg else ""
            if not HwpController._is_hwp_title(title):
                return ""
            return HwpController._extract_doc_name_from_title(title) or title.strip()
        except Exception:
            return ""

    @staticmethod
    def find_hwp_windows() -> List[str]:
        if not IS_WINDOWS:
            return []

        import win32gui  # type: ignore

        results: List[str] = []

        def enum_windows_callback(hwnd, window_titles):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title and ("한글" in title or "HWP" in title or "Hwp" in title):
                    window_titles.append(title)

        win32gui.EnumWindows(enum_windows_callback, results)
        return results

    @staticmethod
    def get_current_filename() -> str:
        # Prefer the foreground HWP window to avoid selecting another document.
        fg_name = HwpController.get_foreground_document_name()
        if fg_name:
            return fg_name

        titles = HwpController.find_hwp_windows()
        if not titles:
            return ""
        for title in titles:
            name = HwpController._extract_doc_name_from_title(title)
            if name:
                return name
        return ""

    _uia_instance: Any = None
    _uia_walker: Any = None
    _last_detected_filename: str = ""

    @staticmethod
    def set_last_detected_filename(filename: str) -> None:
        HwpController._last_detected_filename = (filename or "").strip()

    @staticmethod
    def get_last_detected_filename() -> str:
        return HwpController._last_detected_filename

    @staticmethod
    def _ensure_uia() -> tuple[Any, Any]:
        """UI Automation 싱글턴 인스턴스를 반환합니다."""
        if HwpController._uia_instance is None:
            import comtypes  # type: ignore
            import comtypes.client  # type: ignore
            try:
                comtypes.CoInitialize()
            except OSError:
                pass
            uia_mod = comtypes.client.GetModule("UIAutomationCore.dll")
            uia = comtypes.CoCreateInstance(
                uia_mod.CUIAutomation._reg_clsid_,
                interface=uia_mod.IUIAutomation,
                clsctx=comtypes.CLSCTX_INPROC_SERVER,
            )
            HwpController._uia_instance = uia
            HwpController._uia_walker = uia.CreateTreeWalker(uia.RawViewCondition)
        return HwpController._uia_instance, HwpController._uia_walker

    @staticmethod
    def get_current_page() -> tuple[int, int]:
        """현재 커서가 위치한 (현재 페이지, 전체 페이지)를 반환합니다. 실패 시 (0, 0)."""
        if not IS_WINDOWS:
            return (0, 0)
        try:
            import win32gui  # type: ignore

            # Prefer the foreground HWP window; otherwise match by current filename.
            hwnd_target = 0
            fg = win32gui.GetForegroundWindow()
            fg_title = win32gui.GetWindowText(fg) if fg else ""

            def _is_hwp_title(title: str) -> bool:
                return bool(re.search(r"\b(한글|HWP|Hwp)\b", title))

            if fg and fg_title and _is_hwp_title(fg_title):
                hwnd_target = fg
            else:
                current_filename = HwpController.get_current_filename()
                candidates: list[tuple[int, str]] = []

                def _cb(hwnd: int, _: Any) -> None:
                    if win32gui.IsWindowVisible(hwnd):
                        title = win32gui.GetWindowText(hwnd)
                        if title and _is_hwp_title(title):
                            candidates.append((hwnd, title))

                win32gui.EnumWindows(_cb, None)

                if current_filename:
                    for hwnd, title in candidates:
                        if current_filename in title:
                            hwnd_target = hwnd
                            break

                if not hwnd_target:
                    for hwnd, title in candidates:
                        if re.search(r"\.hwp[x]?", title, re.IGNORECASE):
                            hwnd_target = hwnd
                            break

                if not hwnd_target and candidates:
                    hwnd_target = candidates[0][0]

            if not hwnd_target:
                return (0, 0)

            uia, walker = HwpController._ensure_uia()
            el = uia.ElementFromHandle(hwnd_target)

            def _find_page(elem: Any, depth: int = 0) -> tuple[int, int]:
                if depth > 8:
                    return (0, 0)
                try:
                    name = elem.CurrentName or ""
                    m = re.match(r"(\d+)/(\d+)쪽", name)
                    if m:
                        return (int(m.group(1)), int(m.group(2)))
                except Exception:
                    return (0, 0)
                try:
                    child = walker.GetFirstChildElement(elem)
                    while child:
                        result = _find_page(child, depth + 1)
                        if result[0] > 0:
                            return result
                        child = walker.GetNextSiblingElement(child)
                except Exception:
                    pass
                return (0, 0)

            return _find_page(el)
        except Exception:
            HwpController._uia_instance = None
            HwpController._uia_walker = None
            return (0, 0)

    @staticmethod
    def _clear_corrupted_com_cache() -> None:
        """Remove the win32com gen_py cache if it is corrupted.

        A corrupted cache causes 'Rebuilding cache of generated files for
        COM support...' messages and spawns black console windows.
        """
        try:
            import win32com  # type: ignore

            cache_dir = getattr(win32com, "__gen_path__", None)
            if cache_dir and Path(cache_dir).exists():
                import shutil

                shutil.rmtree(cache_dir, ignore_errors=True)
        except Exception:
            pass

    def connect(self) -> None:
        if not IS_WINDOWS:
            raise HwpControllerError("LitePro는 현재 Windows만 지원합니다.")

        if self._hwp is not None:
            return

        if not self.find_hwp_windows():
            raise HwpControllerError("한글(HWP) 창을 찾지 못했습니다. 먼저 HWP를 실행하세요.")

        with _preserve_foreground():
            hwp_obj = None
            attach_exc: Exception | None = None
            try:
                import win32com.client  # type: ignore

                hwp_obj = win32com.client.GetActiveObject("HWPFrame.HwpObject")
            except Exception as exc:
                attach_exc = exc
                hwp_obj = None

            if not hwp_obj:
                try:
                    import pyhwpx  # type: ignore

                    hwp_obj = pyhwpx.Hwp(
                        new=False,
                        visible=self._visible,
                        register_module=self._register_module,
                    )
                except ImportError:
                    raise
                except Exception as exc:
                    self._clear_corrupted_com_cache()
                    try:
                        import pyhwpx  # type: ignore

                        hwp_obj = pyhwpx.Hwp(
                            new=False,
                            visible=self._visible,
                            register_module=self._register_module,
                        )
                    except Exception as retry_exc:
                        raise HwpControllerError(
                            _format_connect_error(retry_exc, attach_exc)
                        ) from retry_exc

            self._hwp = hwp_obj
            self._try_activate_current_window()

    @staticmethod
    def _get_hwp_win_title(win: Any) -> str:
        for attr in ("Title", "Text", "Caption", "Name"):
            try:
                val = getattr(win, attr)
                if isinstance(val, str) and val.strip():
                    return val
            except Exception:
                pass
        for method in ("GetTitle", "get_Title"):
            try:
                val = getattr(win, method)()
                if isinstance(val, str) and val.strip():
                    return val
            except Exception:
                pass
        return ""

    @staticmethod
    def _activate_hwp_win(win: Any) -> bool:
        """Switch the active document inside HWP without stealing OS focus.

        Only use SetActive/Activate (internal document switch).
        Deliberately excludes SetForeground to avoid bringing HWP
        to the front while the user is working in another app.
        """
        for method in ("SetActive", "Activate", "setActive"):
            try:
                getattr(win, method)()
                return True
            except Exception:
                pass
        return False

    def _try_activate_current_window(self) -> None:
        """
        Best-effort: switch to the currently detected HWP document.
        Prevents typing into a newly created blank document when multiple
        docs are open.  Does NOT bring HWP to the foreground.
        """
        try:
            import win32gui  # type: ignore

            fg = win32gui.GetForegroundWindow()
            fg_title = win32gui.GetWindowText(fg) if fg else ""
        except Exception:
            fg_title = ""

        if not self._is_hwp_title(fg_title):
            return
        target_title = fg_title
        filename = self._extract_doc_name_from_title(fg_title)

        try:
            windows = self._ensure_connected().XHwpWindows
        except Exception:
            return

        try:
            count = windows.Count
        except Exception:
            return

        for i in range(count):
            try:
                win = windows.Item(i)
            except Exception:
                continue
            title = self._get_hwp_win_title(win)
            if (target_title and target_title in title) or (filename and filename in title):
                if self._activate_hwp_win(win):
                    return

    def activate_target_window(self, target_filename: str | None) -> None:
        """
        Best-effort: switch to a specific HWP document by filename/title.
        Falls back to the current window when target is empty or not found.
        Restores the original foreground window after switching.
        """
        with _preserve_foreground():
            if not target_filename:
                self._try_activate_current_window()
                return

            try:
                windows = self._ensure_connected().XHwpWindows
            except Exception:
                self._try_activate_current_window()
                return

            try:
                count = windows.Count
            except Exception:
                self._try_activate_current_window()
                return

            target = target_filename.strip()
            for i in range(count):
                try:
                    win = windows.Item(i)
                except Exception:
                    continue
                title = self._get_hwp_win_title(win)
                if target and target in title:
                    if self._activate_hwp_win(win):
                        return

            self._try_activate_current_window()

    def _ensure_connected(self) -> Any:
        if self._hwp is None:
            raise HwpControllerError("HwpController.connect()를 먼저 호출하세요.")
        return self._hwp

    def _insert_text_raw(self, text: str) -> None:
        if not text:
            return
        hwp = self._ensure_connected()
        try:
            hwp.HAction.GetDefault("InsertText", hwp.HParameterSet.HInsertText.HSet)
            hwp.HParameterSet.HInsertText.Text = text
            hwp.HAction.Execute("InsertText", hwp.HParameterSet.HInsertText.HSet)
        except Exception:
            for char in text:
                hwp.KeyIndicator(ord(char), 1)

    def _set_paragraph_align(self, align: str) -> None:
        try:
            if align == "right":
                self._ensure_connected().HAction.Run("ParagraphShapeAlignRight")
            elif align == "center":
                self._ensure_connected().HAction.Run("ParagraphShapeAlignCenter")
            elif align == "justify":
                self._ensure_connected().HAction.Run("ParagraphShapeAlignJustify")
            else:
                self._ensure_connected().HAction.Run("ParagraphShapeAlignLeft")
        except Exception:
            try:
                hwp = self._ensure_connected()
                if align == "right":
                    hwp.Run("ParagraphShapeAlignRight")
                elif align == "center":
                    hwp.Run("ParagraphShapeAlignCenter")
                elif align == "justify":
                    hwp.Run("ParagraphShapeAlignJustify")
                else:
                    hwp.Run("ParagraphShapeAlignLeft")
            except Exception:
                pass

    def set_align_right_next_line(self) -> None:
        """Right-align only the next line."""
        self._align_right_next_line = True

    def set_align_justify_next_line(self) -> None:
        """Justify-align only the next line."""
        self._align_justify_next_line = True

    def _maybe_insert_line_indent(self, spaces: int) -> None:
        if self._in_condition_box:
            return
        if self._line_start and self._first_line_written:
            self._insert_text_raw(" " * spaces)
            self._line_start = False

    def insert_text(self, text: str) -> None:
        if not text:
            return
        # Normalize escaped tab markers to actual tab
        if text.startswith("\\t") or text.startswith("/t"):
            text = "\t" + text[2:]
        # If a tab-indented formula line starts, insert a blank line above it.
        if self._line_start and text.startswith("\t") and self._first_line_written:
            self.insert_enter()
        # Apply one-line alignment BEFORE indentation logic.
        skip_auto_indent_right = False
        if self._line_start and self._align_right_next_line:
            self._set_paragraph_align("right")
            self._align_right_next_line = False
            self._line_right_aligned = True
            skip_auto_indent_right = True
        if self._line_start and self._align_justify_next_line:
            self._set_paragraph_align("justify")
            self._align_justify_next_line = False
            self._line_justify_aligned = True

        if self._line_start:
            if text.startswith("\t"):
                # If a tab is used for indentation, do not insert auto spaces.
                self._line_start = False
            elif text.startswith(" "):
                # Keep explicit indentation as-is.
                self._line_start = False
            else:
                if not skip_auto_indent_right:
                    # Avoid auto-indenting new problem numbering lines like "2." / "3)".
                    # This prevents the second/third problem from starting with two spaces.
                    if re.match(r"^\d+\s*[.)]", text):
                        pass
                    else:
                        pass

        # For right-aligned score lines, avoid leading indentation.
        if skip_auto_indent_right:
            text = text.lstrip(" \t")
        # If previous token was an equation, remove a single leading space.
        if self._last_was_equation and text.startswith(" "):
            text = text[1:]
        if self._in_condition_box and self._box_line_start and not text.startswith(" "):
            text = f" {text}"
            self._box_line_start = False
        self._insert_text_raw(text)
        self._line_start = False
        self._last_was_equation = False
        if not self._first_line_written:
            self._first_line_written = True

    def set_bold(self, enabled: bool = True) -> None:
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            param.Bold = 1 if enabled else 0
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"굵게 설정 실패: {exc}") from exc
        self._bold_active = enabled

    def set_underline(self, enabled: bool | None = None) -> None:
        """
        Toggle underline when enabled is None, otherwise set explicitly.
        """
        hwp = self._ensure_connected()
        if enabled is None:
            enabled = not self._underline_active
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            param.UnderlineType = 1 if enabled else 0
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"밑줄 설정 실패: {exc}") from exc
        self._underline_active = bool(enabled)

    def set_char_width_ratio(self, percent: int = 100) -> None:
        """
        Set character width ratio (장평). 100 = 100%.
        """
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            applied = False
            for attr in ("Ratio", "CharRatio", "WidthRatio"):
                if hasattr(param, attr):
                    setattr(param, attr, int(percent))
                    applied = True
                    break
            if not applied:
                # Fallback: try SetItem on the parameter set
                try:
                    param.HSet.SetItem("Ratio", int(percent))
                    applied = True
                except Exception:
                    pass
            if applied:
                action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"장평 설정 실패: {exc}") from exc

    def set_table_border_white(self) -> None:
        """
        Set current table borders to white (borderless look).
        Best-effort for different HWP versions.
        """
        hwp = self._ensure_connected()
        color = 0xFFFFFF
        try:
            action = hwp.HAction
            param_sets = hwp.HParameterSet
            candidates = [
                ("TableCellBorderFill", "HTableCellBorderFill"),
                ("CellBorderFill", "HCellBorderFill"),
            ]
            for action_name, param_name in candidates:
                if not hasattr(param_sets, param_name):
                    continue
                param = getattr(param_sets, param_name)
                action.GetDefault(action_name, param.HSet)
                for attr in (
                    "BorderColor",
                    "BorderColorLeft",
                    "BorderColorRight",
                    "BorderColorTop",
                    "BorderColorBottom",
                ):
                    if hasattr(param, attr):
                        setattr(param, attr, color)
                for attr in (
                    "BorderType",
                    "BorderTypeLeft",
                    "BorderTypeRight",
                    "BorderTypeTop",
                    "BorderTypeBottom",
                ):
                    if hasattr(param, attr):
                        setattr(param, attr, 1)
                action.Execute(action_name, param.HSet)
                return
        except Exception as exc:
            raise HwpControllerError(f"표 테두리 색상 설정 실패: {exc}") from exc

    def insert_enter(self) -> None:
        hwp = self._ensure_connected()
        try:
            hwp.HAction.Run("BreakPara")
            if self._in_condition_box:
                # Do not auto-insert a leading space after Enter.
                self._box_line_start = False
            self._line_start = True
            if self._line_right_aligned:
                self._set_paragraph_align("left")
                self._line_right_aligned = False
            if self._line_justify_aligned:
                self._set_paragraph_align("left")
                self._line_justify_aligned = False
            if self._line_center_aligned:
                self._set_paragraph_align("left")
                self._line_center_aligned = False
        except Exception as exc:
            raise HwpControllerError(f"단락 나누기 실패: {exc}") from exc

    def insert_space(self) -> None:
        self.insert_text(" ")

    def insert_paragraph(self) -> None:
        """
        Backward-compatible: line break + a single space.
        Use insert_enter() for line break only.
        """
        self.insert_enter()
        self.insert_space()

    def _set_font_size_pt(self, font_size_pt: float) -> None:
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            param.Height = int(font_size_pt * 100)
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"폰트 크기 설정 실패: {exc}") from exc

    def _set_font_name(self, font_name: str) -> None:
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            for attr in (
                "FaceName",
                "FaceNameUser",
                "FaceNameHangul",
                "FaceNameLatin",
                "FaceNameHanja",
                "FaceNameJapanese",
                "FaceNameOther",
                "FaceNameSymbol",
                "FontName",
            ):
                if hasattr(param, attr):
                    setattr(param, attr, font_name)
            for key in (
                "FaceName",
                "FaceNameUser",
                "FaceNameHangul",
                "FaceNameLatin",
                "FaceNameHanja",
                "FaceNameJapanese",
                "FaceNameOther",
                "FaceNameSymbol",
                "FontName",
            ):
                try:
                    param.HSet.SetItem(key, font_name)
                except Exception:
                    pass
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"글꼴 설정 실패: {exc}") from exc

    def _apply_compact_paragraph(self) -> None:
        """
        Best-effort: reduce paragraph spacing inside tables/boxes.
        """
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param_sets = hwp.HParameterSet
            if hasattr(param_sets, "HParaShape"):
                param = param_sets.HParaShape
                action.GetDefault("ParaShape", param.HSet)
                for attr in (
                    "Spacing",
                    "LineSpacing",
                    "LineSpace",
                    "LineSpacingType",
                    "Before",
                    "After",
                    "ParaTop",
                    "ParaBottom",
                ):
                    if hasattr(param, attr):
                        if "Line" in attr:
                            setattr(param, attr, 100)
                        else:
                            setattr(param, attr, 0)
                for key in (
                    "Spacing",
                    "LineSpacing",
                    "LineSpace",
                    "LineSpacingType",
                    "Before",
                    "After",
                    "ParaTop",
                    "ParaBottom",
                ):
                    try:
                        if "Line" in key:
                            param.HSet.SetItem(key, 100)
                        else:
                            param.HSet.SetItem(key, 0)
                    except Exception:
                        pass
                action.Execute("ParaShape", param.HSet)
        except Exception:
            pass

    def insert_small_paragraph(self, font_size_pt: float = 4.0) -> None:
        """
        Deprecated in LitePro: we no longer insert 4pt spacer lines.
        Kept for backward compatibility with generated scripts.
        """
        return

    def insert_equation(
        self,
        hwpeqn: str,
        *,
        font_size_pt: float = 8.0,
        eq_font_name: str = "HyhwpEQ",
        treat_as_char: bool = True,
        ensure_newline: bool = False,
    ) -> None:
        content = (hwpeqn or "")
        # If an equation line is indented with a tab, use ONLY the tab (no auto spaces).
        if self._line_start and content.startswith("\t"):
            self.insert_text("\t")
            content = content.lstrip("\t")

        # Apply one-line alignment BEFORE indentation logic.
        skip_auto_indent_right = False
        if self._line_start and self._align_right_next_line:
            self._set_paragraph_align("right")
            self._align_right_next_line = False
            self._line_right_aligned = True
            skip_auto_indent_right = True
        if self._line_start and self._align_justify_next_line:
            self._set_paragraph_align("justify")
            self._align_justify_next_line = False
            self._line_justify_aligned = True

        if not skip_auto_indent_right:
            self._maybe_insert_line_indent(2)
        hwp = self._ensure_connected()
        options = EquationOptions(
            font_size_pt=font_size_pt,
            eq_font_name=eq_font_name,
            treat_as_char=treat_as_char,
            ensure_newline=ensure_newline,
        )
        insert_equation_control(hwp, content, options=options)
        self._line_start = False
        self._last_was_equation = True
        if not self._first_line_written:
            self._first_line_written = True

    def insert_latex_equation(
        self,
        latex: str,
        *,
        font_size_pt: float = 8.0,
        eq_font_name: str = "HyhwpEQ",
        treat_as_char: bool = True,
        ensure_newline: bool = False,
    ) -> None:
        hwpeqn = latex_to_hwpeqn(latex)
        self.insert_equation(
            hwpeqn,
            font_size_pt=font_size_pt,
            eq_font_name=eq_font_name,
            treat_as_char=treat_as_char,
            ensure_newline=ensure_newline,
        )

    def _insert_box_raw(self) -> None:
        hwp = self._ensure_connected()
        if hasattr(hwp, "create_table"):
            hwp.create_table(1, 1)
        else:
            action = hwp.HAction
            if hasattr(hwp.HParameterSet, "HTableCreation"):
                param = hwp.HParameterSet.HTableCreation
                action.GetDefault("TableCreate", param.HSet)
                param.Rows = 1
                param.Cols = 1
                action.Execute("TableCreate", param.HSet)
            else:
                param_set = hwp.CreateSet("HTableCreation")
                action.GetDefault("TableCreate", param_set)
                param_set.SetItem("Rows", 1)
                param_set.SetItem("Cols", 1)
                action.Execute("TableCreate", param_set)

    def _apply_box_text_style(self, font_size_pt: float = 8.0) -> None:
        try:
            self._set_font_name("HyhwpEQ")
            self._set_font_size_pt(font_size_pt)
        except Exception:
            pass

    def _move_to_table_cell(self) -> bool:
        hwp = self._ensure_connected()
        before = self._capture_cursor_pos()
        try:
            hwp.HAction.Run("MoveToCell")
            after = self._capture_cursor_pos()
            changed = self._cursor_pos_changed(before, after)
            if changed is True:
                return True
            if self._is_in_table_context():
                return True
        except Exception:
            pass
        before = self._capture_cursor_pos()
        try:
            hwp.Run("MoveToCell")
            after = self._capture_cursor_pos()
            changed = self._cursor_pos_changed(before, after)
            if changed is True:
                return True
            if self._is_in_table_context():
                return True
        except Exception:
            pass
        return False

    def _cursor_pos_changed(self, before: Any | None, after: Any | None) -> bool:
        """Return True when two captured cursor positions are different."""
        if before is None or after is None:
            return False
        try:
            if isinstance(before, (tuple, list)) and isinstance(after, (tuple, list)):
                return tuple(before) != tuple(after)
            return before != after
        except Exception:
            return False

    def _is_in_table_context(self) -> bool:
        """
        Best-effort check that current caret is truly inside a table cell.
        """
        hwp = self._ensure_connected()
        try:
            hwp.HAction.Run("TableCellBlock")
            self._run_action_best_effort("Cancel")
            return True
        except Exception:
            pass
        try:
            hwp.Run("TableCellBlock")
            self._run_action_best_effort("Cancel")
            return True
        except Exception:
            pass
        # Fallback probe: horizontal cell movement only works in table context.
        try:
            hwp.HAction.Run("TableRightCell")
            try:
                hwp.HAction.Run("TableLeftCell")
            except Exception:
                pass
            return True
        except Exception:
            pass
        try:
            hwp.Run("TableRightCell")
            try:
                hwp.Run("TableLeftCell")
            except Exception:
                pass
            return True
        except Exception:
            return False

    def _try_insert_template(self, name: str) -> bool:
        template_path = self._template_dir / name
        if not template_path.exists():
            return False
        hwp = self._ensure_connected()
        action = getattr(hwp, "HAction", None)
        param_sets = getattr(hwp, "HParameterSet", None)
        action_names = ["InsertFile", "FileInsert"]
        param_names = ["HInsertFile", "HFileInsert"]

        # HAction + HParameterSet path
        if action is not None and param_sets is not None:
            for param_name in param_names:
                if not hasattr(param_sets, param_name):
                    continue
                param = getattr(param_sets, param_name)
                for action_name in action_names:
                    try:
                        action.GetDefault(action_name, param.HSet)
                        for attr in ("FileName", "FileName2", "FilePath", "Filename"):
                            if hasattr(param, attr):
                                setattr(param, attr, str(template_path))
                        # Some versions only accept SetItem on HSet.
                        try:
                            param.HSet.SetItem("FileName", str(template_path))
                        except Exception:
                            pass
                        try:
                            param.HSet.SetItem("FileName2", str(template_path))
                        except Exception:
                            pass
                        try:
                            param.HSet.SetItem("FilePath", str(template_path))
                        except Exception:
                            pass
                        try:
                            param.HSet.SetItem("Filename", str(template_path))
                        except Exception:
                            pass
                        for attr, val in (
                            ("KeepSection", 0),
                            ("KeepCharShape", 1),
                            ("KeepParagraphShape", 1),
                            ("KeepStyle", 1),
                            ("SaveBookmark", 0),
                        ):
                            if hasattr(param, attr):
                                setattr(param, attr, val)
                        action.Execute(action_name, param.HSet)
                        return True
                    except Exception:
                        continue

        # Direct method or Run fallback
        direct_names = [
            "InsertFile",
            "FileInsert",
            "insert_file",
            "insertfile",
            "Insertfile",
        ]
        for action_name in action_names:
            if hasattr(hwp, action_name):
                try:
                    getattr(hwp, action_name)(str(template_path))
                    return True
                except Exception:
                    pass
            try:
                hwp.Run(action_name, str(template_path))
                return True
            except Exception:
                continue
        for fn_name in direct_names:
            if hasattr(hwp, fn_name):
                try:
                    getattr(hwp, fn_name)(str(template_path))
                    return True
                except Exception:
                    pass
        return False

    def _cleanup_template_placeholder(self, marker: str) -> None:
        """Find and delete a template placeholder marker without moving the typing cursor."""
        candidates = [marker]
        if marker == "&&&":
            candidates.extend(["＆＆＆", "& & &", "＆ ＆ ＆"])

        saved_pos = self._capture_cursor_pos()
        # If position snapshot is unavailable on this HWP version, avoid
        # global cursor moves. Try local bidirectional search only.
        if saved_pos is None:
            if self._repeat_find_retry(candidates, attempts=3, delay_s=0.04, directions=(0, 1)):
                self._run_action_best_effort("Delete")
            return

        self._move_doc_start()
        found = False
        if self._repeat_find_retry(candidates, directions=(0,)):
            found = True
        if found:
            self._run_action_best_effort("Delete")
        # Keep user's typing flow stable by restoring the pre-cleanup caret.
        self._restore_cursor_pos(saved_pos)

    def cleanup_known_placeholders(self) -> None:
        """
        Best-effort cleanup of residual template markers that may remain
        due to environment-specific focus timing.
        """
        for marker in ("@@@", "###", "&&&"):
            try:
                self._cleanup_template_placeholder(marker)
            except Exception:
                pass

    def cleanup_known_placeholders_near_cursor(self) -> None:
        """
        Cleanup placeholders without global cursor moves.
        This is safe to run at the very end of typing.
        """
        marker_candidates = {
            "@@@": ["@@@", "＠＠＠", "@ @ @", "＠ ＠ ＠"],
            "###": ["###", "＃＃＃", "# # #", "＃ ＃ ＃"],
            "&&&": ["&&&", "＆＆＆", "& & &", "＆ ＆ ＆"],
        }
        for marker in ("@@@", "###", "&&&"):
            try:
                candidates = marker_candidates.get(marker, [marker])
                if self._repeat_find_retry(
                    candidates, attempts=3, delay_s=0.04, directions=(0, 1)
                ):
                    self._run_action_best_effort("Delete")
                    self._run_action_best_effort("Cancel")
            except Exception:
                pass

    def insert_template(self, name: str) -> None:
        """
        Insert a prebuilt HWP template file from `litepro/templates/` at the cursor.

        Example: insert_template("header.hwp")
        """
        if not name:
            raise HwpControllerError("템플릿 이름이 비어있습니다.")
        ok = self._try_insert_template(name)
        if not ok:
            template_path = self._template_dir / name
            raise HwpControllerError(f"템플릿을 찾지 못했습니다: {template_path}")
        # After inserting box templates, remove &&& placeholder if present
        # to prevent cursor-jump issues when focus_placeholder('&&&') runs later.
        base = name.lower().replace("\\", "/").rsplit("/", 1)[-1]
        if base in ("box.hwp", "box_white.hwp"):
            self._cleanup_template_placeholder("&&&")

    def _run_action_best_effort(self, action_name: str) -> bool:
        hwp = self._ensure_connected()
        try:
            hwp.HAction.Run(action_name)
            return True
        except Exception:
            pass
        try:
            hwp.Run(action_name)
            return True
        except Exception:
            return False

    def _repeat_find(self, needle: str, direction: int = 0) -> bool:
        """
        Move selection/cursor to the next occurrence of `needle`.
        Returns True if found, False otherwise.
        """
        if not needle:
            return False
        hwp = self._ensure_connected()
        action = getattr(hwp, "HAction", None)
        param_sets = getattr(hwp, "HParameterSet", None)
        if action is None or param_sets is None or not hasattr(param_sets, "HFindReplace"):
            raise HwpControllerError("HWP FindReplace 인터페이스를 찾지 못했습니다.")
        param = param_sets.HFindReplace
        try:
            action.GetDefault("RepeatFind", param.HSet)
            if hasattr(param, "FindString"):
                param.FindString = needle
            if hasattr(param, "ReplaceString"):
                param.ReplaceString = ""
            if hasattr(param, "IgnoreMessage"):
                param.IgnoreMessage = 1
            for attr, val in (
                ("MatchCase", 0),
                ("WholeWordOnly", 0),
                ("AutoSpell", 0),
                ("UseWildCards", 0),
                ("SeveralWords", 0),
                ("FindRegExp", 0),
                ("FindStyle", 0),
            ):
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, val)
                    except Exception:
                        pass
            # Scope-expanding flags for HWP versions that support them.
            for attr, val in (
                ("FindInTable", 1),
                ("IncludeTable", 1),
                ("AllDocument", 1),
                ("FindScope", 0),
            ):
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, val)
                    except Exception:
                        pass
            if hasattr(param, "Direction"):
                try:
                    param.Direction = int(direction)
                except Exception:
                    pass
            result = action.Execute("RepeatFind", param.HSet)
            if result is False:
                return False
            try:
                return bool(int(result))
            except Exception:
                return True
        except Exception:
            return False

    def _repeat_find_retry(
        self,
        candidates: list[str],
        attempts: int = 6,
        delay_s: float = 0.06,
        directions: tuple[int, ...] = (0,),
    ) -> bool:
        """
        Retry RepeatFind for a short window to absorb async template insertion
        timing differences across PCs/HWP versions.
        """
        for i in range(max(1, attempts)):
            for direction in directions:
                for needle in candidates:
                    if self._repeat_find(needle, direction=direction):
                        return True
            if i < attempts - 1:
                time.sleep(delay_s)
        return False

    def _move_doc_start(self) -> None:
        """
        Best-effort move cursor to document start.
        """
        for action_name in ("MoveDocBegin", "MoveTop", "MoveBegin"):
            if self._run_action_best_effort(action_name):
                return

    def _capture_cursor_pos(self) -> Any | None:
        """
        Best-effort capture of current caret position across HWP versions.
        """
        hwp = self._ensure_connected()
        getter = getattr(hwp, "GetPos", None)
        if getter is None:
            return None
        try:
            return getter()
        except Exception:
            return None

    def _restore_cursor_pos(self, pos: Any | None) -> bool:
        """
        Best-effort restore of a caret position captured by _capture_cursor_pos().
        """
        if pos is None:
            return False
        hwp = self._ensure_connected()
        setter = getattr(hwp, "SetPos", None)
        if setter is None:
            return False
        try:
            if isinstance(pos, (tuple, list)):
                setter(*pos)
            else:
                setter(pos)
            return True
        except Exception:
            return False

    def focus_placeholder(self, marker: str) -> None:
        """
        Find `marker` (e.g. '@@@' or '###'), delete it, and leave the cursor there.
        This enables "기존의 @@@/###을 지우고 그 자리에 타이핑" workflows.
        """
        if marker == "###":
            self._focus_hash_placeholder()
            return

        candidates = [marker]
        original_pos = self._capture_cursor_pos()
        if marker == "@@@":
            candidates.extend(["＠＠＠", "@ @ @", "＠ ＠ ＠"])
        elif marker == "&&&":
            candidates.extend(["＆＆＆", "& & &", "＆ ＆ ＆"])

        found = False
        if self._repeat_find_retry(candidates, directions=(0, 1)):
            found = True
        if not found:
            if marker == "&&&":
                return
            if original_pos is not None:
                self._move_doc_start()
                if self._repeat_find_retry(candidates):
                    found = True
        if not found:
            if original_pos is not None:
                self._restore_cursor_pos(original_pos)
            return

        self._delete_found_marker()

    def _focus_hash_placeholder(self) -> None:
        """
        Specialized handler for ### which lives inside a table cell (보기 box).
        RepeatFind cannot search into table cells on some HWP versions,
        so we use multiple strategies including structural navigation.
        """
        candidates = ["###", "＃＃＃", "# # #", "＃ ＃ ＃"]
        original_pos = self._capture_cursor_pos()

        # Strategy 1: Text search with scope-expanding flags (works on
        # HWP versions where RepeatFind CAN enter tables).
        if self._repeat_find_retry(candidates, directions=(0, 1, 2)):
            self._delete_found_marker()
            return

        # Strategy 2: Locate "<보기>" heading near current cursor and enter
        # the table right below it. This is robust even when ### text is not searchable.
        if self._focus_view_box_from_heading():
            if self._repeat_find_retry(candidates, attempts=2, directions=(0, 1)):
                self._delete_found_marker()
            self._mark_inside_box()
            return

        # Strategy 3: Navigate forward from current position into the
        # next table cell. After typing problem text, the 보기 box table
        # is usually the next table going forward.
        if self._navigate_forward_into_table():
            if self._repeat_find_retry(candidates, attempts=2, directions=(0, 1)):
                self._delete_found_marker()
            self._mark_inside_box()
            return

        # Strategy 4: Restore original position and retry forward table navigation.
        if original_pos is not None:
            self._restore_cursor_pos(original_pos)
            if self._navigate_forward_into_table():
                if self._repeat_find_retry(candidates, attempts=2, directions=(0, 1)):
                    self._delete_found_marker()
                self._mark_inside_box()
                return

        # All strategies exhausted. Stay at current position so typing
        # at least continues near where it should be. Do NOT create a new
        # view box or move to doc start.

    def _delete_found_marker(self) -> None:
        """Delete the marker text that RepeatFind just selected."""
        if self._run_action_best_effort("Delete"):
            return
        if self._run_action_best_effort("DeleteBack"):
            return
        try:
            self._insert_text_raw("")
        except Exception:
            pass

    def _navigate_forward_into_table(self) -> bool:
        """
        From the current cursor position, navigate forward (MoveDown)
        until entering a table cell. Returns True if a cell was entered.
        """
        for _ in range(80):
            self._run_action_best_effort("MoveDown")
            if self._move_to_table_cell():
                return True
        return False

    def _focus_view_box_from_heading(self) -> bool:
        """
        Fallback path for ###:
        find a '<보기>' heading and move into the nearest table cell below it.
        """
        saved_pos = self._capture_cursor_pos()
        heading_candidates = ["<보기>", "< 보 기 >", "<보", "보기>"]
        # Search near current cursor first (both directions), then try from top.
        found_heading = self._repeat_find_retry(
            heading_candidates, attempts=6, delay_s=0.05, directions=(0, 1)
        )
        if not found_heading:
            self._move_doc_start()
            found_heading = self._repeat_find_retry(
                heading_candidates, attempts=8, delay_s=0.05, directions=(0,)
            )
        if not found_heading:
            if saved_pos is not None:
                self._restore_cursor_pos(saved_pos)
            return False

        # Clear heading selection and move down near the box area.
        self._run_action_best_effort("Cancel")
        for _ in range(20):
            self._run_action_best_effort("MoveDown")
            if self._move_to_table_cell():
                return True

        if saved_pos is not None:
            self._restore_cursor_pos(saved_pos)
        return False

    def _mark_inside_box(self) -> None:
        """Update controller state to match being inside a 보기/조건 box."""
        self._in_condition_box = True
        self._box_line_start = True
        self._line_start = False
        if not self._first_line_written:
            self._first_line_written = True

    def insert_box(self) -> None:
        """
        Insert a plain 1x1 table (box) for conditions.
        Cursor stays inside the box for content insertion.
        """
        try:
            if self._try_insert_template("box_template_noheader.hwp"):
                if not self._move_to_table_cell():
                    # Template inserted but cursor did not move into cell: fallback to raw table.
                    self._insert_box_raw()
                    self._move_to_table_cell()
                self._in_condition_box = True
                self._box_line_start = True
                self._line_start = False
                if not self._first_line_written:
                    self._first_line_written = True
                self._apply_box_text_style(8.0)
                self._apply_compact_paragraph()
                return
            if not (self._align_justify_next_line or self._align_right_next_line):
                self._maybe_insert_line_indent(1)
            self._insert_box_raw()
            self._move_to_table_cell()
            self._in_condition_box = True
            self._box_line_start = True
            self._line_start = False
            if not self._first_line_written:
                self._first_line_written = True
            self._apply_box_text_style(8.0)
            self._apply_compact_paragraph()
        except Exception as exc:
            raise HwpControllerError(f"박스 삽입 실패: {exc}") from exc

    def insert_view_box(self) -> None:
        """
        Insert a 1x1 table for a <보기> container.
        The <보기> header text is assumed to be pre-printed or added separately.
        """
        if self._try_insert_template("box_template.hwp"):
            if not self._move_to_table_cell():
                # Template inserted but cursor did not move into cell: fallback to raw table.
                self._insert_box_raw()
                self._move_to_table_cell()
            self._in_condition_box = True
            self._box_line_start = True
            self._line_start = False
            if not self._first_line_written:
                self._first_line_written = True
            self._apply_box_text_style(8.0)
            self._apply_compact_paragraph()
            # Default to justify alignment for boxed passages.
            self._set_paragraph_align("justify")
            return

        if not (self._align_justify_next_line or self._align_right_next_line):
            self._maybe_insert_line_indent(1)
        self._insert_box_raw()
        self._move_to_table_cell()
        self._line_start = False
        if not self._first_line_written:
            self._first_line_written = True

        # Match novaai behavior: add "< 보 기 >" header centered.
        try:
            hwp = self._ensure_connected()
            try:
                hwp.HAction.Run("ParagraphShapeAlignCenter")
            except Exception:
                try:
                    hwp.Run("ParagraphShapeAlignCenter")
                except Exception:
                    pass
            self._apply_box_text_style(8.0)
            self.insert_text("< 보 기 >")
            try:
                hwp.HAction.Run("BreakPara")
            except Exception:
                self.insert_enter()
            try:
                hwp.HAction.Run("ParagraphShapeAlignLeft")
            except Exception:
                try:
                    hwp.Run("ParagraphShapeAlignLeft")
                except Exception:
                    pass
        except Exception:
            pass

        # Ensure <보기> content uses 8pt (and equation-friendly font) consistently.
        self._apply_box_text_style(8.0)
        self._apply_compact_paragraph()
        # Default to justify alignment for boxed passages.
        self._set_paragraph_align("justify")

    def insert_table(
        self,
        rows: int,
        cols: int,
        *,
        cell_data: list[list[str]] | None = None,
        align_center: bool = False,
        exit_after: bool = True,
    ) -> None:
        """
        Insert a table and optionally fill cell contents row by row.
        """
        if rows <= 0 or cols <= 0:
            raise HwpControllerError("표의 행/열은 1 이상이어야 합니다.")
        hwp = self._ensure_connected()
        try:
            if not (self._align_justify_next_line or self._align_right_next_line):
                self._maybe_insert_line_indent(1)
            action = hwp.HAction
            if hasattr(hwp.HParameterSet, "HTableCreation"):
                param = hwp.HParameterSet.HTableCreation
                action.GetDefault("TableCreate", param.HSet)
                param.Rows = rows
                param.Cols = cols
                action.Execute("TableCreate", param.HSet)
            else:
                param_set = hwp.CreateSet("HTableCreation")
                action.GetDefault("TableCreate", param_set)
                param_set.SetItem("Rows", rows)
                param_set.SetItem("Cols", cols)
                action.Execute("TableCreate", param_set)
            self._line_start = False
            if not self._first_line_written:
                self._first_line_written = True

            # Best-effort: minimize table cell padding/margins.
            try:
                param_sets = hwp.HParameterSet
                candidates = [
                    ("TableCellBorderFill", "HTableCellBorderFill"),
                    ("CellBorderFill", "HCellBorderFill"),
                ]
                for action_name, param_name in candidates:
                    if not hasattr(param_sets, param_name):
                        continue
                    tparam = getattr(param_sets, param_name)
                    action.GetDefault(action_name, tparam.HSet)
                    for attr in (
                        "MarginLeft",
                        "MarginRight",
                        "MarginTop",
                        "MarginBottom",
                        "CellMarginLeft",
                        "CellMarginRight",
                        "CellMarginTop",
                        "CellMarginBottom",
                    ):
                        if hasattr(tparam, attr):
                            setattr(tparam, attr, 0)
                    for key in (
                        "MarginLeft",
                        "MarginRight",
                        "MarginTop",
                        "MarginBottom",
                        "CellMarginLeft",
                        "CellMarginRight",
                        "CellMarginTop",
                        "CellMarginBottom",
                    ):
                        try:
                            tparam.HSet.SetItem(key, 0)
                        except Exception:
                            pass
                    action.Execute(action_name, tparam.HSet)
            except Exception:
                pass

            if cell_data:
                def _apply_table_font() -> None:
                    try:
                        action = hwp.HAction
                        param = hwp.HParameterSet.HCharShape
                        action.GetDefault("CharShape", param.HSet)
                        param.Height = int(8.0 * 100)
                        for attr in (
                            "FaceName",
                            "FaceNameUser",
                            "FaceNameHangul",
                            "FaceNameLatin",
                            "FaceNameHanja",
                            "FaceNameJapanese",
                            "FaceNameOther",
                            "FaceNameSymbol",
                            "FontName",
                        ):
                            if hasattr(param, attr):
                                setattr(param, attr, "HyhwpEQ")
                        # Best-effort for versions that only accept SetItem on HSet.
                        for key in (
                            "FaceName",
                            "FaceNameUser",
                            "FaceNameHangul",
                            "FaceNameLatin",
                            "FaceNameHanja",
                            "FaceNameJapanese",
                            "FaceNameOther",
                            "FaceNameSymbol",
                            "FontName",
                        ):
                            try:
                                param.HSet.SetItem(key, "HyhwpEQ")
                            except Exception:
                                pass
                        action.Execute("CharShape", param.HSet)
                    except Exception:
                        pass

                # Normalize cell_data to rows x cols
                if cell_data and cell_data and isinstance(cell_data[0], str):
                    flat = [str(x) for x in cell_data]
                    cell_data = [
                        flat[i : i + cols] for i in range(0, len(flat), cols)
                    ]

                def _run(action_name: str) -> None:
                    try:
                        hwp.HAction.Run(action_name)
                    except Exception:
                        try:
                            hwp.Run(action_name)
                        except Exception:
                            pass

                max_rows = min(rows, len(cell_data))
                for r in range(max_rows):
                    row = cell_data[r]
                    max_cols = min(cols, len(row))
                    for c in range(max_cols):
                        _apply_table_font()
                        self._apply_compact_paragraph()
                        try:
                            self._set_font_name("HyhwpEQ")
                        except Exception:
                            pass
                        if align_center:
                            try:
                                hwp.HAction.Run("ParagraphShapeAlignCenter")
                            except Exception:
                                try:
                                    hwp.Run("ParagraphShapeAlignCenter")
                                except Exception:
                                    pass
                        if row[c]:
                            value = str(row[c])
                            if value.startswith("EQ:"):
                                self.insert_equation(value.replace("EQ:", "", 1).strip())
                            else:
                                self.insert_text(value)
                        if c < cols - 1:
                            _run("TableRightCell")
                    if r < rows - 1:
                        _run("TableLowerCell")
                        for _ in range(cols - 1):
                            _run("TableLeftCell")
        except Exception as exc:
            raise HwpControllerError(f"표 삽입 실패: {exc}") from exc
        finally:
            # Prevent follow-up typing from continuing inside the last table cell.
            # If callers need to keep the cursor inside the table (e.g., for additional table actions),
            # they can pass exit_after=False.
            if exit_after:
                try:
                    self.exit_table()
                except Exception:
                    # Best-effort: if table exit fails, don't crash the whole script.
                    pass
                # Ensure subsequent text starts with normal left alignment outside the table.
                try:
                    self._set_paragraph_align("left")
                except Exception:
                    pass
                self._line_start = True

    def exit_box(self) -> None:
        """Exit the current box/table and move cursor after it."""
        hwp = self._ensure_connected()
        try:
            try:
                hwp.HAction.Run("CloseEx")
                hwp.HAction.Run("MoveDown")
                self._in_condition_box = False
                self._box_line_start = False
                return
            except Exception:
                pass
            try:
                hwp.HAction.Run("TableLowerCell")
                hwp.HAction.Run("MoveDown")
                self._in_condition_box = False
                self._box_line_start = False
                return
            except Exception:
                pass
            self._in_condition_box = False
            self._box_line_start = False
            raise HwpControllerError("박스 종료 실패: 표/박스 이동 실패")
        except Exception as exc:
            raise HwpControllerError(f"박스 종료 실패: {exc}") from exc

    # ── Image insertion (1x1 invisible-table approach) ──────
    _source_image_path: str | None = None

    def set_source_image(self, path: str | None) -> None:
        """Set the original source image path used for cropping."""
        self._source_image_path = path

    # Max pixel width for cropped images before gentle downscaling.
    _CROP_MAX_WIDTH = 900

    def insert_cropped_image(
        self,
        x1_pct: float,
        y1_pct: float,
        x2_pct: float,
        y2_pct: float,
    ) -> None:
        """
        Crop a region from the source image and insert it into the HWP document.

        Parameters are percentages (0.0–1.0) of the original image dimensions:
            x1_pct, y1_pct = top-left corner
            x2_pct, y2_pct = bottom-right corner

        The cropped region is already a small portion of the original, so we
        only downscale when it exceeds _CROP_MAX_WIDTH pixels.
        """
        src = self._source_image_path
        if not src or not Path(src).exists():
            raise HwpControllerError(
                "insert_cropped_image 실패: 원본 이미지 경로가 설정되지 않았습니다."
            )

        try:
            from PIL import Image
        except ImportError:
            raise HwpControllerError(
                "insert_cropped_image 실패: Pillow 라이브러리가 필요합니다."
            )

        img = Image.open(src)
        w, h = img.size

        x1 = max(0, min(int(x1_pct * w), w))
        y1 = max(0, min(int(y1_pct * h), h))
        x2 = max(0, min(int(x2_pct * w), w))
        y2 = max(0, min(int(y2_pct * h), h))

        if x2 <= x1 or y2 <= y1:
            raise HwpControllerError(
                f"insert_cropped_image 실패: 잘못된 좌표 "
                f"({x1_pct},{y1_pct})-({x2_pct},{y2_pct})"
            )

        cropped = img.crop((x1, y1, x2, y2))

        cw, ch = cropped.size
        if cw > self._CROP_MAX_WIDTH:
            scale = self._CROP_MAX_WIDTH / cw
            cropped = cropped.resize(
                (self._CROP_MAX_WIDTH, max(1, int(ch * scale))),
                Image.LANCZOS,
            )

        tmp_dir = Path(tempfile.gettempdir()) / "nova_ai"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = tmp_dir / f"crop_{os.getpid()}_{id(cropped)}.png"
        cropped.save(str(tmp_path), format="PNG")

        # Insert directly into 1x1 table WITHOUT the 0.3x resize.
        # The crop itself already produces a reasonably sized image.
        self._insert_1x1_table()
        self._set_current_table_border_none()
        try:
            self._set_paragraph_align("center")
        except Exception:
            pass
        self._raw_insert_picture(str(tmp_path))
        self._exit_table_after_image()

    # ── Low-level image helpers (table-based) ─────────────

    def _insert_1x1_table(self) -> None:
        """Insert a 1x1 table with zero-padding. Cursor lands inside the cell."""
        hwp = self._ensure_connected()
        action = hwp.HAction
        if hasattr(hwp.HParameterSet, "HTableCreation"):
            param = hwp.HParameterSet.HTableCreation
            action.GetDefault("TableCreate", param.HSet)
            param.Rows = 1
            param.Cols = 1
            action.Execute("TableCreate", param.HSet)
        else:
            param_set = hwp.CreateSet("HTableCreation")
            action.GetDefault("TableCreate", param_set)
            param_set.SetItem("Rows", 1)
            param_set.SetItem("Cols", 1)
            action.Execute("TableCreate", param_set)

        # Zero out cell margins so the image fills the cell tightly.
        try:
            param_sets = hwp.HParameterSet
            for action_name, param_name in (
                ("TableCellBorderFill", "HTableCellBorderFill"),
                ("CellBorderFill", "HCellBorderFill"),
            ):
                if not hasattr(param_sets, param_name):
                    continue
                tparam = getattr(param_sets, param_name)
                action.GetDefault(action_name, tparam.HSet)
                for attr in (
                    "MarginLeft", "MarginRight", "MarginTop", "MarginBottom",
                    "CellMarginLeft", "CellMarginRight",
                    "CellMarginTop", "CellMarginBottom",
                ):
                    if hasattr(tparam, attr):
                        setattr(tparam, attr, 0)
                    try:
                        tparam.HSet.SetItem(attr, 0)
                    except Exception:
                        pass
                action.Execute(action_name, tparam.HSet)
                break
        except Exception:
            pass

    def _set_current_table_border_none(self) -> None:
        """Set all borders of the current table cell to 0 (none / invisible)."""
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param_sets = hwp.HParameterSet
            for action_name, param_name in (
                ("TableCellBorderFill", "HTableCellBorderFill"),
                ("CellBorderFill", "HCellBorderFill"),
            ):
                if not hasattr(param_sets, param_name):
                    continue
                param = getattr(param_sets, param_name)
                action.GetDefault(action_name, param.HSet)
                for attr in (
                    "BorderType", "BorderTypeLeft", "BorderTypeRight",
                    "BorderTypeTop", "BorderTypeBottom",
                ):
                    if hasattr(param, attr):
                        setattr(param, attr, 0)
                action.Execute(action_name, param.HSet)
                return
        except Exception:
            pass

    def _exit_table_after_image(self) -> None:
        """Exit the 1x1 image-wrapper table so the cursor sits below it."""
        hwp = self._ensure_connected()
        try:
            hwp.HAction.Run("CloseEx")
            hwp.HAction.Run("MoveDown")
        except Exception:
            try:
                hwp.HAction.Run("TableLowerCell")
                hwp.HAction.Run("CloseEx")
                hwp.HAction.Run("MoveDown")
            except Exception:
                pass

    def _raw_insert_picture(self, image_path: str) -> None:
        """Insert an image file into HWP as inline (글자처럼 취급)."""
        hwp = self._ensure_connected()
        abs_path = str(Path(image_path).resolve())

        action = getattr(hwp, "HAction", None)
        param_sets = getattr(hwp, "HParameterSet", None)

        if action is not None and param_sets is not None:
            for param_name in ("HInsertPicture", "HPicture"):
                param_obj = getattr(param_sets, param_name, None)
                if param_obj is None:
                    continue
                try:
                    action.GetDefault("InsertPicture", param_obj.HSet)
                    param_obj.FileName = abs_path
                    if hasattr(param_obj, "Treatment"):
                        param_obj.Treatment = 0  # 글자처럼 취급
                    if hasattr(param_obj, "SizeType"):
                        param_obj.SizeType = 0
                    result = action.Execute("InsertPicture", param_obj.HSet)
                    if result is not False:
                        self._try_set_treat_as_char()
                        return
                except Exception:
                    continue

        for method_name in ("InsertPicture", "insert_picture"):
            fn = getattr(hwp, method_name, None)
            if fn is not None:
                try:
                    fn(abs_path, 0)
                    self._try_set_treat_as_char()
                    return
                except Exception:
                    continue

        try:
            hwp.Run("InsertPicture")
            self._try_set_treat_as_char()
            return
        except Exception:
            pass

        raise HwpControllerError(f"이미지 삽입 실패: {abs_path}")

    def _try_set_treat_as_char(self) -> None:
        """Best-effort: set TreatAsChar on the most recently inserted picture.

        Uses multiple strategies in order:
        1. ShapeObjDialog HAction (most reliable, works inside table cells)
        2. Direct ctrl.Properties manipulation
        3. SelectCtrlReverse → retry strategies above
        """
        hwp = self._ensure_connected()

        # ── Strategy 1: ShapeObjDialog (works even inside table cells) ──
        try:
            pset = hwp.HParameterSet.HShapeObject
            hwp.HAction.GetDefault("ShapeObjDialog", pset.HSet)
            pset.TreatAsChar = 1
            pset.TextWrap = 0
            hwp.HAction.Execute("ShapeObjDialog", pset.HSet)
            return
        except Exception:
            pass

        # ── Strategy 2: Select the control, then direct property set ──
        ctrl = getattr(hwp, "CurSelectedCtrl", None)

        if ctrl is None:
            for sel_action in ("SelectCtrlReverse", "SelectCtrlFront"):
                try:
                    hwp.HAction.Run(sel_action)
                    ctrl = getattr(hwp, "CurSelectedCtrl", None)
                    if ctrl is not None:
                        break
                except Exception:
                    continue

        if ctrl is None:
            try:
                ctrl = getattr(hwp, "LastCtrl", None)
                hops = 0
                while ctrl is not None and hops < 20:
                    ctrl_id = str(getattr(ctrl, "CtrlID", "") or "").lower()
                    if ctrl_id == "gso":
                        break
                    ctrl = getattr(ctrl, "Prev", None)
                    hops += 1
                else:
                    ctrl = None
            except Exception:
                ctrl = None

        if ctrl is not None:
            try:
                prop = ctrl.Properties
                prop.SetItem("TreatAsChar", 1)
                ctrl.Properties = prop
            except Exception:
                pass

            # Retry ShapeObjDialog now that a ctrl is selected
            try:
                pset = hwp.HParameterSet.HShapeObject
                hwp.HAction.GetDefault("ShapeObjDialog", pset.HSet)
                pset.TreatAsChar = 1
                pset.TextWrap = 0
                hwp.HAction.Execute("ShapeObjDialog", pset.HSet)
            except Exception:
                pass

        try:
            hwp.HAction.Run("Cancel")
        except Exception:
            pass

    def _physically_resize_image(self, image_path: str, scale: float) -> str:
        """Create a physically smaller copy of the image using Pillow.

        Returns the path to the resized file, or *image_path* unchanged
        when resizing is not possible.
        """
        try:
            from PIL import Image

            img = Image.open(image_path)
            w, h = img.size
            s = max(0.1, scale)
            new_w, new_h = max(1, int(w * s)), max(1, int(h * s))
            resized = img.resize((new_w, new_h), Image.LANCZOS)
            tmp_dir = Path(tempfile.gettempdir()) / "nova_ai"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            out = tmp_dir / f"resized_{os.getpid()}_{id(resized)}.png"
            resized.save(str(out), format="PNG")
            img.close()
            return str(out)
        except Exception:
            return image_path

    def _insert_picture(self, image_path: str) -> None:
        """Insert image into the HWP document inside an invisible 1x1 table.

        Strategy:
        1. Physically resize the image with Pillow (0.3x).
        2. Insert a 1x1 table (block-level element — text cannot flow beside it).
        3. Set table border to 0/none (invisible).
        4. Insert the resized image inside the table cell.
        5. Exit the table — cursor moves below the image.

        This approach uses structure (table) instead of properties
        (TreatAsChar, TextWrap) to enforce block layout.
        """
        abs_path = str(Path(image_path).resolve())

        # ── 1. Physically resize the image ────────────────────
        insert_path = self._physically_resize_image(abs_path, self._IMAGE_INSERT_SCALE)

        # ── 2. Insert 1x1 table ──────────────────────────────
        self._insert_1x1_table()

        # ── 3. Set table border to none (invisible) ──────────
        self._set_current_table_border_none()

        # ── 4. Center-align cell & insert the image ──────────
        try:
            self._set_paragraph_align("center")
        except Exception:
            pass
        self._raw_insert_picture(insert_path)

        # ── 5. Exit table — cursor below the image ───────────
        self._exit_table_after_image()

    def exit_table(self) -> None:
        """Exit the current table without adding an extra blank line."""
        hwp = self._ensure_connected()
        try:
            try:
                hwp.HAction.Run("CloseEx")
                hwp.HAction.Run("MoveDown")
                return
            except Exception:
                pass
            try:
                # Avoid MoveDown to prevent creating an extra blank line.
                hwp.HAction.Run("TableLowerCell")
                try:
                    hwp.HAction.Run("CloseEx")
                    hwp.HAction.Run("MoveDown")
                except Exception:
                    pass
                return
            except Exception:
                pass
            raise HwpControllerError("표 종료 실패: 표/박스 이동 실패")
        except Exception as exc:
            raise HwpControllerError(f"표 종료 실패: {exc}") from exc
