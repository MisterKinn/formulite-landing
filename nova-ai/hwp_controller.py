from __future__ import annotations

import contextlib
import os
import platform
import re
import tempfile
import time
from pathlib import Path
from image_path_utils import load_cv2_image, load_pil_image
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
    lower = msg.lower()
    return (
        "rpc server is unavailable" in lower
        or "0x800706ba" in lower
        or "-2147023174" in lower
        or ("rpc" in lower and ("unavailable" in lower or "server" in lower))
        or ("RPC" in msg and ("서버" in msg or "연결" in msg))
    )


def _format_connect_error(primary_exc: Exception, secondary_exc: Exception | None) -> str:
    if _is_rpc_unavailable_error(primary_exc) or (
        secondary_exc is not None and _is_rpc_unavailable_error(secondary_exc)
    ):
        return (
            "HWP 연결 실패: RPC 서버를 사용할 수 없습니다. "
            "한글(HWP)을 완전히 종료한 뒤 다시 실행하고, "
            "LitePro와 HWP를 같은 권한(일반/관리자)으로 실행해 주세요."
        )
    return f"HWP 연결 실패: {primary_exc}"


class HwpController:
    _IMAGE_INSERT_SCALE = 0.3
    _UIA_RETRY_COOLDOWN_SEC = 30.0

    def __init__(self, visible: bool = True, register_module: bool = True) -> None:
        self._hwp: Any | None = None
        self._visible = visible
        self._register_module = register_module
        self._in_condition_box = False
        self._box_line_start = False
        self._line_start = True
        self._first_line_written = False
        self._problem_stem_indent_active = False
        self._align_center_next_line = False
        self._align_right_next_line = False
        self._line_right_aligned = False
        self._align_justify_next_line = False
        self._line_justify_aligned = False
        self._line_center_aligned = False
        self._last_was_equation = False
        self._underline_active = False
        self._bold_active = False
        self._template_dir = Path(__file__).resolve().parent / "templates"
        # User-configurable typing styles (applied from GUI settings).
        self._typing_text_font_name = "한컴 윤고딕 720"
        self._typing_text_font_size_pt = 8.0
        self._typing_eq_font_name = "HYhwpEQ"
        self._typing_eq_font_size_pt = 8.0
        self._active_font_name: str | None = None
        self._active_font_size_pt: float | None = None

    def configure_typing_styles(
        self,
        *,
        text_font_name: str | None = None,
        text_font_size_pt: float | None = None,
        eq_font_name: str | None = None,
        eq_font_size_pt: float | None = None,
    ) -> None:
        """Update default text/equation styles used during typing."""
        if text_font_name is not None and str(text_font_name).strip():
            self._typing_text_font_name = str(text_font_name).strip()
        if text_font_size_pt is not None:
            try:
                self._typing_text_font_size_pt = max(1.0, float(text_font_size_pt))
            except Exception:
                pass
        if eq_font_name is not None and str(eq_font_name).strip():
            self._typing_eq_font_name = str(eq_font_name).strip()
        if eq_font_size_pt is not None:
            try:
                self._typing_eq_font_size_pt = max(1.0, float(eq_font_size_pt))
            except Exception:
                pass
        self._active_font_name = None
        self._active_font_size_pt = None

    @staticmethod
    def _is_hwp_title(title: str) -> bool:
        if not title:
            return False
        t = str(title).strip()
        if not t:
            return False
        lower = t.lower()
        # Real HWP document tab/window title.
        if re.search(r"\.hwp[x]?\b", lower):
            return True
        # Unsaved docs: "빈 문서1 - 한글", "Untitled - HWP", etc.
        if re.search(r"\s-\s*(한글|hwp|hancom.*|hanword)\s*$", lower):
            return True
        # Main app window titles without explicit doc extension.
        if "hancom office hanword" in lower or "한컴오피스 한글" in t:
            return True
        return False

    @staticmethod
    def _extract_doc_name_from_title(title: str) -> str:
        if not title:
            return ""
        match = re.search(r"([^\\/\-]+\.hwp[x]?)", title, re.IGNORECASE)
        if match:
            return match.group(1)
        # Unsaved docs like "빈 문서1 - 한글" / "Untitled - HWP"
        m2 = re.search(r"^\s*(.*?)\s*-\s*(?:한글|HWP|Hwp|Hancom.*)\s*$", title, re.IGNORECASE)
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
                if HwpController._is_hwp_title(title):
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
    _uia_disabled_until: float = 0.0
    _last_detected_filename: str = ""

    @staticmethod
    def set_last_detected_filename(filename: str) -> None:
        HwpController._last_detected_filename = (filename or "").strip()

    @staticmethod
    def get_last_detected_filename() -> str:
        return HwpController._last_detected_filename

    @staticmethod
    def _ensure_uia() -> tuple[Any, Any]:
        """UI Automation 인스턴스를 반환합니다."""
        if (
            HwpController._uia_instance is None
            and time.monotonic() < HwpController._uia_disabled_until
        ):
            raise RuntimeError("UI Automation initialization is temporarily disabled.")
        import comtypes  # type: ignore
        import comtypes.client  # type: ignore
        try:
            comtypes.CoInitialize()
        except OSError:
            pass
        if HwpController._uia_instance is None:
            try:
                uia_mod = comtypes.client.GetModule("UIAutomationCore.dll")
                uia = comtypes.CoCreateInstance(
                    uia_mod.CUIAutomation._reg_clsid_,
                    interface=uia_mod.IUIAutomation,
                    clsctx=comtypes.CLSCTX_INPROC_SERVER,
                )
                HwpController._uia_instance = uia
                HwpController._uia_walker = uia.CreateTreeWalker(uia.RawViewCondition)
                HwpController._uia_disabled_until = 0.0
            except Exception:
                HwpController._uia_instance = None
                HwpController._uia_walker = None
                HwpController._uia_disabled_until = (
                    time.monotonic() + HwpController._UIA_RETRY_COOLDOWN_SEC
                )
                raise
        return HwpController._uia_instance, HwpController._uia_walker

    _page_re = re.compile(r"(\d+)\s*/\s*(\d+)")

    @staticmethod
    def _find_hwp_window() -> int:
        """Return the best HWP window handle, or 0."""
        try:
            import win32gui  # type: ignore
        except ImportError:
            return 0

        fg = win32gui.GetForegroundWindow()
        fg_title = win32gui.GetWindowText(fg) if fg else ""
        if fg and fg_title and HwpController._is_hwp_title(fg_title):
            return fg

        current_filename = HwpController.get_current_filename()
        candidates: list[tuple[int, str]] = []

        def _cb(hwnd: int, _: Any) -> None:
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title and HwpController._is_hwp_title(title):
                    candidates.append((hwnd, title))

        win32gui.EnumWindows(_cb, None)

        if current_filename:
            for hwnd, title in candidates:
                if current_filename in title:
                    return hwnd

        for hwnd, title in candidates:
            if re.search(r"\.hwp[x]?", title, re.IGNORECASE):
                return hwnd

        return candidates[0][0] if candidates else 0

    @staticmethod
    def focus_target_window(target_filename: str | None = None) -> bool:
        """Bring the target HWP document window to the foreground."""
        if not IS_WINDOWS:
            return False
        try:
            import win32con  # type: ignore
            import win32gui  # type: ignore
        except ImportError:
            return False

        hwnd = 0
        target = str(target_filename or "").strip()
        if target:
            candidates: list[tuple[int, str]] = []

            def _cb(candidate_hwnd: int, _: Any) -> None:
                if not win32gui.IsWindowVisible(candidate_hwnd):
                    return
                title = win32gui.GetWindowText(candidate_hwnd)
                if title and HwpController._is_hwp_title(title):
                    candidates.append((candidate_hwnd, title))

            try:
                win32gui.EnumWindows(_cb, None)
            except Exception:
                candidates = []
            for candidate_hwnd, title in candidates:
                if target in title:
                    hwnd = candidate_hwnd
                    break

        if not hwnd:
            hwnd = HwpController._find_hwp_window()
        if not hwnd:
            return False

        try:
            if win32gui.IsIconic(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            else:
                win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
            win32gui.SetForegroundWindow(hwnd)
            return True
        except Exception:
            return False

    @staticmethod
    def _select_best_page_candidate(
        candidates: list[tuple[int, int]], total_hint: int = 0
    ) -> tuple[int, int]:
        if not candidates:
            return (0, 0)
        valid = [(cur, total) for cur, total in candidates if cur > 0 and total > 0 and cur <= total]
        if not valid:
            return (0, 0)
        if total_hint > 0:
            hinted = [v for v in valid if v[1] == total_hint]
            if hinted:
                return max(hinted, key=lambda x: (x[1], x[0]))
        # Avoid false positives like section indicator 1/1 by preferring larger totals.
        return max(valid, key=lambda x: (x[1], x[0]))

    @staticmethod
    def _get_com_page_hint() -> tuple[int, int]:
        """Best-effort: (current_page, total_page) from COM KeyIndicator/PageCount."""
        try:
            import pythoncom  # type: ignore
            import win32com.client  # type: ignore

            hwp = win32com.client.GetActiveObject("HWPFrame.HwpObject")

            total = 0
            try:
                total = int(getattr(hwp, "PageCount", 0) or 0)
            except Exception:
                total = 0

            current = 0
            try:
                seccnt = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                secno = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                prnpageno = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                colno = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                line = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                pos = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
                over = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_BOOL, False)
                ctrlname = win32com.client.VARIANT(
                    pythoncom.VT_BYREF | pythoncom.VT_BSTR, ""
                )
                hwp.KeyIndicator(seccnt, secno, prnpageno, colno, line, pos, over, ctrlname)
                current = int(prnpageno.value or 0)
            except Exception:
                current = 0

            if current > 0 and total > 0 and current <= total:
                return (current, total)
            if total > 0:
                return (0, total)
        except Exception:
            pass
        return (0, 0)

    @staticmethod
    def _read_page_from_statusbar(hwnd_parent: int, total_hint: int = 0) -> tuple[int, int]:
        """Read page info from HWP status bar via cross-process Win32 API."""
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32

            user32.FindWindowExW.restype = wintypes.HWND
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.VirtualAllocEx.restype = ctypes.c_void_p

            SB_GETPARTS = 0x0406
            SB_GETTEXTLENGTHW = 0x040C
            SB_GETTEXTW = 0x040D

            def _find_sb(parent: int, depth: int = 0) -> int:
                if depth > 5:
                    return 0
                child = user32.FindWindowExW(parent, 0, None, None)
                while child:
                    cls_buf = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(child, cls_buf, 256)
                    if "statusbar" in cls_buf.value.lower():
                        return child
                    found = _find_sb(child, depth + 1)
                    if found:
                        return found
                    child = user32.FindWindowExW(parent, child, None, None)
                return 0

            sb_hwnd = _find_sb(hwnd_parent)
            if not sb_hwnd:
                return (0, 0)

            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(sb_hwnd, ctypes.byref(pid))
            hproc = kernel32.OpenProcess(0x0028, False, pid.value)
            if not hproc:
                return (0, 0)

            try:
                nparts = user32.SendMessageW(sb_hwnd, SB_GETPARTS, 0, 0)
                matches: list[tuple[int, int]] = []
                for i in range(min(nparts, 16)):
                    text_len = user32.SendMessageW(
                        sb_hwnd, SB_GETTEXTLENGTHW, i, 0
                    ) & 0xFFFF
                    if text_len <= 0 or text_len > 512:
                        continue
                    buf_size = (text_len + 2) * 2
                    remote_buf = kernel32.VirtualAllocEx(
                        hproc, None, buf_size, 0x1000, 0x04
                    )
                    if not remote_buf:
                        continue
                    try:
                        user32.SendMessageW(
                            sb_hwnd, SB_GETTEXTW,
                            ctypes.c_ulonglong(i),
                            ctypes.c_longlong(remote_buf),
                        )
                        local_buf = ctypes.create_unicode_buffer(text_len + 2)
                        kernel32.ReadProcessMemory(
                            hproc, ctypes.c_void_p(remote_buf),
                            local_buf, buf_size, None,
                        )
                        m = HwpController._page_re.search(local_buf.value)
                        if m:
                            matches.append((int(m.group(1)), int(m.group(2))))
                    finally:
                        kernel32.VirtualFreeEx(
                            hproc, ctypes.c_void_p(remote_buf), 0, 0x8000
                        )
                return HwpController._select_best_page_candidate(matches, total_hint)
            finally:
                kernel32.CloseHandle(hproc)

            return (0, 0)
        except Exception:
            return (0, 0)

    @staticmethod
    def _read_page_from_uia_statusbar(
        uia: Any, root_el: Any, total_hint: int = 0
    ) -> tuple[int, int]:
        """UIA FindFirst for StatusBar control, then search descendants."""
        try:
            cond = uia.CreatePropertyCondition(30003, 50025)
            sb = root_el.FindFirst(4, cond)
            if sb is None:
                return (0, 0)
            true_cond = uia.CreateTrueCondition()
            descs = sb.FindAll(4, true_cond)
            count = descs.Length if descs else 0
            matches: list[tuple[int, int]] = []
            for i in range(count):
                try:
                    name = descs.GetElement(i).CurrentName or ""
                    m = HwpController._page_re.search(name)
                    if m:
                        matches.append((int(m.group(1)), int(m.group(2))))
                except Exception:
                    continue
            return HwpController._select_best_page_candidate(matches, total_hint)
        except Exception:
            pass
        return (0, 0)

    @staticmethod
    def get_current_page() -> tuple[int, int]:
        """현재 커서가 위치한 (현재 페이지, 전체 페이지)를 반환합니다. 실패 시 (0, 0)."""
        if not IS_WINDOWS:
            return (0, 0)
        try:
            hwnd_target = HwpController._find_hwp_window()
            if not hwnd_target:
                return (0, 0)

            com_cur, com_total = HwpController._get_com_page_hint()
            if com_cur > 0 and com_total > 0:
                return (com_cur, com_total)

            # Strategy 1: Win32 status bar (cross-process, no COM dependency)
            result = HwpController._read_page_from_statusbar(hwnd_target, com_total)
            if result[0] > 0:
                return result

            # Strategy 2+3: UIA-based approaches
            uia, walker = HwpController._ensure_uia()
            el = uia.ElementFromHandle(hwnd_target)

            # Strategy 2: UIA FindFirst for StatusBar control type
            result = HwpController._read_page_from_uia_statusbar(uia, el, com_total)
            if result[0] > 0:
                return result

            # Strategy 3: Recursive UIA tree walk (deeper, exception-safe)
            page_re = HwpController._page_re

            def _find_page(elem: Any, depth: int = 0) -> tuple[int, int]:
                if depth > 25:
                    return (0, 0)
                try:
                    name = elem.CurrentName or ""
                    m = page_re.match(name)
                    if m:
                        return (int(m.group(1)), int(m.group(2)))
                except Exception:
                    pass
                try:
                    child = walker.GetFirstChildElement(elem)
                    while child:
                        found = _find_page(child, depth + 1)
                        if found[0] > 0:
                            return found
                        child = walker.GetNextSiblingElement(child)
                except Exception:
                    pass
                return (0, 0)

            fallback = _find_page(el)
            if fallback[0] > 0:
                if com_total > 0 and fallback[0] <= com_total:
                    return (fallback[0], com_total)
                return fallback
            if com_total > 0:
                return (0, com_total)
            return (0, 0)
        except Exception:
            HwpController._uia_instance = None
            HwpController._uia_walker = None
            HwpController._uia_disabled_until = (
                time.monotonic() + HwpController._UIA_RETRY_COOLDOWN_SEC
            )
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
            raise HwpControllerError("한글(HWP) 창을 찾지 못했습니다. 먼저 HWP를 실행해 주세요.")

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

    def open_new_document(self) -> None:
        """Open a new blank document in the connected HWP instance."""
        self._ensure_connected()
        with _preserve_foreground():
            for action_name in ("FileNew", "NewFile", "FileNewBlank"):
                if self._run_action_best_effort(action_name):
                    # Reset line/context state for the new document.
                    self._in_condition_box = False
                    self._box_line_start = False
                    self._line_start = True
                    self._first_line_written = False
                    self._problem_stem_indent_active = False
                    self._align_center_next_line = False
                    self._align_right_next_line = False
                    self._line_right_aligned = False
                    self._align_justify_next_line = False
                    self._line_justify_aligned = False
                    self._line_center_aligned = False
                    self._last_was_equation = False
                    return
        raise HwpControllerError("새 파일을 열지 못했습니다. HWP 상태를 확인해 주세요.")

    def _insert_text_raw(self, text: str) -> None:
        if not text:
            return
        hwp = self._ensure_connected()
        try:
            hwp.HAction.GetDefault("InsertText", hwp.HParameterSet.HInsertText.HSet)
            hwp.HParameterSet.HInsertText.Text = text
            hwp.HAction.Execute("InsertText", hwp.HParameterSet.HInsertText.HSet)
        except Exception as bulk_exc:
            # Some HWP/pyhwpx environments reject a whole text run at once.
            # Retry with the same InsertText action character-by-character instead
            # of calling KeyIndicator(), which is a status-query API, not a typing API.
            try:
                for char in text:
                    hwp.HAction.GetDefault("InsertText", hwp.HParameterSet.HInsertText.HSet)
                    hwp.HParameterSet.HInsertText.Text = char
                    hwp.HAction.Execute("InsertText", hwp.HParameterSet.HInsertText.HSet)
            except Exception as char_exc:
                raise HwpControllerError(
                    "텍스트 입력 실패: InsertText 실행 중 오류가 발생했습니다. "
                    f"(bulk={bulk_exc}; char={char_exc})"
                ) from char_exc

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

    def set_align_center_next_line(self) -> None:
        """Center-align only the next line."""
        self._align_center_next_line = True

    def set_align_justify_next_line(self) -> None:
        """Justify-align only the next line."""
        self._align_justify_next_line = True

    def _maybe_insert_line_indent(self, spaces: int) -> None:
        if self._in_condition_box:
            return
        if self._line_start and self._first_line_written:
            self._insert_text_raw(" " * spaces)
            self._line_start = False

    @staticmethod
    def _looks_like_problem_number_line(text: str) -> bool:
        stripped = str(text or "").strip()
        if not stripped:
            return False
        return re.match(r"^\d+\s*[.)](?:\s+.*)?$", stripped) is not None

    @staticmethod
    def _looks_like_choice_line(text: str) -> bool:
        stripped = str(text or "").strip()
        return stripped.startswith(("①", "②", "③", "④", "⑤"))

    @staticmethod
    def _looks_like_score_line(text: str) -> bool:
        stripped = str(text or "").strip()
        return re.match(r"^\[\s*\d+\s*점\s*\]$", stripped) is not None

    def _should_auto_indent_problem_stem(self, text: str, *, skip_auto_indent_right: bool = False) -> bool:
        if skip_auto_indent_right:
            return False
        if self._in_condition_box or not self._line_start or not self._first_line_written:
            return False
        if not self._problem_stem_indent_active:
            return False
        if text.startswith((" ", "\t")):
            return False
        stripped = str(text or "").strip()
        if not stripped:
            return False
        if self._looks_like_problem_number_line(stripped):
            return False
        if self._looks_like_score_line(stripped):
            return False
        return True

    def _update_problem_stem_indent_state(self, text: str) -> None:
        if self._in_condition_box:
            return
        stripped = str(text or "").strip()
        if not stripped:
            return
        if self._looks_like_problem_number_line(stripped):
            self._problem_stem_indent_active = True
            return
        if self._looks_like_score_line(stripped):
            return
        if stripped.startswith("<보기>"):
            self._problem_stem_indent_active = False
            return
        if self._looks_like_choice_line(stripped):
            return

    def insert_text(self, text: str) -> None:
        if not text:
            return
        # Keep plain-text typing style consistent with user settings.
        try:
            self._ensure_font_style(
                self._typing_text_font_name,
                self._typing_text_font_size_pt,
            )
        except Exception:
            # Best-effort only: do not block typing on style apply failure.
            pass
        # Normalize escaped tab markers to actual tab
        if text.startswith("\\t") or text.startswith("/t"):
            text = "\t" + text[2:]
        # If a tab-indented formula line starts, insert a blank line above it.
        if self._line_start and text.startswith("\t") and self._first_line_written:
            self.insert_enter()
        # Apply one-line alignment BEFORE indentation logic.
        skip_auto_indent_right = False
        if self._line_start and self._align_center_next_line:
            self._set_paragraph_align("center")
            self._align_center_next_line = False
            self._line_center_aligned = True
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
                if self._should_auto_indent_problem_stem(text, skip_auto_indent_right=skip_auto_indent_right):
                    self._maybe_insert_line_indent(2)

        # For right-aligned score lines, avoid leading indentation.
        if skip_auto_indent_right:
            text = text.lstrip(" \t")
        # If previous token was an equation, remove a single leading space.
        if self._last_was_equation and text.startswith(" "):
            text = text[1:]
        if self._in_condition_box and self._box_line_start:
            self._box_line_start = False
        self._insert_text_raw(text)
        self._line_start = False
        self._last_was_equation = False
        if not self._first_line_written:
            self._first_line_written = True
        self._update_problem_stem_indent_state(text)

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

    def set_italic(self, enabled: bool = True) -> None:
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            applied = False
            for attr in ("Italic", "Slant"):
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, 1 if enabled else 0)
                        applied = True
                    except Exception:
                        pass
            hset = getattr(param, "HSet", None)
            if hset is not None:
                for key in ("Italic", "Slant"):
                    try:
                        hset.SetItem(key, 1 if enabled else 0)
                        applied = True
                    except Exception:
                        pass
            if not applied:
                raise HwpControllerError("문자 기울임 속성을 찾지 못했습니다.")
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"문자 기울임 설정 실패: {exc}") from exc

    def set_strike(self, enabled: bool = True) -> None:
        hwp = self._ensure_connected()
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            applied = False
            for attr in ("StrikeOut", "StrikeOutType", "Strikeout", "StrikeoutType"):
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, 1 if enabled else 0)
                        applied = True
                    except Exception:
                        pass
            hset = getattr(param, "HSet", None)
            if hset is not None:
                for key in ("StrikeOut", "StrikeOutType", "Strikeout", "StrikeoutType"):
                    try:
                        hset.SetItem(key, 1 if enabled else 0)
                        applied = True
                    except Exception:
                        pass
            if not applied:
                raise HwpControllerError("문자 취소선 속성을 찾지 못했습니다.")
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"문자 취소선 설정 실패: {exc}") from exc

    def set_text_highlight(self, color: Any | None = "yellow") -> None:
        del color
        return

    def insert_highlighted_text(self, text: str, color: Any | None = "yellow") -> None:
        del color
        self.insert_text(text)

    def set_text_color(self, color: Any | None = "black") -> None:
        hwp = self._ensure_connected()
        normalized = self._normalize_hwp_color(color)
        color_value = normalized if normalized is not None else 0x000000
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)
            applied = False

            for attr in ("TextColor", "FontColor"):
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, color_value)
                        applied = True
                    except Exception:
                        pass

            hset = getattr(param, "HSet", None)
            if hset is not None:
                for key in ("TextColor", "FontColor"):
                    try:
                        hset.SetItem(key, color_value)
                        applied = True
                    except Exception:
                        pass

            if not applied:
                raise HwpControllerError("문자 색상 속성을 찾지 못했습니다.")
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"문자 색상 설정 실패: {exc}") from exc

    def insert_colored_text(self, text: str, color: Any = "black") -> None:
        del color
        self.insert_text(text)

    def insert_styled_text(
        self,
        text: str,
        color: Any | None = None,
        highlight: Any | None = None,
        bold: bool | None = None,
        underline: bool | None = None,
        italic: bool | None = None,
        strike: bool | None = None,
    ) -> None:
        if bold is not None:
            self.set_bold(bool(bold))
        if underline is not None:
            self.set_underline(bool(underline))
        if italic is not None:
            self.set_italic(bool(italic))
        if strike is not None:
            self.set_strike(bool(strike))
        del color
        del highlight
        try:
            self.insert_text(text)
        finally:
            try:
                if underline is not None:
                    self.set_underline(False)
            except Exception:
                pass
            try:
                if italic is not None:
                    self.set_italic(False)
            except Exception:
                pass
            try:
                if strike is not None:
                    self.set_strike(False)
            except Exception:
                pass
            try:
                if bold is not None:
                    self.set_bold(False)
            except Exception:
                pass

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
        Table border styling is disabled.
        Keep this as a no-op for backward compatibility with older scripts.
        """
        return

    def _apply_selected_cell_border_fill(self, style_params: dict[str, Any]) -> None:
        if not isinstance(style_params, dict) or not style_params:
            return
        hwp = self._ensure_connected()
        action = getattr(hwp, "HAction", None)
        param_sets = getattr(hwp, "HParameterSet", None)
        if action is None or param_sets is None:
            raise HwpControllerError("HWP CellBorderFill 실행에 필요한 객체를 찾지 못했습니다.")

        attempts: list[tuple[str, str, dict[str, Any] | None]] = [
            # Hancom macro examples often use CellBorder + HCellBorderFill
            # for line-style/color changes on selected cells.
            ("CellBorder", "HCellBorderFill", style_params),
            ("CellBorderFill", "HCellBorderFill", {"ApplyTo": 0, "SelCellsBorderFill": style_params}),
            ("CellBorderFill", "HCellBorderFill", {"ApplyTo": 0, **style_params}),
            ("CellBorder", "HTableCellBorderFill", style_params),
            ("TableCellBorderFill", "HTableCellBorderFill", {"ApplyTo": 0, "SelCellsBorderFill": style_params}),
            ("TableCellBorderFill", "HTableCellBorderFill", {"ApplyTo": 0, **style_params}),
        ]

        last_exc: Exception | None = None
        for action_name, param_name, payload in attempts:
            if not hasattr(param_sets, param_name):
                continue
            try:
                param = getattr(param_sets, param_name)
                action.GetDefault(action_name, param.HSet)
                self._apply_hwp_parameter_values(param, payload)
                action.Execute(action_name, param.HSet)
                return
            except Exception as exc:
                last_exc = exc
                continue

        raise HwpControllerError(f"선택 셀 테두리/배경 적용 실패: {last_exc}")

    def _apply_selected_cell_fill(self, fill_attr: dict[str, Any]) -> None:
        if not isinstance(fill_attr, dict) or not fill_attr:
            return
        hwp = self._ensure_connected()
        create_action = getattr(hwp, "CreateAction", None)
        if not callable(create_action):
            raise HwpControllerError("HWP CellFill 실행에 필요한 CreateAction을 찾지 못했습니다.")

        try:
            action = create_action("CellFill")
        except Exception as exc:
            raise HwpControllerError(f"HWP CreateAction 실패: CellFill: {exc}") from exc
        if action is None:
            raise HwpControllerError("HWP CreateAction 결과가 비어 있습니다: CellFill")

        create_set = getattr(action, "CreateSet", None)
        if not callable(create_set):
            raise HwpControllerError("HWP CellFill CreateSet을 찾지 못했습니다.")

        try:
            param = create_set()
            param_hset = getattr(param, "HSet", param)
            action.GetDefault(param_hset)
        except Exception as exc:
            raise HwpControllerError(f"HWP CellFill 기본값 로딩 실패: {exc}") from exc

        fill_payload = dict(fill_attr)
        fill_payload.setdefault("Type", 1)
        fill_payload.setdefault("WinBrushFaceStyle", 0xFFFFFFFF)
        fill_payload.setdefault("WinBrushHatchColor", 0x000000)

        fill_set = None
        for attr_name in ("FillAttr",):
            try:
                candidate = getattr(param, attr_name, None)
            except Exception:
                candidate = None
            if candidate is not None:
                fill_set = candidate
                break
        if fill_set is None:
            for create_item_set_name in ("CreateItemSet", "createItemSet"):
                method = getattr(param_hset, create_item_set_name, None)
                if not callable(method):
                    continue
                try:
                    fill_set = method("FillAttr", "DrawFillAttr")
                    break
                except Exception:
                    continue
        if fill_set is None:
            raise HwpControllerError("HWP CellFill FillAttr를 생성하지 못했습니다.")

        self._apply_hwp_parameter_values(fill_set, fill_payload)
        try:
            action.Execute(param_hset)
        except Exception as exc:
            raise HwpControllerError(f"HWP CellFill 실행 실패: {exc}") from exc

    @staticmethod
    def _normalize_hwp_color(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return max(0, int(value))
        if isinstance(value, float):
            return max(0, int(value))
        if isinstance(value, (tuple, list)) and len(value) >= 3:
            try:
                r, g, b = [max(0, min(255, int(v))) for v in value[:3]]
                return (b << 16) | (g << 8) | r
            except Exception:
                return None
        if isinstance(value, dict):
            if all(key in value for key in ("r", "g", "b")):
                try:
                    r = max(0, min(255, int(value["r"])))
                    g = max(0, min(255, int(value["g"])))
                    b = max(0, min(255, int(value["b"])))
                    return (b << 16) | (g << 8) | r
                except Exception:
                    return None
            return None

        text = str(value or "").strip().lower()
        if not text:
            return None
        named = {
            "black": 0x000000,
            "검정": 0x000000,
            "검은색": 0x000000,
            "white": 0xFFFFFF,
            "흰색": 0xFFFFFF,
            "red": 0x0000FF,
            "빨강": 0x0000FF,
            "빨간색": 0x0000FF,
            "blue": 0xFF0000,
            "파랑": 0xFF0000,
            "파란색": 0xFF0000,
            "green": 0x00FF00,
            "초록": 0x00FF00,
            "초록색": 0x00FF00,
            "녹색": 0x00FF00,
            "yellow": 0x00FFFF,
            "노랑": 0x00FFFF,
            "노란색": 0x00FFFF,
            "gray": 0x808080,
            "grey": 0x808080,
            "회색": 0x808080,
            "light gray": 0xC0C0C0,
            "light grey": 0xC0C0C0,
            "연회색": 0xC0C0C0,
            "orange": 0x00A5FF,
            "주황": 0x00A5FF,
            "주황색": 0x00A5FF,
            "purple": 0x800080,
            "보라": 0x800080,
            "보라색": 0x800080,
        }
        if text in named:
            return named[text]
        if text.startswith("#") and len(text) == 7:
            try:
                r = int(text[1:3], 16)
                g = int(text[3:5], 16)
                b = int(text[5:7], 16)
                return (b << 16) | (g << 8) | r
            except Exception:
                return None
        if text.startswith("0x"):
            try:
                return int(text, 16)
            except Exception:
                return None
        if "," in text:
            parts = [part.strip() for part in text.split(",")]
            if len(parts) >= 3:
                try:
                    r, g, b = [max(0, min(255, int(part))) for part in parts[:3]]
                    return (b << 16) | (g << 8) | r
                except Exception:
                    return None
        return None

    def _normalize_hwp_border_type(self, value: Any) -> int | None:
        if value is None or value is False:
            return None
        if isinstance(value, int):
            return max(0, int(value))
        if isinstance(value, float):
            return max(0, int(value))
        lowered = str(value or "").strip().lower()
        if not lowered:
            return None
        symbolic_map = {
            "none": "None",
            "없음": "None",
            "no line": "None",
            "solid": "Solid",
            "실선": "Solid",
            "dash": "Dash",
            "dashed": "Dash",
            "파선": "Dash",
            "dot": "Dot",
            "dotted": "Dot",
            "점선": "Dot",
            "dashdot": "DashDot",
            "dash_dot": "DashDot",
            "일점쇄선": "DashDot",
            "쇄선": "DashDot",
            "dashdotdot": "DashDotDot",
            "dash_dot_dot": "DashDotDot",
            "dash_dotdot": "DashDotDot",
            "이점쇄선": "DashDotDot",
            "double": "Double",
            "이중선": "Double",
            "이중 실선": "Double",
            "doubleline": "Double",
            "triple": "Triple",
            "삼중선": "Triple",
            "얇고 굵은 이중선": "ThinThick",
            "thinthick": "ThinThick",
            "thin_thick": "ThinThick",
            "굵고 얇은 이중선": "ThickThin",
            "thickthin": "ThickThin",
            "thick_thin": "ThickThin",
            "얇고 굵고 얇은 삼중선": "ThinThickThin",
            "thinthickthin": "ThinThickThin",
            "thin_thick_thin": "ThinThickThin",
        }
        symbolic = symbolic_map.get(lowered)
        if symbolic:
            try:
                hwp = self._ensure_connected()
                resolver = getattr(hwp, "HwpLineType", None)
                if callable(resolver):
                    resolved = resolver(symbolic)
                    if resolved is not None:
                        return int(resolved)
            except Exception:
                pass

        fallback_numeric_map = {
            "none": 0,
            "없음": 0,
            "solid": 1,
            "실선": 1,
            "dash": 2,
            "dashed": 2,
            "파선": 2,
            "dot": 3,
            "dotted": 3,
            "점선": 3,
            "dashdot": 4,
            "dash_dot": 4,
            "일점쇄선": 4,
            "쇄선": 4,
            "dashdotdot": 5,
            "dash_dot_dot": 5,
            "이점쇄선": 5,
            "double": 6,
            "이중선": 6,
            "이중 실선": 6,
            "triple": 7,
            "삼중선": 7,
            "thinthick": 8,
            "thin_thick": 8,
            "얇고 굵은 이중선": 8,
            "thickthin": 9,
            "thick_thin": 9,
            "굵고 얇은 이중선": 9,
            "thinthickthin": 10,
            "thin_thick_thin": 10,
            "얇고 굵고 얇은 삼중선": 10,
        }
        return fallback_numeric_map.get(lowered)

    @staticmethod
    def _normalize_hwp_border_width(value: Any) -> int | None:
        if value is None or value is False:
            return None
        if isinstance(value, int):
            return max(0, int(value))
        if isinstance(value, float):
            mm = float(value)
        else:
            text = str(value or "").strip().lower()
            if not text:
                return None
            if text.endswith("mm"):
                text = text[:-2].strip()
            try:
                mm = float(text)
            except Exception:
                return None
        width_map = [
            (0.1, 0), (0.12, 1), (0.15, 2), (0.2, 3), (0.25, 4),
            (0.3, 5), (0.4, 6), (0.5, 7), (0.6, 8), (0.7, 9),
            (1.0, 10), (1.5, 11), (2.0, 12), (3.0, 13), (4.0, 14), (5.0, 15),
        ]
        return min(width_map, key=lambda item: abs(item[0] - mm))[1]

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
            raise HwpControllerError(f"줄 나누기 실패: {exc}") from exc

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
            self._active_font_size_pt = float(font_size_pt)
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
            self._active_font_name = font_name
        except Exception as exc:
            raise HwpControllerError(f"글꼴 설정 실패: {exc}") from exc

    def _ensure_font_style(self, font_name: str, font_size_pt: float) -> None:
        normalized_name = str(font_name or "").strip()
        normalized_size = float(font_size_pt)
        if self._active_font_name != normalized_name:
            self._set_font_name(normalized_name)
        if self._active_font_size_pt != normalized_size:
            self._set_font_size_pt(normalized_size)

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

    def _compact_block_surroundings(self) -> None:
        """
        Best-effort: minimize vertical whitespace around inserted blocks
        such as templates, boxes, and tables.
        """
        try:
            self._apply_compact_paragraph()
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
        font_size_pt: float | None = None,
        eq_font_name: str | None = None,
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
        if self._line_start and self._align_center_next_line:
            self._set_paragraph_align("center")
            self._align_center_next_line = False
            self._line_center_aligned = True
        if self._line_start and self._align_right_next_line:
            self._set_paragraph_align("right")
            self._align_right_next_line = False
            self._line_right_aligned = True
            skip_auto_indent_right = True
        if self._line_start and self._align_justify_next_line:
            self._set_paragraph_align("justify")
            self._align_justify_next_line = False
            self._line_justify_aligned = True

        if self._should_auto_indent_problem_stem(content, skip_auto_indent_right=skip_auto_indent_right):
            self._maybe_insert_line_indent(2)
        resolved_font_size = (
            float(font_size_pt) if font_size_pt is not None else float(self._typing_eq_font_size_pt)
        )
        resolved_eq_font = (
            str(eq_font_name).strip() if eq_font_name is not None and str(eq_font_name).strip()
            else self._typing_eq_font_name
        )
        hwp = self._ensure_connected()
        options = EquationOptions(
            font_size_pt=resolved_font_size,
            eq_font_name=resolved_eq_font,
            treat_as_char=treat_as_char,
            ensure_newline=ensure_newline,
        )
        insert_equation_control(hwp, content, options=options)
        self._active_font_name = None
        self._active_font_size_pt = None
        self._line_start = False
        self._last_was_equation = True
        if not self._first_line_written:
            self._first_line_written = True
        self._update_problem_stem_indent_state(content)

    def insert_latex_equation(
        self,
        latex: str,
        *,
        font_size_pt: float | None = None,
        eq_font_name: str | None = None,
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
            self._set_font_name(self._typing_text_font_name)
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
            candidates.extend(["&&&", "& & &"])

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
            "@@@": ["@@@", "@ @ @"],
            "###": ["###", "# # #"],
            "&&&": ["&&&", "& & &"],
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
            raise HwpControllerError("템플릿 이름이 비어 있습니다.")
        self._compact_block_surroundings()
        base = name.lower().replace("\\", "/").rsplit("/", 1)[-1]
        if base == "box_white.hwp":
            base = "box.hwp"
        if base == "box.hwp":
            self._insert_virtual_box_template()
            return
        ok = self._try_insert_template(name)
        if not ok:
            template_path = self._template_dir / name
            raise HwpControllerError(f"템플릿을 찾지 못했습니다: {template_path}")
        self._compact_block_surroundings()

    def _insert_virtual_box_template(self) -> None:
        """
        Built-in placeholder template for a plain bordered box.

        This mirrors the `header.hwp -> focus_placeholder("###")` workflow:
        - create a plain box
        - place a literal ### marker inside
        - let the script call focus_placeholder("###") to replace it
        """
        self.insert_box()
        self.insert_text("###")

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

    def run_hwp_action(self, action_name: str) -> None:
        name = str(action_name or "").strip()
        if not name:
            raise HwpControllerError("실행할 HWP Action 이름이 비어 있습니다.")
        if not self._run_action_best_effort(name):
            raise HwpControllerError(f"HWP Action 실행 실패: {name}")

    def _get_or_create_hwp_item_set(self, target: Any, item_name: str) -> Any | None:
        name = str(item_name or "").strip()
        if target is None or not name:
            return None

        for owner in (target, getattr(target, "HSet", None)):
            if owner is None:
                continue

            existing = getattr(owner, name, None)
            if existing is not None:
                return existing

            for method_name in ("CreateItemSet", "createItemSet"):
                method = getattr(owner, method_name, None)
                if not callable(method):
                    continue
                arg_candidates = [
                    (name, name),
                    (name,),
                ]
                if not name.startswith("H"):
                    arg_candidates.append((name, f"H{name}"))
                for args in arg_candidates:
                    try:
                        child = method(*args)
                    except TypeError:
                        continue
                    except Exception:
                        child = None
                    if child is not None:
                        return child
        return None

    def _apply_hwp_parameter_values(self, target: Any, values: dict[str, Any] | None) -> None:
        if target is None or not isinstance(values, dict):
            return
        hset = getattr(target, "HSet", None)
        for raw_key, value in values.items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            if "." in key:
                head, rest = key.split(".", 1)
                child = getattr(target, head, None)
                if child is None:
                    child = self._get_or_create_hwp_item_set(target, head)
                if child is not None:
                    self._apply_hwp_parameter_values(child, {rest: value})
                    continue
            if isinstance(value, dict):
                child = getattr(target, key, None)
                if child is None:
                    child = self._get_or_create_hwp_item_set(target, key)
                if child is not None:
                    self._apply_hwp_parameter_values(child, value)
                    continue
            try:
                setattr(target, key, value)
                continue
            except Exception:
                pass
            if hset is not None:
                try:
                    hset.SetItem(key, value)
                    continue
                except Exception:
                    pass
            try:
                target.SetItem(key, value)
            except Exception:
                pass

    @staticmethod
    def _parameter_set_name_candidates(parameter_set_name: str) -> list[str]:
        name = str(parameter_set_name or "").strip()
        if not name:
            return []
        candidates: list[str] = []
        for candidate in (
            name,
            name[1:] if name.startswith("H") and len(name) > 1 else "",
            f"H{name}" if not name.startswith("H") else "",
        ):
            candidate = str(candidate or "").strip()
            if candidate and candidate not in candidates:
                candidates.append(candidate)
        return candidates

    def execute_hwp_action(
        self,
        action_name: str,
        parameter_set_name: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        hwp = self._ensure_connected()
        name = str(action_name or "").strip()
        if not name:
            raise HwpControllerError("실행할 HWP Action 이름이 비어 있습니다.")

        action = getattr(hwp, "HAction", None)
        if action is None:
            raise HwpControllerError("HWP HAction 객체를 찾지 못했습니다.")

        if not parameter_set_name:
            self.run_hwp_action(name)
            return True

        param_sets = getattr(hwp, "HParameterSet", None)
        param_name = str(parameter_set_name or "").strip()
        resolved_param_name = param_name
        param_obj = None
        param_hset = None
        force_create_set_actions = {"StyleDirectEdit"}
        should_force_create_set = name in force_create_set_actions
        if param_sets is not None and not should_force_create_set:
            for candidate in self._parameter_set_name_candidates(param_name):
                candidate_obj = getattr(param_sets, candidate, None)
                candidate_hset = getattr(candidate_obj, "HSet", None) if candidate_obj is not None else None
                if candidate_obj is not None and candidate_hset is not None:
                    resolved_param_name = candidate
                    param_obj = candidate_obj
                    param_hset = candidate_hset
                    break

        # Some actions in the developer PDFs do not expose a named
        # HParameterSet member and instead require CreateAction(...).CreateSet().
        created_action = None
        using_created_action = False
        if param_obj is None or param_hset is None:
            create_action = getattr(hwp, "CreateAction", None)
            if not callable(create_action):
                raise HwpControllerError(
                    f"HWP ParameterSet을 찾지 못했고 CreateAction도 사용할 수 없습니다: {param_name}"
                )
            try:
                created_action = create_action(name)
            except Exception as exc:
                raise HwpControllerError(
                    f"HWP CreateAction 실패: {name}: {exc}"
                ) from exc
            if created_action is None:
                raise HwpControllerError(f"HWP CreateAction 결과가 비어 있습니다: {name}")

            create_set = getattr(created_action, "CreateSet", None)
            if callable(create_set):
                try:
                    param_obj = create_set()
                    param_hset = getattr(param_obj, "HSet", param_obj)
                    using_created_action = True
                except Exception as exc:
                    raise HwpControllerError(
                        f"HWP CreateSet 실패: {name} / {param_name}: {exc}"
                    ) from exc
            else:
                fallback_create_set = getattr(hwp, "CreateSet", None)
                if not callable(fallback_create_set):
                    raise HwpControllerError(
                        f"HWP ParameterSet 생성 실패: {name} / {param_name}"
                    )
                last_exc: Exception | None = None
                for candidate in self._parameter_set_name_candidates(param_name):
                    try:
                        param_obj = fallback_create_set(candidate)
                        param_hset = getattr(param_obj, "HSet", param_obj)
                        resolved_param_name = candidate
                        last_exc = None
                        break
                    except Exception as exc:
                        last_exc = exc
                if param_obj is None or param_hset is None:
                    raise HwpControllerError(
                        f"HWP CreateSet 실패: {name} / {param_name}: {last_exc}"
                    )

        if param_obj is None or param_hset is None:
            raise HwpControllerError(f"HWP ParameterSet 준비 실패: {name} / {param_name}")

        try:
            if using_created_action and created_action is not None:
                created_action.GetDefault(param_hset)
            else:
                action.GetDefault(name, param_hset)
        except Exception as exc:
            raise HwpControllerError(
                f"HWP Action 기본 ParameterSet 로딩 실패: {name} / {resolved_param_name}: {exc}"
            ) from exc

        self._apply_hwp_parameter_values(param_obj, params)

        try:
            if using_created_action and created_action is not None:
                return created_action.Execute(param_hset)
            return action.Execute(name, param_hset)
        except Exception as exc:
            raise HwpControllerError(
                f"HWP Action Execute 실패: {name} / {resolved_param_name}: {exc}"
            ) from exc

    def call_hwp_method(self, method_name: str, *args: Any) -> Any:
        hwp = self._ensure_connected()
        name = str(method_name or "").strip()
        if not name:
            raise HwpControllerError("호출할 HWP 메서드 이름이 비어 있습니다.")
        method = getattr(hwp, name, None)
        if not callable(method):
            raise HwpControllerError(f"HWP 메서드를 찾지 못했습니다: {name}")
        try:
            return method(*args)
        except Exception as exc:
            raise HwpControllerError(f"HWP 메서드 호출 실패: {name}: {exc}") from exc

    @staticmethod
    def _read_named_hwp_value(target: Any, candidate_names: tuple[str, ...]) -> Any:
        if target is None:
            return None
        for key in candidate_names:
            try:
                value = getattr(target, key, None)
            except Exception:
                value = None
            if value not in (None, ""):
                return value

            for accessor_name in ("Item", "GetItem", "item"):
                accessor = getattr(target, accessor_name, None)
                if not callable(accessor):
                    continue
                try:
                    value = accessor(key)
                except Exception:
                    continue
                if value not in (None, ""):
                    return value
        return None

    def get_current_style_name(self) -> str:
        hwp = self._ensure_connected()

        pyhwpx_get_style = getattr(hwp, "get_style", None)
        if callable(pyhwpx_get_style):
            try:
                result = pyhwpx_get_style()
                if isinstance(result, dict):
                    for key in ("name", "NameLocal", "style_name", "local_name"):
                        value = result.get(key)
                        if value:
                            return str(value)
                if result not in (None, ""):
                    return str(result)
            except Exception:
                pass

        action = getattr(hwp, "HAction", None)
        param_sets = getattr(hwp, "HParameterSet", None)
        if action is not None and param_sets is not None and hasattr(param_sets, "HParaShape"):
            try:
                param = param_sets.HParaShape
                action.GetDefault("ParaShape", param.HSet)
                value = self._read_named_hwp_value(
                    param,
                    ("NameLocal", "StyleName", "StyleNameLocal", "ParaStyle", "Style"),
                )
                if value in (None, ""):
                    value = self._read_named_hwp_value(
                        getattr(param, "HSet", None),
                        ("NameLocal", "StyleName", "StyleNameLocal", "ParaStyle", "Style"),
                    )
                if value not in (None, ""):
                    return str(value)
            except Exception:
                pass

        raise HwpControllerError("현재 문단 스타일 이름을 조회하지 못했습니다.")

    def get_style_list(self, used_only: bool = False) -> Any:
        hwp = self._ensure_connected()

        method_candidates = [
            "get_used_style_dict" if used_only else "get_style_dict",
            "get_style_dict",
            "get_used_style_dict",
            "GetStyleDict",
            "GetUsedStyleDict",
            "get_style_list",
            "GetStyleList",
        ]
        tried: list[str] = []
        for name in method_candidates:
            if not name or name in tried:
                continue
            tried.append(name)
            method = getattr(hwp, name, None)
            if not callable(method):
                continue
            try:
                result = method()
            except Exception:
                continue
            if isinstance(result, dict):
                return result
            if isinstance(result, (list, tuple, set)):
                return list(result)
            if result not in (None, ""):
                return result

        raise HwpControllerError("현재 연결된 한글 환경에서는 스타일 목록 조회를 지원하지 않습니다.")

    def delete_style(self, style_name: str, replacement_style: str = "바탕글") -> Any:
        source = str(style_name or "").strip()
        replacement = str(replacement_style or "").strip() or "바탕글"
        if not source:
            raise HwpControllerError("삭제할 스타일 이름이 비어 있습니다.")
        if source == replacement:
            raise HwpControllerError("삭제 대상 스타일과 대체 스타일이 같습니다.")

        hwp = self._ensure_connected()
        pyhwpx_delete = getattr(hwp, "delete_style_by_name", None)
        if callable(pyhwpx_delete):
            try:
                return pyhwpx_delete(source, replacement)
            except Exception:
                pass

        attempts = [
            {"NameLocal": source, "ReplaceNameLocal": replacement},
            {"NameLocal": source, "ReplaceStyle": replacement},
            {"StyleName": source, "ReplaceStyleName": replacement},
            {"Name": source, "ReplaceName": replacement},
        ]
        last_exc: Exception | None = None
        for params in attempts:
            try:
                return self.execute_hwp_action("StyleDelete", "StyleDelete", params)
            except Exception as exc:
                last_exc = exc
                continue

        raise HwpControllerError(
            f"스타일 삭제에 실패했습니다: {source} -> {replacement}: {last_exc}"
        )

    def remove_unused_styles(self) -> Any:
        hwp = self._ensure_connected()
        remover = getattr(hwp, "remove_unused_styles", None)
        if callable(remover):
            try:
                return remover()
            except Exception as exc:
                raise HwpControllerError(f"미사용 스타일 정리에 실패했습니다: {exc}") from exc
        raise HwpControllerError("현재 연결된 한글 환경에서는 미사용 스타일 정리를 지원하지 않습니다.")

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
            raise HwpControllerError("HWP FindReplace 파라미터셋을 찾지 못했습니다.")
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
        This enables "기존 @@@/###를 지우고 그 자리에 타이핑" workflows.
        """
        if marker == "###":
            self._focus_hash_placeholder()
            return

        candidates = [marker]
        original_pos = self._capture_cursor_pos()
        if marker == "@@@":
            candidates.extend(["@@@", "@ @ @"])
        elif marker == "&&&":
            candidates.extend(["&&&", "& & &"])

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
        Specialized handler for ### placeholders.
        For `header.hwp`, ### lives in row 2 of the <보기> table body.
        """
        # Some `header.hwp` variants keep one literal space before the marker.
        # Match both forms so the leftover leading space is removed with `###`.
        candidates = [" ###", " # # #", "###", "# # #"]
        original_pos = self._capture_cursor_pos()

        if self._repeat_find_retry(candidates, directions=(0, 1, 2)):
            self._delete_found_marker()
            self._mark_inside_box()
            self._apply_box_text_style(8.0)
            self._apply_compact_paragraph()
            self._set_paragraph_align("justify")
            return

        # Try header.hwp-specific fallback: locate the nearby <보기> table,
        # move into row 2 (body cell), then remove ### there.
        if self._focus_header_view_body_cell():
            return

        if original_pos is not None:
            self._restore_cursor_pos(original_pos)

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
        heading_candidates = ["<보기>", "< 보 기 >", "<보기", "보기>"]
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
        # Do not inject an automatic leading space at box line start.
        self._box_line_start = False
        self._line_start = False
        if not self._first_line_written:
            self._first_line_written = True

    def insert_box(self) -> None:
        """
        Insert a plain 1x1 table (box) for conditions.
        Cursor stays inside the box for content insertion.
        """
        try:
            self._compact_block_surroundings()
            if self._try_insert_template("box_template_noheader.hwp"):
                if not self._move_to_table_cell():
                    # Template inserted but cursor did not move into cell: fallback to raw table.
                    self._insert_box_raw()
                    self._move_to_table_cell()
                self._in_condition_box = True
                self._box_line_start = False
                self._line_start = False
                if not self._first_line_written:
                    self._first_line_written = True
                self._apply_box_text_style(8.0)
                self._apply_compact_paragraph()
                return
            if not (
                self._align_center_next_line
                or self._align_justify_next_line
                or self._align_right_next_line
            ):
                self._maybe_insert_line_indent(1)
            self._insert_box_raw()
            self._move_to_table_cell()
            self._in_condition_box = True
            self._box_line_start = False
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
        self._compact_block_surroundings()
        if self._try_insert_template("box_template.hwp"):
            if not self._move_to_table_cell():
                # Template inserted but cursor did not move into cell: fallback to raw table.
                self._insert_box_raw()
                self._move_to_table_cell()
            self._in_condition_box = True
            self._box_line_start = False
            self._line_start = False
            if not self._first_line_written:
                self._first_line_written = True
            self._apply_box_text_style(8.0)
            self._apply_compact_paragraph()
            # Default to justify alignment for boxed passages.
            self._set_paragraph_align("justify")
            return

        if not (
            self._align_center_next_line
            or self._align_justify_next_line
            or self._align_right_next_line
        ):
            self._maybe_insert_line_indent(1)
        self._insert_box_raw()
        self._move_to_table_cell()
        self._line_start = False
        if not self._first_line_written:
            self._first_line_written = True

        # Match novaai behavior: add "<보기>" header centered.
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
            self.insert_text("<보기>")
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

    def insert_header_view_box(self) -> None:
        """
        Legacy helper kept for compatibility.
        New preferred flow:
        - insert_template('header.hwp')
        - focus_placeholder('###')
        - ... type inside box ...
        - exit_box()
        """
        self.insert_template("header.hwp")
        self.focus_placeholder("###")

    def _focus_header_view_body_cell(self) -> bool:
        """
        Move into row 2 of `header.hwp`, where the ### placeholder lives.
        """
        candidates = [" ###", " # # #", "###", "# # #"]

        def _move_to_second_row_body_cell() -> bool:
            if not self._is_in_table_context():
                return False
            # Normalize to the table origin first, then move exactly one row down.
            # `header.hwp` is structured as:
            #   row 1: title area (<보기>)
            #   row 2: merged body cell for actual content
            if not self._run_action_best_effort("TableColBegin"):
                for _ in range(6):
                    if not self._run_action_best_effort("TableLeftCell"):
                        break
            if not self._run_action_best_effort("TableColPageUp"):
                for _ in range(6):
                    if not self._run_action_best_effort("TableUpperCell"):
                        break
            moved_down = self._run_action_best_effort("TableLowerCell")
            if not moved_down:
                return False
            self._run_action_best_effort("CloseEx")
            return True

        if self._focus_view_box_from_heading():
            if _move_to_second_row_body_cell():
                if self._repeat_find_retry(candidates, attempts=2, directions=(0, 1, 2)):
                    self._delete_found_marker()
                self._mark_inside_box()
                self._apply_box_text_style(8.0)
                self._apply_compact_paragraph()
                self._set_paragraph_align("justify")
                return True

        if self._navigate_forward_into_table():
            if _move_to_second_row_body_cell():
                if self._repeat_find_retry(candidates, attempts=2, directions=(0, 1, 2)):
                    self._delete_found_marker()
                self._mark_inside_box()
                self._apply_box_text_style(8.0)
                self._apply_compact_paragraph()
                self._set_paragraph_align("justify")
                return True

        if self._move_to_table_cell():
            if _move_to_second_row_body_cell():
                if self._repeat_find_retry(candidates, attempts=2, directions=(0, 1, 2)):
                    self._delete_found_marker()
                self._mark_inside_box()
                self._apply_box_text_style(8.0)
                self._apply_compact_paragraph()
                self._set_paragraph_align("justify")
                return True

        return False

    def insert_table(
        self,
        rows: int,
        cols: int,
        *,
        cell_data: list[Any] | None = None,
        merged_cells: list[dict[str, Any] | tuple[int, int, int, int]] | None = None,
        align_center: bool = False,
        exit_after: bool = True,
    ) -> None:
        """
        Insert a table and optionally fill/merge cells.
        """
        if rows <= 0 or cols <= 0:
            raise HwpControllerError("표의 행/열은 1 이상이어야 합니다.")
        hwp = self._ensure_connected()
        try:
            self._compact_block_surroundings()
            if not (
                self._align_center_next_line
                or self._align_justify_next_line
                or self._align_right_next_line
            ):
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

            table_specs: dict[tuple[int, int], dict[str, Any]] = {}
            auto_merge_specs: list[tuple[int, int, int, int]] = []
            manual_merge_specs: list[tuple[int, int, int, int]] = []
            style_specs: dict[tuple[int, int], dict[str, Any]] = {}

            def _normalize_cell_value(value: Any) -> dict[str, Any]:
                if isinstance(value, dict):
                    def _pick(*keys: str, fallback: Any = None) -> Any:
                        for key in keys:
                            if key in value and value.get(key) is not None:
                                return value.get(key)
                        return fallback

                    fill_obj = value.get("fill")
                    if not isinstance(fill_obj, dict):
                        fill_obj = {}
                    border_obj = value.get("border")
                    if not isinstance(border_obj, dict):
                        border_obj = {}
                    diagonal_labels = value.get("diagonal_labels", value.get("diagonalLabels"))
                    if not isinstance(diagonal_labels, dict):
                        diagonal_labels = {}
                    text = value.get("text")
                    if text is None:
                        text = value.get("value", "")
                    return {
                        "text": "" if text is None else str(text),
                        "equation": value.get("equation", value.get("eq")),
                        "content": value.get("content", value.get("segments")),
                        "lines": value.get("lines"),
                        "top_left": _pick(
                            "top_left",
                            "topLeft",
                            "upper_left",
                            "upperLeft",
                            fallback=diagonal_labels.get("top_left", diagonal_labels.get("topLeft")),
                        ),
                        "top_right": _pick(
                            "top_right",
                            "topRight",
                            "upper_right",
                            "upperRight",
                            fallback=diagonal_labels.get("top_right", diagonal_labels.get("topRight")),
                        ),
                        "bottom_left": _pick(
                            "bottom_left",
                            "bottomLeft",
                            "lower_left",
                            "lowerLeft",
                            fallback=diagonal_labels.get("bottom_left", diagonal_labels.get("bottomLeft")),
                        ),
                        "bottom_right": _pick(
                            "bottom_right",
                            "bottomRight",
                            "lower_right",
                            "lowerRight",
                            fallback=diagonal_labels.get("bottom_right", diagonal_labels.get("bottomRight")),
                        ),
                        "rowspan": max(1, int(value.get("rowspan", 1) or 1)),
                        "colspan": max(1, int(value.get("colspan", 1) or 1)),
                        "align": str(value.get("align", "") or "").strip().lower(),
                        "fill_color": _pick(
                            "fill_color",
                            "fillColor",
                            "background_color",
                            "backgroundColor",
                            "bg_color",
                            "bgColor",
                            fallback=fill_obj.get("color"),
                        ),
                        "border_color": _pick("border_color", "borderColor", fallback=border_obj.get("color")),
                        "border_color_left": _pick(
                            "border_color_left",
                            "borderColorLeft",
                            fallback=border_obj.get("left_color", border_obj.get("leftColor")),
                        ),
                        "border_color_right": _pick(
                            "border_color_right",
                            "borderColorRight",
                            fallback=border_obj.get("right_color", border_obj.get("rightColor")),
                        ),
                        "border_color_top": _pick(
                            "border_color_top",
                            "borderColorTop",
                            fallback=border_obj.get("top_color", border_obj.get("topColor")),
                        ),
                        "border_color_bottom": _pick(
                            "border_color_bottom",
                            "borderColorBottom",
                            fallback=border_obj.get("bottom_color", border_obj.get("bottomColor")),
                        ),
                        "border_color_vertical": _pick(
                            "border_color_vertical",
                            "borderColorVertical",
                            "color_vert",
                            "colorVert",
                            fallback=border_obj.get("vertical_color", border_obj.get("verticalColor")),
                        ),
                        "border_color_horizontal": _pick(
                            "border_color_horizontal",
                            "borderColorHorizontal",
                            "color_horz",
                            "colorHorz",
                            fallback=border_obj.get("horizontal_color", border_obj.get("horizontalColor")),
                        ),
                        "border_type": _pick(
                            "border_type",
                            "borderType",
                            "line_style",
                            "lineStyle",
                            fallback=border_obj.get("type", border_obj.get("style")),
                        ),
                        "border_type_left": _pick(
                            "border_type_left",
                            "borderTypeLeft",
                            fallback=border_obj.get("left_type", border_obj.get("leftType")),
                        ),
                        "border_type_right": _pick(
                            "border_type_right",
                            "borderTypeRight",
                            fallback=border_obj.get("right_type", border_obj.get("rightType")),
                        ),
                        "border_type_top": _pick(
                            "border_type_top",
                            "borderTypeTop",
                            fallback=border_obj.get("top_type", border_obj.get("topType")),
                        ),
                        "border_type_bottom": _pick(
                            "border_type_bottom",
                            "borderTypeBottom",
                            fallback=border_obj.get("bottom_type", border_obj.get("bottomType")),
                        ),
                        "border_width": _pick(
                            "border_width",
                            "borderWidth",
                            "line_width",
                            "lineWidth",
                            fallback=border_obj.get("width"),
                        ),
                        "border_width_left": _pick(
                            "border_width_left",
                            "borderWidthLeft",
                            fallback=border_obj.get("left_width", border_obj.get("leftWidth")),
                        ),
                        "border_width_right": _pick(
                            "border_width_right",
                            "borderWidthRight",
                            fallback=border_obj.get("right_width", border_obj.get("rightWidth")),
                        ),
                        "border_width_top": _pick(
                            "border_width_top",
                            "borderWidthTop",
                            fallback=border_obj.get("top_width", border_obj.get("topWidth")),
                        ),
                        "border_width_bottom": _pick(
                            "border_width_bottom",
                            "borderWidthBottom",
                            fallback=border_obj.get("bottom_width", border_obj.get("bottomWidth")),
                        ),
                        "diagonal": _pick(
                            "diagonal",
                            "diag",
                            "diagonal_mark",
                            "diagonalMark",
                            fallback=border_obj.get("diagonal"),
                        ),
                    }
                if value is None:
                    return {"text": "", "rowspan": 1, "colspan": 1, "align": ""}
                return {"text": str(value), "rowspan": 1, "colspan": 1, "align": ""}

            def _normalize_merge_spec(value: dict[str, Any] | tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
                try:
                    if isinstance(value, dict):
                        row = int(value.get("row", value.get("r", 0)) or 0)
                        col = int(value.get("col", value.get("c", 0)) or 0)
                        rowspan = int(value.get("rowspan", value.get("rows", 1)) or 1)
                        colspan = int(value.get("colspan", value.get("cols", 1)) or 1)
                        return (row, col, row + max(1, rowspan) - 1, col + max(1, colspan) - 1)
                    if isinstance(value, (tuple, list)) and len(value) == 4:
                        r1, c1, r2, c2 = [int(v) for v in value]
                        return (min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2))
                except Exception:
                    return None
                return None

            def _move_to_table_origin() -> None:
                if not self._run_action_best_effort("TableColBegin"):
                    for _ in range(max(cols, 1) + 2):
                        if not self._run_action_best_effort("TableLeftCell"):
                            break
                if not self._run_action_best_effort("TableColPageUp"):
                    for _ in range(max(rows, 1) + 2):
                        if not self._run_action_best_effort("TableUpperCell"):
                            break

            def _move_to_table_cell(row: int, col: int) -> None:
                _move_to_table_origin()
                for _ in range(max(0, int(row))):
                    self._run_action_best_effort("TableLowerCell")
                for _ in range(max(0, int(col))):
                    self._run_action_best_effort("TableRightCell")

            def _apply_cell_alignment(align: str) -> None:
                normalized = str(align or "").strip().lower()
                if normalized in {"center", "centre", "middle", "가운데", "중앙"}:
                    self._run_action_best_effort("TableCellAlignCenterCenter")
                elif normalized in {"right", "오른쪽", "우측"}:
                    self._run_action_best_effort("TableCellAlignRightCenter")
                elif normalized in {"left", "왼쪽", "좌측"}:
                    self._run_action_best_effort("TableCellAlignLeftCenter")

            def _merge_table_region(start_row: int, start_col: int, end_row: int, end_col: int) -> None:
                start_row = max(0, min(int(start_row), rows - 1))
                start_col = max(0, min(int(start_col), cols - 1))
                end_row = max(start_row, min(int(end_row), rows - 1))
                end_col = max(start_col, min(int(end_col), cols - 1))
                if start_row == end_row and start_col == end_col:
                    return
                _move_to_table_cell(start_row, start_col)
                self._run_action_best_effort("TableCellBlock")
                self._run_action_best_effort("TableCellBlockExtend")
                for _ in range(end_row - start_row):
                    self._run_action_best_effort("TableLowerCell")
                for _ in range(end_col - start_col):
                    self._run_action_best_effort("TableRightCell")
                if not self._run_action_best_effort("TableMergeCell"):
                    raise HwpControllerError(
                        f"표 셀 병합 실패: ({start_row}, {start_col}) ~ ({end_row}, {end_col})"
                    )
                self._run_action_best_effort("Cancel")

            def _extract_style_params(spec: dict[str, Any]) -> dict[str, Any]:
                # Table background fill and border styling are intentionally disabled.
                return {}

            def _extract_diagonal_params(spec: dict[str, Any]) -> dict[str, Any]:
                if not isinstance(spec, dict):
                    return {}
                raw = str(spec.get("diagonal", "") or "").strip().lower()
                if not raw:
                    return {}

                # Hancom developer docs define diagonals through CellBorder /
                # CellBorderFill with SlashFlag or BackSlashFlag. We also force
                # a visible solid black line so the slash does not inherit an
                # invisible border style from prior table formatting.
                diag_params: dict[str, Any] = {
                    "DiagonalType": 1,
                    "DiagonalWidth": 1,
                    "DiagonalColor": 0x000000,
                }
                if raw in {"\\", "＼", "backslash", "diag_down", "down", "left_top_to_right_bottom"}:
                    diag_params["BackSlashFlag"] = 0x02
                    diag_params["__kind"] = "down"
                    return diag_params
                if raw in {"/", "／", "slash", "diag_up", "up", "right_top_to_left_bottom"}:
                    diag_params["SlashFlag"] = 0x02
                    diag_params["__kind"] = "up"
                    return diag_params
                if raw in {"x", "cross", "diag_cross"}:
                    diag_params["BackSlashFlag"] = 0x02
                    diag_params["SlashFlag"] = 0x02
                    diag_params["__kind"] = "cross"
                    return diag_params
                return {}

            def _apply_selected_cell_diagonal(diag_params: dict[str, Any]) -> None:
                if not isinstance(diag_params, dict) or not diag_params:
                    return
                payload = {
                    key: value
                    for key, value in diag_params.items()
                    if not str(key).startswith("__")
                }
                hwp = self._ensure_connected()
                create_action = getattr(hwp, "CreateAction", None)
                if callable(create_action):
                    try:
                        action = create_action("CellBorder")
                        if action is not None:
                            param = action.CreateSet()
                            hset = getattr(param, "HSet", param)
                            action.GetDefault(hset)
                            self._apply_hwp_parameter_values(param, payload)
                            action.Execute(hset)
                            return
                    except Exception:
                        pass

                last_exc: Exception | None = None
                attempts = [
                    ("CellBorder", "CellBorderFill", payload),
                    ("CellBorder", "HCellBorderFill", payload),
                    ("CellBorderFill", "CellBorderFill", {"ApplyTo": 0, "SelCellsBorderFill": payload}),
                    ("CellBorderFill", "HCellBorderFill", {"ApplyTo": 0, "SelCellsBorderFill": payload}),
                    ("CellBorderFill", "HCellBorderFill", {"ApplyTo": 0, **payload}),
                ]
                for action_name, param_name, payload in attempts:
                    try:
                        self.execute_hwp_action(action_name, param_name, payload)
                        return
                    except Exception as exc:
                        last_exc = exc
                        continue
                raise HwpControllerError(f"셀 대각선 적용 실패: {last_exc}")

            def _apply_cell_style(row: int, col: int, spec: dict[str, Any]) -> None:
                style_params = _extract_style_params(spec)
                diag_params = _extract_diagonal_params(spec)
                if not style_params and not diag_params:
                    return
                _move_to_table_cell(row, col)
                self._run_action_best_effort("TableCellBlock")
                try:
                    fill_attr = style_params.get("FillAttr")
                    border_only = {k: v for k, v in style_params.items() if k != "FillAttr"}
                    if isinstance(fill_attr, dict) and fill_attr:
                        self._apply_selected_cell_fill(fill_attr)
                    if border_only:
                        self._apply_selected_cell_border_fill(border_only)
                    if diag_params:
                        _apply_selected_cell_diagonal(diag_params)
                finally:
                    self._run_action_best_effort("Cancel")

            if cell_data or merged_cells:
                def _apply_table_font() -> None:
                    try:
                        action = hwp.HAction
                        param = hwp.HParameterSet.HCharShape
                        action.GetDefault("CharShape", param.HSet)
                        param.Height = int(float(self._typing_text_font_size_pt) * 100)
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
                                setattr(param, attr, self._typing_text_font_name)
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
                                param.HSet.SetItem(key, self._typing_text_font_name)
                            except Exception:
                                pass
                        action.Execute("CharShape", param.HSet)
                    except Exception:
                        pass

                # Normalize cell_data to rows x cols and collect merged-cell specs.
                # Follow the guide's rule: each row should be handled as either
                # compact mode (covered cells omitted) or explicit mode
                # (base-grid columns fully described with None for covered cells).
                if cell_data and cell_data and isinstance(cell_data[0], str):
                    flat = [str(x) for x in cell_data]
                    cell_data = [
                        flat[i : i + cols] for i in range(0, len(flat), cols)
                    ]
                occupied = [[False for _ in range(cols)] for _ in range(rows)]

                def _fit_span(start_row: int, start_col: int, rowspan: int, colspan: int) -> tuple[int, int]:
                    max_requested_row = min(rows, start_row + max(1, int(rowspan)))
                    max_requested_col = min(cols, start_col + max(1, int(colspan)))
                    fitted_rowspan = 0
                    fitted_colspan = max_requested_col - start_col
                    for rr in range(start_row, max_requested_row):
                        row_width = 0
                        for cc in range(start_col, max_requested_col):
                            if occupied[rr][cc]:
                                break
                            row_width += 1
                        fitted_colspan = min(fitted_colspan, row_width)
                        if fitted_colspan <= 0:
                            break
                        fitted_rowspan += 1
                    return max(0, fitted_rowspan), max(0, fitted_colspan)

                if isinstance(cell_data, list):
                    max_rows = min(rows, len(cell_data))
                    for r in range(max_rows):
                        row = cell_data[r]
                        if not isinstance(row, list):
                            row = [row]
                        has_none = any(item is None for item in row)
                        explicit_mode = has_none or len(row) >= cols
                        compact_mode = not explicit_mode

                        if explicit_mode:
                            max_cols = min(cols, len(row))
                            for c in range(max_cols):
                                raw_value = row[c]
                                if raw_value is None:
                                    continue
                                if occupied[r][c]:
                                    continue
                                spec = _normalize_cell_value(raw_value)
                                requested_rowspan = max(1, min(int(spec["rowspan"]), rows - r))
                                requested_colspan = max(1, min(int(spec["colspan"]), cols - c))
                                rowspan, colspan = _fit_span(r, c, requested_rowspan, requested_colspan)
                                if rowspan <= 0 or colspan <= 0:
                                    continue
                                spec["rowspan"] = rowspan
                                spec["colspan"] = colspan
                                table_specs[(r, c)] = spec
                                style_params = _extract_style_params(spec)
                                if style_params or _extract_diagonal_params(spec):
                                    style_specs[(r, c)] = spec
                                for rr in range(r, r + rowspan):
                                    for cc in range(c, c + colspan):
                                        occupied[rr][cc] = True
                                if rowspan > 1 or colspan > 1:
                                    auto_merge_specs.append((r, c, r + rowspan - 1, c + colspan - 1))
                        if compact_mode:
                            c = 0
                            for raw_value in row:
                                while c < cols and occupied[r][c]:
                                    c += 1
                                if c >= cols:
                                    break
                                if raw_value is None:
                                    c += 1
                                    continue
                                spec = _normalize_cell_value(raw_value)
                                requested_rowspan = max(1, min(int(spec["rowspan"]), rows - r))
                                requested_colspan = max(1, min(int(spec["colspan"]), cols - c))
                                rowspan, colspan = _fit_span(r, c, requested_rowspan, requested_colspan)
                                if rowspan <= 0 or colspan <= 0:
                                    c += 1
                                    continue
                                spec["rowspan"] = rowspan
                                spec["colspan"] = colspan
                                table_specs[(r, c)] = spec
                                style_params = _extract_style_params(spec)
                                if style_params or _extract_diagonal_params(spec):
                                    style_specs[(r, c)] = spec
                                for rr in range(r, r + rowspan):
                                    for cc in range(c, c + colspan):
                                        occupied[rr][cc] = True
                                if rowspan > 1 or colspan > 1:
                                    auto_merge_specs.append((r, c, r + rowspan - 1, c + colspan - 1))
                                c += colspan
                if merged_cells:
                    for merge_value in merged_cells:
                        merge_spec = _normalize_merge_spec(merge_value)
                        if merge_spec is not None:
                            manual_merge_specs.append(merge_spec)

                def _spec_has_meaningful_content(spec: dict[str, Any] | None) -> bool:
                    if not isinstance(spec, dict):
                        return False
                    for key in ("text", "equation", "top_left", "top_right", "bottom_left", "bottom_right"):
                        value = spec.get(key)
                        if value is not None and str(value).strip():
                            return True
                    content = spec.get("content")
                    if isinstance(content, list) and any(
                        (item is not None and str(item).strip()) if not isinstance(item, dict)
                        else any(str(item.get(k, "") or "").strip() for k in ("text", "value", "equation"))
                        for item in content
                    ):
                        return True
                    lines = spec.get("lines")
                    if isinstance(lines, list) and any(
                        (item is not None and str(item).strip()) if not isinstance(item, dict)
                        else any(str(item.get(k, "") or "").strip() for k in ("text", "value", "equation"))
                        for item in lines
                    ):
                        return True
                    return False

                def _rect_cells(rect: tuple[int, int, int, int]) -> list[tuple[int, int]]:
                    start_row, start_col, end_row, end_col = rect
                    return [
                        (rr, cc)
                        for rr in range(start_row, end_row + 1)
                        for cc in range(start_col, end_col + 1)
                    ]

                def _count_meaningful_anchor_cells(rect: tuple[int, int, int, int]) -> int:
                    start_row, start_col, end_row, end_col = rect
                    count = 0
                    for (rr, cc), spec in table_specs.items():
                        if start_row <= rr <= end_row and start_col <= cc <= end_col:
                            if _spec_has_meaningful_content(spec):
                                count += 1
                    return count

                def _resolve_merge_specs() -> list[tuple[int, int, int, int]]:
                    claimed = [[False for _ in range(cols)] for _ in range(rows)]
                    accepted: list[tuple[int, int, int, int]] = []
                    seen: set[tuple[int, int, int, int]] = set()

                    def _try_accept(rect: tuple[int, int, int, int]) -> None:
                        start_row, start_col, end_row, end_col = rect
                        normalized = (
                            max(0, min(int(start_row), rows - 1)),
                            max(0, min(int(start_col), cols - 1)),
                            max(0, min(int(end_row), rows - 1)),
                            max(0, min(int(end_col), cols - 1)),
                        )
                        start_row, start_col, end_row, end_col = normalized
                        if end_row < start_row or end_col < start_col:
                            return
                        if start_row == end_row and start_col == end_col:
                            return
                        rect = (start_row, start_col, end_row, end_col)
                        if rect in seen:
                            return
                        if _count_meaningful_anchor_cells(rect) > 1:
                            return
                        for rr, cc in _rect_cells(rect):
                            if claimed[rr][cc]:
                                return
                        accepted.append(rect)
                        seen.add(rect)
                        for rr, cc in _rect_cells(rect):
                            claimed[rr][cc] = True

                    # Prefer merges implied directly by cell anchor specs.
                    for rect in auto_merge_specs:
                        _try_accept(rect)
                    # Apply extra merged_cells only when they do not conflict.
                    for rect in manual_merge_specs:
                        _try_accept(rect)
                    return accepted

                def _run(action_name: str) -> None:
                    try:
                        hwp.HAction.Run(action_name)
                    except Exception:
                        try:
                            hwp.Run(action_name)
                        except Exception:
                            pass

                def _normalize_table_cell_items(spec: dict[str, Any]) -> list[Any]:
                    diagonal = str(spec.get("diagonal", "") or "").strip().lower()
                    top_left = spec.get("top_left")
                    top_right = spec.get("top_right")
                    bottom_left = spec.get("bottom_left")
                    bottom_right = spec.get("bottom_right")
                    has_corner_labels = any(
                        value is not None and str(value).strip()
                        for value in (top_left, top_right, bottom_left, bottom_right)
                    )
                    if has_corner_labels:
                        out: list[Any] = []

                        def _push_text(value: Any, align: str) -> None:
                            text_value = str(value or "").strip()
                            if not text_value:
                                return
                            out.append({"type": "text", "value": text_value, "align": align})

                        if diagonal in {"\\", "＼", "backslash", "diag_down", "down", "left_top_to_right_bottom"}:
                            _push_text(top_right, "right")
                            if out and bottom_left is not None and str(bottom_left).strip():
                                out.append({"type": "newline"})
                            _push_text(bottom_left, "left")
                        elif diagonal in {"/", "／", "slash", "diag_up", "up", "right_top_to_left_bottom"}:
                            _push_text(top_left, "left")
                            if out and bottom_right is not None and str(bottom_right).strip():
                                out.append({"type": "newline"})
                            _push_text(bottom_right, "right")
                        else:
                            _push_text(top_left, "left")
                            if out and top_right is not None and str(top_right).strip():
                                out.append({"type": "newline"})
                            _push_text(top_right, "right")
                            if out and bottom_left is not None and str(bottom_left).strip():
                                out.append({"type": "newline"})
                            _push_text(bottom_left, "left")
                            if out and bottom_right is not None and str(bottom_right).strip():
                                out.append({"type": "newline"})
                            _push_text(bottom_right, "right")

                        if out:
                            return out

                    content = spec.get("content")
                    if isinstance(content, list) and content:
                        return content

                    lines = spec.get("lines")
                    if isinstance(lines, list) and lines:
                        out: list[Any] = []
                        for idx, line in enumerate(lines):
                            if idx > 0:
                                out.append({"type": "newline"})
                            out.append(line)
                        return out

                    equation = spec.get("equation")
                    if equation is not None and str(equation).strip():
                        return [{"type": "equation", "value": str(equation).strip()}]

                    text = str(spec.get("text", "") or "")
                    normalized_text = text.replace("\r\n", "\n").replace("\r", "\n")
                    if "\n" not in normalized_text:
                        return [normalized_text]

                    out: list[Any] = []
                    for idx, line in enumerate(normalized_text.split("\n")):
                        if idx > 0:
                            out.append({"type": "newline"})
                        out.append(line)
                    return out

                def _insert_table_cell_item(item: Any) -> None:
                    if item is None:
                        return
                    if isinstance(item, dict):
                        kind = str(item.get("type", "") or "").strip().lower()
                        item_align = str(item.get("align", "") or "").strip().lower()
                        if not kind:
                            if item.get("equation") is not None:
                                kind = "equation"
                            elif item.get("text") is not None or item.get("value") is not None:
                                kind = "text"
                        if kind in {"newline", "linebreak", "break", "enter"}:
                            self.insert_enter()
                            return
                        if item_align in {"left", "왼쪽", "좌측"}:
                            self._set_paragraph_align("left")
                        elif item_align in {"center", "centre", "middle", "가운데", "중앙"}:
                            self._set_paragraph_align("center")
                        elif item_align in {"right", "오른쪽", "우측"}:
                            self._set_paragraph_align("right")
                        elif item_align in {"justify", "양쪽", "양쪽정렬"}:
                            self._set_paragraph_align("justify")
                        if kind in {"equation", "eq", "math"}:
                            eq = str(item.get("value", item.get("equation", "")) or "").strip()
                            if eq:
                                self.insert_equation(eq)
                            return
                        text_value = str(item.get("value", item.get("text", "")) or "")
                    else:
                        text_value = str(item)

                    stripped = text_value.strip()
                    if stripped == "EQ:":
                        return
                    if stripped.startswith("EQ:"):
                        eq = stripped.replace("EQ:", "", 1).strip()
                        if eq:
                            self.insert_equation(eq)
                        return
                    if text_value:
                        self.insert_text(text_value)

                _move_to_table_origin()
                for r in range(rows):
                    for c in range(cols):
                        _apply_table_font()
                        self._apply_compact_paragraph()
                        try:
                            self._set_font_name(self._typing_text_font_name)
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
                        spec = table_specs.get((r, c))
                        if spec:
                            _apply_cell_alignment(str(spec.get("align", "")))
                            for item in _normalize_table_cell_items(spec):
                                _insert_table_cell_item(item)
                        if c < cols - 1:
                            _run("TableRightCell")
                    if r < rows - 1:
                        _run("TableLowerCell")
                        for _ in range(cols - 1):
                            _run("TableLeftCell")
                resolved_merge_specs = _resolve_merge_specs()
                for start_row, start_col, end_row, end_col in sorted(
                    resolved_merge_specs,
                    key=lambda item: (item[0], item[1], item[2], item[3]),
                    reverse=True,
                ):
                    _merge_table_region(start_row, start_col, end_row, end_col)
                for (style_row, style_col), style_spec in style_specs.items():
                    _apply_cell_style(style_row, style_col, style_spec)
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
                self._compact_block_surroundings()
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
                self._compact_block_surroundings()
                self._line_start = True
                return
            except Exception:
                pass
            try:
                hwp.HAction.Run("TableLowerCell")
                hwp.HAction.Run("MoveDown")
                self._in_condition_box = False
                self._box_line_start = False
                self._compact_block_surroundings()
                self._line_start = True
                return
            except Exception:
                pass
            self._in_condition_box = False
            self._box_line_start = False
            raise HwpControllerError("박스 종료 실패: 박스 밖으로 이동하지 못했습니다.")
        except Exception as exc:
            raise HwpControllerError(f"박스 종료 실패: {exc}") from exc

    # Image insertion (1x1 invisible-table approach)
    _source_image_path: str | None = None

    def set_source_image(self, path: str | None) -> None:
        """Set the original source image path used for cropping."""
        self._source_image_path = path

    # Max pixel width for cropped images before gentle downscaling.
    _CROP_MAX_WIDTH = 900

    @staticmethod
    def _normalize_crop_box_1000(
        x1: float,
        y1: float,
        x2: float,
        y2: float,
    ) -> tuple[tuple[float, float, float, float], bool]:
        max_coord = max(abs(float(x1)), abs(float(y1)), abs(float(x2)), abs(float(y2)))
        legacy_ratio_input = max_coord <= 1.5
        scale = 1000.0 if legacy_ratio_input else 1.0
        xmin, xmax = sorted((float(x1) * scale, float(x2) * scale))
        ymin, ymax = sorted((float(y1) * scale, float(y2) * scale))
        xmin = max(0.0, min(1000.0, xmin))
        ymin = max(0.0, min(1000.0, ymin))
        xmax = max(0.0, min(1000.0, xmax))
        ymax = max(0.0, min(1000.0, ymax))
        if xmax <= xmin:
            xmax = min(1000.0, xmin + 1.0)
        if ymax <= ymin:
            ymax = min(1000.0, ymin + 1.0)
        if xmax <= xmin or ymax <= ymin:
            raise HwpControllerError(
                "insert_cropped_image 실패: 유효한 정규화 좌표를 만들 수 없습니다."
            )
        return ((xmin, ymin, xmax, ymax), legacy_ratio_input)

    @staticmethod
    def _normalized_box_1000_to_pixels(
        image_size: tuple[int, int],
        box_1000: tuple[float, float, float, float],
    ) -> tuple[int, int, int, int]:
        img_w, img_h = image_size
        xmin, ymin, xmax, ymax = box_1000
        x1 = max(0, min(int(round((xmin / 1000.0) * img_w)), img_w - 1))
        y1 = max(0, min(int(round((ymin / 1000.0) * img_h)), img_h - 1))
        x2 = max(x1 + 1, min(int(round((xmax / 1000.0) * img_w)), img_w))
        y2 = max(y1 + 1, min(int(round((ymax / 1000.0) * img_h)), img_h))
        return (x1, y1, x2, y2)

    @staticmethod
    def _pixel_rect_to_normalized_1000(
        image_size: tuple[int, int],
        rect: tuple[int, int, int, int],
    ) -> tuple[float, float, float, float]:
        img_w, img_h = image_size
        x1, y1, x2, y2 = rect
        if img_w <= 0 or img_h <= 0:
            return (0.0, 0.0, 1000.0, 1000.0)
        return (
            max(0.0, min(1000.0, (x1 / img_w) * 1000.0)),
            max(0.0, min(1000.0, (y1 / img_h) * 1000.0)),
            max(0.0, min(1000.0, (x2 / img_w) * 1000.0)),
            max(0.0, min(1000.0, (y2 / img_h) * 1000.0)),
        )

    def _render_percent_crop_image(
        self,
        src: str,
        box_1000: tuple[float, float, float, float],
    ) -> str:
        """
        Render a crop using the same idea as CSS percent-based viewport cropping:
        scale the full image, shift it by normalized offsets, and clip it to the
        target viewport instead of pre-cutting by raw pixel coordinates.
        """
        try:
            from PIL import Image
        except ImportError as exc:
            raise HwpControllerError(
                "insert_cropped_image 실패: Pillow 라이브러리가 필요합니다."
            ) from exc

        img = load_pil_image(src, mode="RGB")
        img_w, img_h = img.size
        xmin, ymin, xmax, ymax = box_1000
        crop_w_norm = max(1.0, xmax - xmin)
        crop_h_norm = max(1.0, ymax - ymin)
        raw_crop_w = max(1.0, img_w * (crop_w_norm / 1000.0))
        scale = min(1.0, float(self._CROP_MAX_WIDTH) / raw_crop_w)
        scaled_full_w = max(1, int(round(img_w * scale)))
        scaled_full_h = max(1, int(round(img_h * scale)))
        viewport_w = max(1, int(round((crop_w_norm / 1000.0) * scaled_full_w)))
        viewport_h = max(1, int(round((crop_h_norm / 1000.0) * scaled_full_h)))
        offset_x = -int(round((xmin / 1000.0) * scaled_full_w))
        offset_y = -int(round((ymin / 1000.0) * scaled_full_h))

        resized = img.resize((scaled_full_w, scaled_full_h), Image.LANCZOS)
        canvas = Image.new("RGB", (viewport_w, viewport_h), (255, 255, 255))
        canvas.paste(resized, (offset_x, offset_y))
        tmp_dir = Path(tempfile.gettempdir()) / "nova_ai"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = tmp_dir / f"crop_css_{os.getpid()}_{id(canvas)}.png"
        canvas.save(str(tmp_path), format="PNG")
        return str(tmp_path)

    def _extract_ocr_line_boxes(self, src: str) -> list[tuple[int, int, int, int, str]]:
        try:
            import os
            import pytesseract  # type: ignore[import-not-found]
            from PIL import Image  # type: ignore[import-not-found]
        except Exception:
            return []

        try:
            tesseract_cmd = os.getenv("TESSERACT_CMD")
            if tesseract_cmd:
                pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        except Exception:
            pass

        try:
            image = load_pil_image(src, mode="RGB")
        except Exception:
            return []

        scale = 1.0
        max_dim = max(image.size)
        if max_dim > 1800:
            scale = 1800.0 / float(max_dim)
            image = image.resize(
                (
                    max(1, int(image.size[0] * scale)),
                    max(1, int(image.size[1] * scale)),
                ),
                Image.LANCZOS,
            )

        try:
            data = pytesseract.image_to_data(
                image,
                lang="kor+eng",
                output_type=pytesseract.Output.DICT,
            )
        except Exception:
            return []

        count = len(data.get("text", []))
        groups: dict[tuple[int, int, int], dict[str, Any]] = {}
        for i in range(count):
            text = str(data.get("text", [""] * count)[i] or "").strip()
            if not text:
                continue
            try:
                conf = float(data.get("conf", ["-1"] * count)[i] or -1)
            except Exception:
                conf = -1
            if conf < 20 and len(text) < 2:
                continue
            try:
                left = int(data.get("left", [0] * count)[i] or 0)
                top = int(data.get("top", [0] * count)[i] or 0)
                width = int(data.get("width", [0] * count)[i] or 0)
                height = int(data.get("height", [0] * count)[i] or 0)
            except Exception:
                continue
            if width <= 0 or height <= 0:
                continue
            block = int(data.get("block_num", [0] * count)[i] or 0)
            par = int(data.get("par_num", [0] * count)[i] or 0)
            line = int(data.get("line_num", [0] * count)[i] or 0)
            key = (block, par, line)
            bucket = groups.setdefault(
                key,
                {
                    "x0": left,
                    "y0": top,
                    "x1": left + width,
                    "y1": top + height,
                    "parts": [],
                },
            )
            bucket["x0"] = min(int(bucket["x0"]), left)
            bucket["y0"] = min(int(bucket["y0"]), top)
            bucket["x1"] = max(int(bucket["x1"]), left + width)
            bucket["y1"] = max(int(bucket["y1"]), top + height)
            bucket["parts"].append((left, text))

        lines: list[tuple[int, int, int, int, str]] = []
        inv_scale = 1.0 / scale if scale > 0 else 1.0
        for bucket in groups.values():
            parts = sorted(bucket["parts"], key=lambda item: item[0])
            text = " ".join(str(part[1]) for part in parts).strip()
            if not text:
                continue
            x0 = int(round(float(bucket["x0"]) * inv_scale))
            y0 = int(round(float(bucket["y0"]) * inv_scale))
            x1 = int(round(float(bucket["x1"]) * inv_scale))
            y1 = int(round(float(bucket["y1"]) * inv_scale))
            if x1 <= x0 or y1 <= y0:
                continue
            lines.append((x0, y0, x1 - x0, y1 - y0, text))
        return lines

    def _snap_crop_to_text_gaps(
        self,
        src: str,
        rect: tuple[int, int, int, int],
        image_size: tuple[int, int],
    ) -> tuple[int, int, int, int]:
        img_w, img_h = image_size
        x1, y1, x2, y2 = rect
        lines = self._extract_ocr_line_boxes(src)
        if not lines:
            return rect

        band_expand_x = max(18, int((x2 - x1) * 0.18))
        search_y = max(60, int((y2 - y1) * 1.4))
        band_left = max(0, x1 - band_expand_x)
        band_right = min(img_w, x2 + band_expand_x)

        candidate_lines: list[tuple[int, int, int, int, str]] = []
        min_line_width = img_w * 0.12
        for line in lines:
            lx, ly, lw, lh, text = line
            if lw <= 0 or lh <= 0:
                continue
            compact = "".join(str(text or "").split())
            if len(compact) < 6 and lw < min_line_width:
                continue
            line_right = lx + lw
            if line_right < band_left or lx > band_right:
                continue
            if ly > y2 + search_y or (ly + lh) < y1 - search_y:
                continue
            candidate_lines.append(line)

        if not candidate_lines:
            return rect

        above_line: tuple[int, int, int, int, str] | None = None
        below_line: tuple[int, int, int, int, str] | None = None
        for line in candidate_lines:
            lx, ly, lw, lh, _text = line
            line_bottom = ly + lh
            if line_bottom <= y1:
                if above_line is None or line_bottom > above_line[1] + above_line[3]:
                    above_line = line
            elif ly >= y2:
                if below_line is None or ly < below_line[1]:
                    below_line = line

        snapped_top = y1
        snapped_bottom = y2
        if above_line is not None:
            _, ly, _lw, lh, _text = above_line
            margin = max(4, int(lh * 0.2))
            snapped_top = max(0, ly + lh + margin)
        if below_line is not None:
            _, ly, _lw, lh, _text = below_line
            margin = max(4, int(lh * 0.2))
            snapped_bottom = min(img_h, ly - margin)

        if snapped_bottom <= snapped_top:
            return rect

        new_height = snapped_bottom - snapped_top
        old_height = max(1, y2 - y1)
        if new_height < max(18, int(old_height * 0.45)):
            return rect

        return (x1, snapped_top, x2, snapped_bottom)

    def _refine_crop_rect(
        self,
        src: str,
        rect: tuple[int, int, int, int],
    ) -> tuple[int, int, int, int]:
        """
        Refine a rough AI crop using CV-heavy content detection plus OCR line-gap
        snapping so the final crop keeps figure labels but avoids swallowing
        surrounding body text.
        """
        try:
            import cv2  # type: ignore[import-not-found]
            import numpy as np  # type: ignore[import-not-found]
        except Exception:
            return rect

        img = load_cv2_image(src)
        if img is None:
            return rect

        ih, iw = img.shape[:2]
        x1, y1, x2, y2 = rect
        x1 = max(0, min(int(x1), iw - 1))
        y1 = max(0, min(int(y1), ih - 1))
        x2 = max(x1 + 1, min(int(x2), iw))
        y2 = max(y1 + 1, min(int(y2), ih))
        rough_rect = (x1, y1, x2, y2)
        rough_w = x2 - x1
        rough_h = y2 - y1
        if rough_w < 24 or rough_h < 24:
            return rough_rect

        search_pad_x = max(14, int(rough_w * 0.14))
        search_pad_y = max(14, int(rough_h * 0.14))
        sx1 = max(0, x1 - search_pad_x)
        sy1 = max(0, y1 - search_pad_y)
        sx2 = min(iw, x2 + search_pad_x)
        sy2 = min(ih, y2 + search_pad_y)
        search = img[sy1:sy2, sx1:sx2]
        if search.size == 0:
            return rough_rect

        sh, sw = search.shape[:2]
        if sw < 24 or sh < 24:
            return rough_rect

        gray = cv2.cvtColor(search, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        try:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(blurred)
        except Exception:
            enhanced = blurred

        _, non_white = cv2.threshold(enhanced, 244, 255, cv2.THRESH_BINARY_INV)
        try:
            _, otsu = cv2.threshold(
                enhanced,
                0,
                255,
                cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
            )
        except Exception:
            otsu = cv2.threshold(enhanced, 200, 255, cv2.THRESH_BINARY_INV)[1]
        adaptive = cv2.adaptiveThreshold(
            enhanced,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            31,
            11,
        )
        edges = cv2.Canny(enhanced, 40, 140)
        gradient = cv2.morphologyEx(enhanced, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
        _, gradient_mask = cv2.threshold(gradient, 18, 255, cv2.THRESH_BINARY)

        h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, int(sw * 0.08)), 1))
        v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, int(sh * 0.08))))
        h_lines = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, h_kernel)
        v_lines = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, v_kernel)

        mask = cv2.bitwise_or(non_white, otsu)
        mask = cv2.bitwise_or(mask, adaptive)
        mask = cv2.bitwise_or(mask, edges)
        mask = cv2.bitwise_or(mask, gradient_mask)
        mask = cv2.bitwise_or(mask, h_lines)
        mask = cv2.bitwise_or(mask, v_lines)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)

        def _trim_dense_edges(local_mask):
            trimmed = local_mask.copy()
            hh, ww = trimmed.shape[:2]
            if hh < 8 or ww < 8:
                return trimmed
            band = 2
            density_threshold = 0.22
            max_trim_y = max(1, int(hh * 0.12))
            max_trim_x = max(1, int(ww * 0.12))
            top = 0
            bottom = hh
            left = 0
            right = ww
            while top < max_trim_y:
                sample = trimmed[top : min(hh, top + band), left:right]
                if sample.size == 0:
                    break
                if float(np.count_nonzero(sample)) / float(sample.size) < density_threshold:
                    break
                top += 1
            while (hh - bottom) < max_trim_y and bottom > top:
                sample = trimmed[max(top, bottom - band) : bottom, left:right]
                if sample.size == 0:
                    break
                if float(np.count_nonzero(sample)) / float(sample.size) < density_threshold:
                    break
                bottom -= 1
            while left < max_trim_x:
                sample = trimmed[top:bottom, left : min(ww, left + band)]
                if sample.size == 0:
                    break
                if float(np.count_nonzero(sample)) / float(sample.size) < density_threshold:
                    break
                left += 1
            while (ww - right) < max_trim_x and right > left:
                sample = trimmed[top:bottom, max(left, right - band) : right]
                if sample.size == 0:
                    break
                if float(np.count_nonzero(sample)) / float(sample.size) < density_threshold:
                    break
                right -= 1
            if top > 0:
                trimmed[:top, :] = 0
            if bottom < hh:
                trimmed[bottom:, :] = 0
            if left > 0:
                trimmed[:, :left] = 0
            if right < ww:
                trimmed[:, right:] = 0
            return trimmed

        mask = _trim_dense_edges(mask)

        search_area = float(max(1, sw * sh))
        rough_rel = (x1 - sx1, y1 - sy1, x2 - sx1, y2 - sy1)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        if num_labels <= 1:
            return rough_rect

        components: list[dict[str, Any]] = []
        min_area = max(12, int(search_area * 0.00012))
        for label in range(1, num_labels):
            cx = int(stats[label, cv2.CC_STAT_LEFT])
            cy = int(stats[label, cv2.CC_STAT_TOP])
            cw = int(stats[label, cv2.CC_STAT_WIDTH])
            ch = int(stats[label, cv2.CC_STAT_HEIGHT])
            area = int(stats[label, cv2.CC_STAT_AREA])
            if cw <= 1 or ch <= 1 or area < min_area:
                continue
            density = float(area) / float(max(1, cw * ch))
            touches_edge = cx <= 1 or cy <= 1 or (cx + cw) >= sw - 1 or (cy + ch) >= sh - 1
            long_line = cw >= max(20, int(sw * 0.35)) or ch >= max(20, int(sh * 0.35))
            if touches_edge and area > search_area * 0.35 and density < 0.12 and not long_line:
                continue
            if density < 0.01 and not long_line:
                continue
            comp = {
                "x1": cx,
                "y1": cy,
                "x2": cx + cw,
                "y2": cy + ch,
                "area": area,
                "cx": cx + (cw / 2.0),
                "cy": cy + (ch / 2.0),
            }
            components.append(comp)

        if not components:
            return rough_rect

        def _rect_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> int:
            ax1, ay1, ax2, ay2 = a
            bx1, by1, bx2, by2 = b
            ix1 = max(ax1, bx1)
            iy1 = max(ay1, by1)
            ix2 = min(ax2, bx2)
            iy2 = min(ay2, by2)
            if ix2 <= ix1 or iy2 <= iy1:
                return 0
            return int((ix2 - ix1) * (iy2 - iy1))

        def _gap_to_union(comp: dict[str, Any], union_rect: tuple[int, int, int, int]) -> tuple[int, int]:
            ux1, uy1, ux2, uy2 = union_rect
            gap_x = max(0, max(ux1 - int(comp["x2"]), int(comp["x1"]) - ux2))
            gap_y = max(0, max(uy1 - int(comp["y2"]), int(comp["y1"]) - uy2))
            return gap_x, gap_y

        rough_center_x = (rough_rel[0] + rough_rel[2]) / 2.0
        rough_center_y = (rough_rel[1] + rough_rel[3]) / 2.0
        seeds = [
            comp for comp in components
            if _rect_overlap(
                rough_rel,
                (int(comp["x1"]), int(comp["y1"]), int(comp["x2"]), int(comp["y2"])),
            ) > 0
        ]
        if not seeds:
            seeds = [
                min(
                    components,
                    key=lambda comp: (
                        ((float(comp["cx"]) - rough_center_x) ** 2 + (float(comp["cy"]) - rough_center_y) ** 2),
                        -float(comp["area"]),
                    ),
                )
            ]

        union_x1 = min(int(comp["x1"]) for comp in seeds)
        union_y1 = min(int(comp["y1"]) for comp in seeds)
        union_x2 = max(int(comp["x2"]) for comp in seeds)
        union_y2 = max(int(comp["y2"]) for comp in seeds)
        gap_x_limit = max(16, int(rough_w * 0.12))
        gap_y_limit = max(16, int(rough_h * 0.12))

        changed = True
        while changed:
            changed = False
            current_union = (union_x1, union_y1, union_x2, union_y2)
            for comp in components:
                comp_rect = (int(comp["x1"]), int(comp["y1"]), int(comp["x2"]), int(comp["y2"]))
                if _rect_overlap(current_union, comp_rect) > 0:
                    if (
                        comp_rect[0] < union_x1
                        or comp_rect[1] < union_y1
                        or comp_rect[2] > union_x2
                        or comp_rect[3] > union_y2
                    ):
                        union_x1 = min(union_x1, comp_rect[0])
                        union_y1 = min(union_y1, comp_rect[1])
                        union_x2 = max(union_x2, comp_rect[2])
                        union_y2 = max(union_y2, comp_rect[3])
                        changed = True
                    continue
                gap_x, gap_y = _gap_to_union(comp, current_union)
                if gap_x <= gap_x_limit and gap_y <= gap_y_limit:
                    union_x1 = min(union_x1, comp_rect[0])
                    union_y1 = min(union_y1, comp_rect[1])
                    union_x2 = max(union_x2, comp_rect[2])
                    union_y2 = max(union_y2, comp_rect[3])
                    changed = True

        union_x1 = max(0, min(union_x1, sw - 1))
        union_y1 = max(0, min(union_y1, sh - 1))
        union_x2 = max(union_x1 + 1, min(union_x2, sw))
        union_y2 = max(union_y1 + 1, min(union_y2, sh))
        union_mask = mask[union_y1:union_y2, union_x1:union_x2]
        if union_mask.size == 0:
            return rough_rect

        row_proj = np.count_nonzero(union_mask, axis=1).astype(np.float32)
        col_proj = np.count_nonzero(union_mask, axis=0).astype(np.float32)
        if row_proj.size > 0:
            row_proj = np.convolve(row_proj, np.ones(5, dtype=np.float32) / 5.0, mode="same")
        if col_proj.size > 0:
            col_proj = np.convolve(col_proj, np.ones(5, dtype=np.float32) / 5.0, mode="same")

        row_peak = float(row_proj.max()) if row_proj.size else 0.0
        col_peak = float(col_proj.max()) if col_proj.size else 0.0
        row_thresh = max(1.0, row_peak * 0.08)
        col_thresh = max(1.0, col_peak * 0.08)
        row_idx = np.where(row_proj >= row_thresh)[0]
        col_idx = np.where(col_proj >= col_thresh)[0]
        if row_idx.size > 0:
            union_y1 += int(row_idx[0])
            union_y2 = union_y1 + int(row_idx[-1] - row_idx[0] + 1)
        if col_idx.size > 0:
            union_x1 += int(col_idx[0])
            union_x2 = union_x1 + int(col_idx[-1] - col_idx[0] + 1)

        refined_w = max(1, union_x2 - union_x1)
        refined_h = max(1, union_y2 - union_y1)
        pad_x = max(6, int(refined_w * 0.04))
        pad_y = max(6, int(refined_h * 0.05))
        rx1 = max(0, sx1 + union_x1 - pad_x)
        ry1 = max(0, sy1 + union_y1 - pad_y)
        rx2 = min(iw, sx1 + union_x2 + pad_x)
        ry2 = min(ih, sy1 + union_y2 + pad_y)
        refined_rect = (int(rx1), int(ry1), int(rx2), int(ry2))

        if rx2 <= rx1 or ry2 <= ry1:
            return rough_rect

        refined_area = float((rx2 - rx1) * (ry2 - ry1))
        rough_area = float(max(1, rough_w * rough_h))
        overlap_area = float(_rect_overlap(rough_rect, refined_rect))
        width_ratio = float(rx2 - rx1) / float(max(1, rough_w))
        height_ratio = float(ry2 - ry1) / float(max(1, rough_h))
        refined_center_x = (rx1 + rx2) / 2.0
        refined_center_y = (ry1 + ry2) / 2.0
        rough_center_abs_x = (x1 + x2) / 2.0
        rough_center_abs_y = (y1 + y2) / 2.0
        center_distance = ((refined_center_x - rough_center_abs_x) ** 2 + (refined_center_y - rough_center_abs_y) ** 2) ** 0.5
        if refined_area < rough_area * 0.02:
            return rough_rect
        if overlap_area <= 0:
            return rough_rect
        if center_distance > max(rough_w, rough_h) * 0.8:
            return rough_rect
        if refined_area < rough_area * 0.08:
            return rough_rect
        if refined_area < rough_area * 0.15 and (width_ratio < 0.45 or height_ratio < 0.45):
            return rough_rect
        if width_ratio < 0.18 or height_ratio < 0.18:
            return rough_rect
        if refined_area >= rough_area * 0.995:
            refined_rect = rough_rect

        snapped_rect = self._snap_crop_to_text_gaps(src, refined_rect, (iw, ih))
        sx1_final, sy1_final, sx2_final, sy2_final = snapped_rect
        if sx2_final <= sx1_final or sy2_final <= sy1_final:
            return refined_rect
        snapped_area = float((sx2_final - sx1_final) * (sy2_final - sy1_final))
        if snapped_area < refined_area * 0.45:
            return refined_rect
        return snapped_rect

    def insert_cropped_image(
        self,
        x1_pct: float,
        y1_pct: float,
        x2_pct: float,
        y2_pct: float,
    ) -> None:
        """
        Insert a region from the source image into the HWP document.

        Preferred coordinates are normalized 0-1000 values, matching Gemini
        responseSchema output. Legacy 0.0-1.0 ratios are still accepted.
        The final inserted image is rendered with CSS-style percent cropping
        math and then placed into an invisible 1x1 table cell.
        """
        src = self._source_image_path
        if not src or not Path(src).exists():
            raise HwpControllerError(
                "insert_cropped_image 실패: 원본 이미지 경로가 설정되지 않았거나 파일이 없습니다."
            )
        box_1000, legacy_ratio_input = self._normalize_crop_box_1000(
            x1_pct,
            y1_pct,
            x2_pct,
            y2_pct,
        )
        img = load_pil_image(src, mode="RGB")
        if legacy_ratio_input:
            px1, py1, px2, py2 = self._normalized_box_1000_to_pixels(img.size, box_1000)
            rx1, ry1, rx2, ry2 = self._refine_crop_rect(src, (px1, py1, px2, py2))
            box_1000 = self._pixel_rect_to_normalized_1000(
                img.size,
                (rx1, ry1, rx2, ry2),
            )
        rendered_path = self._render_percent_crop_image(src, box_1000)

        self._insert_1x1_table()
        self._set_current_table_border_none()
        try:
            self._set_paragraph_align("center")
        except Exception:
            pass
        self._raw_insert_picture(rendered_path)
        self._exit_table_after_image()

    def insert_generated_image(self, image_path: str) -> None:
        """
        Insert a pre-generated image file into the document using the same
        table-based flow as insert_cropped_image().
        """
        path = (image_path or "").strip()
        if not path:
            raise HwpControllerError("insert_generated_image 실패: 이미지 경로가 비어 있습니다.")
        p = Path(path)
        if not p.exists():
            raise HwpControllerError(f"insert_generated_image 실패: 파일을 찾을 수 없습니다: {path}")

        self._insert_1x1_table()
        self._set_current_table_border_none()
        try:
            self._set_paragraph_align("center")
        except Exception:
            pass
        self._raw_insert_picture(str(p))
        self._exit_table_after_image()

    # Low-level image helpers (table-based)

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
        3. SelectCtrlReverse plus the retry strategies above
        """
        hwp = self._ensure_connected()

        # Strategy 1: ShapeObjDialog (works even inside table cells)
        try:
            pset = hwp.HParameterSet.HShapeObject
            hwp.HAction.GetDefault("ShapeObjDialog", pset.HSet)
            pset.TreatAsChar = 1
            pset.TextWrap = 0
            hwp.HAction.Execute("ShapeObjDialog", pset.HSet)
            return
        except Exception:
            pass

        # Strategy 2: Select the control, then direct property set
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

            img = load_pil_image(image_path)
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
        2. Insert a 1x1 table (block-level element, so text cannot flow beside it).
        3. Set table border to 0/none (invisible).
        4. Insert the resized image inside the table cell.
        5. Exit the table so the cursor moves below the image.

        This approach uses structure (table) instead of properties
        (TreatAsChar, TextWrap) to enforce block layout.
        """
        abs_path = str(Path(image_path).resolve())

        # 1. Physically resize the image
        insert_path = self._physically_resize_image(abs_path, self._IMAGE_INSERT_SCALE)

        # 2. Insert 1x1 table
        self._insert_1x1_table()

        # 3. Set table border to none (invisible)
        self._set_current_table_border_none()

        # 4. Center-align cell and insert the image
        try:
            self._set_paragraph_align("center")
        except Exception:
            pass
        self._raw_insert_picture(insert_path)

        # 5. Exit table and leave the cursor below the image
        self._exit_table_after_image()

    def exit_table(self) -> None:
        """Exit the current table without adding an extra blank line."""
        hwp = self._ensure_connected()
        try:
            try:
                hwp.HAction.Run("CloseEx")
                hwp.HAction.Run("MoveDown")
                self._compact_block_surroundings()
                self._line_start = True
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
                self._compact_block_surroundings()
                self._line_start = True
                return
            except Exception:
                pass
            raise HwpControllerError("표 종료 실패: 표 밖으로 이동하지 못했습니다.")
        except Exception as exc:
            raise HwpControllerError(f"표 종료 실패: {exc}") from exc

