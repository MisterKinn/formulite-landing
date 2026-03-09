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
    lower = msg.lower()
    return (
        "rpc server is unavailable" in lower
        or "0x800706ba" in lower
        or "-2147023174" in lower
        or ("rpc" in lower and ("unavailable" in lower or "server" in lower))
        or ("RPC" in msg and ("?쒕쾭" in msg or "곌껐" in msg or "연결" in msg))
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
        import comtypes  # type: ignore
        import comtypes.client  # type: ignore
        try:
            comtypes.CoInitialize()
        except OSError:
            pass
        if HwpController._uia_instance is None:
            uia_mod = comtypes.client.GetModule("UIAutomationCore.dll")
            uia = comtypes.CoCreateInstance(
                uia_mod.CUIAutomation._reg_clsid_,
                interface=uia_mod.IUIAutomation,
                clsctx=comtypes.CLSCTX_INPROC_SERVER,
            )
            HwpController._uia_instance = uia
            HwpController._uia_walker = uia.CreateTreeWalker(uia.RawViewCondition)
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
            raise HwpControllerError("LitePro???꾩옱 Windows留?吏?먰빀?덈떎.")

        if self._hwp is not None:
            return

        if not self.find_hwp_windows():
            raise HwpControllerError("?쒓?(HWP) 李쎌쓣 李얠? 紐삵뻽?듬땲?? 癒쇱? HWP瑜??ㅽ뻾?섏꽭??")

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
            raise HwpControllerError(f"援듦쾶 ?ㅼ젙 ?ㅽ뙣: {exc}") from exc
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
            raise HwpControllerError(f"諛묒쨪 ?ㅼ젙 ?ㅽ뙣: {exc}") from exc
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
        hwp = self._ensure_connected()
        normalized = self._normalize_hwp_color(color)
        try:
            action = hwp.HAction
            param = hwp.HParameterSet.HCharShape
            action.GetDefault("CharShape", param.HSet)

            # Best-effort across HWP versions: some expose shade/background attrs
            # directly, some only through HSet keys.
            color_value = normalized if normalized is not None else 0xFFFFFF
            enabled = normalized is not None
            applied = False

            bool_fields = (
                "Shade",
                "UseShadeColor",
                "UseBackgroundColor",
                "UseTextBackgroundColor",
            )
            color_fields = (
                "ShadeColor",
                "BackColor",
                "BackgroundColor",
                "TextBackgroundColor",
            )

            for attr in bool_fields:
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, 1 if enabled else 0)
                        applied = True
                    except Exception:
                        pass
            for attr in color_fields:
                if hasattr(param, attr):
                    try:
                        setattr(param, attr, color_value)
                        applied = True
                    except Exception:
                        pass

            hset = getattr(param, "HSet", None)
            if hset is not None:
                for key in bool_fields:
                    try:
                        hset.SetItem(key, 1 if enabled else 0)
                        applied = True
                    except Exception:
                        pass
                for key in color_fields:
                    try:
                        hset.SetItem(key, color_value)
                        applied = True
                    except Exception:
                        pass

            if not applied:
                raise HwpControllerError("문자 형광/배경색 속성을 찾지 못했습니다.")
            action.Execute("CharShape", param.HSet)
        except Exception as exc:
            raise HwpControllerError(f"문자 형광/배경색 설정 실패: {exc}") from exc

    def insert_highlighted_text(self, text: str, color: Any | None = "yellow") -> None:
        self.set_text_highlight(color)
        try:
            self.insert_text(text)
        finally:
            try:
                self.set_text_highlight(None)
            except Exception:
                pass

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
        self.set_text_color(color)
        try:
            self.insert_text(text)
        finally:
            try:
                self.set_text_color("black")
            except Exception:
                pass

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
        if color is not None:
            self.set_text_color(color)
        if highlight is not None:
            self.set_text_highlight(highlight)
        try:
            self.insert_text(text)
        finally:
            try:
                if highlight is not None:
                    self.set_text_highlight(None)
            except Exception:
                pass
            try:
                if color is not None:
                    self.set_text_color("black")
            except Exception:
                pass
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
        Set character width ratio (?ν룊). 100 = 100%.
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
            raise HwpControllerError(f"?ν룊 ?ㅼ젙 ?ㅽ뙣: {exc}") from exc

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
            raise HwpControllerError(f"???뚮몢由??됱긽 ?ㅼ젙 ?ㅽ뙣: {exc}") from exc

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
            raise HwpControllerError(f"?⑤씫 ?섎늻湲??ㅽ뙣: {exc}") from exc

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
            raise HwpControllerError(f"?고듃 ?ш린 ?ㅼ젙 ?ㅽ뙣: {exc}") from exc

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
            raise HwpControllerError(f"湲瑗??ㅼ젙 ?ㅽ뙣: {exc}") from exc

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
            self._set_font_name("HYhwpEQ")
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
            raise HwpControllerError("?쒗뵆由??대쫫??鍮꾩뼱?덉뒿?덈떎.")
        ok = self._try_insert_template(name)
        if not ok:
            template_path = self._template_dir / name
            raise HwpControllerError(f"?쒗뵆由우쓣 李얠? 紐삵뻽?듬땲?? {template_path}")
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

    def run_hwp_action(self, action_name: str) -> None:
        name = str(action_name or "").strip()
        if not name:
            raise HwpControllerError("실행할 HWP Action 이름이 비어 있습니다.")
        if not self._run_action_best_effort(name):
            raise HwpControllerError(f"HWP Action 실행 실패: {name}")

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
                if child is not None:
                    self._apply_hwp_parameter_values(child, {rest: value})
                    continue
            if isinstance(value, dict):
                child = getattr(target, key, None)
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
        if param_sets is not None:
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
            raise HwpControllerError("HWP FindReplace ?명꽣?섏씠?ㅻ? 李얠? 紐삵뻽?듬땲??")
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
        This enables "湲곗〈??@@@/###??吏?곌퀬 洹??먮━????댄븨" workflows.
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
        candidates = ["###", "# # #"]
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
        find a '<蹂닿린>' heading and move into the nearest table cell below it.
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
        """Update controller state to match being inside a 蹂닿린/議곌굔 box."""
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
            raise HwpControllerError(f"諛뺤뒪 ?쎌엯 ?ㅽ뙣: {exc}") from exc

    def insert_view_box(self) -> None:
        """
        Insert a 1x1 table for a <蹂닿린> container.
        The <蹂닿린> header text is assumed to be pre-printed or added separately.
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

        # Match novaai behavior: add "< 蹂?湲?>" header centered.
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
            self.insert_text("< 蹂?湲?>")
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

        # Ensure <蹂닿린> content uses 8pt (and equation-friendly font) consistently.
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
        candidates = ["###", "# # #"]

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
            raise HwpControllerError("?쒖쓽 ???댁? 1 ?댁긽?댁뼱???⑸땲??")
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

            table_specs: dict[tuple[int, int], dict[str, Any]] = {}
            merge_specs: list[tuple[int, int, int, int]] = []
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
                    text = value.get("text")
                    if text is None:
                        text = value.get("value", "")
                    return {
                        "text": "" if text is None else str(text),
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
                if not isinstance(spec, dict):
                    return {}
                params: dict[str, Any] = {}
                fill_color = self._normalize_hwp_color(
                    spec.get("fill_color", spec.get("background_color", spec.get("bg_color")))
                )
                if fill_color is not None:
                    params["FillAttr"] = {"Type": 1, "WinBrushFaceColor": fill_color}

                border_type = self._normalize_hwp_border_type(spec.get("border_type", spec.get("line_style")))
                border_width = self._normalize_hwp_border_width(spec.get("border_width", spec.get("line_width")))
                border_color = self._normalize_hwp_color(spec.get("border_color"))

                side_color_overrides = {
                    "Left": self._normalize_hwp_color(spec.get("border_color_left")),
                    "Right": self._normalize_hwp_color(spec.get("border_color_right")),
                    "Top": self._normalize_hwp_color(spec.get("border_color_top")),
                    "Bottom": self._normalize_hwp_color(spec.get("border_color_bottom")),
                }
                vertical_color = self._normalize_hwp_color(
                    spec.get("border_color_vertical", spec.get("color_vert"))
                )
                horizontal_color = self._normalize_hwp_color(
                    spec.get("border_color_horizontal", spec.get("color_horz"))
                )
                side_type_overrides = {
                    "Left": self._normalize_hwp_border_type(spec.get("border_type_left")),
                    "Right": self._normalize_hwp_border_type(spec.get("border_type_right")),
                    "Top": self._normalize_hwp_border_type(spec.get("border_type_top")),
                    "Bottom": self._normalize_hwp_border_type(spec.get("border_type_bottom")),
                }
                side_width_overrides = {
                    "Left": self._normalize_hwp_border_width(spec.get("border_width_left")),
                    "Right": self._normalize_hwp_border_width(spec.get("border_width_right")),
                    "Top": self._normalize_hwp_border_width(spec.get("border_width_top")),
                    "Bottom": self._normalize_hwp_border_width(spec.get("border_width_bottom")),
                }

                if border_color is not None:
                    params["BorderColor"] = border_color
                    params["ColorVert"] = border_color
                    params["ColorHorz"] = border_color
                    for suffix in ("Left", "Right", "Top", "Bottom"):
                        params[f"BorderColor{suffix}"] = border_color
                if vertical_color is not None:
                    params["ColorVert"] = vertical_color
                if horizontal_color is not None:
                    params["ColorHorz"] = horizontal_color
                for suffix, value in side_color_overrides.items():
                    if value is not None:
                        params[f"BorderColor{suffix}"] = value
                if border_type is not None:
                    params["BorderType"] = border_type
                    for suffix in ("Left", "Right", "Top", "Bottom"):
                        params[f"BorderType{suffix}"] = border_type
                for suffix, value in side_type_overrides.items():
                    if value is not None:
                        params[f"BorderType{suffix}"] = value
                if border_width is not None:
                    params["BorderWidth"] = border_width
                    for suffix in ("Left", "Right", "Top", "Bottom"):
                        params[f"BorderWidth{suffix}"] = border_width
                for suffix, value in side_width_overrides.items():
                    if value is not None:
                        params[f"BorderWidth{suffix}"] = value
                return params

            def _apply_cell_style(row: int, col: int, spec: dict[str, Any]) -> None:
                style_params = _extract_style_params(spec)
                if not style_params:
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
                finally:
                    self._run_action_best_effort("Cancel")

            if cell_data or merged_cells:
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
                                setattr(param, attr, "HYhwpEQ")
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
                                param.HSet.SetItem(key, "HYhwpEQ")
                            except Exception:
                                pass
                        action.Execute("CharShape", param.HSet)
                    except Exception:
                        pass

                # Normalize cell_data to rows x cols and collect merged-cell specs.
                if cell_data and cell_data and isinstance(cell_data[0], str):
                    flat = [str(x) for x in cell_data]
                    cell_data = [
                        flat[i : i + cols] for i in range(0, len(flat), cols)
                    ]
                occupied = [[False for _ in range(cols)] for _ in range(rows)]
                if isinstance(cell_data, list):
                    max_rows = min(rows, len(cell_data))
                    for r in range(max_rows):
                        row = cell_data[r]
                        if not isinstance(row, list):
                            row = [row]
                        c = 0
                        for raw_value in row:
                            while c < cols and occupied[r][c]:
                                c += 1
                            if c >= cols:
                                break
                            if raw_value is None:
                                occupied[r][c] = True
                                c += 1
                                continue
                            spec = _normalize_cell_value(raw_value)
                            rowspan = max(1, min(int(spec["rowspan"]), rows - r))
                            colspan = max(1, min(int(spec["colspan"]), cols - c))
                            spec["rowspan"] = rowspan
                            spec["colspan"] = colspan
                            table_specs[(r, c)] = spec
                            style_params = _extract_style_params(spec)
                            if style_params:
                                style_specs[(r, c)] = spec
                            for rr in range(r, r + rowspan):
                                for cc in range(c, c + colspan):
                                    occupied[rr][cc] = True
                            if rowspan > 1 or colspan > 1:
                                merge_specs.append((r, c, r + rowspan - 1, c + colspan - 1))
                            c += colspan
                if merged_cells:
                    for merge_value in merged_cells:
                        merge_spec = _normalize_merge_spec(merge_value)
                        if merge_spec is not None:
                            merge_specs.append(merge_spec)

                def _run(action_name: str) -> None:
                    try:
                        hwp.HAction.Run(action_name)
                    except Exception:
                        try:
                            hwp.Run(action_name)
                        except Exception:
                            pass

                _move_to_table_origin()
                for r in range(rows):
                    for c in range(cols):
                        _apply_table_font()
                        self._apply_compact_paragraph()
                        try:
                            self._set_font_name("HYhwpEQ")
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
                            value = str(spec.get("text", ""))
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
                unique_merge_specs = list(dict.fromkeys(merge_specs))
                for start_row, start_col, end_row, end_col in sorted(
                    unique_merge_specs,
                    key=lambda item: (item[0], item[1], item[2], item[3]),
                    reverse=True,
                ):
                    _merge_table_region(start_row, start_col, end_row, end_col)
                for (style_row, style_col), style_spec in style_specs.items():
                    _apply_cell_style(style_row, style_col, style_spec)
        except Exception as exc:
            raise HwpControllerError(f"???쎌엯 ?ㅽ뙣: {exc}") from exc
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
            raise HwpControllerError("諛뺤뒪 醫낅즺 ?ㅽ뙣: ??諛뺤뒪 ?대룞 ?ㅽ뙣")
        except Exception as exc:
            raise HwpControllerError(f"諛뺤뒪 醫낅즺 ?ㅽ뙣: {exc}") from exc

    # ?? Image insertion (1x1 invisible-table approach) ??????
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

        Parameters are percentages (0.0??.0) of the original image dimensions:
            x1_pct, y1_pct = top-left corner
            x2_pct, y2_pct = bottom-right corner

        The cropped region is already a small portion of the original, so we
        only downscale when it exceeds _CROP_MAX_WIDTH pixels.
        """
        src = self._source_image_path
        if not src or not Path(src).exists():
            raise HwpControllerError(
                "insert_cropped_image 실패: 원본 이미지 경로가 설정되지 않았거나 파일이 없습니다."
            )

        try:
            from PIL import Image
        except ImportError:
            raise HwpControllerError(
                "insert_cropped_image 실패: Pillow 라이브러리가 필요합니다."
            )

        img = Image.open(src)
        w, h = img.size

        # Be tolerant of model output: swapped/equal percentages are auto-normalized.
        lx_pct, rx_pct = sorted((float(x1_pct), float(x2_pct)))
        ty_pct, by_pct = sorted((float(y1_pct), float(y2_pct)))

        x1 = max(0, min(int(lx_pct * w), w))
        y1 = max(0, min(int(ty_pct * h), h))
        x2 = max(0, min(int(rx_pct * w), w))
        y2 = max(0, min(int(by_pct * h), h))

        if x2 <= x1:
            x2 = min(w, x1 + 1)
        if y2 <= y1:
            y2 = min(h, y1 + 1)
        if x2 <= x1 or y2 <= y1:
            raise HwpControllerError(
                f"insert_cropped_image 실패: 유효한 좌표를 만들 수 없습니다 "
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

    # ?? Low-level image helpers (table-based) ?????????????

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
        """Insert an image file into HWP as inline (湲?먯쿂??痍④툒)."""
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
                        param_obj.Treatment = 0  # 湲?먯쿂??痍④툒
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
        3. SelectCtrlReverse ??retry strategies above
        """
        hwp = self._ensure_connected()

        # ?? Strategy 1: ShapeObjDialog (works even inside table cells) ??
        try:
            pset = hwp.HParameterSet.HShapeObject
            hwp.HAction.GetDefault("ShapeObjDialog", pset.HSet)
            pset.TreatAsChar = 1
            pset.TextWrap = 0
            hwp.HAction.Execute("ShapeObjDialog", pset.HSet)
            return
        except Exception:
            pass

        # ?? Strategy 2: Select the control, then direct property set ??
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
        2. Insert a 1x1 table (block-level element ??text cannot flow beside it).
        3. Set table border to 0/none (invisible).
        4. Insert the resized image inside the table cell.
        5. Exit the table ??cursor moves below the image.

        This approach uses structure (table) instead of properties
        (TreatAsChar, TextWrap) to enforce block layout.
        """
        abs_path = str(Path(image_path).resolve())

        # ?? 1. Physically resize the image ????????????????????
        insert_path = self._physically_resize_image(abs_path, self._IMAGE_INSERT_SCALE)

        # ?? 2. Insert 1x1 table ??????????????????????????????
        self._insert_1x1_table()

        # ?? 3. Set table border to none (invisible) ??????????
        self._set_current_table_border_none()

        # ?? 4. Center-align cell & insert the image ??????????
        try:
            self._set_paragraph_align("center")
        except Exception:
            pass
        self._raw_insert_picture(insert_path)

        # ?? 5. Exit table ??cursor below the image ???????????
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
            raise HwpControllerError("??醫낅즺 ?ㅽ뙣: ??諛뺤뒪 ?대룞 ?ㅽ뙣")
        except Exception as exc:
            raise HwpControllerError(f"??醫낅즺 ?ㅽ뙣: {exc}") from exc

