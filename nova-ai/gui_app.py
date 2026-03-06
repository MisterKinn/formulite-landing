from __future__ import annotations

import concurrent.futures
import ast
import base64
import json
import os
import re
import sys
import queue
import threading
import math
import tempfile
import time
import uuid
from pathlib import Path

# Allow running this file directly (python gui_app.py) by ensuring the
# package parent directory is on sys.path.
if __package__ in (None, ""):
    pkg_parent = Path(__file__).resolve().parent.parent
    if str(pkg_parent) not in sys.path:
        sys.path.insert(0, str(pkg_parent))

from PySide6.QtCore import Qt, QTimer, QThread, Signal, QEvent, QSize, QRect
from PySide6.QtWidgets import (
    QApplication,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QMessageBox,
    QFileDialog,
    QTextEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QStackedLayout,
    QSizePolicy,
    QProgressBar,
    QFrame,
    QDialog,
    QComboBox,
    QLineEdit,
)
from PySide6.QtGui import (
    QColor, QPalette, QGuiApplication, QImage, QPixmap, QIcon,
    QFont, QFontDatabase, QPainter, QDoubleValidator, QIntValidator,
)
from PySide6.QtWidgets import QStyledItemDelegate, QStyle

from ai_client import AIClient, AIClientError
from hwp_controller import HwpController, HwpControllerError
from ocr_pipeline import extract_text, extract_text_from_pil_image, OcrError
from layout_detector import detect_container, crop_inside_rect, mask_rect_on_image
from prompt_loader import get_image_generation_prompt
from script_runner import ScriptRunner, ScriptCancelled
from backend.oauth_desktop import get_stored_user, start_oauth_flow, logout_user, is_logged_in
from backend.firebase_profile import (
    refresh_user_profile_from_firebase,
    get_ai_usage,
    increment_ai_usage,
    get_remaining_usage,
    check_usage_limit,
    get_plan_limit,
    force_refresh_usage,
    register_desktop_device_session,
    is_desktop_session_active,
    PLAN_LIMITS,
)


class LoginWorker(QThread):
    """OAuth ????? ????????????"""
    finished = Signal(bool)  # True if login successful
    
    def run(self) -> None:
        try:
            user = start_oauth_flow(timeout=300)
            self.finished.emit(user is not None and bool(user.get("uid")))
        except Exception:
            self.finished.emit(False)


class FilenameWorker(QThread):
    result = Signal(str, int, int)

    def run(self) -> None:  # type: ignore[override]
        filename = ""
        cur_page = 0
        total_page = 0
        try:
            filename = HwpController.get_current_filename()
            if filename:
                try:
                    cur_page, total_page = HwpController.get_current_page()
                except Exception:
                    cur_page, total_page = 0, 0
        except Exception:
            filename = ""
        self.result.emit(filename or "", cur_page, total_page)


class ProfileRefreshWorker(QThread):
    finished = Signal(object, int)

    def __init__(self, uid: str, force_usage_refresh: bool = False) -> None:
        super().__init__()
        self._uid = uid
        self._force_usage_refresh = force_usage_refresh

    def run(self) -> None:  # type: ignore[override]
        profile = None
        usage = 0
        try:
            profile = refresh_user_profile_from_firebase()
        except Exception:
            profile = None
        try:
            if self._force_usage_refresh:
                usage = force_refresh_usage()
            else:
                usage = get_ai_usage(self._uid)
        except Exception:
            usage = 0
        self.finished.emit(profile or {}, usage)


class SessionGuardWorker(QThread):
    finished = Signal(bool)

    def __init__(self, uid: str, desktop_session_id: str, tier: str, email: str) -> None:
        super().__init__()
        self._uid = uid
        self._desktop_session_id = desktop_session_id
        self._tier = tier
        self._email = email

    def run(self) -> None:  # type: ignore[override]
        try:
            active = is_desktop_session_active(
                self._uid,
                self._desktop_session_id,
                tier=self._tier,
                email=self._email,
            )
        except Exception:
            # Network/API issues should not force local logout.
            active = True
        self.finished.emit(bool(active))


class AIWorker(QThread):
    finished = Signal(object)
    error = Signal(str)
    progress = Signal(int, str)
    item_finished = Signal(int, str)

    def __init__(self, image_paths: list[str], image_mode: str = "crop") -> None:
        super().__init__()
        self._image_paths = image_paths
        mode = (image_mode or "crop").strip().lower()
        if mode not in {"no_image", "crop", "ai_generate"}:
            mode = "crop"
        self._image_mode = mode
        self._image_generation_prompt_cache: str | None = None

    @staticmethod
    def _extract_code(text: str) -> str:
        cleaned = (text or "").strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            return "\n".join(lines).strip()
        return cleaned

    def _get_image_generation_prompt(self) -> str:
        if self._image_generation_prompt_cache is not None:
            return self._image_generation_prompt_cache
        prompt = get_image_generation_prompt().strip()
        if not prompt:
            prompt = "Recreate the provided crop as a clean grayscale CSAT-style vector diagram."
        self._image_generation_prompt_cache = prompt
        return prompt

    @staticmethod
    def _extract_inline_image_bytes(response: object) -> tuple[bytes | None, str]:
        def _get_field(obj: object, *names: str) -> object | None:
            if obj is None:
                return None
            if isinstance(obj, dict):
                for name in names:
                    if name in obj:
                        return obj.get(name)
                return None
            for name in names:
                try:
                    value = getattr(obj, name)
                except Exception:
                    continue
                if value is not None:
                    return value
            return None

        def _iter_items(value: object) -> list[object]:
            if value is None:
                return []
            if isinstance(value, dict):
                return []
            if isinstance(value, (str, bytes, bytearray)):
                return []
            try:
                return list(value)  # Handles protobuf repeated containers.
            except Exception:
                return []

        def _decode_data(data: object) -> bytes | None:
            if data is None:
                return None
            if isinstance(data, (bytes, bytearray)):
                return bytes(data)
            if isinstance(data, str):
                text = data.strip()
                if not text:
                    return None
                if text.startswith("data:") and "," in text:
                    text = text.split(",", 1)[1].strip()
                try:
                    return base64.b64decode(text, validate=True)
                except Exception:
                    try:
                        return base64.b64decode(text + "===")
                    except Exception:
                        return None
            return None

        def _pull_from_part(part: object) -> tuple[bytes | None, str]:
            inline = _get_field(part, "inline_data", "inlineData")
            if inline is None:
                return (None, "")
            mime = (
                _get_field(inline, "mime_type", "mimeType")
                or "image/png"
            )
            data = _decode_data(_get_field(inline, "data"))
            if data:
                return (data, str(mime or "image/png"))
            return (None, "")

        def _scan_container(container: object) -> tuple[bytes | None, str]:
            parts = _iter_items(_get_field(container, "parts"))
            for part in parts:
                data, mime = _pull_from_part(part)
                if data:
                    return (data, mime)

            candidates = _iter_items(_get_field(container, "candidates"))
            for candidate in candidates:
                content = _get_field(candidate, "content")
                cparts = _iter_items(_get_field(content, "parts"))
                for part in cparts:
                    data, mime = _pull_from_part(part)
                    if data:
                        return (data, mime)
            return (None, "")

        data, mime = _scan_container(response)
        if data:
            return (data, mime)

        # Some SDK responses expose only dict payload via to_dict().
        try:
            to_dict = getattr(response, "to_dict", None)
            if callable(to_dict):
                payload = to_dict()
                data, mime = _scan_container(payload)
                if data:
                    return (data, mime)
        except Exception:
            pass
        return (None, "")

    @staticmethod
    def _parse_crop_call_args(arg_expr: str) -> tuple[float, float, float, float] | None:
        try:
            node = ast.parse(f"f({arg_expr})", mode="eval")
            call = node.body  # type: ignore[attr-defined]
            if not isinstance(call, ast.Call):
                return None
            args = [float(ast.literal_eval(a)) for a in call.args]
            if len(args) != 4:
                return None
            return (args[0], args[1], args[2], args[3])
        except Exception:
            return None

    @staticmethod
    def _crop_region_to_file(
        source_image_path: str,
        coords: tuple[float, float, float, float],
        *,
        idx: int,
        call_no: int,
    ) -> str:
        from PIL import Image  # type: ignore[import-not-found]

        x1_pct, y1_pct, x2_pct, y2_pct = coords
        img = Image.open(source_image_path).convert("RGB")
        w, h = img.size
        x1 = max(0, min(int(x1_pct * w), w))
        y1 = max(0, min(int(y1_pct * h), h))
        x2 = max(0, min(int(x2_pct * w), w))
        y2 = max(0, min(int(y2_pct * h), h))
        if x2 <= x1 or y2 <= y1:
            raise AIClientError(
                f"크롭 좌표가 잘못되었습니다: ({x1_pct}, {y1_pct})-({x2_pct}, {y2_pct})"
            )

        crop = img.crop((x1, y1, x2, y2))
        tmp_dir = Path(tempfile.gettempdir()) / "nova_ai" / "generated_crops"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        out_path = tmp_dir / f"crop_{os.getpid()}_{idx}_{call_no}_{uuid.uuid4().hex[:8]}.png"
        crop.save(out_path, format="PNG")
        return str(out_path)

    def _generate_image_from_crop(self, crop_path: str) -> str:
        try:
            from ai_client import _load_env as _load_ai_env  # type: ignore

            _load_ai_env()
        except Exception:
            pass

        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not api_key:
            raise AIClientError("GEMINI_API_KEY is missing.")
        model_name = (os.getenv("IMAGE_AI_MODEL") or "").strip() or "gemini-3-pro-image-preview"
        prompt_text = self._get_image_generation_prompt()

        try:
            import google.generativeai as genai
            from PIL import Image  # type: ignore[import-not-found]
        except Exception as exc:
            raise AIClientError(f"이미지 생성 모듈 로딩 실패: {exc}") from exc

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)
        image = Image.open(crop_path).convert("RGB")
        response = model.generate_content([prompt_text, image])
        img_bytes, mime = self._extract_inline_image_bytes(response)
        if not img_bytes:
            raise AIClientError("이미지 생성 응답에서 이미지 데이터를 찾지 못했습니다. 모델 응답 형식이 예상과 다를 수 있습니다.")

        ext = ".png"
        mime_l = (mime or "").lower()
        if "jpeg" in mime_l or "jpg" in mime_l:
            ext = ".jpg"
        elif "webp" in mime_l:
            ext = ".webp"

        out_dir = Path(tempfile.gettempdir()) / "nova_ai" / "generated_images"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"generated_{os.getpid()}_{uuid.uuid4().hex[:10]}{ext}"
        out_path.write_bytes(img_bytes)
        return str(out_path)

    def _apply_image_generation_pipeline(
        self,
        idx: int,
        image_path: str,
        script: str,
        log_fn,
    ) -> str:
        if self._image_mode != "ai_generate":
            return script
        if not script.strip():
            return script

        lines = script.splitlines()
        crop_pattern = re.compile(r"^(\s*)insert_cropped_image\((.+)\)\s*$")
        call_count = 0
        generated_count = 0
        failed_count = 0

        for line_idx, line in enumerate(lines):
            m = crop_pattern.match(line)
            if not m:
                continue
            call_count += 1
            indent = m.group(1)
            coords = self._parse_crop_call_args(m.group(2))
            if coords is None:
                continue
            self.progress.emit(idx, "이미지 생성중...")
            try:
                crop_path = self._crop_region_to_file(
                    image_path,
                    coords,
                    idx=idx,
                    call_no=call_count,
                )
                generated_path = self._generate_image_from_crop(crop_path)
                lines[line_idx] = f"{indent}insert_generated_image({generated_path!r})"
                generated_count += 1
                log_fn(f"[{idx}] Generated image #{generated_count}: {generated_path}")
            except Exception as exc:
                failed_count += 1
                # Fallback to original crop insertion instead of aborting whole image.
                log_fn(f"[{idx}] Image generation failed for crop #{call_count}: {exc}")

        if generated_count > 0:
            log_fn(f"[{idx}] Image generation complete: {generated_count} item(s)")
        if failed_count > 0:
            log_fn(f"[{idx}] Image generation fallback used for {failed_count} item(s)")
        return "\n".join(lines)

    @staticmethod
    def _strip_image_insertions(script: str) -> str:
        if not script.strip():
            return script
        lines = script.splitlines()
        image_call = re.compile(r"^\s*insert_(?:cropped|generated)_image\(")
        kept = [line for line in lines if not image_call.match(line.strip())]
        return "\n".join(kept).strip()

    def _apply_image_mode_pipeline(
        self,
        idx: int,
        image_path: str,
        script: str,
        log_fn,
    ) -> str:
        if self._image_mode == "ai_generate":
            return self._apply_image_generation_pipeline(idx, image_path, script, log_fn)
        if self._image_mode == "no_image":
            stripped = self._strip_image_insertions(script)
            if stripped != (script or "").strip():
                log_fn(f"[{idx}] Image insertion lines removed by no-image mode")
            return stripped
        return script

    def run(self) -> None:  # type: ignore[override]
        import sys
        def _log(msg: str) -> None:
            if sys.stderr is not None:
                try:
                    sys.stderr.write(f"[GUI Debug] {msg}\n")
                    sys.stderr.flush()
                except Exception:
                    # In windowed PyInstaller builds, stderr can be an invalid handle.
                    pass
        
        try:
            total = len(self._image_paths)
            results: list[str] = [""] * total
            _log(f"Starting AI generation for {total} images")

            def _job(idx: int, image_path: str) -> str:
                _log(f"[{idx}] Processing: {image_path}")
                user = get_stored_user() or {}
                uid = str(user.get("uid") or "")
                tier = str(user.get("plan") or user.get("tier") or "free")

                # ????? 1??? ??? ????1??? ???.
                if uid and not check_usage_limit(uid, tier):
                    limit = get_plan_limit(tier)
                    raise AIClientError(
                        f"\uC0AC\uC6A9 \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4 ({limit}/{limit}).\n"
                        f"\uD604\uC7AC \uD50C\uB79C: {tier}\n"
                        "nova-ai.work\uC5D0\uC11C \uD50C\uB79C\uC744 \uC5C5\uADF8\uB808\uC774\uB4DC\uD574\uC8FC\uC138\uC694."
                    )

                # 1 image : 1 AIClient (1-to-1 mapping, safe for concurrency)
                # ???? ??(????????)????? ??????????? ??? ???? ?????.
                try:
                    client = AIClient(check_usage=False)
                except Exception as e:
                    _log(f"[{idx}] AIClient creation failed: {e}")
                    raise

                def _sanitize_part(script: str) -> str:
                    code = self._extract_code(script)
                    if not code:
                        return ""
                    out_lines: list[str] = []
                    for line in code.splitlines():
                        s = line.strip()
                        if not s:
                            out_lines.append(line)
                            continue
                        # Prevent nested template/placeholder/box insertions inside parts.
                        if s.startswith("insert_template("):
                            continue
                        if s.startswith("focus_placeholder("):
                            continue
                        if s.startswith("insert_box(") or s == "insert_box()":
                            continue
                        if s.startswith("insert_view_box(") or s == "insert_view_box()":
                            continue
                        if s.startswith("exit_box(") or s == "exit_box()":
                            continue
                        out_lines.append(line)
                    return "\n".join(out_lines).strip()

                # 1) Full OCR (fallback context)
                _log(f"[{idx}] Starting OCR...")
                ocr_text_full = ""
                try:
                    ocr_text_full = extract_text(image_path)
                    _log(f"[{idx}] OCR done, length: {len(ocr_text_full)}")
                except Exception as e:
                    _log(f"[{idx}] OCR failed (skipping): {type(e).__name__}: {e}")
                    ocr_text_full = ""

                # 2) Detect container + split generation when possible
                _log(f"[{idx}] Detecting container...")
                det = detect_container(image_path)
                _log(f"[{idx}] Container detected: template={det.template}, rect={det.rect}")
                if det.template and det.rect:
                    _log(f"[{idx}] Building region images...")
                    # Build region images
                    try:
                        outside_img = mask_rect_on_image(image_path, det.rect)
                        _log(f"[{idx}] Outside image: {type(outside_img)}")
                    except Exception as e:
                        _log(f"[{idx}] mask_rect_on_image failed: {e}")
                        outside_img = None
                    
                    try:
                        inside_img = crop_inside_rect(image_path, det.rect)
                        _log(f"[{idx}] Inside image: {type(inside_img)}")
                    except Exception as e:
                        _log(f"[{idx}] crop_inside_rect failed: {e}")
                        inside_img = None

                    tmp_dir = Path(tempfile.gettempdir()) / "nova_ai"
                    try:
                        tmp_dir.mkdir(parents=True, exist_ok=True)
                    except Exception:
                        tmp_dir = Path.cwd()

                    outside_path = ""
                    inside_path = ""
                    try:
                        if outside_img is not None:
                            fp = tmp_dir / f"nova_ai_outside_{os.getpid()}_{idx}.png"
                            outside_img.save(fp, format="PNG")
                            outside_path = str(fp)
                    except Exception:
                        outside_path = ""
                    try:
                        if inside_img is not None:
                            fp = tmp_dir / f"nova_ai_inside_{os.getpid()}_{idx}.png"
                            inside_img.save(fp, format="PNG")
                            inside_path = str(fp)
                    except Exception:
                        inside_path = ""

                    outside_ocr = ""
                    inside_ocr = ""
                    try:
                        if outside_img is not None:
                            outside_ocr = extract_text_from_pil_image(outside_img)
                    except OcrError:
                        outside_ocr = ""
                    try:
                        if inside_img is not None:
                            inside_ocr = extract_text_from_pil_image(inside_img)
                    except OcrError:
                        inside_ocr = ""

                    _log(f"[{idx}] Calling AI for OUTSIDE content...")
                    outside_script_raw = client.generate_script_for_image(
                        outside_path or image_path,
                        description=(
                            "Type ONLY the content OUTSIDE/BEFORE the box container. "
                            "This includes the problem statement and equation. "
                            "Do NOT include ?? ?? ?? conditions - those go INSIDE the box. "
                            "Do NOT include the answer choices (????????."
                        ),
                        ocr_text=outside_ocr or ocr_text_full,
                    )
                    _log(f"[{idx}] Outside AI response length: {len(outside_script_raw) if outside_script_raw else 0}")
                    
                    _log(f"[{idx}] Calling AI for INSIDE content...")
                    # For inside content, use the FULL image so AI can find the ?? ?? ?? conditions
                    inside_script_raw = client.generate_script_for_image(
                        image_path,  # Use full image, not cropped inside
                        description=(
                            "Type ONLY the ?? ?? ?? (or ?? ?? ?? ?? conditions that should go INSIDE the box. "
                            "These are the numbered conditions like '?? k=0???...' or '?? k=3???...' "
                            "Do NOT include the problem text before the box. "
                            "Do NOT include answer choices (????????."
                        ),
                        ocr_text=inside_ocr or ocr_text_full,
                    )
                    _log(f"[{idx}] Inside AI response length: {len(inside_script_raw) if inside_script_raw else 0}")
                    
                    _log(f"[{idx}] Calling AI for CHOICES content...")
                    # For choices (????????, use the FULL image
                    choices_script_raw = client.generate_script_for_image(
                        image_path,
                        description=(
                            "Type ONLY the answer choices (????????or ???? ???? ?? ???? ?? ???? ?? ???? ?? ??. "
                            "These are the multiple choice options at the bottom of the problem. "
                            "Do NOT include the problem text. "
                            "Do NOT include ?? ?? ?? conditions."
                        ),
                        ocr_text=ocr_text_full,
                    )
                    _log(f"[{idx}] Choices AI response length: {len(choices_script_raw) if choices_script_raw else 0}")

                    outside_part = _sanitize_part(outside_script_raw or "")
                    inside_part = _sanitize_part(inside_script_raw or "")
                    choices_part = _sanitize_part(choices_script_raw or "")
                    
                    _log(f"[{idx}] Outside part preview: {outside_part[:200] if outside_part else 'EMPTY'}...")
                    _log(f"[{idx}] Inside part preview: {inside_part[:200] if inside_part else 'EMPTY'}...")
                    _log(f"[{idx}] Choices part preview: {choices_part[:200] if choices_part else 'EMPTY'}...")

                    # Template structure:
                    # 1. Insert box template
                    # 2. @@@ = placeholder for content BEFORE the box (problem text)
                    # 3. ### = placeholder for content INSIDE the box (?? ?? ?? conditions)
                    # 4. &&& = placeholder for content AFTER the box (answer choices ????????
                    combined = "\n".join(
                        [
                            f"insert_template('{det.template}')",
                            "focus_placeholder('@@@')",
                            outside_part,
                            "focus_placeholder('###')",
                            inside_part,
                            "focus_placeholder('&&&')",
                            choices_part,
                        ]
                    ).strip()
                    _log(f"[{idx}] Combined script length: {len(combined)}")
                    combined = self._apply_image_mode_pipeline(idx, image_path, combined, _log)
                    if uid and combined.strip():
                        increment_ai_usage(uid)
                    return combined

                if det.template and not det.rect:
                    # Header text detected but rectangle not confidently found:
                    # enforce template/placeholder workflow and let the model separate.
                    _log(f"[{idx}] Template detected (no rect): {det.template}")
                    script_raw = client.generate_script_for_image(image_path, ocr_text=ocr_text_full) or ""
                    _log(f"[{idx}] AI response length: {len(script_raw)}")
                    script_body = _sanitize_part(script_raw)
                    combined = "\n".join(
                        [
                            f"insert_template('{det.template}')",
                            "focus_placeholder('@@@')",
                            script_body,
                            "focus_placeholder('###')",
                            "",
                        ]
                    ).strip()
                    combined = self._apply_image_mode_pipeline(idx, image_path, combined, _log)
                    if uid and combined.strip():
                        increment_ai_usage(uid)
                    return combined

                # No container detected: default behavior
                _log(f"[{idx}] No container detected, calling AI...")
                raw_result = client.generate_script_for_image(image_path, ocr_text=ocr_text_full) or ""
                _log(f"[{idx}] AI response length: {len(raw_result)}")
                if not raw_result.strip():
                    _log(f"[{idx}] WARNING: Empty AI response!")
                final_code = self._extract_code(raw_result)
                final_code = self._apply_image_mode_pipeline(idx, image_path, final_code, _log)
                if uid and final_code.strip():
                    increment_ai_usage(uid)
                return final_code

            # If you need to cap concurrency (rate limiting), set NOVA_AI_MAX_WORKERS.
            max_workers_env = os.getenv("NOVA_AI_MAX_WORKERS")
            max_workers = total
            if max_workers_env:
                try:
                    max_workers = max(1, min(total, int(max_workers_env)))
                except Exception:
                    max_workers = total

            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
                future_to_idx: dict[concurrent.futures.Future[str], int] = {}
                for idx, image_path in enumerate(self._image_paths):
                    self.progress.emit(idx, "\uC0DD\uC131\uC911...")
                    future_to_idx[ex.submit(_job, idx, image_path)] = idx

                for fut in concurrent.futures.as_completed(future_to_idx):
                    idx = future_to_idx[fut]
                    try:
                        text = fut.result() or ""
                        results[idx] = text
                        if text.strip():
                            self.progress.emit(idx, "\uCF54\uB4DC \uC0DD\uC131 \uC644\uB8CC")
                        else:
                            self.progress.emit(idx, "\uC624\uB958(\uBE48 \uACB0\uACFC)")
                        # Notify UI for incremental typing / preview.
                        self.item_finished.emit(idx, text)
                    except Exception as exc:
                        results[idx] = ""
                        self.progress.emit(idx, f"\uC624\uB958: {exc}")
                        self.item_finished.emit(idx, "")
            self.finished.emit(results)
        except Exception as exc:
            self.error.emit(str(exc))


class ChatWorker(QThread):
    finished = Signal(object)
    error = Signal(str)

    def __init__(self, user_message: str, current_filename: str = "") -> None:
        super().__init__()
        self._user_message = user_message
        self._current_filename = current_filename

    @staticmethod
    def _strip_code_fence(text: str) -> str:
        cleaned = (text or "").strip()
        if not cleaned.startswith("```"):
            return cleaned
        lines = cleaned.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()

    @staticmethod
    def _extract_json_payload(text: str) -> dict[str, object] | None:
        cleaned = ChatWorker._strip_code_fence(text)
        if not cleaned:
            return None
        decoder = json.JSONDecoder()
        for idx, ch in enumerate(cleaned):
            if ch != "{":
                continue
            try:
                obj, _ = decoder.raw_decode(cleaned[idx:])
            except Exception:
                continue
            if isinstance(obj, dict):
                return obj
        return None

    @staticmethod
    def _normalize_actions(raw_actions: object) -> list[dict[str, str]]:
        allowed = {"open_new_file"}
        normalized: list[dict[str, str]] = []
        if not isinstance(raw_actions, list):
            return normalized
        for item in raw_actions:
            name = ""
            if isinstance(item, str):
                name = item.strip()
            elif isinstance(item, dict):
                name = str(item.get("name") or "").strip()
            if name in allowed:
                normalized.append({"name": name})
        return normalized

    @staticmethod
    def _infer_local_actions(message: str) -> list[dict[str, str]]:
        text = (message or "").strip().lower()
        if not text:
            return []
        has_new_doc = (
            ("새 파일" in text)
            or ("새파일" in text)
            or ("새 문서" in text)
            or ("new file" in text)
            or ("new document" in text)
        )
        has_open_intent = (
            ("열어" in text)
            or ("열기" in text)
            or ("만들" in text)
            or ("create" in text)
            or ("open" in text)
        )
        if has_new_doc and has_open_intent:
            return [{"name": "open_new_file"}]
        return []

    def run(self) -> None:  # type: ignore[override]
        message = (self._user_message or "").strip()
        if not message:
            self.finished.emit({"reply": "", "actions": [], "model": ""})
            return

        fallback_actions = self._infer_local_actions(message)
        try:
            # Ensure .env is loaded before reading CHAT_AI_MODEL.
            from ai_client import _load_env as _load_ai_env  # type: ignore

            _load_ai_env()
        except Exception:
            pass
        chat_model = (os.getenv("CHAT_AI_MODEL") or "").strip() or "gemini-2.5-flash"
        prompt = (
            "당신은 Nova AI 데스크톱 앱의 HWP 편집 도우미입니다.\n"
            "반드시 JSON 객체만 출력하세요. 마크다운 금지.\n\n"
            "형식:\n"
            "{\n"
            '  "reply": "사용자에게 보여줄 짧은 한국어 응답",\n'
            '  "actions": [{"name": "open_new_file"}]\n'
            "}\n\n"
            "허용된 action name:\n"
            "- open_new_file : 한글(HWP)에서 새 빈 문서를 연다.\n\n"
            "지원되지 않는 요청이면 actions를 빈 배열로 두고 reply에 가능한 안내를 작성하세요.\n"
            f"현재 감지 문서: {self._current_filename or '없음'}\n"
            f"사용자 요청: {message}"
        )
        try:
            client = AIClient(model=chat_model, check_usage=False)
            raw = client.generate_script(prompt)
            parsed = self._extract_json_payload(raw)
            reply = ""
            actions: list[dict[str, str]] = []
            if parsed is not None:
                reply = str(parsed.get("reply") or "").strip()
                actions = self._normalize_actions(parsed.get("actions"))
            if not actions and fallback_actions:
                actions = fallback_actions
            if not reply:
                if actions:
                    reply = "요청한 편집 작업을 실행합니다."
                else:
                    reply = "요청을 확인했지만 현재 지원되는 자동 편집 명령이 제한적입니다."
            self.finished.emit({"reply": reply, "actions": actions, "model": chat_model})
        except Exception as exc:
            if fallback_actions:
                self.finished.emit(
                    {
                        "reply": "요청한 편집 작업을 실행합니다.",
                        "actions": fallback_actions,
                        "model": "local-fallback",
                    }
                )
                return
            self.error.emit(str(exc))


# ???? Material Icons helper ????????????????????????????????????????????????????????
_MI_MENU = "\ue5d2"
_MI_PERSON = "\ue7fd"
_MI_BAR_CHART = "\ue26b"
_MI_STAR = "\ue838"
_MI_SETTINGS = "\ue8b8"
_MI_HELP = "\ue8fd"
_MI_INFO = "\ue88e"
_MI_LOGIN = "\ue853"       # account_circle
_MI_LOGOUT = "\ue879"      # exit_to_app
_MI_DELETE = "\ue872"      # delete
_MI_RETYPE = "\ue042"      # replay
_MI_CODE = "\ue86f"        # code
_MI_HOME = "\ue88a"        # home (language/web)
_MI_DOWNLOAD = "\ue2c4"    # file_download
_MI_CLOSE = "\ue5cd"       # close
_MI_CHAT = "\ue0b7"        # chat


def _material_icon(
    codepoint: str, size: int = 20, color: QColor | None = None,
) -> QIcon:
    """Render a Material Icons glyph into a QIcon."""
    if color is None:
        color = QColor(80, 80, 80)
    font = QFont("Material Icons", size)
    dim = size + 8
    pm = QPixmap(dim, dim)
    pm.fill(QColor(0, 0, 0, 0))
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setFont(font)
    p.setPen(color)
    p.drawText(pm.rect(), Qt.AlignmentFlag.AlignCenter, codepoint)
    p.end()
    return QIcon(pm)


class SidebarOverlay(QWidget):
    """Semi-transparent overlay behind the sidebar."""
    clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet("background-color: rgba(0, 0, 0, 50);")
        self.hide()

    def mousePressEvent(self, event):  # type: ignore[override]
        self.clicked.emit()
        super().mousePressEvent(event)


class CodeViewDialog(QDialog):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("\uCF54\uB4DC \uBCF4\uAE30")
        self.setModal(True)
        self.resize(520, 420)
        self.setStyleSheet("QDialog { background-color: #ffffff; }")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(10)

        self._title = QLabel("")
        self._title.setStyleSheet("font-size: 12px; font-weight: 600; color: #111827;")
        layout.addWidget(self._title)

        self._code_view = QTextEdit()
        self._code_view.setReadOnly(True)
        self._code_view.setStyleSheet(
            "QTextEdit { background-color: #f8f9fa; border: 1px solid #e5e7eb;"
            "  border-radius: 8px; padding: 8px; font-size: 12px;"
            "  color: #333; font-family: 'Consolas', 'Pretendard', monospace; }"
        )
        layout.addWidget(self._code_view, 1)

        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        close_btn = QPushButton("\uB2EB\uAE30")
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setStyleSheet(
            "QPushButton { background-color: #f3f4f6; color: #333;"
            "  border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 14px;"
            "  font-size: 12px; font-weight: 500; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
        )
        close_btn.clicked.connect(self.reject)
        btn_row.addWidget(close_btn)
        layout.addLayout(btn_row)

    def set_code(self, title: str, code: str) -> None:
        self._title.setText(title or "")
        self._code_view.setPlainText(code or "")


class LogoutDialog(QDialog):
    """Modern styled logout confirmation dialog."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("\uB85C\uADF8\uC544\uC6C3")
        self.setFixedSize(360, 220)
        self.setWindowFlags(
            Qt.WindowType.Dialog
            | Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        # ???? outer card ????
        card = QFrame(self)
        card.setGeometry(0, 0, 360, 220)
        card.setStyleSheet(
            "QFrame { background-color: #ffffff; border-radius: 16px; }"
        )

        lay = QVBoxLayout(card)
        lay.setContentsMargins(32, 28, 32, 24)
        lay.setSpacing(0)

        # icon
        icon_label = QLabel()
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setFixedHeight(48)
        icon_label.setFont(QFont("Material Icons", 36))
        icon_label.setText(_MI_LOGOUT)
        icon_label.setStyleSheet("color: #ef4444; background: transparent;")
        lay.addWidget(icon_label)

        lay.addSpacing(12)

        # title
        title = QLabel("\uB85C\uADF8\uC544\uC6C3 \uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet(
            "font-size: 16px; font-weight: 700; color: #1a1a2e; background: transparent;"
        )
        lay.addWidget(title)

        lay.addSpacing(6)

        # subtitle
        sub = QLabel("\uD604\uC7AC \uACC4\uC815\uC5D0\uC11C \uB85C\uADF8\uC544\uC6C3\uB429\uB2C8\uB2E4.")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub.setStyleSheet(
            "font-size: 12px; color: #9ca3af; background: transparent;"
        )
        lay.addWidget(sub)

        lay.addSpacing(24)

        # buttons
        btn_row = QHBoxLayout()
        btn_row.setSpacing(12)

        cancel_btn = QPushButton("\uCDE8\uC18C")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setFixedHeight(40)
        cancel_btn.setStyleSheet(
            "QPushButton { background-color: #f3f4f6; color: #374151; border: none;"
            "  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 24px; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
            "QPushButton:pressed { background-color: #d1d5db; }"
        )
        cancel_btn.clicked.connect(self.reject)

        confirm_btn = QPushButton("\uB85C\uADF8\uC544\uC6C3")
        confirm_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        confirm_btn.setFixedHeight(40)
        confirm_btn.setStyleSheet(
            "QPushButton { background-color: #ef4444; color: #ffffff; border: none;"
            "  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 24px; }"
            "QPushButton:hover { background-color: #dc2626; }"
            "QPushButton:pressed { background-color: #b91c1c; }"
        )
        confirm_btn.clicked.connect(self.accept)

        btn_row.addWidget(cancel_btn)
        btn_row.addWidget(confirm_btn)
        lay.addLayout(btn_row)

    # allow dragging the frameless dialog
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if hasattr(self, "_drag_pos") and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def paintEvent(self, event):
        """Draw a subtle drop-shadow around the card."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        # shadow layers
        for i in range(4):
            c = QColor(0, 0, 0, 8 - i * 2)
            painter.setBrush(c)
            painter.drawRoundedRect(self.rect().adjusted(i, i, -i, -i), 16, 16)
        painter.end()


class LoginResultDialog(QDialog):
    """Modern styled login result notification dialog."""

    def __init__(self, parent=None, *, success: bool = True, user_name: str = ""):
        super().__init__(parent)
        self.setWindowTitle("\uB85C\uADF8\uC778 \uC644\uB8CC" if success else "\uB85C\uADF8\uC778 \uC2E4\uD328")
        self.setFixedSize(360, 240)
        self.setWindowFlags(
            Qt.WindowType.Dialog
            | Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        card = QFrame(self)
        card.setGeometry(0, 0, 360, 240)
        card.setStyleSheet(
            "QFrame { background-color: #ffffff; border-radius: 16px; }"
        )

        lay = QVBoxLayout(card)
        lay.setContentsMargins(32, 28, 32, 24)
        lay.setSpacing(0)

        # icon
        icon_label = QLabel()
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setFixedSize(56, 56)
        if success:
            icon_label.setText("\u2713")
            icon_label.setStyleSheet(
                "background-color: #ecfdf5; color: #10b981; border-radius: 28px;"
                "font-size: 28px; font-weight: bold;"
            )
        else:
            icon_label.setText("!")
            icon_label.setStyleSheet(
                "background-color: #fef2f2; color: #ef4444; border-radius: 28px;"
                "font-size: 28px; font-weight: bold;"
            )

        icon_row = QHBoxLayout()
        icon_row.addStretch()
        icon_row.addWidget(icon_label)
        icon_row.addStretch()
        lay.addLayout(icon_row)

        lay.addSpacing(16)

        # title
        if success:
            title_text = "\uB85C\uADF8\uC778 \uC131\uACF5!"
        else:
            title_text = "\uB85C\uADF8\uC778 \uC2E4\uD328"
        title = QLabel(title_text)
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet(
            "font-size: 17px; font-weight: 700; color: #1a1a2e; background: transparent;"
        )
        lay.addWidget(title)

        lay.addSpacing(6)

        # subtitle
        if success:
            sub_text = f"\uD658\uC601\uD569\uB2C8\uB2E4, {user_name}\uB2D8!"
        else:
            sub_text = "\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694."
        sub = QLabel(sub_text)
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub.setWordWrap(True)
        sub.setStyleSheet(
            "font-size: 13px; color: #9ca3af; background: transparent;"
        )
        lay.addWidget(sub)

        lay.addSpacing(24)

        # button
        btn_color = "#10b981" if success else "#ef4444"
        btn_hover = "#059669" if success else "#dc2626"
        btn_pressed = "#047857" if success else "#b91c1c"
        ok_btn = QPushButton("\uD655\uC778")
        ok_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        ok_btn.setFixedHeight(40)
        ok_btn.setStyleSheet(
            f"QPushButton {{ background-color: {btn_color}; color: #ffffff; border: none;"
            f"  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 32px; }}"
            f"QPushButton:hover {{ background-color: {btn_hover}; }}"
            f"QPushButton:pressed {{ background-color: {btn_pressed}; }}"
        )
        ok_btn.clicked.connect(self.accept)

        btn_row = QHBoxLayout()
        btn_row.addStretch()
        btn_row.addWidget(ok_btn)
        btn_row.addStretch()
        lay.addLayout(btn_row)

        # auto-close after 3 seconds on success
        if success:
            self._auto_timer = QTimer(self)
            self._auto_timer.setSingleShot(True)
            self._auto_timer.timeout.connect(self.accept)
            self._auto_timer.start(3000)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if hasattr(self, "_drag_pos") and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        for i in range(4):
            c = QColor(0, 0, 0, 8 - i * 2)
            painter.setBrush(c)
            painter.drawRoundedRect(self.rect().adjusted(i, i, -i, -i), 16, 16)
        painter.end()


class _FramelessCardDialog(QDialog):
    """Base frameless card dialog with shadow and drag support."""

    def __init__(self, parent, w: int, h: int):
        super().__init__(parent)
        self.setFixedSize(w, h)
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

    def _make_card(self) -> QFrame:
        card = QFrame(self)
        card.setGeometry(0, 0, self.width(), self.height())
        card.setStyleSheet("QFrame { background-color: #ffffff; border-radius: 16px; }")
        return card

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if hasattr(self, "_drag_pos") and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        for i in range(4):
            c = QColor(0, 0, 0, 8 - i * 2)
            painter.setBrush(c)
            painter.drawRoundedRect(self.rect().adjusted(i, i, -i, -i), 16, 16)
        painter.end()


class ProfileDialog(_FramelessCardDialog):
    """Modern styled profile info dialog."""

    def __init__(self, parent=None, *, name: str = "", email: str = "",
                 tier: str = "Free", uid: str = ""):
        super().__init__(parent, 380, 340)
        self.setWindowTitle("\uD504\uB85C\uD544 \uC815\uBCF4")
        card = self._make_card()
        lay = QVBoxLayout(card)
        lay.setContentsMargins(32, 28, 32, 24)
        lay.setSpacing(0)

        # avatar circle with initial
        initial = (name or "?")[0].upper()
        _tier_colors = {
            "Free": "#6366f1", "free": "#6366f1",
            "Standard": "#0ea5e9", "Plus": "#8b5cf6",
            "Pro": "#8b5cf6", "pro": "#8b5cf6", "ultra": "#8b5cf6",
        }
        accent = _tier_colors.get(tier, "#6366f1")
        avatar = QLabel(initial)
        avatar.setFixedSize(56, 56)
        avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        avatar.setStyleSheet(
            f"background-color: {accent}; color: #ffffff; border-radius: 28px;"
            "font-size: 24px; font-weight: 700;"
        )
        a_row = QHBoxLayout()
        a_row.addStretch(); a_row.addWidget(avatar); a_row.addStretch()
        lay.addLayout(a_row)
        lay.addSpacing(14)

        # name
        n_lbl = QLabel(name or "\uC0AC\uC6A9\uC790")
        n_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        n_lbl.setStyleSheet("font-size: 17px; font-weight: 700; color: #1a1a2e; background: transparent;")
        lay.addWidget(n_lbl)
        lay.addSpacing(4)

        # tier badge
        _tier_map = {"Free": "\uBB34\uB8CC", "free": "\uBB34\uB8CC", "Standard": "Standard",
                     "Plus": "\u25c7 PLUS",
                     "Pro": "Ultra", "pro": "Ultra", "ultra": "Ultra"}
        badge = QLabel(_tier_map.get(tier, tier) + " \uD50C\uB79C")
        badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        badge.setStyleSheet(
            f"font-size: 11px; font-weight: 600; color: {accent};"
            f"background-color: rgba({int(accent[1:3],16)},{int(accent[3:5],16)},{int(accent[5:7],16)},0.12);"
            "border-radius: 8px; padding: 4px 14px;"
        )
        b_row = QHBoxLayout()
        b_row.addStretch(); b_row.addWidget(badge); b_row.addStretch()
        lay.addLayout(b_row)
        lay.addSpacing(20)

        # info rows
        info_style = (
            "font-size: 12px; color: #6b7280; background: transparent; padding: 0;"
        )
        val_style = (
            "font-size: 12px; font-weight: 600; color: #1a1a2e; background: transparent; padding: 0;"
        )
        sep_style = "background-color: #f3f4f6; border: none;"

        for label_text, value_text in [("Email", email or "-"), ("UID", uid or "-")]:
            row = QHBoxLayout()
            row.setContentsMargins(0, 0, 0, 0)
            lbl = QLabel(label_text)
            lbl.setStyleSheet(info_style)
            val = QLabel(value_text)
            val.setStyleSheet(val_style)
            val.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            row.addWidget(lbl)
            row.addStretch()
            row.addWidget(val)
            lay.addLayout(row)
            lay.addSpacing(8)
            sep = QFrame()
            sep.setFixedHeight(1)
            sep.setStyleSheet(sep_style)
            lay.addWidget(sep)
            lay.addSpacing(8)

        lay.addStretch()

        # close button
        close_btn = QPushButton("\uB2EB\uAE30")
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setFixedHeight(40)
        close_btn.setStyleSheet(
            f"QPushButton {{ background-color: {accent}; color: #ffffff; border: none;"
            "  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 32px; }"
            f"QPushButton:hover {{ background-color: {accent}dd; }}"
        )
        close_btn.clicked.connect(self.accept)
        br = QHBoxLayout()
        br.addStretch(); br.addWidget(close_btn); br.addStretch()
        lay.addLayout(br)


class UsageDialog(_FramelessCardDialog):
    """Modern styled usage info dialog."""

    def __init__(self, parent=None, *, tier: str = "Free",
                 usage: int = 0, limit: int = 5):
        super().__init__(parent, 380, 340)
        self.setWindowTitle("\uC0AC\uC6A9\uB7C9 \uC815\uBCF4")
        card = self._make_card()
        lay = QVBoxLayout(card)
        lay.setContentsMargins(32, 16, 32, 24)
        lay.setSpacing(0)

        # ??? ?? (?????
        close_row = QHBoxLayout()
        close_row.setContentsMargins(0, 0, 0, 0)
        close_row.addStretch()
        close_btn = QPushButton()
        close_btn.setFixedSize(28, 28)
        close_btn.setIcon(_material_icon(_MI_CLOSE, 18, QColor("#9ca3af")))
        close_btn.setIconSize(QSize(18, 18))
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setStyleSheet(
            "QPushButton { border: none; background: transparent;"
            "  border-radius: 14px; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
        )
        close_btn.clicked.connect(self.accept)
        close_row.addWidget(close_btn)
        lay.addLayout(close_row)
        lay.addSpacing(2)

        _tier_colors = {
            "Free": "#6366f1", "free": "#6366f1",
            "Standard": "#0ea5e9", "Plus": "#8b5cf6",
            "Pro": "#8b5cf6", "pro": "#8b5cf6", "ultra": "#8b5cf6",
        }
        accent = _tier_colors.get(tier, "#6366f1")
        remaining = max(0, limit - usage)
        ratio = usage / limit if limit > 0 else 0

        # icon
        icon_label = QLabel(_MI_BAR_CHART)
        icon_label.setFont(QFont("Material Icons", 32))
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setStyleSheet(f"color: {accent}; background: transparent;")
        icon_label.setFixedHeight(44)
        lay.addWidget(icon_label)
        lay.addSpacing(10)

        # title
        title = QLabel("\uC0AC\uC6A9\uB7C9 \uD604\uD669")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 17px; font-weight: 700; color: #1a1a2e; background: transparent;")
        lay.addWidget(title)
        lay.addSpacing(4)

        # tier badge
        _tier_map = {"Free": "\uBB34\uB8CC", "free": "\uBB34\uB8CC", "Standard": "Standard",
                     "Plus": "\u25c7 PLUS",
                     "Pro": "Ultra", "pro": "Ultra", "ultra": "Ultra"}
        badge = QLabel(_tier_map.get(tier, tier) + " \uD50C\uB79C")
        badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        badge.setStyleSheet(
            f"font-size: 10px; font-weight: 600; color: {accent};"
            f"background-color: rgba({int(accent[1:3],16)},{int(accent[3:5],16)},{int(accent[5:7],16)},0.12);"
            "border-radius: 6px; padding: 3px 12px;"
        )
        b_row = QHBoxLayout()
        b_row.addStretch(); b_row.addWidget(badge); b_row.addStretch()
        lay.addLayout(b_row)
        lay.addSpacing(22)

        # big number
        num_color = "#ef4444" if ratio >= 1.0 else "#f97316" if ratio >= 0.8 else accent
        big = QLabel(f"{usage}<span style='font-size:18px; color:#9ca3af;'> / {limit}</span>")
        big.setAlignment(Qt.AlignmentFlag.AlignCenter)
        big.setStyleSheet(f"font-size: 36px; font-weight: 800; color: {num_color}; background: transparent;")
        big.setTextFormat(Qt.TextFormat.RichText)
        lay.addWidget(big)
        lay.addSpacing(10)

        # progress bar
        bar = QProgressBar()
        bar.setFixedHeight(8)
        bar.setTextVisible(False)
        bar.setMaximum(max(limit, 1))
        bar.setValue(min(usage, limit))
        bar_color = "#ef4444" if ratio >= 1.0 else "#f97316" if ratio >= 0.8 else accent
        bar.setStyleSheet(f"""
            QProgressBar {{ border: none; border-radius: 4px; background-color: #f3f4f6; }}
            QProgressBar::chunk {{ background-color: {bar_color}; border-radius: 4px; }}
        """)
        lay.addWidget(bar)
        lay.addSpacing(6)

        # remaining text
        rem_text = f"\uB0A8\uC740 \uD69F\uC218: {remaining}" if remaining > 0 else "\uC0AC\uC6A9 \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4"
        rem = QLabel(rem_text)
        rem.setAlignment(Qt.AlignmentFlag.AlignCenter)
        rem.setStyleSheet(
            f"font-size: 12px; color: {'#ef4444' if remaining <= 0 else '#9ca3af'}; background: transparent;"
        )
        lay.addWidget(rem)
        # ??? ??? ???????????? ???
        if remaining <= 0:
            lay.addSpacing(20)
            btn = QPushButton("\uD50C\uB79C \uC5C5\uADF8\uB808\uC774\uB4DC")
            btn.setStyleSheet(
                "QPushButton { background-color: #f59e0b; color: #ffffff; border: none;"
                "  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 28px; }"
                "QPushButton:hover { background-color: #d97706; }"
            )
            btn.clicked.connect(self._open_pricing)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setFixedHeight(40)
            br = QHBoxLayout()
            br.addStretch(); br.addWidget(btn); br.addStretch()
            lay.addLayout(br)

    def _open_pricing(self):
        import webbrowser
        webbrowser.open("https://www.nova-ai.work/profile?tab=subscription")
        self.accept()


class DownloadFormDialog(_FramelessCardDialog):
    """?? ?? ???? ?????."""

    _FORMS = [
        ("\uC218\uB2A5 \uAD6D\uC5B4 \uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC",
         "https://storage.googleapis.com/physics2/%EC%96%91%EC%8B%9D/%EC%88%98%EB%8A%A5%20%EA%B5%AD%EC%96%B4%20%EC%96%91%EC%8B%9D%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C.hwp"),
        ("\uC218\uB2A5 \uC601\uC5B4 \uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC",
         "https://storage.googleapis.com/physics2/%EC%96%91%EC%8B%9D/%EC%88%98%EB%8A%A5%20%EC%98%81%EC%96%B4%20%EC%96%91%EC%8B%9D%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C.hwp"),
        ("\uC218\uB2A5 \uC218\uD559 \uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC",
         "https://storage.googleapis.com/physics2/%EC%96%91%EC%8B%9D/%EC%88%98%EB%8A%A5%20%EC%88%98%ED%95%99%20%EC%96%91%EC%8B%9D%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C.hwp"),
        ("\uC218\uB2A5 \uACFC\uD0D0 \uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC",
         "https://storage.googleapis.com/physics2/%EC%96%91%EC%8B%9D/%EC%88%98%EB%8A%A5%20%EA%B3%BC%ED%83%90%20%EC%96%91%EC%8B%9D%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C.hwp"),
        ("\uC218\uB2A5 \uC0AC\uD0D0 \uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC",
         "https://storage.googleapis.com/physics2/%EC%96%91%EC%8B%9D/%EC%88%98%EB%8A%A5%20%EC%82%AC%ED%9A%8C%20%EC%96%91%EC%8B%9D%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C.hwp"),
    ]
    _EXAM_BANK_URL = "https://novabook-six.vercel.app/exam-papers"

    def __init__(self, parent=None):
        super().__init__(parent, 380, 440)
        self.setWindowTitle("\uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC")
        card = self._make_card()
        lay = QVBoxLayout(card)
        lay.setContentsMargins(32, 16, 32, 24)
        lay.setSpacing(0)

        # ??? ?? (?????
        close_row = QHBoxLayout()
        close_row.setContentsMargins(0, 0, 0, 0)
        close_row.addStretch()
        close_btn = QPushButton()
        close_btn.setFixedSize(28, 28)
        close_btn.setIcon(_material_icon(_MI_CLOSE, 18, QColor("#9ca3af")))
        close_btn.setIconSize(QSize(18, 18))
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setStyleSheet(
            "QPushButton { border: none; background: transparent;"
            "  border-radius: 14px; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
        )
        close_btn.clicked.connect(self.accept)
        close_row.addWidget(close_btn)
        lay.addLayout(close_row)
        lay.addSpacing(2)

        icon_label = QLabel(_MI_DOWNLOAD)
        icon_label.setFont(QFont("Material Icons", 32))
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setStyleSheet("color: #6366f1; background: transparent;")
        icon_label.setFixedHeight(44)
        lay.addWidget(icon_label)
        lay.addSpacing(10)

        title = QLabel("\uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet(
            "font-size: 17px; font-weight: 700; color: #1a1a2e; background: transparent;"
        )
        lay.addWidget(title)
        lay.addSpacing(6)

        subtitle = QLabel("\uCD5C\uC2E0 \uC218\uB2A5 HWP \uC591\uC2DD\uC744 \uB0B4\uB824\uBC1B\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet(
            "font-size: 11px; color: #9ca3af; background: transparent;"
        )
        lay.addWidget(subtitle)
        lay.addSpacing(18)

        for label_text, url in self._FORMS:
            btn = QPushButton(label_text)
            btn.setIcon(_material_icon(_MI_DOWNLOAD, 16, QColor("#4f46e5")))
            btn.setIconSize(QSize(16, 16))
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setFixedHeight(36)
            btn.setStyleSheet(
                "QPushButton { background-color: #f3f4f6; color: #1a1a2e; border: none;"
                "  border-radius: 8px; font-size: 12px; font-weight: 500;"
                "  text-align: left; padding: 0 14px; }"
                "QPushButton:hover { background-color: #d1d5db; color: #111827; }"
            )
            btn.clicked.connect(lambda checked, u=url: self._open_url(u))
            lay.addWidget(btn)
            lay.addSpacing(6)

        lay.addSpacing(4)
        sep = QFrame()
        sep.setFixedHeight(1)
        sep.setStyleSheet("background-color: #f3f4f6; border: none;")
        lay.addWidget(sep)
        lay.addSpacing(10)

        bank_btn = QPushButton("\uAE30\uCD9C\uBB38\uC81C \uBCF4\uB7EC\uAC00\uAE30")
        bank_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        bank_btn.setFixedHeight(40)
        bank_btn.setStyleSheet(
            "QPushButton { background-color: #6366f1; color: #ffffff; border: none;"
            "  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 32px; }"
            "QPushButton:hover { background-color: #4338ca; }"
        )
        bank_btn.clicked.connect(lambda: self._open_url(self._EXAM_BANK_URL))
        br = QHBoxLayout()
        br.addStretch(); br.addWidget(bank_btn); br.addStretch()
        lay.addLayout(br)

    @staticmethod
    def _mixed_font() -> QFont:
        f = QFont()
        f.setFamilies(["Material Icons", "Pretendard", "sans-serif"])
        return f

    @staticmethod
    def _open_url(url: str) -> None:
        import webbrowser
        webbrowser.open(url)


class NeedLoginDialog(_FramelessCardDialog):
    """Small dialog shown when login is required."""

    def __init__(self, parent=None, *, title: str = ""):
        super().__init__(parent, 340, 190)
        self.setWindowTitle(title)
        card = self._make_card()
        lay = QVBoxLayout(card)
        lay.setContentsMargins(32, 28, 32, 24)
        lay.setSpacing(0)

        icon_label = QLabel(_MI_LOGIN)
        icon_label.setFont(QFont("Material Icons", 32))
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setStyleSheet("color: #6366f1; background: transparent;")
        icon_label.setFixedHeight(44)
        lay.addWidget(icon_label)
        lay.addSpacing(10)

        msg = QLabel("\uB85C\uADF8\uC778 \uD6C4 \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4")
        msg.setAlignment(Qt.AlignmentFlag.AlignCenter)
        msg.setStyleSheet("font-size: 15px; font-weight: 600; color: #1a1a2e; background: transparent;")
        lay.addWidget(msg)
        lay.addSpacing(22)

        btn = QPushButton("\uD655\uC778")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedHeight(38)
        btn.setStyleSheet(
            "QPushButton { background-color: #6366f1; color: #ffffff; border: none;"
            "  border-radius: 10px; font-size: 13px; font-weight: 600; padding: 0 32px; }"
            "QPushButton:hover { background-color: #4f46e5; }"
        )
        btn.clicked.connect(self.accept)
        br = QHBoxLayout()
        br.addStretch(); br.addWidget(btn); br.addStretch()
        lay.addLayout(br)


class SidebarWidget(QFrame):
    """Slide-in sidebar with user info and navigation menu."""
    logout_clicked = Signal()
    login_clicked = Signal()
    menu_clicked = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedWidth(300)
        self.setObjectName("sidebarFrame")
        self.setStyleSheet(
            "#sidebarFrame { background-color: #FAFAFA; border-right: 1px solid #e8e8e8; }"
        )

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ???? User info section ??????????????????????????????????????????????????????????
        user_section = QWidget()
        user_section.setObjectName("sidebarUserSection")
        user_section.setStyleSheet(
            "#sidebarUserSection {"
            "  background-color: #FAFAFA;"
            "}"
        )
        ul = QVBoxLayout(user_section)
        ul.setContentsMargins(24, 32, 24, 24)
        ul.setSpacing(4)

        self._name = QLabel("\uAC8C\uC2A4\uD2B8")
        self._name.setStyleSheet(
            "font-size: 15px; font-weight: 700; color: #1a1a2e; background: transparent;"
        )

        self._plan_badge = QLabel("\uBB34\uB8CC")
        self._plan_badge.setFixedHeight(22)
        self._plan_badge.setStyleSheet(
            "font-size: 10px; font-weight: 600; color: #6366f1;"
            "background-color: rgba(99,102,241,0.12);"
            "border-radius: 6px; padding: 3px 10px;"
        )

        self._email = QLabel("")
        self._email.setStyleSheet(
            "font-size: 11px; color: #8b8fa3; background: transparent;"
        )

        self._usage_bar = QProgressBar()
        self._usage_bar.setFixedHeight(6)
        self._usage_bar.setTextVisible(False)
        self._usage_bar.setStyleSheet("""
            QProgressBar {
                border: none; border-radius: 3px;
                background-color: rgba(0,0,0,0.08);
            }
            QProgressBar::chunk {
                background-color: #6366f1; border-radius: 3px;
            }
        """)

        self._usage_label = QLabel("")
        self._usage_label.setStyleSheet(
            "font-size: 10px; color: #8b8fa3; background: transparent;"
        )

        name_plan_row = QHBoxLayout()
        name_plan_row.setContentsMargins(0, 0, 0, 0)
        name_plan_row.setSpacing(8)
        name_plan_row.addWidget(self._name)
        name_plan_row.addWidget(self._plan_badge)
        name_plan_row.addStretch(1)
        ul.addLayout(name_plan_row)
        ul.addWidget(self._email)
        ul.addSpacing(10)
        ul.addWidget(self._usage_bar)
        ul.addWidget(self._usage_label)
        lay.addWidget(user_section)

        # ???? Menu section padding ????????????????????????????????????????????????????
        lay.addSpacing(8)

        # ???? Menu items ????????????????????????????????????????????????????????????????????????
        _ms = (
            "QPushButton { text-align: left; padding: 11px 24px; border: none;"
            "  background-color: transparent; color: #444; font-size: 13px;"
            "  border-radius: 0px; }"
            "QPushButton:hover { background-color: #f5f5ff; color: #6366f1; }"
            "QPushButton:pressed { background-color: #ededff; }"
        )
        _menu_icons = {
            "download_form": _MI_DOWNLOAD,
            "profile": _MI_PERSON,
            "usage": _MI_BAR_CHART,
            "upgrade": _MI_STAR,
            "homepage": _MI_HOME,
            "inquiry": _MI_CHAT,
        }
        for mid, mlabel in [
            ("download_form", "\uC591\uC2DD \uB2E4\uC6B4\uB85C\uB4DC"),
            ("profile", "\uD504\uB85C\uD544 \uC815\uBCF4"),
            ("usage", "\uC0AC\uC6A9\uB7C9 \uC815\uBCF4"),
            ("upgrade", "\uD50C\uB79C \uC5C5\uADF8\uB808\uC774\uB4DC"),
            ("homepage", "\uD648\uD398\uC774\uC9C0"),
            ("inquiry", "\uBB38\uC758/\uACE0\uAC1D\uC13C\uD130"),
        ]:
            btn = QPushButton(mlabel)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setStyleSheet(_ms)
            icon_cp = _menu_icons.get(mid)
            if icon_cp:
                btn.setIcon(_material_icon(icon_cp, color=QColor("#888")))
                btn.setIconSize(QSize(20, 20))
            btn.clicked.connect(lambda checked, _id=mid: self.menu_clicked.emit(_id))
            lay.addWidget(btn)

        lay.addStretch(1)

        # ???? Separator ??????????????????????????????????????????????????????????????????????????
        sep2 = QFrame()
        sep2.setFrameShape(QFrame.Shape.HLine)
        sep2.setFixedHeight(1)
        sep2.setStyleSheet("background-color: #f0f0f0; border: none;")
        lay.addWidget(sep2)

        # ???? Login / Logout ????????????????????????????????????????????????????????????????
        self._login_btn = QPushButton("\uB85C\uADF8\uC778")
        self._login_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._login_btn.setIcon(_material_icon(_MI_LOGIN, color=QColor("#6366f1")))
        self._login_btn.setIconSize(QSize(20, 20))
        self._login_btn.setStyleSheet(
            "QPushButton { text-align: left; padding: 13px 24px; border: none;"
            "  background-color: transparent; color: #6366f1;"
            "  font-size: 13px; font-weight: 600; }"
            "QPushButton:hover { background-color: #f5f5ff; }"
        )
        self._login_btn.clicked.connect(self.login_clicked.emit)

        self._logout_btn = QPushButton("\uB85C\uADF8\uC544\uC6C3")
        self._logout_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._logout_btn.setIcon(_material_icon(_MI_LOGOUT, color=QColor("#ef4444")))
        self._logout_btn.setIconSize(QSize(20, 20))
        self._logout_btn.setStyleSheet(
            "QPushButton { text-align: left; padding: 13px 24px; border: none;"
            "  background-color: transparent; color: #ef4444; font-size: 13px; }"
            "QPushButton:hover { background-color: #fef2f2; }"
        )
        self._logout_btn.clicked.connect(self.logout_clicked.emit)

        lay.addWidget(self._login_btn)
        lay.addWidget(self._logout_btn)

        ver = QLabel("Nova AI v1.0")
        ver.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ver.setStyleSheet("color: #c4c4c4; font-size: 10px; padding: 12px; background: transparent;")
        lay.addWidget(ver)

        self.hide()

    # ???? Public helpers ????????????????????????????????????????????????????????????????
    def update_user_info(
        self,
        uid: str | None,
        name: str,
        email: str,
        tier: str,
        usage: int,
        limit: int,
        avatar_url: str | None = None,
    ) -> None:
        _tier_map = {
            "Free": "\uBB34\uB8CC", "free": "\uBB34\uB8CC",
            "Standard": "PLUS", "standard": "PLUS",
            "Plus": "PLUS", "plus": "PLUS",
            "Pro": "Ultra", "pro": "Ultra", "ultra": "Ultra",
        }
        # tier ??accent color
        _tier_colors = {
            "Free": "#6366f1", "free": "#6366f1",
            "Standard": "#0ea5e9", "Plus": "#8b5cf6",
            "Pro": "#8b5cf6", "pro": "#8b5cf6", "ultra": "#8b5cf6",
        }
        if uid:
            accent = _tier_colors.get(tier, "#6366f1")
            self._name.setText(name or "\uC0AC\uC6A9\uC790")
            self._email.setText(email or "")
            self._email.setVisible(bool(email))
            self._plan_badge.setText(f"{_tier_map.get(tier, tier)} \uD50C\uB79C")
            self._plan_badge.setStyleSheet(
                f"font-size: 10px; font-weight: 600; color: {accent};"
                f"background-color: rgba({int(accent[1:3],16)},{int(accent[3:5],16)},{int(accent[5:7],16)},0.12);"
                "border-radius: 6px; padding: 3px 10px;"
            )
            self._plan_badge.setVisible(True)

            self._usage_bar.setMaximum(max(limit, 1))
            self._usage_bar.setValue(usage)
            rem = limit - usage

            ratio = usage / limit if limit > 0 else 0
            c = (
                "#ef4444" if ratio >= 1.0 else
                "#f97316" if ratio >= 0.8 else accent
            )
            self._usage_bar.setStyleSheet(f"""
                QProgressBar {{
                    border: none; border-radius: 3px;
                    background-color: rgba(0,0,0,0.08);
                }}
                QProgressBar::chunk {{
                    background-color: {c}; border-radius: 3px;
                }}
            """)
            self._usage_bar.setVisible(True)
            self._usage_label.setText(
                f"{usage}/{limit} \uC0AC\uC6A9" if rem > 0 else "\uD55C\uB3C4 \uB3C4\uB2EC"
            )
            self._usage_label.setVisible(True)
            self._login_btn.setVisible(False)
            self._logout_btn.setVisible(True)
        else:
            self._name.setText("\uB85C\uADF8\uC778 \uD574\uC8FC\uC138\uC694")
            self._email.setVisible(False)
            self._plan_badge.setVisible(False)
            self._usage_bar.setVisible(False)
            self._usage_label.setVisible(False)
            self._login_btn.setVisible(True)
            self._logout_btn.setVisible(False)


class DownwardPopupComboBox(QComboBox):
    """Always open combo popup below the control."""

    def showPopup(self) -> None:  # type: ignore[override]
        super().showPopup()
        QTimer.singleShot(0, self._move_popup_below)

    def _move_popup_below(self) -> None:
        popup = self.view().window()
        if popup is None:
            return
        anchor = self.mapToGlobal(self.rect().bottomLeft())
        x = anchor.x()
        y = anchor.y()
        screen = QGuiApplication.screenAt(anchor)
        if screen is not None:
            avail = screen.availableGeometry()
            max_x = avail.right() - popup.width() + 1
            x = max(avail.left(), min(x, max_x))
        popup.move(x, y)


class NovaAILiteWindow(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Nova AI - \uC218\uB2A5 \uD615\uC2DD \uD0C0\uC774\uD551 AI")
        self.setMinimumSize(360, 480)
        self.setAcceptDrops(True)

        # ??????????
        _app_dir = Path(__file__).resolve().parent
        _icon_candidates = [
            # Preferred icon: project public asset.
            _app_dir.parent / "public" / "pabicon789.png",
            _app_dir / "pabicon789.png",
            _app_dir / "logo33.png",
            _app_dir / "nova_ai.ico",
            # PyInstaller bundle paths.
            Path(getattr(sys, "_MEIPASS", "")) / "pabicon789.png" if getattr(sys, "_MEIPASS", None) else None,
            Path(getattr(sys, "_MEIPASS", "")) / "logo33.png" if getattr(sys, "_MEIPASS", None) else None,
            Path(getattr(sys, "_MEIPASS", "")) / "nova_ai.ico" if getattr(sys, "_MEIPASS", None) else None,
        ]
        for _icon_path in _icon_candidates:
            if _icon_path and _icon_path.exists():
                self.setWindowIcon(QIcon(str(_icon_path)))
                break

        # Profile state (populated from get_stored_user() and Firebase)
        self.profile_uid: str | None = None
        self.profile_display_name: str = "\uC0AC\uC6A9\uC790"
        self.profile_plan: str = "\uBB34\uB8CC"
        self.profile_avatar_url: str | None = None
        self._login_worker: LoginWorker | None = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 11, 16, 12)
        layout.setSpacing(6)

        self.selected_images: list[str] = []
        self.generated_code: str = ""
        self.generated_codes: list[str] = []
        self._generated_codes_by_index: list[str] = []
        self._gen_statuses: list[str] = []
        self._ai_worker: AIWorker | None = None
        self._typed_indexes: set[int] = set()
        self._next_auto_type_index: int = 0
        self._auto_type_has_inserted_any: bool = False
        self._auto_type_pending_idx: int | None = None
        self._skipped_indexes: set[int] = set()
        self._typing_worker: "TypingWorker | None" = None
        self._chat_worker: "ChatWorker | None" = None
        self._typing_text_font_name = "한컴 윤고딕 720"
        self._typing_text_font_size_pt = 8.0
        self._typing_eq_font_name = "HYhwpEQ"
        self._typing_eq_font_size_pt = 8.0
        self._image_mode = "crop"
        self._typing_style_compact_breakpoint_px = 980
        _typing_dropdown_icon = (Path(__file__).resolve().parent / "assets" / "dropdown_triangle.png").as_posix()

        self._typing_style_bar = QFrame()
        self._typing_style_bar.setObjectName("typingStyleBar")
        self._typing_style_bar.setStyleSheet(
            "QFrame#typingStyleBar { background-color: #f8fafc; border: 1px solid #e5e7eb;"
            "  border-radius: 10px; }"
            "QLabel#typingStyleTitle { font-size: 12px; font-weight: 700; color: #1a1a2e; background: transparent; }"
            "QLabel#typingStyleLabel { font-size: 11px; font-weight: 600; color: #6b7280; background: transparent; }"
            "QComboBox { background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px;"
            "  padding: 2px 8px 2px 8px; min-height: 24px; font-size: 12px; color: #111827; }"
            "QComboBox#typingFontCombo { padding: 2px 24px 2px 8px; }"
            "QComboBox#typingFontCombo::drop-down { subcontrol-origin: padding; subcontrol-position: top right;"
            "  width: 18px; border: none; }"
            f"QComboBox#typingFontCombo::down-arrow {{ image: url('{_typing_dropdown_icon}');"
            "  width: 12px; height: 12px; margin-right: 3px; }}"
            "QComboBox#typingSizeCombo::drop-down { width: 0px; border: none; }"
            "QComboBox#typingSizeCombo::down-arrow { image: none; width: 0px; height: 0px; }"
            "QComboBox QAbstractItemView { background: #ffffff; border: 1px solid #d1d5db;"
            "  outline: 0; selection-background-color: #eef2ff; selection-color: #111827; }"
            "QComboBox QAbstractItemView::item { border: none; padding: 4px 8px; }"
            "QComboBox QAbstractItemView::item:hover { background-color: #eef2ff; border: none; }"
            "QComboBox QAbstractItemView::item:selected { background-color: #eef2ff; border: none; color: #111827; }"
        )
        _ts_root = QVBoxLayout(self._typing_style_bar)
        _ts_root.setContentsMargins(10, 6, 10, 6)
        _ts_root.setSpacing(6)

        _img_mode_row = QHBoxLayout()
        _img_mode_row.setContentsMargins(0, 0, 0, 0)
        _img_mode_row.setSpacing(8)
        _img_mode_lbl = QLabel("이미지")
        _img_mode_lbl.setObjectName("typingStyleLabel")
        _img_mode_row.addSpacing(2)
        _img_mode_lbl.setFixedWidth(52)
        _img_mode_row.addWidget(_img_mode_lbl)
        self._image_mode_combo = DownwardPopupComboBox()
        self._image_mode_combo.setObjectName("typingFontCombo")
        self._image_mode_combo.setEditable(False)
        self._image_mode_combo.addItems(
            ["이미지 없이 생성하기", "이미지 크롭해서 생성하기", "AI 이미지 생성하기"]
        )
        self._image_mode_combo.setFixedWidth(220)
        _img_mode_row.addWidget(self._image_mode_combo)
        _img_mode_row.addStretch(1)
        _ts_root.addLayout(_img_mode_row)

        _ts_lay = QHBoxLayout()
        _ts_lay.setContentsMargins(0, 0, 0, 0)
        _ts_lay.setSpacing(8)
        _ts_lay.addSpacing(2)

        _txt_lbl = QLabel("\uAE00\uC528 \uD3F0\uD2B8")
        _txt_lbl.setObjectName("typingStyleLabel")
        _txt_lbl.setFixedWidth(52)
        _ts_lay.addWidget(_txt_lbl)
        self._typing_text_font_combo = DownwardPopupComboBox()
        self._typing_text_font_combo.setObjectName("typingFontCombo")
        self._typing_text_font_combo.setEditable(False)
        self._typing_text_font_combo.addItems(
            [
                "HYhwpEQ",
                "함초롬바탕",
                "함초롬돋움",
                "맑은 고딕",
                "한컴 윤고딕 720",
                "한컴 윤고딕 740",
                "바탕",
                "돋움",
                "굴림",
            ]
        )
        self._typing_text_font_combo.setCurrentText(self._typing_text_font_name)
        self._typing_text_font_combo.setFixedWidth(140)
        _ts_lay.addWidget(self._typing_text_font_combo)

        _txt_size_lbl = QLabel("\uD06C\uAE30")
        _txt_size_lbl.setObjectName("typingStyleLabel")
        _ts_lay.addWidget(_txt_size_lbl)
        self._typing_text_size_combo = QComboBox()
        self._typing_text_size_combo.setObjectName("typingSizeCombo")
        self._typing_text_size_combo.setEditable(True)
        self._typing_text_size_combo.addItems(
            ["8.0", "9.0", "10.0", "11.0", "12.0", "13.0", "14.0", "15.0", "16.0"]
        )
        self._typing_text_size_combo.setCurrentText(self._format_text_font_size(self._typing_text_font_size_pt))
        if self._typing_text_size_combo.lineEdit() is not None:
            self._typing_text_size_combo.lineEdit().setValidator(QDoubleValidator(1.0, 999.0, 1, self))
        self._typing_text_size_combo.setFixedWidth(140)
        _ts_lay.addWidget(self._typing_text_size_combo)

        _eq_lbl = QLabel("\uC218\uC2DD \uD3F0\uD2B8")
        _eq_lbl.setObjectName("typingStyleLabel")
        _ts_lay.addWidget(_eq_lbl)
        self._typing_eq_font_combo = DownwardPopupComboBox()
        self._typing_eq_font_combo.setObjectName("typingFontCombo")
        self._typing_eq_font_combo.setEditable(False)
        self._typing_eq_font_combo.addItems(["HYhwpEQ", "HancomEQN"])
        self._typing_eq_font_combo.setCurrentText(self._typing_eq_font_name)
        self._typing_eq_font_combo.setFixedWidth(140)
        _ts_lay.addWidget(self._typing_eq_font_combo)

        _eq_size_lbl = QLabel("\uD06C\uAE30")
        _eq_size_lbl.setObjectName("typingStyleLabel")
        _ts_lay.addWidget(_eq_size_lbl)
        self._typing_eq_size_combo = QComboBox()
        self._typing_eq_size_combo.setObjectName("typingSizeCombo")
        self._typing_eq_size_combo.setEditable(True)
        self._typing_eq_size_combo.addItems(
            ["8", "9", "10", "11", "12", "13", "14", "15", "16"]
        )
        self._typing_eq_size_combo.setCurrentText(self._format_eq_font_size(self._typing_eq_font_size_pt))
        if self._typing_eq_size_combo.lineEdit() is not None:
            self._typing_eq_size_combo.lineEdit().setValidator(QIntValidator(1, 999, self))
        self._typing_eq_size_combo.setFixedWidth(140)
        _ts_lay.addWidget(self._typing_eq_size_combo)
        _ts_lay.addStretch(1)
        _ts_root.addLayout(_ts_lay)

        self._typing_text_font_combo.currentTextChanged.connect(self._on_typing_style_changed)
        self._typing_text_size_combo.currentIndexChanged.connect(self._on_typing_style_changed)
        if self._typing_text_size_combo.lineEdit() is not None:
            self._typing_text_size_combo.lineEdit().editingFinished.connect(self._on_typing_style_changed)
        self._typing_eq_font_combo.currentTextChanged.connect(self._on_typing_style_changed)
        self._typing_eq_size_combo.currentIndexChanged.connect(self._on_typing_style_changed)
        if self._typing_eq_size_combo.lineEdit() is not None:
            self._typing_eq_size_combo.lineEdit().editingFinished.connect(self._on_typing_style_changed)
        self._image_mode_combo.currentTextChanged.connect(self._on_image_mode_changed)

        # Compact typing style bar (shown on narrow window widths).
        self._typing_style_bar_compact = QFrame()
        self._typing_style_bar_compact.setObjectName("typingStyleBarCompact")
        self._typing_style_bar_compact.setStyleSheet(
            "QFrame#typingStyleBarCompact { background-color: #f8fafc; border: 1px solid #e5e7eb;"
            "  border-radius: 10px; }"
            "QLabel#typingStyleTitle { font-size: 12px; font-weight: 700; color: #1a1a2e; background: transparent; }"
            "QLabel#typingStyleLabel { font-size: 11px; font-weight: 600; color: #6b7280; background: transparent; }"
            "QComboBox { background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px;"
            "  padding: 2px 8px 2px 8px; min-height: 24px; font-size: 12px; color: #111827; }"
            "QComboBox#typingFontCombo { padding: 2px 24px 2px 8px; }"
            "QComboBox#typingFontCombo::drop-down { subcontrol-origin: padding; subcontrol-position: top right;"
            "  width: 18px; border: none; }"
            f"QComboBox#typingFontCombo::down-arrow {{ image: url('{_typing_dropdown_icon}');"
            "  width: 12px; height: 12px; margin-right: 3px; }}"
            "QComboBox#typingSizeCombo::drop-down { width: 0px; border: none; }"
            "QComboBox#typingSizeCombo::down-arrow { image: none; width: 0px; height: 0px; }"
            "QComboBox QAbstractItemView { background: #ffffff; border: 1px solid #d1d5db;"
            "  outline: 0; selection-background-color: #eef2ff; selection-color: #111827; }"
            "QComboBox QAbstractItemView::item { border: none; padding: 4px 8px; }"
            "QComboBox QAbstractItemView::item:hover { background-color: #eef2ff; border: none; }"
            "QComboBox QAbstractItemView::item:selected { background-color: #eef2ff; border: none; color: #111827; }"
        )
        _tsc_v = QVBoxLayout(self._typing_style_bar_compact)
        _tsc_v.setContentsMargins(10, 6, 10, 6)
        _tsc_v.setSpacing(6)
        _img_mode_row_c = QHBoxLayout()
        _img_mode_row_c.setContentsMargins(0, 0, 0, 0)
        _img_mode_row_c.setSpacing(6)
        _img_mode_lbl_c = QLabel("이미지")
        _img_mode_lbl_c.setObjectName("typingStyleLabel")
        _img_mode_lbl_c.setFixedWidth(52)
        _img_mode_row_c.addWidget(_img_mode_lbl_c)
        self._image_mode_combo_compact = DownwardPopupComboBox()
        self._image_mode_combo_compact.setObjectName("typingFontCombo")
        self._image_mode_combo_compact.setEditable(False)
        self._image_mode_combo_compact.addItems(
            ["이미지 없이 생성하기", "이미지 크롭해서 생성하기", "AI 이미지 생성하기"]
        )
        self._image_mode_combo_compact.setMinimumWidth(140)
        _img_mode_row_c.addWidget(self._image_mode_combo_compact, 1)
        _tsc_v.addLayout(_img_mode_row_c)
        _tsc_row1 = QHBoxLayout()
        _tsc_row1.setSpacing(6)
        _tsc_txt_lbl = QLabel("\uAE00\uC528 \uD3F0\uD2B8")
        _tsc_txt_lbl.setObjectName("typingStyleLabel")
        _tsc_txt_lbl.setFixedWidth(52)
        _tsc_row1.addWidget(_tsc_txt_lbl)
        self._typing_text_font_combo_compact = DownwardPopupComboBox()
        self._typing_text_font_combo_compact.setObjectName("typingFontCombo")
        self._typing_text_font_combo_compact.setEditable(False)
        self._typing_text_font_combo_compact.addItems(
            [
                "HYhwpEQ",
                "함초롬바탕",
                "함초롬돋움",
                "맑은 고딕",
                "한컴 윤고딕 720",
                "한컴 윤고딕 740",
                "바탕",
                "돋움",
                "굴림",
            ]
        )
        self._typing_text_font_combo_compact.setCurrentText(self._typing_text_font_name)
        self._typing_text_font_combo_compact.setMinimumWidth(96)
        _tsc_row1.addWidget(self._typing_text_font_combo_compact, 1)
        _tsc_txt_size_lbl = QLabel("\uD06C\uAE30")
        _tsc_txt_size_lbl.setObjectName("typingStyleLabel")
        _tsc_row1.addWidget(_tsc_txt_size_lbl)
        self._typing_text_size_combo_compact = QComboBox()
        self._typing_text_size_combo_compact.setObjectName("typingSizeCombo")
        self._typing_text_size_combo_compact.setEditable(True)
        self._typing_text_size_combo_compact.addItems(
            ["8.0", "9.0", "10.0", "11.0", "12.0", "13.0", "14.0", "15.0", "16.0"]
        )
        self._typing_text_size_combo_compact.setCurrentText(self._format_text_font_size(self._typing_text_font_size_pt))
        if self._typing_text_size_combo_compact.lineEdit() is not None:
            self._typing_text_size_combo_compact.lineEdit().setValidator(QDoubleValidator(1.0, 999.0, 1, self))
        self._typing_text_size_combo_compact.setMinimumWidth(96)
        _tsc_row1.addWidget(self._typing_text_size_combo_compact, 1)
        _tsc_v.addLayout(_tsc_row1)

        _tsc_row2 = QHBoxLayout()
        _tsc_row2.setSpacing(6)
        _tsc_eq_lbl = QLabel("\uC218\uC2DD \uD3F0\uD2B8")
        _tsc_eq_lbl.setObjectName("typingStyleLabel")
        _tsc_eq_lbl.setFixedWidth(52)
        _tsc_row2.addWidget(_tsc_eq_lbl)
        self._typing_eq_font_combo_compact = DownwardPopupComboBox()
        self._typing_eq_font_combo_compact.setObjectName("typingFontCombo")
        self._typing_eq_font_combo_compact.setEditable(False)
        self._typing_eq_font_combo_compact.addItems(["HYhwpEQ", "HancomEQN"])
        self._typing_eq_font_combo_compact.setCurrentText(self._typing_eq_font_name)
        self._typing_eq_font_combo_compact.setMinimumWidth(96)
        _tsc_row2.addWidget(self._typing_eq_font_combo_compact, 1)
        _tsc_eq_size_lbl = QLabel("\uD06C\uAE30")
        _tsc_eq_size_lbl.setObjectName("typingStyleLabel")
        _tsc_row2.addWidget(_tsc_eq_size_lbl)
        self._typing_eq_size_combo_compact = QComboBox()
        self._typing_eq_size_combo_compact.setObjectName("typingSizeCombo")
        self._typing_eq_size_combo_compact.setEditable(True)
        self._typing_eq_size_combo_compact.addItems(
            ["8", "9", "10", "11", "12", "13", "14", "15", "16"]
        )
        self._typing_eq_size_combo_compact.setCurrentText(self._format_eq_font_size(self._typing_eq_font_size_pt))
        if self._typing_eq_size_combo_compact.lineEdit() is not None:
            self._typing_eq_size_combo_compact.lineEdit().setValidator(QIntValidator(1, 999, self))
        self._typing_eq_size_combo_compact.setMinimumWidth(96)
        _tsc_row2.addWidget(self._typing_eq_size_combo_compact, 1)
        _tsc_v.addLayout(_tsc_row2)

        self._typing_text_font_combo_compact.currentTextChanged.connect(self._on_typing_style_changed_compact)
        self._typing_text_size_combo_compact.currentIndexChanged.connect(self._on_typing_style_changed_compact)
        if self._typing_text_size_combo_compact.lineEdit() is not None:
            self._typing_text_size_combo_compact.lineEdit().editingFinished.connect(
                self._on_typing_style_changed_compact
            )
        self._typing_eq_font_combo_compact.currentTextChanged.connect(self._on_typing_style_changed_compact)
        self._typing_eq_size_combo_compact.currentIndexChanged.connect(self._on_typing_style_changed_compact)
        if self._typing_eq_size_combo_compact.lineEdit() is not None:
            self._typing_eq_size_combo_compact.lineEdit().editingFinished.connect(
                self._on_typing_style_changed_compact
            )
        self._image_mode_combo_compact.currentTextChanged.connect(self._on_image_mode_changed_compact)
        self._typing_style_bar_compact.hide()
        # ???? ???????? ??(pill) ????
        self._filename_chip = QFrame()
        self._filename_chip.setObjectName("filenameChip")
        self._filename_chip.setFixedHeight(32)
        self._filename_chip.setStyleSheet(
            "QFrame#filenameChip { background-color: #dbeafe; border: 1px solid #93c5fd; border-radius: 16px; }"
        )
        _chip_lay = QHBoxLayout(self._filename_chip)
        _chip_lay.setContentsMargins(8, 0, 10, 0)
        _chip_lay.setSpacing(4)
        self._filename_icon = QLabel()
        self._filename_icon.setPixmap(
            _material_icon("\ue873", 18, QColor("#3b82f6")).pixmap(QSize(18, 18))
        )
        self._filename_icon.setFixedSize(18, 18)
        self._filename_icon.setStyleSheet("background: transparent;")
        _chip_lay.addWidget(self._filename_icon)
        self.filename_label = QLabel("\uAC10\uC9C0 \uD30C\uC77C \uC5C6\uC74C")
        self.filename_label.setStyleSheet(
            "color: #3B82F6; font-size: 12px; font-weight: 700; background: transparent;"
        )
        _fn_font = self.filename_label.font()
        _fn_font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, -0.5)
        self.filename_label.setFont(_fn_font)
        _chip_lay.addWidget(self.filename_label)
        self._filename_chip.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)

        # ???? ??? ???? ??? ????
        self._page_badge = QFrame()
        self._page_badge.setObjectName("pageBadge")
        self._page_badge.setFixedHeight(32)
        self._page_badge.setStyleSheet(
            "QFrame#pageBadge { background-color: #e0f2fe; border: 1px solid #7dd3fc;"
            "  border-radius: 16px; }"
        )
        _pb_lay = QHBoxLayout(self._page_badge)
        _pb_lay.setContentsMargins(10, 0, 10, 0)
        _pb_lay.setSpacing(0)
        self._page_label = QLabel("")
        self._page_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._page_label.setStyleSheet(
            "color: #0369a1; font-size: 11px; font-weight: 700; background: transparent;"
        )
        _pb_lay.addWidget(self._page_label)
        self._page_badge.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        self._page_badge.setVisible(False)

        # Chat page document meta chips (top-left in chat container).
        self._chat_filename_chip = QFrame()
        self._chat_filename_chip.setObjectName("chatFilenameChip")
        self._chat_filename_chip.setFixedHeight(32)
        self._chat_filename_chip.setStyleSheet(
            "QFrame#chatFilenameChip { background-color: #dbeafe; border: 1px solid #93c5fd; border-radius: 16px; }"
        )
        _chat_chip_lay = QHBoxLayout(self._chat_filename_chip)
        _chat_chip_lay.setContentsMargins(8, 0, 10, 0)
        _chat_chip_lay.setSpacing(4)
        self._chat_filename_icon = QLabel()
        self._chat_filename_icon.setPixmap(
            _material_icon("\ue873", 18, QColor("#3b82f6")).pixmap(QSize(18, 18))
        )
        self._chat_filename_icon.setFixedSize(18, 18)
        self._chat_filename_icon.setStyleSheet("background: transparent;")
        _chat_chip_lay.addWidget(self._chat_filename_icon)
        self._chat_filename_label = QLabel("\uAC10\uC9C0 \uD30C\uC77C \uC5C6\uC74C")
        self._chat_filename_label.setStyleSheet(
            "color: #3B82F6; font-size: 12px; font-weight: 700; background: transparent;"
        )
        _chat_fn_font = self._chat_filename_label.font()
        _chat_fn_font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, -0.5)
        self._chat_filename_label.setFont(_chat_fn_font)
        _chat_chip_lay.addWidget(self._chat_filename_label)
        self._chat_filename_chip.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)

        self._chat_page_badge = QFrame()
        self._chat_page_badge.setObjectName("chatPageBadge")
        self._chat_page_badge.setFixedHeight(32)
        self._chat_page_badge.setStyleSheet(
            "QFrame#chatPageBadge { background-color: #e0f2fe; border: 1px solid #7dd3fc;"
            "  border-radius: 16px; }"
        )
        _chat_pb_lay = QHBoxLayout(self._chat_page_badge)
        _chat_pb_lay.setContentsMargins(10, 0, 10, 0)
        _chat_pb_lay.setSpacing(0)
        self._chat_page_label = QLabel("")
        self._chat_page_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._chat_page_label.setStyleSheet(
            "color: #0369a1; font-size: 11px; font-weight: 700; background: transparent;"
        )
        _chat_pb_lay.addWidget(self._chat_page_label)
        self._chat_page_badge.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        self._chat_page_badge.setVisible(False)

        self.typing_status_label = QLabel("")
        self.typing_status_label.setStyleSheet("color: #6366f1; font-size: 12px; font-weight: 500;")
        self.typing_status_label.setVisible(False)
        self.order_title = QLabel("\uD0C0\uC774\uD551 \uC21C\uC11C: (\uC5C6\uC74C)")
        self.order_title.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.order_list = OrderListWidget()
        self.order_list.setMinimumHeight(260)
        self.order_list.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.order_list.setStyleSheet(
            "QListWidget { background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px;"
            "  padding: 6px; }"
            "QListWidget::item { background-color: transparent; border: none;"
            "  padding: 4px 6px; border-radius: 6px; }"
            "QListWidget::item:selected { background-color: rgba(99, 102, 241, 0.1); }"
            "QListWidget::item:hover { background-color: rgba(0, 0, 0, 0.04); }"
        )
        self.order_list.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        self.order_list.setDragDropMode(QListWidget.DragDropMode.InternalMove)
        self.order_list.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.order_list.setDragEnabled(True)
        self.order_list.setAcceptDrops(True)
        self.order_list.setDropIndicatorShown(True)
        self._order_delegate = OrderListDelegate(self.order_list)
        self._order_delegate.delete_clicked.connect(self._on_order_delete_clicked)
        self._order_delegate.retype_clicked.connect(self._on_order_retype_clicked)
        self._order_delegate.view_clicked.connect(self._on_order_view_clicked)
        self.order_list.setItemDelegate(self._order_delegate)
        self.order_list.itemClicked.connect(self._on_order_item_clicked)
        self.order_list.itemSelectionChanged.connect(self._on_order_selection_changed)
        self.order_list.model().rowsMoved.connect(self._on_order_rows_moved)
        self.order_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.order_list.customContextMenuRequested.connect(self._on_order_context_menu)
        self.order_list.filesDropped.connect(self._on_files_dropped)

        self.btn_ai_type = QPushButton("\uBCF4\uB0B4\uAE30")
        self.btn_ai_type.setIcon(_material_icon("\ue163", 18, QColor("#ffffff")))
        self.btn_ai_type.setIconSize(QSize(18, 18))
        self.btn_ai_type.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_ai_type.setEnabled(False)
        self.btn_ai_type.setStyleSheet(
            "QPushButton { background-color: #6366f1; color: white;"
            "  border: none; border-radius: 8px; padding: 7px 12px;"
            "  font-size: 13px; font-weight: 600; }"
            "QPushButton:hover { background-color: #4f46e5; }"
            "QPushButton:pressed { background-color: #4338ca; }"
            "QPushButton:disabled { background-color: #c7c7cc; color: #f0f0f0; }"
        )
        self._sync_image_mode_controls(source="", mode_key=self._image_mode)

        self.code_view = QTextEdit()
        self.code_view.setReadOnly(False)
        self.code_view.setFixedHeight(200)
        self.code_view.setStyleSheet(
            "QTextEdit { background-color: #f8f9fa; border: 1px solid #e5e7eb;"
            "  border-radius: 8px; padding: 8px; font-size: 12px;"
            "  color: #333; font-family: 'Consolas', 'Pretendard', monospace; }"
        )
        self._generated_code_label = QLabel("\uC0DD\uC131 \uCF54\uB4DC")
        self._generated_code_label.setStyleSheet("font-size: 13px; font-weight: 600; color: #333;")
        self._code_type_btn = QPushButton("\uCF54\uB4DC \uD0C0\uC774\uD551")
        self._code_type_btn.setEnabled(False)
        self._code_type_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._code_type_btn.setStyleSheet(
            "QPushButton { background-color: #f3f4f6; color: #333;"
            "  border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 14px;"
            "  font-size: 12px; font-weight: 500; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
            "QPushButton:disabled { color: #aaa; border-color: #eee; background-color: #fafafa; }"
        )
        self._generated_container = QWidget()
        gen_layout = QVBoxLayout(self._generated_container)
        gen_layout.setContentsMargins(0, 0, 0, 0)
        gen_layout.setSpacing(8)
        gen_header = QHBoxLayout()
        gen_header.addWidget(self._generated_code_label)
        gen_header.addStretch(1)
        gen_header.addWidget(self._code_type_btn)
        gen_layout.addLayout(gen_header)
        gen_layout.addWidget(self.code_view)
        # Hidden until user presses the typing-order button (AI ?????).
        self._generated_container.setVisible(False)

        # Typing order container (status + list + bottom row)
        order_container = QWidget()
        order_layout = QVBoxLayout(order_container)
        order_layout.setContentsMargins(0, 0, 0, 0)
        order_layout.setSpacing(8)
        order_status_row = QHBoxLayout()
        order_status_row.addWidget(self.typing_status_label)
        order_status_row.addStretch(1)
        order_layout.addLayout(order_status_row)
        list_stack_container = QWidget()
        list_stack_container.setMinimumHeight(260)
        list_stack_container.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        list_stack_container.setStyleSheet(
            "QWidget { background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; }"
        )
        list_stack = QStackedLayout(list_stack_container)
        list_stack.setContentsMargins(8, 8, 8, 8)
        self._empty_placeholder = DropPlaceholder()
        self._empty_placeholder.setMinimumHeight(260)
        self._empty_placeholder.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._empty_placeholder.clicked.connect(self.on_upload_image)
        self._empty_placeholder.filesDropped.connect(self._on_files_dropped)
        list_stack.addWidget(self._empty_placeholder)
        list_stack.addWidget(self.order_list)
        order_layout.addWidget(list_stack_container, 1)
        self._order_list_stack = list_stack

        self._chat_container = QFrame()
        self._chat_container.setObjectName("chatContainer")
        self._chat_container.setStyleSheet(
            "QFrame#chatContainer { background: transparent; border: none; }"
            "QListWidget#chatThread { background: transparent; border: none; border-radius: 0px;"
            "  padding: 0px; font-size: 12px; color: #111827; }"
            "QListWidget#chatThread::item { border: none; padding: 6px 8px; margin: 2px 0; }"
            "QLineEdit#chatInput { background: #ffffff; border: 1px solid #d1d5db; border-radius: 8px;"
            "  padding: 6px 10px; font-size: 12px; color: #111827; }"
            "QPushButton#chatSendBtn { background-color: #6366f1; color: #ffffff; border: none;"
            "  border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 600; }"
            "QPushButton#chatSendBtn:hover { background-color: #4f46e5; }"
            "QPushButton#chatSendBtn:disabled { background-color: #c7c7cc; color: #f0f0f0; }"
        )
        _chat_lay = QVBoxLayout(self._chat_container)
        _chat_lay.setContentsMargins(0, 0, 0, 0)
        _chat_lay.setSpacing(8)
        self._chat_thread = QListWidget()
        self._chat_thread.setObjectName("chatThread")
        self._chat_thread.setSelectionMode(QListWidget.SelectionMode.NoSelection)
        self._chat_thread.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self._chat_thread.setVerticalScrollMode(QListWidget.ScrollMode.ScrollPerPixel)
        self._chat_thread.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._chat_thread.setWordWrap(True)
        _chat_lay.addWidget(self._chat_thread, 1)

        _chat_input_row = QHBoxLayout()
        _chat_input_row.setContentsMargins(0, 0, 0, 0)
        _chat_input_row.setSpacing(0)
        self._chat_input = QLineEdit()
        self._chat_input.setObjectName("chatInput")
        self._chat_input.setPlaceholderText("예: 새 파일을 열어줘")
        _chat_input_row.addWidget(self._chat_input, 1)
        _chat_lay.addLayout(_chat_input_row)

        _chat_action_row = QHBoxLayout()
        _chat_action_row.setContentsMargins(0, 0, 0, 0)
        _chat_action_row.setSpacing(8)
        _chat_action_row.addWidget(self._chat_filename_chip)
        _chat_action_row.addWidget(self._chat_page_badge)
        _chat_action_row.addStretch(1)
        self._chat_send_btn = QPushButton("보내기")
        self._chat_send_btn.setObjectName("chatSendBtn")
        self._chat_send_btn.setIcon(_material_icon("\ue163", 18, QColor("#ffffff")))
        self._chat_send_btn.setIconSize(QSize(18, 18))
        self._chat_send_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._chat_send_btn.setStyleSheet(
            "QPushButton { background-color: #6366f1; color: white;"
            "  border: none; border-radius: 8px; padding: 7px 12px;"
            "  font-size: 13px; font-weight: 600; }"
            "QPushButton:hover { background-color: #4f46e5; }"
            "QPushButton:pressed { background-color: #4338ca; }"
            "QPushButton:disabled { background-color: #c7c7cc; color: #f0f0f0; }"
        )
        _chat_action_row.addWidget(self._chat_send_btn)
        _chat_lay.addLayout(_chat_action_row)

        self._chat_send_btn.clicked.connect(self._on_chat_send_clicked)
        self._chat_input.returnPressed.connect(self._on_chat_send_clicked)

        # ???? ?? ??? ??(?????? ??, ???????? ??) ????
        _hdr_top = 6
        _hdr_h = 48
        _m = layout.contentsMargins()
        layout.setContentsMargins(_m.left(), _hdr_top + _hdr_h, _m.right(), _m.bottom())

        self._header_bar = QWidget(self)
        self._header_bar.setObjectName("headerBar")
        self._header_bar.setStyleSheet(
            "#headerBar { background-color: #ffffff; }"
        )
        self._header_bar.setGeometry(0, _hdr_top, self.width(), _hdr_h)
        _h_lay = QHBoxLayout(self._header_bar)
        _h_lay.setContentsMargins(12, 0, 14, 0)

        self._menu_btn = QPushButton()
        self._menu_btn.setFixedSize(36, 36)
        self._menu_btn.setIcon(_material_icon(_MI_MENU, 22, QColor("#444")))
        self._menu_btn.setIconSize(QSize(24, 24))
        self._menu_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._menu_btn.setStyleSheet(
            "QPushButton { border: none; background: transparent;"
            "  border-radius: 8px; }"
            "QPushButton:hover { background-color: #f3f4f6; }"
        )
        self._menu_btn.clicked.connect(self._toggle_sidebar)
        _h_lay.addWidget(self._menu_btn)

        self._header_mode_btn = QPushButton("AI 채팅 편집")
        self._header_mode_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_mode_btn.setFixedHeight(30)
        self._header_mode_btn.setStyleSheet(
            "QPushButton { background-color: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe;"
            "  border-radius: 8px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background-color: #e0e7ff; }"
            "QPushButton:pressed { background-color: #c7d2fe; }"
        )
        self._header_mode_btn.clicked.connect(self._on_header_mode_clicked)
        _h_lay.addStretch(1)
        self._replay_selected_btn = QPushButton("선택 코드 재생")
        self._replay_selected_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._replay_selected_btn.setFixedHeight(30)
        self._replay_selected_btn.setStyleSheet(
            "QPushButton { background-color: #f3f4f6; color: #374151; border: 1px solid #d1d5db;"
            "  border-radius: 8px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
            "QPushButton:disabled { background-color: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; }"
        )
        self._replay_selected_btn.clicked.connect(self._on_replay_selected_clicked)
        self._replay_selected_btn.setVisible(False)
        _h_lay.addWidget(self._replay_selected_btn)
        _h_lay.addSpacing(6)
        _h_lay.addWidget(self._header_mode_btn)
        _h_lay.addSpacing(8)

        # Right side header area (name and plan badge).
        self._header_user_area = QWidget()
        self._header_user_area.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_user_area.setStyleSheet("background: transparent;")
        self._header_user_area.installEventFilter(self)
        _hu_lay = QHBoxLayout(self._header_user_area)
        _hu_lay.setContentsMargins(6, 4, 10, 4)
        _hu_lay.setSpacing(8)

        # ??? + ??? ?????
        self._header_name = QLabel("\uB85C\uADF8\uC778")
        self._header_name.setStyleSheet(
            "font-size: 12px; font-weight: 600; color: #1a1a2e; background: transparent;"
        )

        self._header_plan = QLabel("\uBB34\uB8CC")
        self._header_plan.setFixedHeight(18)
        self._header_plan.setStyleSheet(
            "font-size: 9px; font-weight: 600; color: #6366f1;"
            "background-color: rgba(99,102,241,0.10);"
            "border-radius: 4px; padding: 1px 6px;"
        )

        _hu_lay.addWidget(self._header_name)
        _hu_lay.addWidget(self._header_plan)

        # ??? ??????? ??? ??? ?? ??????
        self._header_user_btn = QPushButton(self._header_user_area)
        self._header_user_btn.setStyleSheet(
            "QPushButton { border: none; background: transparent; }"
            "QPushButton:hover { background: transparent; }"
        )
        self._header_user_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_user_btn.clicked.connect(self._on_header_user_clicked)
        # Hide header profile summary; keep sidebar/profile access through menu.
        self._header_user_area.setVisible(False)

        self._code_view_dialog = CodeViewDialog(self)

        self._typing_page = QWidget()
        _typing_page_layout = QVBoxLayout(self._typing_page)
        _typing_page_layout.setContentsMargins(0, 0, 0, 0)
        _typing_page_layout.setSpacing(6)
        _typing_page_layout.addWidget(self._typing_style_bar)
        _typing_page_layout.addWidget(self._typing_style_bar_compact)
        _typing_page_layout.addWidget(order_container)
        _typing_page_layout.addSpacing(8)
        top_action_row = QHBoxLayout()
        self._top_action_row = top_action_row
        top_action_row.addWidget(self._filename_chip)
        top_action_row.addWidget(self._page_badge)
        top_action_row.addStretch(1)
        top_action_row.addWidget(self.btn_ai_type)
        _typing_page_layout.addLayout(top_action_row)
        _typing_page_layout.addWidget(self._generated_container)

        self._chat_page = QWidget()
        _chat_page_layout = QVBoxLayout(self._chat_page)
        _chat_page_layout.setContentsMargins(0, 0, 0, 0)
        _chat_page_layout.setSpacing(6)
        _chat_page_layout.addWidget(self._chat_container, 1)

        self._content_stack_container = QWidget()
        self._content_stack = QStackedLayout(self._content_stack_container)
        self._content_stack.setContentsMargins(0, 0, 0, 0)
        self._content_stack.setSpacing(0)
        self._content_stack.addWidget(self._typing_page)
        self._content_stack.addWidget(self._chat_page)
        layout.addWidget(self._content_stack_container, 1)
        self._main_mode = "typing"
        self._set_main_mode("typing")

        self.btn_ai_type.clicked.connect(self.on_ai_type_run)
        self._code_type_btn.clicked.connect(self._on_code_type_clicked)
        self.code_view.textChanged.connect(self._on_code_view_changed)

        self._filename_worker: FilenameWorker | None = None
        self._filename_update_pending = False
        self._profile_worker: ProfileRefreshWorker | None = None
        self._session_guard_worker: SessionGuardWorker | None = None
        self._profile_refresh_force_pending = False
        self._post_login_sync_attempts_left = 0
        self._post_login_sync_timer = QTimer(self)
        self._post_login_sync_timer.setSingleShot(True)
        self._post_login_sync_timer.timeout.connect(self._run_post_login_profile_sync)
        self._profile_usage = 0
        self._profile_usage_last_refresh = 0.0
        self._desktop_session_id = uuid.uuid4().hex
        self._remote_logout_in_progress = False

        self._timer = QTimer(self)
        self._timer.setInterval(250)
        self._timer.timeout.connect(self._schedule_filename_update)
        self._timer.start()
        self._session_guard_timer = QTimer(self)
        self._session_guard_timer.setInterval(4000)
        self._session_guard_timer.timeout.connect(self._schedule_session_guard_check)
        self._session_guard_timer.start()
        self.update_filename()
        self._auto_type_after_ai = False
        self._current_code_index = -1
        self._current_code_path: str | None = None
        self._code_view_updating = False
        self._ai_error_messages: dict[int, str] = {}
        # Animate "????? status in the list.
        self._status_anim_timer = QTimer(self)
        self._status_anim_timer.setInterval(50)
        self._status_anim_timer.timeout.connect(self._tick_status_animation)
        self._status_anim_timer.start()

        # Capture ESC globally to stop typing even during long operations.
        app = QApplication.instance()
        if app is not None:
            app.installEventFilter(self)
        
        # ???? ?????? ?????? & ?????? ??? (?????? ????, ?? ???) ????
        self._sidebar_overlay = SidebarOverlay(self)
        self._sidebar_overlay.clicked.connect(self._close_sidebar)
        self._sidebar = SidebarWidget(self)
        self._sidebar.login_clicked.connect(self._on_login_clicked)
        self._sidebar.logout_clicked.connect(self._on_logout_clicked)
        self._sidebar.menu_clicked.connect(self._on_sidebar_menu)

        # ?? ???????? ?????? (?? ?????)
        self._load_stored_user()
        self._register_desktop_session_if_needed()
        self._update_user_status()
        
        # Firebase??? ?? ??????????(???????
        QTimer.singleShot(500, self._refresh_profile_from_firebase)
        self._on_typing_style_changed()
        self._update_typing_style_bar_mode()

    def _load_stored_user(self) -> None:
        """?? ????? ????? ???????? ??"""
        user = get_stored_user()
        if user and user.get("uid"):
            self.profile_uid = user.get("uid")
            self.profile_display_name = user.get("name") or "\uC0AC\uC6A9\uC790"
            self.profile_plan = user.get("plan") or user.get("tier") or "Free"
            self.profile_avatar_url = user.get("photo_url")
        else:
            self.profile_uid = None
            self.profile_display_name = "\uC0AC\uC6A9\uC790"
            self.profile_plan = "Free"
            self.profile_avatar_url = None

    def _register_desktop_session_if_needed(self) -> None:
        """Single-device ?????Free/Plus/Test)??? ??? PC ??? ???."""
        if not self.profile_uid:
            return
        user = get_stored_user() or {}
        tier = str(user.get("plan") or user.get("tier") or self.profile_plan or "free")
        email = str(user.get("email") or "")
        register_desktop_device_session(
            str(self.profile_uid),
            self._desktop_session_id,
            tier=tier,
            email=email,
        )

    def _schedule_session_guard_check(self) -> None:
        if not self.profile_uid:
            return
        if self._remote_logout_in_progress:
            return
        if self._session_guard_worker and self._session_guard_worker.isRunning():
            return

        user = get_stored_user() or {}
        tier = str(user.get("plan") or user.get("tier") or self.profile_plan or "free")
        email = str(user.get("email") or "")
        self._session_guard_worker = SessionGuardWorker(
            str(self.profile_uid),
            self._desktop_session_id,
            tier,
            email,
        )
        self._session_guard_worker.finished.connect(self._on_session_guard_finished)
        self._session_guard_worker.start()

    def _on_session_guard_finished(self, is_active: bool) -> None:
        if is_active or self._remote_logout_in_progress:
            return
        self._remote_logout_in_progress = True
        self._close_sidebar()
        self._apply_local_logout_state()
        QMessageBox.information(
            self,
            "\uC138\uC158 \uC885\uB8CC",
            "\uD604\uC7AC PC\uC5D0\uC11C \uC138\uC158\uC774 \uC885\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.\n"
            "\uACC4\uC18D \uC774\uC6A9\uD558\uB824\uBA74 \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694.",
        )
        self._remote_logout_in_progress = False

    def _apply_local_logout_state(self) -> None:
        logout_user()
        self._post_login_sync_timer.stop()
        self._post_login_sync_attempts_left = 0
        self._profile_refresh_force_pending = False
        self.profile_uid = None
        self.profile_display_name = "\uC0AC\uC6A9\uC790"
        self.profile_plan = "Free"
        self.profile_avatar_url = None
        self._profile_usage = 0
        self._profile_usage_last_refresh = 0.0
        self._update_user_status(refresh=False)

    def _refresh_profile_from_firebase(self) -> None:
        """Refresh latest profile data from Firebase."""
        if not self.profile_uid:
            return
        self._schedule_profile_refresh(force=True)

    def _update_user_status(self, refresh: bool = True) -> None:
        """???????????? ?????????????????? + ???????????"""
        _tier_map = {
            "Free": "\uBB34\uB8CC", "free": "\uBB34\uB8CC",
            "Standard": "Standard", "Plus": "PLUS",
            "Pro": "Ultra \uD50C\uB79C", "pro": "Ultra \uD50C\uB79C", "ultra": "Ultra \uD50C\uB79C",
        }
        if self.profile_uid:
            tier = self.profile_plan or "Free"
            usage = self._profile_usage
            limit = get_plan_limit(tier)
            user = get_stored_user()
            email = user.get("email", "") if user else ""
            self._sidebar.update_user_info(
                uid=self.profile_uid,
                name=self.profile_display_name,
                email=email,
                tier=tier,
                usage=usage,
                limit=limit,
                avatar_url=self.profile_avatar_url,
            )
            # ??? ????????????????
            t_label = _tier_map.get(tier, tier)
            _tier_colors = {
                "Free": "#6366f1", "free": "#6366f1",
                "Standard": "#8b5cf6", "standard": "#8b5cf6",
                "Plus": "#8b5cf6", "plus": "#8b5cf6",
                "Pro": "#8b5cf6", "pro": "#8b5cf6", "ultra": "#8b5cf6",
            }
            accent = _tier_colors.get(tier, "#6366f1")
            self._header_name.setText(self.profile_display_name or "\uC0AC\uC6A9\uC790")
            self._header_plan.setText(t_label)
            self._header_plan.setVisible(False)
            self._header_user_area.setVisible(False)
            if refresh:
                self._schedule_profile_refresh()
        else:
            self._sidebar.update_user_info(
                uid=None, name="", email="", tier="Free",
                usage=0, limit=5,
            )
            self._header_name.setText("\uB85C\uADF8\uC778")
            self._header_plan.setText("")
            self._header_plan.setVisible(False)
            self._header_user_area.setVisible(False)
        self._update_send_button_state()

    def _on_login_clicked(self) -> None:
        """Handle login button click and start OAuth flow."""
        self._close_sidebar()
        self._sidebar._login_btn.setEnabled(False)
        self._sidebar._login_btn.setText("\uB85C\uADF8\uC778 \uC911..")
        
        # ??????????OAuth ????????
        self._login_worker = LoginWorker()
        self._login_worker.finished.connect(self._on_login_finished)
        self._login_worker.start()

    def _on_login_finished(self, success: bool) -> None:
        """OAuth ???????"""
        self._sidebar._login_btn.setEnabled(True)
        self._sidebar._login_btn.setText("\uB85C\uADF8\uC778")
        
        if success:
            self._load_stored_user()
            self._register_desktop_session_if_needed()
            self._update_user_status(refresh=False)
            dlg = LoginResultDialog(self, success=True, user_name=self.profile_display_name)
            dlg.exec()
            # Retry profile sync a few times after login to absorb web-state propagation delay.
            self._start_post_login_profile_sync()
        else:
            dlg = LoginResultDialog(self, success=False)
            dlg.exec()

    def _start_post_login_profile_sync(self) -> None:
        if not self.profile_uid:
            return
        self._post_login_sync_timer.stop()
        self._post_login_sync_attempts_left = 4
        self._schedule_profile_refresh(force=True)
        self._post_login_sync_timer.start(1200)

    def _run_post_login_profile_sync(self) -> None:
        if not self.profile_uid:
            self._post_login_sync_attempts_left = 0
            return
        if self._post_login_sync_attempts_left <= 0:
            return
        self._post_login_sync_attempts_left -= 1
        self._schedule_profile_refresh(force=True)
        if self._post_login_sync_attempts_left > 0:
            self._post_login_sync_timer.start(1200)

    def _on_logout_clicked(self) -> None:
        """????? ?? ???"""
        self._close_sidebar()
        dlg = LogoutDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._apply_local_logout_state()

    # ???? ??? ????? ??? ??????????????????????????????????????????????????????????
    def _on_download_form_clicked(self) -> None:
        """??? ??? ????? ?? ???"""
        dlg = DownloadFormDialog(self)
        dlg.exec()

    # ???? Header user area click ????????????????????????????????????????????????
    def _on_header_user_clicked(self) -> None:
        """??? ???????? ??? ?????????????? ??"""
        if self.profile_uid:
            self._toggle_usage_popup()
        else:
            self._on_login_clicked()

    def _on_header_mode_clicked(self) -> None:
        if getattr(self, "_main_mode", "typing") == "typing":
            self._set_main_mode("chat")
        else:
            self._set_main_mode("typing")

    def _set_main_mode(self, mode: str) -> None:
        next_mode = "chat" if mode == "chat" else "typing"
        self._main_mode = next_mode
        if not hasattr(self, "_content_stack"):
            return

        if next_mode == "chat":
            self._content_stack.setCurrentWidget(self._chat_page)
            self._header_mode_btn.setText("AI 타이핑 이동하기")
            self._header_mode_btn.setToolTip("자동 타이핑 화면으로 이동")
            if hasattr(self, "_chat_input"):
                self._chat_input.setFocus()
        else:
            self._content_stack.setCurrentWidget(self._typing_page)
            self._header_mode_btn.setText("AI 채팅 편집")
            self._header_mode_btn.setToolTip("AI 채팅 화면으로 이동")

        self._update_typing_style_bar_mode()

    # ???? Usage popup helpers ????????????????????????????????????????????????????????
    def _toggle_usage_popup(self) -> None:
        """????????????????"""
        self._show_usage_dialog()

    # ???? Sidebar helpers ??????????????????????????????????????????????????????????????????
    def _toggle_sidebar(self) -> None:
        if self._sidebar.isVisible():
            self._close_sidebar()
        else:
            self._open_sidebar()

    def _open_sidebar(self) -> None:
        self._sidebar_overlay.setGeometry(0, 0, self.width(), self.height())
        self._sidebar.setGeometry(0, 0, 300, self.height())
        self._sidebar_overlay.show()
        self._sidebar_overlay.raise_()  # above header
        self._sidebar.show()
        self._sidebar.raise_()          # above overlay

    def _close_sidebar(self) -> None:
        self._sidebar.hide()
        self._sidebar_overlay.hide()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        self._update_typing_style_bar_mode()
        if hasattr(self, "_header_bar"):
            self._header_bar.setGeometry(0, 6, self.width(), 48)
            self._header_bar.raise_()
        if hasattr(self, "_header_user_btn") and hasattr(self, "_header_user_area"):
            self._header_user_btn.setGeometry(
                0, 0, self._header_user_area.width(), self._header_user_area.height()
            )
        
        if hasattr(self, "_sidebar_overlay") and self._sidebar_overlay.isVisible():
            self._sidebar_overlay.setGeometry(0, 0, self.width(), self.height())
        if hasattr(self, "_sidebar") and self._sidebar.isVisible():
            self._sidebar.setGeometry(0, 0, 300, self.height())

    def _on_sidebar_menu(self, menu_id: str) -> None:
        self._close_sidebar()
        if menu_id == "download_form":
            self._on_download_form_clicked()
        elif menu_id == "profile":
            self._show_profile_dialog()
        elif menu_id == "usage":
            self._show_usage_dialog()
        elif menu_id == "upgrade":
            import webbrowser
            webbrowser.open("https://www.nova-ai.work/profile?tab=subscription")
        elif menu_id == "homepage":
            import webbrowser
            webbrowser.open("https://nova-ai.work")
        elif menu_id == "inquiry":
            import webbrowser
            webbrowser.open("https://open.kakao.com/o/sVWlO2fi")

    def _show_profile_dialog(self) -> None:
        if not self.profile_uid:
            NeedLoginDialog(self, title="\uB85C\uADF8\uC778 \uD544\uC694").exec()
            return
        user = get_stored_user()
        email = user.get("email", "-") if user else "-"
        ProfileDialog(
            self,
            name=self.profile_display_name,
            email=email,
            tier=self.profile_plan or "Free",
            uid=self.profile_uid,
        ).exec()

    def _show_usage_dialog(self) -> None:
        if not self.profile_uid:
            NeedLoginDialog(self, title="\uB85C\uADF8\uC778 \uD544\uC694").exec()
            return
        tier = self.profile_plan or "Free"
        UsageDialog(
            self,
            tier=tier,
            usage=self._profile_usage,
            limit=get_plan_limit(tier),
        ).exec()
        self._schedule_profile_refresh()

    def _show_about_dialog(self) -> None:
        QMessageBox.about(
            self,
            "Nova AI \uC18C\uAC1C",
            "Nova AI v1.0\n\n"
            "\uC218\uB2A5 \uD615\uC2DD \uD0C0\uC774\uD551 AI\n\n"
            "https://nova-ai.work",
        )

    def _tick_status_animation(self) -> None:
        try:
            self._order_delegate.advance()
            self.order_list.viewport().update()
        except Exception:
            pass

    def _connect(self) -> HwpController:
        controller = HwpController()
        controller.connect()
        return controller

    def update_filename(self) -> None:
        self._schedule_filename_update()

    def _schedule_filename_update(self) -> None:
        if self._filename_worker and self._filename_worker.isRunning():
            self._filename_update_pending = True
            return
        self._filename_update_pending = False
        if self._filename_worker is None:
            self._filename_worker = FilenameWorker()
            self._filename_worker.result.connect(self._on_filename_result)
        self._filename_worker.start()

    def _on_filename_result(self, filename: str, cur_page: int, total_page: int) -> None:
        if filename:
            HwpController.set_last_detected_filename(filename)
            self.filename_label.setText(filename)
            if hasattr(self, "_chat_filename_label"):
                self._chat_filename_label.setText(filename)
            self.filename_label.setStyleSheet(
                "color: #3B82F6; font-size: 12px; font-weight: 700; background: transparent;"
            )
            if hasattr(self, "_chat_filename_label"):
                self._chat_filename_label.setStyleSheet(
                    "color: #3B82F6; font-size: 12px; font-weight: 700; background: transparent;"
                )
            self._filename_icon.setPixmap(
                _material_icon("\ue873", 18, QColor("#3b82f6")).pixmap(QSize(18, 18))
            )
            if hasattr(self, "_chat_filename_icon"):
                self._chat_filename_icon.setPixmap(
                    _material_icon("\ue873", 18, QColor("#3b82f6")).pixmap(QSize(18, 18))
                )
            self._filename_chip.setStyleSheet(
                "QFrame#filenameChip { background-color: #dbeafe; border: 1px solid #93c5fd; border-radius: 16px; }"
            )
            if hasattr(self, "_chat_filename_chip"):
                self._chat_filename_chip.setStyleSheet(
                    "QFrame#chatFilenameChip { background-color: #dbeafe; border: 1px solid #93c5fd; border-radius: 16px; }"
                )
            if cur_page > 0:
                self._page_label.setText(
                    f"{cur_page}/{total_page} page" if total_page > 0
                    else f"{cur_page} page"
                )
                self._page_badge.setVisible(True)
                if hasattr(self, "_chat_page_label"):
                    self._chat_page_label.setText(
                        f"{cur_page}/{total_page} page" if total_page > 0
                        else f"{cur_page} page"
                    )
                if hasattr(self, "_chat_page_badge"):
                    self._chat_page_badge.setVisible(True)
            else:
                self._page_badge.setVisible(False)
                if hasattr(self, "_chat_page_badge"):
                    self._chat_page_badge.setVisible(False)
        else:
            HwpController.set_last_detected_filename("")
            self.filename_label.setText("\uAC10\uC9C0 \uD30C\uC77C \uC5C6\uC74C")
            if hasattr(self, "_chat_filename_label"):
                self._chat_filename_label.setText("\uAC10\uC9C0 \uD30C\uC77C \uC5C6\uC74C")
            self.filename_label.setStyleSheet(
                "color: #9ca3af; font-size: 12px; font-weight: 500; background: transparent;"
            )
            if hasattr(self, "_chat_filename_label"):
                self._chat_filename_label.setStyleSheet(
                    "color: #9ca3af; font-size: 12px; font-weight: 500; background: transparent;"
                )
            self._filename_icon.setPixmap(
                _material_icon("\ue873", 18, QColor("#b0b4c0")).pixmap(QSize(18, 18))
            )
            if hasattr(self, "_chat_filename_icon"):
                self._chat_filename_icon.setPixmap(
                    _material_icon("\ue873", 18, QColor("#b0b4c0")).pixmap(QSize(18, 18))
                )
            self._filename_chip.setStyleSheet(
                "QFrame#filenameChip { background-color: #f0f0f0; border: 1px solid #d4d4d4; border-radius: 16px; }"
            )
            if hasattr(self, "_chat_filename_chip"):
                self._chat_filename_chip.setStyleSheet(
                    "QFrame#chatFilenameChip { background-color: #f0f0f0; border: 1px solid #d4d4d4; border-radius: 16px; }"
                )
            self._page_badge.setVisible(False)
            if hasattr(self, "_chat_page_badge"):
                self._chat_page_badge.setVisible(False)

        if self._filename_update_pending:
            self._filename_update_pending = False
            QTimer.singleShot(0, self._schedule_filename_update)

    def _schedule_profile_refresh(self, force: bool = False) -> None:
        if not self.profile_uid:
            return
        now = time.time()
        if not force and (now - self._profile_usage_last_refresh) < 30:
            return
        if self._profile_worker and self._profile_worker.isRunning():
            if force:
                self._profile_refresh_force_pending = True
            return
        self._profile_refresh_force_pending = False
        self._profile_worker = ProfileRefreshWorker(self.profile_uid, force_usage_refresh=force)
        self._profile_worker.finished.connect(self._on_profile_refreshed)
        self._profile_worker.start()

    def _on_profile_refreshed(self, profile: dict, usage: int) -> None:
        if profile:
            self.profile_plan = (
                profile.get("plan")
                or profile.get("tier")
                or self.profile_plan
            )
            self.profile_display_name = profile.get("display_name") or self.profile_display_name
            self.profile_avatar_url = profile.get("photo_url") or self.profile_avatar_url
        self._register_desktop_session_if_needed()
        self._profile_usage = max(0, int(usage or 0))
        self._profile_usage_last_refresh = time.time()
        self._update_user_status(refresh=False)
        if self._profile_refresh_force_pending and self.profile_uid:
            self._profile_refresh_force_pending = False
            QTimer.singleShot(0, lambda: self._schedule_profile_refresh(force=True))

    def on_upload_image(self) -> None:
        file_paths, _ = QFileDialog.getOpenFileNames(
            self,
            "\uC774\uBBF8\uC9C0 \uC120\uD0DD",
            "",
            "Images (*.png *.jpg *.jpeg *.bmp *.gif *.webp *.pdf);;All Files (*)",
        )
        if file_paths:
            self._set_selected_images(file_paths)

    def _on_files_dropped(self, file_paths: list[str]) -> None:
        if file_paths:
            self._set_selected_images(file_paths)

    def _append_chat_message(self, role: str, text: str) -> None:
        message = (text or "").strip()
        if not message:
            return
        if not hasattr(self, "_chat_thread"):
            return
        prefix = "나" if role == "user" else ("AI" if role == "assistant" else "시스템")
        item = QListWidgetItem(f"{prefix}: {message}")
        if role == "user":
            item.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            item.setForeground(QColor("#1d4ed8"))
            item.setBackground(QColor("#dbeafe"))
        elif role == "assistant":
            item.setTextAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            item.setForeground(QColor("#111827"))
            item.setBackground(QColor("#f3f4f6"))
        else:
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            item.setForeground(QColor("#6b7280"))
            item.setBackground(QColor("#eef2ff"))
        self._chat_thread.addItem(item)
        self._chat_thread.scrollToBottom()

    def _set_chat_busy(self, busy: bool) -> None:
        self._chat_send_btn.setEnabled(not busy)
        self._chat_input.setEnabled(not busy)
        if busy:
            self._chat_input.setPlaceholderText("AI가 편집 요청을 처리중입니다...")
        else:
            self._chat_input.setPlaceholderText("예: 새 파일을 열어줘")

    def _on_chat_send_clicked(self) -> None:
        if self._chat_worker and self._chat_worker.isRunning():
            return
        message = self._chat_input.text().strip()
        if not message:
            return
        self._append_chat_message("user", message)
        self._append_chat_message("status", "AI가 해석중...")
        self._chat_input.clear()
        self._set_chat_busy(True)
        current_filename = self._current_detected_filename() or ""
        self._chat_worker = ChatWorker(message, current_filename)
        self._chat_worker.finished.connect(self._on_chat_worker_finished)
        self._chat_worker.error.connect(self._on_chat_worker_error)
        self._chat_worker.start()

    def _execute_chat_actions(self, actions: list[dict[str, str]]) -> list[str]:
        logs: list[str] = []
        for action in actions:
            if not isinstance(action, dict):
                continue
            name = str(action.get("name") or "").strip()
            if name == "open_new_file":
                try:
                    controller = HwpController()
                    controller.connect()
                    controller.open_new_document()
                    logs.append("새 파일을 열었습니다.")
                    self._schedule_filename_update()
                except Exception as exc:
                    logs.append(f"새 파일 열기에 실패했습니다: {exc}")
            elif name:
                logs.append(f"지원하지 않는 편집 명령입니다: {name}")
        return logs

    def _on_chat_worker_finished(self, payload: object) -> None:
        self._chat_worker = None
        reply = ""
        actions: list[dict[str, str]] = []
        if isinstance(payload, dict):
            reply = str(payload.get("reply") or "").strip()
            raw_actions = payload.get("actions")
            if isinstance(raw_actions, list):
                actions = [a for a in raw_actions if isinstance(a, dict)]
        if actions:
            self._append_chat_message("status", "적용하는 중...")
        action_logs = self._execute_chat_actions(actions)
        for log in action_logs:
            self._append_chat_message("status", log)
        if not reply:
            reply = "처리를 완료했습니다."
        self._append_chat_message("assistant", reply)
        self._set_chat_busy(False)

    def _on_chat_worker_error(self, message: str) -> None:
        self._set_chat_busy(False)
        self._chat_worker = None
        self._append_chat_message("assistant", f"요청 처리 중 오류가 발생했습니다: {message}")

    def on_ai_run(self) -> None:
        self._start_ai_run(auto_type=False)

    def on_ai_type_run(self) -> None:
        if self._image_mode == "ai_generate":
            self._set_typing_status("AI 코드/이미지 생성중...")
        elif self._image_mode == "no_image":
            self._set_typing_status("AI 코드 생성중...(이미지 없음)")
        else:
            self._set_typing_status("AI \uC0DD\uC131\uC911...")
        # Hide generated code preview when using "send" flow.
        self._generated_container.setVisible(False)
        self._start_ai_run(auto_type=True)

    def _start_ai_run(self, auto_type: bool) -> None:
        if not self.selected_images:
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uC774\uBBF8\uC9C0\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574\uC8FC\uC138\uC694.")
            return
        remaining = self._get_remaining_send_quota()
        if remaining <= 0:
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uB0A8\uC740 \uC0AC\uC6A9 \uD69F\uC218\uAC00 \uC5C6\uC5B4 \uC2E4\uD589\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        if len(self.selected_images) > remaining:
            exceeded = len(self.selected_images) - remaining
            QMessageBox.warning(
                self,
                "\uC54C\uB9BC",
                f"\uD604\uC7AC \uB0A8\uC740 \uD69F\uC218\uB294 {remaining}\uD68C\uC785\uB2C8\uB2E4.\n"
                f"\uC120\uD0DD\uD55C {len(self.selected_images)}\uAC1C \uC911 {exceeded}\uAC1C\uB294 \uC81C\uC678\uB429\uB2C8\uB2E4.\n"
                "\uB0A8\uC740 \uD69F\uC218 \uB0B4\uC5D0\uC11C\uB9CC \uCC98\uB9AC\uB429\uB2C8\uB2E4.",
            )
            return
        if self._ai_worker and self._ai_worker.isRunning():
            return
        # Prevent reordering/removal while generation is running.
        self._set_order_editable(False)
        if hasattr(self, "_image_mode_combo"):
            self._image_mode_combo.setEnabled(False)
        if hasattr(self, "_image_mode_combo_compact"):
            self._image_mode_combo_compact.setEnabled(False)
        self._auto_type_after_ai = auto_type
        self.generated_code = ""
        self.generated_codes = []
        self._generated_codes_by_index = [""] * len(self.selected_images)
        self._gen_statuses = ["\uB300\uAE30\uC911"] * len(self.selected_images)
        self._typed_indexes = set()
        self._next_auto_type_index = 0
        self._auto_type_has_inserted_any = False
        self._skipped_indexes = set()
        self._ai_error_messages = {}
        self._render_order_list()
        self.code_view.setPlainText("")
        self._ai_worker = AIWorker(
            self.selected_images,
            image_mode=self._image_mode,
        )
        self._ai_worker.finished.connect(self._on_ai_finished)
        self._ai_worker.error.connect(self._on_ai_error)
        self._ai_worker.progress.connect(self._on_ai_progress)
        self._ai_worker.item_finished.connect(self._on_ai_item_finished)
        self._ai_worker.start()

    def on_type_run(self) -> None:
        if not self.generated_codes and not self.generated_code.strip():
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uBA3C\uC800 AI \uCF54\uB4DC \uC0DD\uC131\uC744 \uC2E4\uD589\uD574\uC8FC\uC138\uC694.")
            return
        script = self._build_typing_script()
        if not script.strip():
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uD0C0\uC774\uD551\uD560 \uCF54\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        self._ensure_typing_worker()
        target_filename = self._current_detected_filename()
        self._typing_worker.enqueue(-1, script, target_filename)

    def _render_order_list(self) -> None:
        self.order_list.clear()
        if not self.selected_images:
            self.order_title.setText("")
            self._update_replay_button_visibility()
            return
        self.order_title.setText("\uD0C0\uC774\uD551 \uC21C\uC11C:")
        for idx, path in enumerate(self.selected_images):
            name = os.path.basename(path)
            status = self._gen_statuses[idx] if idx < len(self._gen_statuses) else "\uB300\uAE30\uC911"
            item = QListWidgetItem(f"{idx + 1}. {name} - {status}")
            item.setData(Qt.ItemDataRole.UserRole, path)
            self.order_list.addItem(item)
        self._update_replay_button_visibility()

    def _on_ai_progress(self, idx: int, status: str) -> None:
        if idx < 0:
            return
        if idx >= len(self._gen_statuses):
            self._gen_statuses.extend(["\uB300\uAE30\uC911"] * (idx + 1 - len(self._gen_statuses)))
        normalized_status = status
        if status.startswith("\uC624\uB958"):
            raw_message = status.replace("\uC624\uB958:", "").strip() if ":" in status else status
            clean_message = _normalize_runtime_error_message(raw_message)
            normalized_status = f"\uC624\uB958({clean_message})"
            self._ai_error_messages[idx] = clean_message or "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958"
        self._gen_statuses[idx] = normalized_status
        self._render_order_list()

    def _run_typing(self) -> None:
        # Deprecated: typing now runs in a worker thread to allow ESC cancellation.
        self.on_type_run()

    def _run_typing_script(self, script: str) -> None:
        # Deprecated: typing now runs in a worker thread to allow ESC cancellation.
        if not script.strip():
            return
        self._ensure_typing_worker()
        target_filename = self._current_detected_filename()
        self._typing_worker.enqueue(-1, script, target_filename)

    def _build_typing_script(self) -> str:
        if self.generated_codes:
            cleaned = [code.strip() for code in self.generated_codes if code.strip()]
            separator = "\ninsert_enter()\n" * 4
            return separator.join(cleaned)
        return self.generated_code

    def _on_ai_item_finished(self, idx: int, text: str) -> None:
        """Called when a single image's code generation finishes (success or fail)."""
        if idx < 0:
            return
        if idx >= len(self._generated_codes_by_index):
            # Defensive: keep arrays consistent.
            self._generated_codes_by_index.extend([""] * (idx + 1 - len(self._generated_codes_by_index)))
        self._generated_codes_by_index[idx] = (text or "").strip()
        if idx < len(self.generated_codes):
            self.generated_codes[idx] = self._generated_codes_by_index[idx]
        if idx == self._current_code_index:
            if not self.code_view.hasFocus() or not self.code_view.toPlainText().strip():
                self._set_code_view_text(self._generated_codes_by_index[idx])
            self._update_code_type_button_state()
        # Auto-typing: type incrementally in order as soon as possible.
        if self._auto_type_after_ai:
            self._try_auto_type()

    def _try_auto_type(self) -> None:
        """Type completed items in order while generation continues."""
        if not self._auto_type_after_ai:
            return
        total = len(self.selected_images)
        if total <= 0:
            return
        if self._auto_type_pending_idx is not None:
            return

        # Type sequentially (1 -> 2 -> 3 ...) only when each is ready.
        while self._next_auto_type_index < total and self._auto_type_pending_idx is None:
            idx = self._next_auto_type_index

            status = self._gen_statuses[idx] if idx < len(self._gen_statuses) else "\uB300\uAE30\uC911"
            # Not ready yet (still generating or not started).
            if status in ("\uB300\uAE30\uC911", "\uC0DD\uC131\uC911..."):
                self._set_typing_status("\uC0DD\uC131 \uC644\uB8CC \uB300\uAE30\uC911...")
                return

            code = (self._generated_codes_by_index[idx] or "").strip()
            # If generation failed/empty, skip and continue to the next item.
            if not code:
                if idx not in self._skipped_indexes:
                    self._skipped_indexes.add(idx)
                    if idx < len(self._gen_statuses):
                        self._gen_statuses[idx] = "\uAC74\uB108\uB700(\uCF54\uB4DC \uC5C6\uC74C)"
                    self._render_order_list()
                self._next_auto_type_index += 1
                continue

            separator = ""
            if self._auto_type_has_inserted_any:
                separator = "insert_enter()\n" * 4
            script = f"{separator}{code}\n"

            self._ensure_typing_worker()
            self._auto_type_pending_idx = idx
            if idx < len(self._gen_statuses):
                self._gen_statuses[idx] = "\uD0C0\uC774\uD551\uC911..."
            self._render_order_list()
            self._set_typing_status("\uD0C0\uC774\uD551 \uC9C4\uD589\uC911...")
            target_filename = self._current_detected_filename()
            # Pass original image path so insert_cropped_image can crop from it
            src_img = self.selected_images[idx] if idx < len(self.selected_images) else None
            self._typing_worker.enqueue(idx, script, target_filename, src_img)
            return

    def _on_ai_finished(self, results: object) -> None:
        if not isinstance(results, list):
            results = [results]
        raw_codes = [str(item or "").strip() for item in results]

        total = len(self.selected_images)
        if len(raw_codes) < total:
            raw_codes.extend([""] * (total - len(raw_codes)))
        raw_codes = raw_codes[:total]

        self._generated_codes_by_index = raw_codes
        ok_count = sum(1 for c in raw_codes if c.strip())
        all_ok = (total > 0) and (ok_count == total)

        self._render_order_list()

        # Store results for manual typing as well.
        self.generated_codes = raw_codes
        self.generated_code = raw_codes[0] if total == 1 else ""

        # Ensure any remaining ready items are typed (in case signals arrived late).
        if self._auto_type_after_ai:
            self._try_auto_type()
            if self._next_auto_type_index >= total and self._auto_type_pending_idx is None:
                self._auto_type_after_ai = False
                self._set_typing_status("")

        if not all_ok:
            failed_indexes = [i + 1 for i, code in enumerate(raw_codes) if not code.strip()]
            details: list[str] = []
            for i in failed_indexes:
                msg = self._ai_error_messages.get(i - 1, "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958")
                details.append(f"{i}\uBC88: {msg}")
            detail_text = "\n".join(details)
            QMessageBox.warning(
                self,
                "\uC624\uB958",
                f"\uB2E4\uC74C \uD56D\uBAA9\uC5D0\uC11C \uCF54\uB4DC \uC0DD\uC131\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4: {failed_indexes}\n"
                f"{detail_text}\n"
                "\uC6D0\uBCF8 \uBB38\uC11C/\uC774\uBBF8\uC9C0\uB97C \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.",
            )
        self._set_order_editable(True)
        if hasattr(self, "_image_mode_combo"):
            self._image_mode_combo.setEnabled(True)
        if hasattr(self, "_image_mode_combo_compact"):
            self._image_mode_combo_compact.setEnabled(True)
        self._update_code_type_button_state()
        
        # ??? ???????????
        self._update_user_status(refresh=False)
        self._schedule_profile_refresh(force=True)

    def _on_ai_error(self, message: str) -> None:
        self._render_order_list()
        QMessageBox.critical(self, "AI \uC624\uB958", message)
        self._auto_type_after_ai = False
        self._set_order_editable(True)
        if hasattr(self, "_image_mode_combo"):
            self._image_mode_combo.setEnabled(True)
        if hasattr(self, "_image_mode_combo_compact"):
            self._image_mode_combo_compact.setEnabled(True)
        
        # ??? ???????????
        self._update_user_status(refresh=False)
        self._schedule_profile_refresh(force=True)

    @staticmethod
    def _normalize_size_text(text: str) -> str:
        return (text or "").strip().lower().replace("pt", "").strip()

    @staticmethod
    def _parse_text_font_size_value(text: str, fallback: float) -> float:
        normalized = NovaAILiteWindow._normalize_size_text(text)
        try:
            value = float(normalized)
            return max(1.0, value)
        except Exception:
            return fallback

    @staticmethod
    def _parse_eq_font_size_value(text: str, fallback: float) -> float:
        normalized = NovaAILiteWindow._normalize_size_text(text)
        if normalized.isdigit():
            return max(1.0, float(int(normalized)))
        return fallback

    @staticmethod
    def _format_text_font_size(value: float) -> str:
        return f"{max(1.0, float(value)):.1f}"

    @staticmethod
    def _format_eq_font_size(value: float) -> str:
        return f"{max(1, int(value))}"

    def _apply_typing_styles_to_worker(self) -> None:
        if self._typing_worker is None:
            return
        self._typing_worker.set_typing_styles(
            text_font_name=self._typing_text_font_name,
            text_font_size_pt=self._typing_text_font_size_pt,
            eq_font_name=self._typing_eq_font_name,
            eq_font_size_pt=self._typing_eq_font_size_pt,
        )

    def _sync_typing_style_controls(
        self,
        *,
        source: str,
        text_font_name: str,
        text_font_size_text: str,
        eq_font_name: str,
        eq_font_size_text: str,
    ) -> None:
        if source != "main":
            updates_main = (
                (self._typing_text_font_combo, text_font_name),
                (self._typing_text_size_combo, text_font_size_text),
                (self._typing_eq_font_combo, eq_font_name),
                (self._typing_eq_size_combo, eq_font_size_text),
            )
            for combo, value in updates_main:
                was_blocked = combo.blockSignals(True)
                combo.setCurrentText(value)
                combo.blockSignals(was_blocked)
        if source != "compact":
            updates_compact = (
                (self._typing_text_font_combo_compact, text_font_name),
                (self._typing_text_size_combo_compact, text_font_size_text),
                (self._typing_eq_font_combo_compact, eq_font_name),
                (self._typing_eq_size_combo_compact, eq_font_size_text),
            )
            for combo, value in updates_compact:
                was_blocked = combo.blockSignals(True)
                combo.setCurrentText(value)
                combo.blockSignals(was_blocked)

    @staticmethod
    def _image_mode_text(mode_key: str) -> str:
        mapping = {
            "no_image": "이미지 없이 생성하기",
            "crop": "이미지 크롭해서 생성하기",
            "ai_generate": "AI 이미지 생성하기",
        }
        return mapping.get(mode_key, mapping["crop"])

    @staticmethod
    def _image_mode_key_from_text(text: str) -> str:
        mapping = {
            "이미지 없이 생성하기": "no_image",
            "이미지 크롭해서 생성하기": "crop",
            "AI 이미지 생성하기": "ai_generate",
        }
        return mapping.get((text or "").strip(), "crop")

    def _sync_image_mode_controls(self, *, source: str, mode_key: str) -> None:
        mode_text = self._image_mode_text(mode_key)
        if source != "main" and hasattr(self, "_image_mode_combo"):
            blocked = self._image_mode_combo.blockSignals(True)
            self._image_mode_combo.setCurrentText(mode_text)
            self._image_mode_combo.blockSignals(blocked)
        if source != "compact" and hasattr(self, "_image_mode_combo_compact"):
            blocked = self._image_mode_combo_compact.blockSignals(True)
            self._image_mode_combo_compact.setCurrentText(mode_text)
            self._image_mode_combo_compact.blockSignals(blocked)

    def _on_image_mode_changed(self) -> None:
        if not hasattr(self, "_image_mode_combo"):
            return
        key = self._image_mode_key_from_text(self._image_mode_combo.currentText())
        self._image_mode = key
        self._sync_image_mode_controls(source="main", mode_key=key)

    def _on_image_mode_changed_compact(self) -> None:
        if not hasattr(self, "_image_mode_combo_compact"):
            return
        key = self._image_mode_key_from_text(self._image_mode_combo_compact.currentText())
        self._image_mode = key
        self._sync_image_mode_controls(source="compact", mode_key=key)

    def _update_typing_style_bar_mode(self) -> None:
        if not hasattr(self, "_typing_style_bar") or not hasattr(self, "_typing_style_bar_compact"):
            return
        if getattr(self, "_main_mode", "typing") != "typing":
            self._typing_style_bar.setVisible(False)
            self._typing_style_bar_compact.setVisible(False)
            return
        use_compact = self.width() < self._typing_style_compact_breakpoint_px
        self._relocate_doc_meta_widgets(use_compact)
        self._typing_style_bar.setVisible(not use_compact)
        self._typing_style_bar_compact.setVisible(use_compact)

    def _relocate_doc_meta_widgets(self, use_compact: bool) -> None:
        if (
            not hasattr(self, "_filename_chip")
            or not hasattr(self, "_page_badge")
            or not hasattr(self, "_top_action_row")
        ):
            return
        target_row = self._top_action_row
        target_row.insertWidget(0, self._filename_chip)
        target_row.insertWidget(1, self._page_badge)

    def _on_typing_style_changed(self) -> None:
        text_font_name = self._typing_text_font_combo.currentText().strip() or "HYhwpEQ"
        text_font_size_val = self._parse_text_font_size_value(
            self._typing_text_size_combo.currentText(),
            self._typing_text_font_size_pt,
        )
        text_font_size_text = self._format_text_font_size(text_font_size_val)
        eq_font_name = self._typing_eq_font_combo.currentText().strip() or "HYhwpEQ"
        eq_font_size_val = self._parse_eq_font_size_value(
            self._typing_eq_size_combo.currentText(),
            self._typing_eq_font_size_pt,
        )
        eq_font_size_text = self._format_eq_font_size(eq_font_size_val)
        self._sync_typing_style_controls(
            source="main",
            text_font_name=text_font_name,
            text_font_size_text=text_font_size_text,
            eq_font_name=eq_font_name,
            eq_font_size_text=eq_font_size_text,
        )
        self._typing_text_font_name = text_font_name
        self._typing_text_font_size_pt = text_font_size_val
        self._typing_eq_font_name = eq_font_name
        self._typing_eq_font_size_pt = eq_font_size_val
        self._apply_typing_styles_to_worker()

    def _on_typing_style_changed_compact(self) -> None:
        text_font_name = self._typing_text_font_combo_compact.currentText().strip() or "HYhwpEQ"
        text_font_size_val = self._parse_text_font_size_value(
            self._typing_text_size_combo_compact.currentText(),
            self._typing_text_font_size_pt,
        )
        text_font_size_text = self._format_text_font_size(text_font_size_val)
        eq_font_name = self._typing_eq_font_combo_compact.currentText().strip() or "HYhwpEQ"
        eq_font_size_val = self._parse_eq_font_size_value(
            self._typing_eq_size_combo_compact.currentText(),
            self._typing_eq_font_size_pt,
        )
        eq_font_size_text = self._format_eq_font_size(eq_font_size_val)
        self._sync_typing_style_controls(
            source="compact",
            text_font_name=text_font_name,
            text_font_size_text=text_font_size_text,
            eq_font_name=eq_font_name,
            eq_font_size_text=eq_font_size_text,
        )
        self._typing_text_font_name = text_font_name
        self._typing_text_font_size_pt = text_font_size_val
        self._typing_eq_font_name = eq_font_name
        self._typing_eq_font_size_pt = eq_font_size_val
        self._apply_typing_styles_to_worker()

    def _ensure_typing_worker(self) -> None:
        if self._typing_worker and self._typing_worker.isRunning():
            self._apply_typing_styles_to_worker()
            return
        self._typing_worker = TypingWorker()
        self._typing_worker.item_started.connect(self._on_typing_item_started)
        self._typing_worker.item_finished.connect(self._on_typing_item_finished)
        self._typing_worker.cancelled.connect(self._on_typing_cancelled)
        self._typing_worker.error.connect(self._on_typing_error)
        self._apply_typing_styles_to_worker()
        self._typing_worker.start()

    def _on_typing_item_started(self, idx: int) -> None:
        if idx >= 0 and idx < len(self._gen_statuses):
            self._gen_statuses[idx] = "\uD0C0\uC774\uD551\uC911..."
            self._render_order_list()
        self._set_typing_status("\uD0C0\uC774\uD551 \uC9C4\uD589\uC911...")

    def _on_typing_item_finished(self, idx: int) -> None:
        if idx >= 0 and idx < len(self._gen_statuses):
            self._gen_statuses[idx] = "\uD0C0\uC774\uD551 \uC644\uB8CC"
            self._render_order_list()
        if idx >= 0 and self._auto_type_pending_idx == idx:
            self._auto_type_pending_idx = None
            self._auto_type_has_inserted_any = True
            self._next_auto_type_index = idx + 1
            if self._auto_type_after_ai:
                self._try_auto_type()
            if self._next_auto_type_index >= len(self.selected_images):
                self._auto_type_after_ai = False
                self._set_typing_status("\uD0C0\uC774\uD551 \uC644\uB8CC")
                return
        if not self._auto_type_after_ai and self._auto_type_pending_idx is None:
            self._set_typing_status("\uD0C0\uC774\uD551 \uC644\uB8CC")

    def _on_typing_cancelled(self) -> None:
        # Stop auto-type chain, keep generated code for manual re-run.
        pending_idx = self._auto_type_pending_idx
        self._auto_type_after_ai = False
        self._auto_type_pending_idx = None
        if pending_idx is not None and 0 <= pending_idx < len(self._gen_statuses):
            self._gen_statuses[pending_idx] = "\uCDE8\uC18C\uB428"
            self._render_order_list()
        self._set_typing_status("")
        QMessageBox.information(self, "\uC54C\uB9BC", "\uD0C0\uC774\uD551\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.")

    def _on_typing_error(self, message: str) -> None:
        clean_message = _normalize_runtime_error_message(message)
        pending_idx = self._auto_type_pending_idx
        self._auto_type_after_ai = False
        self._auto_type_pending_idx = None
        if pending_idx is not None and 0 <= pending_idx < len(self._gen_statuses):
            self._gen_statuses[pending_idx] = f"\uC624\uB958({clean_message})"
            self._render_order_list()
        self._set_typing_status("")
        QMessageBox.critical(self, "\uD0C0\uC774\uD551 \uC624\uB958", clean_message)

    def _cancel_typing(self) -> None:
        if self._typing_worker and self._typing_worker.isRunning():
            self._typing_worker.cancel()

    def _save_clipboard_image(self) -> str:
        clipboard = QGuiApplication.clipboard()
        if clipboard is None:
            return ""
        img = clipboard.image()
        if img is None or img.isNull():
            return ""
        tmp_dir = Path(tempfile.gettempdir()) / "nova_ai"
        try:
            tmp_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            tmp_dir = Path.cwd()
        file_name = f"nova_ai_clip_{os.getpid()}_{time.time_ns()}.png"
        file_path = tmp_dir / file_name
        try:
            saved = img.save(str(file_path), "PNG")
        except Exception:
            saved = False
        return str(file_path) if saved else ""

    def _try_paste_image(self) -> bool:
        clipboard = QGuiApplication.clipboard()
        if clipboard is None:
            return False
        mime = clipboard.mimeData()
        if mime is None or not mime.hasImage():
            return False
        path = self._save_clipboard_image()
        if not path:
            return False
        before_count = len(self.selected_images)
        new_paths = list(self.selected_images)
        new_paths.append(path)
        self._set_selected_images(new_paths)
        return len(self.selected_images) > before_count

    def eventFilter(self, obj, event):  # type: ignore[override]
        try:
            if obj is getattr(self, "_header_user_area", None):
                if event.type() == QEvent.Type.Enter:
                    self._header_name.setStyleSheet(
                        "font-size: 12px; font-weight: 600; color: #6366f1; background: transparent;"
                    )
                elif event.type() == QEvent.Type.Leave:
                    self._header_name.setStyleSheet(
                        "font-size: 12px; font-weight: 600; color: #1a1a2e; background: transparent;"
                    )
            if event.type() == QEvent.Type.KeyPress and event.key() == Qt.Key.Key_Escape:
                self._cancel_typing()
                return True
            if (
                event.type() == QEvent.Type.KeyPress
                and event.key() == Qt.Key.Key_V
                and event.modifiers() & Qt.KeyboardModifier.ControlModifier
            ):
                if self._try_paste_image():
                    return True
        except Exception:
            pass
        return super().eventFilter(obj, event)

    def _on_order_item_clicked(self, item: QListWidgetItem) -> None:
        idx = self.order_list.row(item)
        if idx < 0 or idx >= len(self._generated_codes_by_index):
            self._current_code_index = -1
            self._current_code_path = None
            self._set_code_view_text("")
            self._update_code_type_button_state()
            return
        self._current_code_index = idx
        path = item.data(Qt.ItemDataRole.UserRole)
        self._current_code_path = path if isinstance(path, str) else None
        code = self._generated_codes_by_index[idx] or ""
        self._set_code_view_text(code)
        self._update_code_type_button_state()

    def _selected_order_indexes(self) -> list[int]:
        indexes: list[int] = []
        for item in self.order_list.selectedItems():
            idx = self.order_list.row(item)
            if idx >= 0:
                indexes.append(idx)
        return sorted(set(indexes))

    def _update_replay_button_visibility(self) -> None:
        if not hasattr(self, "_replay_selected_btn"):
            return
        selected = self._selected_order_indexes()
        has_multi = len(selected) >= 2
        has_code = any(
            0 <= idx < len(self._generated_codes_by_index)
            and bool((self._generated_codes_by_index[idx] or "").strip())
            for idx in selected
        )
        self._replay_selected_btn.setVisible(bool(has_multi and has_code))

    def _on_order_selection_changed(self) -> None:
        self._update_replay_button_visibility()
        current = self.order_list.currentItem()
        if current is not None:
            self._on_order_item_clicked(current)

    def _on_replay_selected_clicked(self) -> None:
        indexes = self._selected_order_indexes()
        if len(indexes) < 2:
            QMessageBox.information(self, "알림", "재생할 코드를 2개 이상 선택해 주세요.")
            return

        scripts: list[tuple[int, str]] = []
        for idx in indexes:
            if idx < 0 or idx >= len(self._generated_codes_by_index):
                continue
            code = (self._generated_codes_by_index[idx] or "").strip()
            if code:
                scripts.append((idx, code))
        if not scripts:
            QMessageBox.information(self, "알림", "선택한 항목에 재생할 코드가 없습니다.")
            return

        self._auto_type_after_ai = False
        self._auto_type_pending_idx = None
        self._set_typing_status("선택 코드 재생중...")
        self._ensure_typing_worker()
        target_filename = self._current_detected_filename()

        for seq, (idx, code) in enumerate(scripts):
            prefix = ""
            if seq > 0:
                prefix = "insert_enter()\n" * 4
            src_img = self.selected_images[idx] if idx < len(self.selected_images) else None
            self._typing_worker.enqueue(idx, f"{prefix}{code}\n", target_filename, src_img)

    def _on_order_rows_moved(self, *args) -> None:
        # Rebuild selected_images order based on list widget items.
        if not self.selected_images:
            return
        new_paths: list[str] = []
        for i in range(self.order_list.count()):
            item = self.order_list.item(i)
            path = item.data(Qt.ItemDataRole.UserRole)
            if isinstance(path, str) and path:
                new_paths.append(path)
        if not new_paths or len(new_paths) != len(self.selected_images):
            return
        old_index_by_path = {p: i for i, p in enumerate(self.selected_images)}
        self.selected_images = new_paths
        if self._generated_codes_by_index:
            self._generated_codes_by_index = [
                self._generated_codes_by_index[old_index_by_path[p]]
                for p in new_paths
                if p in old_index_by_path
            ]
        if self._gen_statuses:
            self._gen_statuses = [
                self._gen_statuses[old_index_by_path[p]]
                for p in new_paths
                if p in old_index_by_path
            ]
        self._render_order_list()
        if self._current_code_path and self._current_code_path in new_paths:
            self._current_code_index = new_paths.index(self._current_code_path)
            code = self._generated_codes_by_index[self._current_code_index] or ""
            self._set_code_view_text(code)
        else:
            self._current_code_index = -1
            self._current_code_path = None
            self._set_code_view_text("")
        self._update_code_type_button_state()

    def _on_order_context_menu(self, pos) -> None:
        if not self._is_order_editable():
            return
        item = self.order_list.itemAt(pos)
        if item is None:
            return
        menu = QMenu(self)
        remove_action = menu.addAction("\uBAA9\uB85D\uC5D0\uC11C \uC81C\uAC70")
        action = menu.exec(self.order_list.mapToGlobal(pos))
        if action == remove_action:
            self._remove_order_item(item)

    def _remove_order_item(self, item: QListWidgetItem) -> None:
        if not self._is_order_editable():
            QMessageBox.information(self, "\uC54C\uB9BC", "\uC0DD\uC131 \uC911\uC5D0\uB294 \uD56D\uBAA9\uC744 \uC0AD\uC81C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        idx = self.order_list.row(item)
        if idx < 0 or idx >= len(self.selected_images):
            return
        self.selected_images.pop(idx)
        if idx < len(self._generated_codes_by_index):
            self._generated_codes_by_index.pop(idx)
        if idx < len(self._gen_statuses):
            self._gen_statuses.pop(idx)
        self._render_order_list()

    def _set_selected_images(self, file_paths: list[str]) -> None:
        next_images = [path for path in file_paths if path]
        if next_images and not is_logged_in():
            QMessageBox.information(
                self,
                "\uB85C\uADF8\uC778 \uD544\uC694",
                "\uC774\uBBF8\uC9C0\uB97C \uCD94\uAC00\uD558\uB824\uBA74 \uBA3C\uC800 \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694.",
            )
            return
        if next_images:
            next_images = self._limit_images_by_remaining_quota(next_images)

        self.selected_images = next_images
        self._update_send_button_state()
        if not self.selected_images:
            self.order_list.clear()
            self._gen_statuses = []
            self._generated_codes_by_index = []
            self._current_code_index = -1
            self._current_code_path = None
            self._set_code_view_text("")
            self._update_code_type_button_state()
            self._update_order_list_visibility()
            self._update_replay_button_visibility()
            return
        order_lines = [
            f"{idx + 1}. {os.path.basename(path)}"
            for idx, path in enumerate(self.selected_images)
        ]
        self.order_title.setText("\uD0C0\uC774\uD551 \uC21C\uC11C:\n" + "\n".join(order_lines))
        self._generated_codes_by_index = [""] * len(self.selected_images)
        self._gen_statuses = ["\uB300\uAE30\uC911"] * len(self.selected_images)
        self._render_order_list()
        self._current_code_index = -1
        self._current_code_path = None
        self._set_code_view_text("")
        self._update_code_type_button_state()
        self._update_order_list_visibility()
        self._update_replay_button_visibility()

    def _set_order_editable(self, enabled: bool) -> None:
        if enabled:
            self.order_list.setDragDropMode(QListWidget.DragDropMode.InternalMove)
            self.order_list.setDragEnabled(True)
            self.order_list.setAcceptDrops(True)
            self.order_list.setDropIndicatorShown(True)
        else:
            self.order_list.setDragDropMode(QListWidget.DragDropMode.NoDragDrop)
            self.order_list.setDragEnabled(False)
            self.order_list.setAcceptDrops(False)
            self.order_list.setDropIndicatorShown(False)

    def _is_order_editable(self) -> bool:
        return self.order_list.dragDropMode() != QListWidget.DragDropMode.NoDragDrop

    def _update_order_list_visibility(self) -> None:
        if not self.selected_images:
            self._order_list_stack.setCurrentWidget(self._empty_placeholder)
        else:
            self._order_list_stack.setCurrentWidget(self.order_list)

    def _set_typing_status(self, text: str) -> None:
        self.typing_status_label.setText(text)
        self.typing_status_label.setVisible(bool(text))
        self._update_send_button_state()

    def _get_remaining_send_quota(self) -> int:
        if not self.profile_uid:
            return 0
        tier = self.profile_plan or "Free"
        limit = max(0, int(get_plan_limit(tier)))
        usage = max(0, int(self._profile_usage or 0))
        return max(0, limit - usage)

    def _limit_images_by_remaining_quota(
        self, image_paths: list[str], show_message: bool = True
    ) -> list[str]:
        if not image_paths:
            return image_paths
        remaining = self._get_remaining_send_quota()
        if remaining <= 0:
            if show_message:
                QMessageBox.warning(
                    self,
                    "\uC54C\uB9BC",
                    "\uB0A8\uC740 \uC0AC\uC6A9 \uD69F\uC218\uAC00 \uC5C6\uC5B4 \uC774\uBBF8\uC9C0\uB97C \uCD94\uAC00\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
                )
            return []
        if len(image_paths) <= remaining:
            return image_paths

        exceeded = len(image_paths) - remaining
        if show_message:
            QMessageBox.information(
                self,
                "\uC54C\uB9BC",
                f"\uD604\uC7AC \uB0A8\uC740 \uD69F\uC218\uB294 {remaining}\uD68C\uC785\uB2C8\uB2E4.\n"
                f"\uC120\uD0DD\uD55C {len(image_paths)}\uAC1C \uC911 {exceeded}\uAC1C\uB9CC \uC81C\uC678\uD558\uACE0 \uCD94\uAC00\uB429\uB2C8\uB2E4.",
            )
        return image_paths[:remaining]

    def _update_send_button_state(self) -> None:
        has_images = bool(self.selected_images)
        status = self.typing_status_label.text().strip()
        if not has_images:
            self.btn_ai_type.setEnabled(False)
            return
        remaining = self._get_remaining_send_quota()
        if remaining <= 0:
            self.btn_ai_type.setEnabled(False)
            return
        if len(self.selected_images) > remaining:
            self.btn_ai_type.setEnabled(False)
            return
        if status and status != "\uD0C0\uC774\uD551 \uC644\uB8CC":
            self.btn_ai_type.setEnabled(False)
            return
        self.btn_ai_type.setEnabled(True)

    def _set_code_view_text(self, text: str) -> None:
        self._code_view_updating = True
        try:
            self.code_view.setPlainText(text or "")
        finally:
            self._code_view_updating = False

    def _update_code_type_button_state(self) -> None:
        idx = self._current_code_index
        if idx < 0 or idx >= len(self._generated_codes_by_index):
            self._code_type_btn.setEnabled(False)
            return
        code = self._generated_codes_by_index[idx] or ""
        self._code_type_btn.setEnabled(bool(code.strip()))

    def _sync_current_code_from_view(self) -> None:
        idx = self._current_code_index
        if idx < 0 or idx >= len(self._generated_codes_by_index):
            return
        text = self.code_view.toPlainText()
        self._generated_codes_by_index[idx] = text
        if idx < len(self.generated_codes):
            self.generated_codes[idx] = text
        self._update_code_type_button_state()

    def _on_code_view_changed(self) -> None:
        if self._code_view_updating:
            return
        self._sync_current_code_from_view()

    def _on_code_type_clicked(self) -> None:
        idx = self._current_code_index
        if idx < 0 or idx >= len(self._generated_codes_by_index):
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uC120\uD0DD\uB41C \uCF54\uB4DC \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        self._type_code_for_index(idx)

    def _type_code_for_index(self, idx: int) -> None:
        if idx < 0 or idx >= len(self._generated_codes_by_index):
            return
        if idx == self._current_code_index:
            self._sync_current_code_from_view()
        script = (self._generated_codes_by_index[idx] or "").strip()
        if not script:
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uD0C0\uC774\uD551\uD560 \uCF54\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        # Ensure only the selected item is typed.
        self._auto_type_after_ai = False
        self._auto_type_pending_idx = None
        self._set_typing_status("\uC120\uD0DD \uCF54\uB4DC \uD0C0\uC774\uD551\uC911...")
        self._ensure_typing_worker()
        target_filename = self._current_detected_filename()
        src_img = self.selected_images[idx] if idx < len(self.selected_images) else None
        self._typing_worker.enqueue(idx, f"{script}\n", target_filename, src_img)

    def _current_detected_filename(self) -> str | None:
        # Always prefer the currently focused HWP window.
        active_name = HwpController.get_foreground_document_name()
        if active_name:
            return active_name

        current_name = HwpController.get_current_filename()
        if current_name:
            return current_name

        last_name = HwpController.get_last_detected_filename()
        if last_name:
            return last_name

        text = (self.filename_label.text() or "").strip()
        if not text or text in ("\uAC10\uC9C0 \uD30C\uC77C \uC5C6\uC74C", "\uD30C\uC77C \uC5C6\uC74C"):
            return None
        return text

    def _select_order_index(self, idx: int) -> None:
        if idx < 0 or idx >= self.order_list.count():
            return
        item = self.order_list.item(idx)
        if item is None:
            return
        self.order_list.setCurrentRow(idx)
        self._on_order_item_clicked(item)

    def _on_order_delete_clicked(self, idx: int) -> None:
        if not self._is_order_editable():
            QMessageBox.information(self, "\uC54C\uB9BC", "\uC0DD\uC131 \uC911\uC5D0\uB294 \uBAA9\uB85D\uC744 \uC218\uC815\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        item = self.order_list.item(idx)
        if item is None:
            return
        self._remove_order_item(item)

    def _on_order_retype_clicked(self, idx: int) -> None:
        if idx < 0 or idx >= len(self._generated_codes_by_index):
            return
        self._select_order_index(idx)
        self._type_code_for_index(idx)

    def _on_order_view_clicked(self, idx: int) -> None:
        if idx < 0 or idx >= len(self.selected_images):
            return
        title = f"{idx + 1}. {os.path.basename(self.selected_images[idx])}"
        code = ""
        if idx < len(self._generated_codes_by_index):
            code = self._generated_codes_by_index[idx] or ""
        if not code.strip():
            QMessageBox.information(self, "\uCF54\uB4DC \uBCF4\uAE30", "\uC544\uC9C1 \uC0DD\uC131\uB41C \uCF54\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        self._code_view_dialog.set_code(title, code)
        self._code_view_dialog.show()
        self._code_view_dialog.raise_()

    def dragEnterEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event) -> None:  # type: ignore[override]
        urls = event.mimeData().urls()
        if not urls:
            return
        file_paths = [url.toLocalFile() for url in urls if url.toLocalFile()]
        if file_paths:
            self._set_selected_images(file_paths)


def _is_rpc_unavailable_message(message: str) -> bool:
    msg = str(message or "")
    lower = msg.lower()
    return (
        "rpc server is unavailable" in lower
        or "0x800706ba" in lower
        or "-2147023174" in lower
        or ("rpc" in lower and ("unavailable" in lower or "server" in lower))
        or ("RPC" in msg and ("?쒕쾭" in msg or "곌껐" in msg or "연결" in msg))
    )


def _normalize_runtime_error_message(message: str) -> str:
    text = str(message or "").strip()
    if not text:
        return "알 수 없는 오류가 발생했습니다."

    if _is_rpc_unavailable_message(text):
        return (
            "HWP 연결에 실패했습니다. HWP를 완전히 종료한 뒤 다시 실행하고, "
            "Nova AI와 HWP를 같은 권한으로 실행해 주세요."
        )

    lower = text.lower()
    if "gemini_api_key is missing" in lower:
        return "GEMINI_API_KEY가 설정되어 있지 않습니다. .env 파일을 확인해 주세요."
    if "insert_cropped_image" in lower and ("source image path" in lower or "원본 이미지 경로" in text):
        return "원본 이미지 경로를 찾지 못해 크롭 이미지를 삽입할 수 없습니다."
    if "insert_cropped_image" in lower and ("invalid" in lower or "좌표" in text):
        return "이미지 크롭 좌표가 잘못되어 삽입하지 못했습니다."
    if "pillow" in lower:
        return "이미지 처리 라이브러리(Pillow) 문제로 작업을 진행할 수 없습니다."

    # Mojibake-like text: fallback to a clean summary instead of broken glyphs.
    if text.count("?") >= 4 or "??" in text:
        return (
            "오류 메시지 인코딩이 손상되었습니다. 현재 작업을 중단하고 "
            "HWP 연결 상태를 확인한 뒤 다시 시도해 주세요."
        )
    return text


class TypingWorker(QThread):
    item_started = Signal(int)
    item_finished = Signal(int)
    cancelled = Signal()
    error = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        self._q: "queue.Queue[tuple[int, str, str | None, str | None]]" = queue.Queue()
        self._cancel = threading.Event()
        self._style_lock = threading.Lock()
        self._text_font_name = "한컴 윤고딕 720"
        self._text_font_size_pt = 8.0
        self._eq_font_name = "HYhwpEQ"
        self._eq_font_size_pt = 8.0

    def set_typing_styles(
        self,
        *,
        text_font_name: str,
        text_font_size_pt: float,
        eq_font_name: str,
        eq_font_size_pt: float,
    ) -> None:
        with self._style_lock:
            self._text_font_name = str(text_font_name or "").strip() or "HYhwpEQ"
            try:
                self._text_font_size_pt = max(1.0, float(text_font_size_pt))
            except Exception:
                self._text_font_size_pt = 8.0
            self._eq_font_name = str(eq_font_name or "").strip() or "HYhwpEQ"
            try:
                self._eq_font_size_pt = max(1.0, float(eq_font_size_pt))
            except Exception:
                self._eq_font_size_pt = 8.0

    def _snapshot_typing_styles(self) -> tuple[str, float, str, float]:
        with self._style_lock:
            return (
                self._text_font_name,
                self._text_font_size_pt,
                self._eq_font_name,
                self._eq_font_size_pt,
            )

    def enqueue(self, idx: int, script: str, target_filename: str | None = None, source_image_path: str | None = None) -> None:
        if not script.strip():
            return
        self._q.put((idx, script, target_filename, source_image_path))

    def cancel(self) -> None:
        self._cancel.set()
        # best-effort drain
        try:
            while True:
                self._q.get_nowait()
        except Exception:
            pass

    def run(self) -> None:  # type: ignore[override]
        # COM init (best-effort) to safely control HWP from this thread.
        pythoncom = None
        try:
            import pythoncom  # type: ignore
        except Exception:
            pythoncom = None
        if pythoncom is not None:
            try:
                pythoncom.CoInitialize()
            except Exception:
                pass

        controller: HwpController | None = None
        runner: ScriptRunner | None = None
        try:
            while True:
                if self._cancel.is_set():
                    self.cancelled.emit()
                    return
                try:
                    item = self._q.get(timeout=0.1)
                except Exception:
                    continue
                source_image_path = None
                if isinstance(item, tuple) and len(item) == 4:
                    idx, script, target_filename, source_image_path = item
                elif isinstance(item, tuple) and len(item) == 3:
                    idx, script, target_filename = item
                else:
                    idx, script = item  # type: ignore[misc]
                    target_filename = None

                if self._cancel.is_set():
                    self.cancelled.emit()
                    return

                try:
                    resolved_target = (
                        target_filename
                        or HwpController.get_foreground_document_name()
                        or HwpController.get_current_filename()
                        or HwpController.get_last_detected_filename()
                    )
                    if not resolved_target:
                        self.error.emit(
                            "활성 HWP 문서를 찾지 못했습니다. "
                            "타이핑할 문서를 선택한 뒤 다시 시도해 주세요."
                        )
                        return
                    if controller is None:
                        controller = HwpController()
                        controller.connect()
                        controller.activate_target_window(resolved_target)
                        t_font, t_size, e_font, e_size = self._snapshot_typing_styles()
                        controller.configure_typing_styles(
                            text_font_name=t_font,
                            text_font_size_pt=t_size,
                            eq_font_name=e_font,
                            eq_font_size_pt=e_size,
                        )
                        runner = ScriptRunner(controller)
                    else:
                        # Always refresh the active document before typing.
                        controller.activate_target_window(resolved_target)
                        t_font, t_size, e_font, e_size = self._snapshot_typing_styles()
                        controller.configure_typing_styles(
                            text_font_name=t_font,
                            text_font_size_pt=t_size,
                            eq_font_name=e_font,
                            eq_font_size_pt=e_size,
                        )

                    self.item_started.emit(idx)
                    assert runner is not None
                    runner.run(script, cancel_check=self._cancel.is_set, source_image_path=source_image_path)
                except ScriptCancelled:
                    self.cancelled.emit()
                    return
                except HwpControllerError as exc:
                    msg = str(exc)
                    if _is_rpc_unavailable_message(msg):
                        try:
                            controller = HwpController()
                            controller.connect()
                            controller.activate_target_window(resolved_target)
                            t_font, t_size, e_font, e_size = self._snapshot_typing_styles()
                            controller.configure_typing_styles(
                                text_font_name=t_font,
                                text_font_size_pt=t_size,
                                eq_font_name=e_font,
                                eq_font_size_pt=e_size,
                            )
                            runner = ScriptRunner(controller)
                            runner.run(script, cancel_check=self._cancel.is_set, source_image_path=source_image_path)
                        except Exception as retry_exc:
                            self.error.emit(_normalize_runtime_error_message(str(retry_exc)))
                            return
                    else:
                        self.error.emit(_normalize_runtime_error_message(msg))
                        return
                except Exception as exc:
                    msg = str(exc)
                    if _is_rpc_unavailable_message(msg):
                        try:
                            controller = HwpController()
                            controller.connect()
                            controller.activate_target_window(resolved_target)
                            t_font, t_size, e_font, e_size = self._snapshot_typing_styles()
                            controller.configure_typing_styles(
                                text_font_name=t_font,
                                text_font_size_pt=t_size,
                                eq_font_name=e_font,
                                eq_font_size_pt=e_size,
                            )
                            runner = ScriptRunner(controller)
                            runner.run(script, cancel_check=self._cancel.is_set, source_image_path=source_image_path)
                        except Exception as retry_exc:
                            self.error.emit(_normalize_runtime_error_message(str(retry_exc)))
                            return
                    else:
                        self.error.emit(_normalize_runtime_error_message(msg))
                        return
                self.item_finished.emit(idx)
        finally:
            if pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass


class OrderListWidget(QListWidget):
    filesDropped = Signal(list)

    def dragEnterEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            return
        super().dragEnterEvent(event)

    def dragMoveEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            return
        super().dragMoveEvent(event)

    def dropEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            paths = [url.toLocalFile() for url in event.mimeData().urls() if url.toLocalFile()]
            if paths:
                self.filesDropped.emit(paths)
                event.acceptProposedAction()
                return
        super().dropEvent(event)


class DropPlaceholder(QWidget):
    clicked = Signal()
    filesDropped = Signal(list)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setStyleSheet(
            "background-color: #f8fafc;"
            "border: 1px solid #e5e7eb;"
            "border-radius: 12px;"
        )
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(8)
        icon_label = QLabel()
        icon_label.setPixmap(
            _material_icon("\ue2c6", 32, QColor("#b0b4c0")).pixmap(QSize(40, 40))
        )
        icon_label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        icon_label.setStyleSheet("background: transparent; border: none;")
        text_label = QLabel("\uD30C\uC77C\uC744 \uC5EC\uAE30\uC5D0 \uB04C\uC5B4\uB193\uAC70\uB098 \uD074\uB9AD\uD574 \uC5C5\uB85C\uB4DC\uD558\uC138\uC694")
        text_label.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter)
        text_label.setStyleSheet(
            "color: #9ca3af; background-color: transparent; border: none;"
            "font-size: 13px;"
        )
        hint_label = QLabel("PNG, JPG, PDF \uD30C\uC77C \uC9C0\uC6D0")
        hint_label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        hint_label.setStyleSheet(
            "color: #c4c8d4; background: transparent; border: none;"
            "font-size: 11px;"
        )
        layout.addStretch(1)
        layout.addWidget(icon_label)
        layout.addWidget(text_label)
        layout.addWidget(hint_label)
        layout.addStretch(1)

    def mousePressEvent(self, event) -> None:  # type: ignore[override]
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
            return
        super().mousePressEvent(event)

    def dragEnterEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            return
        super().dragEnterEvent(event)

    def dropEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            paths = [url.toLocalFile() for url in event.mimeData().urls() if url.toLocalFile()]
            if paths:
                self.filesDropped.emit(paths)
                event.acceptProposedAction()
                return
        super().dropEvent(event)


class OrderListDelegate(QStyledItemDelegate):
    """
    Draw the status part with a wavy black->white animation when status is animating.
    Item text format is expected: "{n}. {name} - {status}".
    """

    delete_clicked = Signal(int)
    retype_clicked = Signal(int)
    view_clicked = Signal(int)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._phase = 0.0
        self._icon_size = 16
        self._icon_gap = 6
        self._icon_padding = 6
        self._delete_icon = _material_icon(_MI_DELETE, size=16, color=QColor("#9ca3af"))
        self._retype_icon = _material_icon(_MI_RETYPE, size=16, color=QColor("#9ca3af"))
        self._view_icon = _material_icon(_MI_CODE, size=16, color=QColor("#9ca3af"))

    def advance(self) -> None:
        self._phase += 0.25
        if self._phase > 1e9:
            self._phase = 0.0

    def _draw_icons(self, painter, rect) -> None:
        icon_y = rect.y() + (rect.height() - self._icon_size) // 2
        delete_x = rect.x() + rect.width() - self._icon_padding - self._icon_size
        retype_x = delete_x - self._icon_gap - self._icon_size
        view_x = retype_x - self._icon_gap - self._icon_size
        painter.drawPixmap(
            QRect(view_x, icon_y, self._icon_size, self._icon_size),
            self._view_icon.pixmap(self._icon_size, self._icon_size),
        )
        painter.drawPixmap(
            QRect(retype_x, icon_y, self._icon_size, self._icon_size),
            self._retype_icon.pixmap(self._icon_size, self._icon_size),
        )
        painter.drawPixmap(
            QRect(delete_x, icon_y, self._icon_size, self._icon_size),
            self._delete_icon.pixmap(self._icon_size, self._icon_size),
        )

    def paint(self, painter, option, index) -> None:  # type: ignore[override]
        opt = option
        self.initStyleOption(opt, index)

        text = opt.text or ""
        # Let the style draw the background/selection, but we will custom draw the text.
        opt_text_backup = opt.text
        opt.text = ""
        style = opt.widget.style() if opt.widget else QApplication.style()
        style.drawControl(QStyle.ControlElement.CE_ItemViewItem, opt, painter, opt.widget)
        opt.text = opt_text_backup

        # Determine colors with contrast fallback (keep text black even when selected).
        base_color = opt.palette.color(QPalette.ColorRole.Text)
        bg = opt.palette.color(QPalette.ColorRole.Base)
        # If text color is too close to background, fall back to WindowText or dark gray.
        if abs(base_color.red() - bg.red()) + abs(base_color.green() - bg.green()) + abs(base_color.blue() - bg.blue()) < 60:
            base_color = opt.palette.color(QPalette.ColorRole.WindowText)
            if abs(base_color.red() - bg.red()) + abs(base_color.green() - bg.green()) + abs(base_color.blue() - bg.blue()) < 60:
                base_color = QColor(40, 40, 40)

        # Prepare text rect.
        icon_area = (self._icon_size * 3) + (self._icon_gap * 2) + self._icon_padding
        rect = opt.rect.adjusted(8, 0, -(8 + icon_area), 0)
        fm = opt.fontMetrics
        y = rect.y() + (rect.height() + fm.ascent() - fm.descent()) // 2
        x = rect.x()

        # Split into prefix and status.
        sep = " - "
        if sep not in text:
            painter.setPen(base_color)
            painter.drawText(rect, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, text)
            self._draw_icons(painter, opt.rect)
            return

        prefix, status = text.rsplit(sep, 1)
        prefix_with_sep = prefix + sep

        painter.save()
        painter.setFont(opt.font)

        # Draw prefix normally.
        painter.setPen(base_color)
        painter.drawText(x, y, prefix_with_sep)
        x += fm.horizontalAdvance(prefix_with_sep)

        status_text = status.strip()

        # Color mapping for status labels.
        status_colors = {
            "\uB300\uAE30\uC911": QColor("#9ca3af"),
            "\uC0DD\uC131\uC911...": None,   # animated pulse
            "\uD0C0\uC774\uD551\uC911...": None,       # animated pulse
            "\uD0C0\uC774\uD551 \uC9C4\uD589\uC911...": QColor("#d97706"),
            "\uD0C0\uC774\uD551 \uC644\uB8CC": QColor("#059669"),
            "\uCF54\uB4DC \uC0DD\uC131 \uC644\uB8CC": QColor("#6366f1"),
            "\uD0C0\uC774\uD551 \uC624\uB958": QColor("#ef4444"),
            "\uAC74\uB108\uB700(\uCF54\uB4DC \uC5C6\uC74C)": QColor("#f97316"),
        }

        if status_text not in status_colors:
            painter.setPen(base_color)
            painter.drawText(x, y, status)
            painter.restore()
            self._draw_icons(painter, opt.rect)
            return

        target = status_colors[status_text]
        if target is not None:
            painter.setPen(target)
            painter.drawText(x, y, status)
            painter.restore()
            self._draw_icons(painter, opt.rect)
            return

        # Animated dark gray -> light gray pulse (for light mode).
        speed = 1.2
        phase = self._phase * speed
        # 0..1 pulse
        t = (math.sin(phase) * 0.5) + 0.5
        gray = int(round(60 + (170 - 60) * t))
        painter.setPen(QColor(gray, gray, gray))
        painter.drawText(x, y, status)

        painter.restore()
        self._draw_icons(painter, opt.rect)

    def editorEvent(self, event, model, option, index) -> bool:  # type: ignore[override]
        if event.type() == QEvent.Type.MouseButtonRelease and event.button() == Qt.MouseButton.LeftButton:
            full_rect = option.rect
            icon_y = full_rect.y() + (full_rect.height() - self._icon_size) // 2
            delete_x = full_rect.x() + full_rect.width() - self._icon_padding - self._icon_size
            retype_x = delete_x - self._icon_gap - self._icon_size
            view_x = retype_x - self._icon_gap - self._icon_size
            delete_rect = QRect(delete_x, icon_y, self._icon_size, self._icon_size)
            retype_rect = QRect(retype_x, icon_y, self._icon_size, self._icon_size)
            view_rect = QRect(view_x, icon_y, self._icon_size, self._icon_size)
            pos = event.position().toPoint() if hasattr(event, "position") else event.pos()
            if delete_rect.contains(pos):
                self.delete_clicked.emit(index.row())
                return True
            if retype_rect.contains(pos):
                self.retype_clicked.emit(index.row())
                return True
            if view_rect.contains(pos):
                self.view_clicked.emit(index.row())
                return True
        return super().editorEvent(event, model, option, index)


def _load_app_fonts() -> None:
    """Load Pretendard & Material Icons from the fonts/ directory."""
    _app_dir = Path(__file__).resolve().parent
    candidates = [_app_dir / "fonts"]
    _meipass = getattr(sys, "_MEIPASS", None)
    if _meipass:
        candidates.append(Path(_meipass) / "fonts")
    for fonts_dir in candidates:
        if not fonts_dir.is_dir():
            continue
        for ff in fonts_dir.iterdir():
            if ff.suffix.lower() in (".otf", ".ttf"):
                QFontDatabase.addApplicationFont(str(ff))


def _clear_win32com_cache() -> None:
    """Remove corrupted win32com gen_py cache to prevent black console popups."""
    try:
        import win32com  # type: ignore
        import shutil

        cache_dir = getattr(win32com, "__gen_path__", None)
        if cache_dir and Path(cache_dir).exists():
            shutil.rmtree(cache_dir, ignore_errors=True)
    except Exception:
        pass


def main() -> None:
    _clear_win32com_cache()
    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    # ???? Load custom fonts (Material Icons only) ????????????????
    _load_app_fonts()

    # ???? Set global app icon (taskbar/alt-tab) ??????????????????
    _app_dir = Path(__file__).resolve().parent
    _icon_candidates = [
        _app_dir.parent / "public" / "pabicon789.png",
        _app_dir / "pabicon789.png",
        _app_dir / "logo33.png",
        _app_dir / "nova_ai.ico",
        Path(getattr(sys, "_MEIPASS", "")) / "pabicon789.png" if getattr(sys, "_MEIPASS", None) else None,
        Path(getattr(sys, "_MEIPASS", "")) / "logo33.png" if getattr(sys, "_MEIPASS", None) else None,
        Path(getattr(sys, "_MEIPASS", "")) / "nova_ai.ico" if getattr(sys, "_MEIPASS", None) else None,
    ]
    for _icon_path in _icon_candidates:
        if _icon_path and _icon_path.exists():
            app.setWindowIcon(QIcon(str(_icon_path)))
            break

    # ???? Clean light palette ??????????????????????????????????????????????????????????
    pal = QPalette()
    pal.setColor(QPalette.ColorRole.Window, QColor("#ffffff"))
    pal.setColor(QPalette.ColorRole.WindowText, QColor("#1a1a2e"))
    pal.setColor(QPalette.ColorRole.Base, QColor("#ffffff"))
    pal.setColor(QPalette.ColorRole.AlternateBase, QColor("#f9fafb"))
    pal.setColor(QPalette.ColorRole.Text, QColor("#1a1a2e"))
    pal.setColor(QPalette.ColorRole.Button, QColor("#f3f4f6"))
    pal.setColor(QPalette.ColorRole.ButtonText, QColor("#1a1a2e"))
    pal.setColor(QPalette.ColorRole.Highlight, QColor("#6366f1"))
    pal.setColor(QPalette.ColorRole.HighlightedText, QColor("#ffffff"))
    pal.setColor(QPalette.ColorRole.ToolTipBase, QColor("#ffffff"))
    pal.setColor(QPalette.ColorRole.ToolTipText, QColor("#333"))
    pal.setColor(QPalette.ColorRole.PlaceholderText, QColor("#9ca3af"))
    app.setPalette(pal)
    # ????????????????????????????????????????????????????????????????????????????????????????????????????????

    window = NovaAILiteWindow()
    window.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
    window.setMinimumSize(360, 480)
    window.resize(460, 640)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

