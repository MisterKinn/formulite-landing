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
import textwrap
import time
import uuid
import wave
import webbrowser
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse

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
    QBoxLayout,
    QLabel,
    QPushButton,
    QMessageBox,
    QFileDialog,
    QTextEdit,
    QListView,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QScrollArea,
    QStackedLayout,
    QSizePolicy,
    QProgressBar,
    QFrame,
    QDialog,
    QComboBox,
    QLineEdit,
    QStyleOptionViewItem,
)
from PySide6.QtGui import (
    QColor, QPalette, QGuiApplication, QImage, QPixmap, QIcon,
    QFont, QFontDatabase, QPainter, QDoubleValidator, QIntValidator,
)
from PySide6.QtMultimedia import QAudioFormat, QAudioSource, QMediaDevices
from PySide6.QtWidgets import QStyledItemDelegate, QStyle

from ai_client import AIClient, AIClientError, normalize_ai_error_message
from chat_page import ChatComposeTextEdit, ChatMessageWidget, ChatWorker
from figure_code_runner import FigureCodeRenderError, render_python_figure_code
from hwp_controller import HwpController, HwpControllerError
from local_figure_renderer import LocalFigureRenderError, render_local_figure
from ocr_pipeline import extract_text, extract_text_from_pil_image
from layout_detector import detect_container, crop_inside_rect
from image_path_utils import load_pil_image
from prompt_loader import get_image_generation_prompt
from pdf_problem_splitter import split_pdf_into_problem_items
from script_runner import ScriptRunner, ScriptCancelled
from upload_items import UploadItem, build_upload_item
from backend.oauth_desktop import (
    get_stored_user,
    is_logged_in,
    login_with_email_password,
    logout_user,
)
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
from runtime_env import can_connect, first_env_value, load_runtime_env, missing_env_keys


class LoginWorker(QThread):
    """Email/password login worker."""
    finished = Signal(bool, str)

    def __init__(self, email: str, password: str) -> None:
        super().__init__()
        self._email = email
        self._password = password

    def run(self) -> None:
        try:
            user = login_with_email_password(self._email, self._password)
            self.finished.emit(user is not None and bool(user.get("uid")), "")
        except Exception as exc:
            message = str(exc or "").strip() or "로그인에 실패했습니다. 다시 시도해주세요."
            self.finished.emit(False, message)


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


class VoiceTranscriptionWorker(QThread):
    transcription_finished = Signal(str, str)
    transcription_error = Signal(str, str)

    def __init__(self, wav_path: str, model: str | None = None, parent=None) -> None:
        super().__init__(parent)
        self._wav_path = wav_path
        self._model = (model or "").strip()

    @staticmethod
    def _extract_gemini_transcription_text(response: object) -> str:
        if isinstance(response, str):
            return response.strip()
        try:
            text = getattr(response, "text", None)
            if isinstance(text, str) and text.strip():
                return text.strip()
        except Exception:
            pass
        try:
            texts: list[str] = []
            for candidate in getattr(response, "candidates", []) or []:
                content = getattr(candidate, "content", None)
                for part in getattr(content, "parts", []) or []:
                    part_text = getattr(part, "text", None)
                    if isinstance(part_text, str) and part_text.strip():
                        texts.append(part_text.strip())
            if texts:
                return "\n".join(texts).strip()
        except Exception:
            pass
        return str(response or "").strip()

    def _run_gemini_transcription(self, model_name: str) -> str:
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is missing.")
        try:
            from google import genai
            from google.genai import types
        except Exception as exc:
            raise RuntimeError("google-genai package is not installed.") from exc

        suffix = Path(self._wav_path).suffix.lower()
        mime_type = {
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".m4a": "audio/mp4",
            ".ogg": "audio/ogg",
            ".webm": "audio/webm",
        }.get(suffix, "audio/wav")

        client = genai.Client(api_key=api_key)
        try:
            with open(self._wav_path, "rb") as audio_file:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        (
                            "다음 한국어 음성을 한글 문서 편집 보조용 명령문으로 정확히 받아쓴다. "
                            "설명은 추가하지 말고, 들린 명령만 평문으로 반환한다."
                        ),
                        types.Part.from_bytes(data=audio_file.read(), mime_type=mime_type),
                    ],
                )
        finally:
            try:
                client.close()
            except Exception:
                pass
        return self._extract_gemini_transcription_text(response)

    def run(self) -> None:  # type: ignore[override]
        try:
            from ai_client import (  # type: ignore
                DEFAULT_GEMINI_MODEL,
                _load_env as _load_ai_env,
                _normalize_model_name,
            )

            try:
                _load_ai_env()
            except Exception:
                pass
            raw_model = (
                self._model
                or DEFAULT_GEMINI_MODEL
            )
            model_name = _normalize_model_name(raw_model)
            text = self._run_gemini_transcription(model_name)
            self.transcription_finished.emit(text, self._wav_path)
        except Exception as exc:
            self.transcription_error.emit(str(exc), self._wav_path)


class AIWorker(QThread):
    finished = Signal(object)
    error = Signal(str)
    progress = Signal(int, str)
    item_finished = Signal(int, str)

    def __init__(
        self,
        image_items: list[UploadItem],
        image_mode: str = "crop",
        generation_mode: str = "problem",
    ) -> None:
        super().__init__()
        self._image_items = image_items
        mode = (image_mode or "crop").strip().lower()
        if mode not in {"no_image", "crop", "ai_generate"}:
            mode = "crop"
        self._image_mode = mode
        normalized_generation_mode = (generation_mode or "problem").strip().lower()
        if normalized_generation_mode not in {"problem", "explanation", "problem_and_explanation"}:
            normalized_generation_mode = "problem"
        self._generation_mode = normalized_generation_mode
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

    def _build_exam_style_image_prompt(self) -> str:
        base_prompt = self._get_image_generation_prompt().strip()
        if not base_prompt:
            base_prompt = (
                "Keep the original figure semantics and layout, but redraw it in clean "
                "Korean CSAT/KICE printed exam style."
            )
        normalization_block = """
[KICE Style Normalization Mode - Highest Priority]
Preserve semantics and layout, but normalize rendering to clean exam-print style.
- Keep original composition and object layout as-is.
- Keep all labels, numbers, symbols, and relationships unchanged.
- Do not add, remove, or replace objects or text.
- Normalize sketchy or scan-like strokes into crisp, uniform vector-like lines.
- Keep line intent (solid or dashed), relative spacing, and graph or table structure.
- Correct camera tilt, page rotation, and perspective skew into a frontal upright view.
- Output must be upright: horizontal lines are horizontal, vertical lines are vertical.
- Use a clean white background with print-like grayscale contrast and remove shadows, blur, scan noise, and handwriting traces.
- If repeated dots, particles, or markers appear, preserve the exact count and each item's relative placement. Do not rearrange them into cleaner spacing.
- For science diagrams, preserve exact shell count, orbit/ring count, bracket placement, charge labels, nucleus count, and electron count.
- For atomic or ionic diagrams, keep every electron on the same shell as in the source and preserve each electron's relative angular position. Do not redistribute electrons for symmetry.
- If cleanup would risk changing technical meaning, choose semantic fidelity over visual prettiness.
""".strip()
        return f"{base_prompt}\n\n{normalization_block}".strip()

    @staticmethod
    def _rotate_image_with_white_background(image, angle_deg: float):
        from PIL import Image  # type: ignore[import-not-found]

        if abs(angle_deg) < 0.01:
            return image
        fill = 255 if image.mode == "L" else (255, 255, 255)
        return image.rotate(-angle_deg, expand=True, fillcolor=fill, resample=Image.BICUBIC)

    @staticmethod
    def _projection_variance(values: list[int]) -> float:
        if not values:
            return 0.0
        mean = sum(values) / len(values)
        return sum((v - mean) ** 2 for v in values) / len(values)

    @classmethod
    def _score_alignment_angle(cls, image, angle_deg: float) -> float:
        rotated = cls._rotate_image_with_white_background(image, angle_deg)
        width, height = rotated.size
        pixels = list(rotated.getdata())
        threshold = 232
        row_counts = [0] * height
        col_counts = [0] * width
        for y in range(height):
            row_base = y * width
            for x in range(width):
                if pixels[row_base + x] < threshold:
                    row_counts[y] += 1
                    col_counts[x] += 1
        if max(row_counts, default=0) == 0 and max(col_counts, default=0) == 0:
            return 0.0
        return cls._projection_variance(row_counts) + cls._projection_variance(col_counts)

    @classmethod
    def _estimate_skew_angle(cls, image) -> float:
        from PIL import Image  # type: ignore[import-not-found]

        grayscale = image.convert("L")
        max_detect = 800
        max_dim = max(grayscale.size)
        if max_dim > max_detect:
            scale = max_detect / max_dim
            grayscale = grayscale.resize(
                (
                    max(64, int(grayscale.size[0] * scale)),
                    max(64, int(grayscale.size[1] * scale)),
                ),
                Image.BICUBIC,
            )

        best_angle = 0.0
        search_plan = (
            (-12.0, 12.0, 1.0),
            (-2.0, 2.0, 0.25),
            (-0.5, 0.5, 0.1),
        )
        for min_offset, max_offset, step in search_plan:
            center = best_angle
            start = center + min_offset
            end = center + max_offset
            angle = start
            best_score = None
            while angle <= end + 1e-9:
                score = cls._score_alignment_angle(grayscale, angle)
                if best_score is None or score > best_score:
                    best_score = score
                    best_angle = angle
                angle += step
        return 0.0 if abs(best_angle) < 0.15 else max(-12.0, min(12.0, best_angle))

    @classmethod
    def _deskew_exam_style_image(cls, image):
        current = image.convert("RGB")
        for _ in range(3):
            angle = cls._estimate_skew_angle(current)
            if angle == 0:
                break
            current = cls._rotate_image_with_white_background(current, angle)
        return current

    @staticmethod
    def _estimate_border_median_luma(image) -> int:
        grayscale = image.convert("L")
        width, height = grayscale.size
        border = max(2, int(min(width, height) * 0.06))
        pixels = list(grayscale.getdata())
        samples: list[int] = []
        for y in range(height):
            row_base = y * width
            for x in range(width):
                if x < border or x >= width - border or y < border or y >= height - border:
                    samples.append(pixels[row_base + x])
        if not samples:
            return 255
        samples.sort()
        return samples[len(samples) // 2]

    @classmethod
    def _enforce_white_background(cls, image):
        from PIL import Image  # type: ignore[import-not-found]

        base = Image.new("RGB", image.size, "#ffffff")
        base.paste(image.convert("RGB"))
        border_median = cls._estimate_border_median_luma(base)
        if border_median >= 248:
            return base

        white_point = max(210, min(248, border_median + 6))
        black_point = 0
        scale = 255 / max(1, white_point - black_point)
        corrected = []
        for r, g, b in list(base.getdata()):
            channels = []
            for value in (r, g, b):
                mapped = round((value - black_point) * scale)
                channels.append(0 if mapped < 0 else 255 if mapped > 255 else mapped)
            corrected.append(tuple(channels))
        normalized = Image.new("RGB", base.size, "#ffffff")
        normalized.putdata(corrected)
        return normalized

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
                return list(value)
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
            mime = _get_field(inline, "mime_type", "mimeType") or "image/png"
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
    def _parse_local_figure_call_args(arg_expr: str) -> tuple[str, dict[str, object]] | None:
        try:
            node = ast.parse(f"f({arg_expr})", mode="eval")
            call = node.body  # type: ignore[attr-defined]
            if not isinstance(call, ast.Call):
                return None
            if len(call.args) != 2 or call.keywords:
                return None
            kind = ast.literal_eval(call.args[0])
            spec = ast.literal_eval(call.args[1])
            if not isinstance(kind, str) or not isinstance(spec, dict):
                return None
            return (kind, spec)
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
        img = load_pil_image(source_image_path, mode="RGB")
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
        from ai_client import (  # type: ignore
            DEFAULT_GEMINI_MODEL,
            _load_env as _load_ai_env,
            _normalize_model_name,
        )

        try:
            _load_ai_env()
        except Exception:
            pass

        model_name = _normalize_model_name((
            os.getenv("GEMINI_IMAGE_MODEL")
            or DEFAULT_GEMINI_MODEL
        ).strip())
        if "image" not in model_name:
            raise AIClientError(
                f"현재 설정된 모델({model_name})은 텍스트 출력 전용이라 AI 이미지 생성을 지원하지 않습니다."
            )
        prompt_text = self._build_exam_style_image_prompt()
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not api_key:
            raise AIClientError("GEMINI_API_KEY is missing.")
        try:
            from google import genai
            from google.genai import types
            from PIL import Image  # type: ignore[import-not-found]
            import io
        except Exception as exc:
            raise AIClientError(f"이미지 생성 모듈 로딩 실패: {exc}") from exc

        client = None
        try:
            client = genai.Client(api_key=api_key)
            image = self._deskew_exam_style_image(load_pil_image(crop_path, mode="RGB"))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    prompt_text,
                    types.Part.from_bytes(data=buffer.getvalue(), mime_type="image/png"),
                ],
                config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
            )
        except Exception as exc:
            raise AIClientError(f"Gemini 이미지 생성 실패: {exc}") from exc
        finally:
            try:
                if client is not None:
                    client.close()
            except Exception:
                pass
        img_bytes, mime = self._extract_inline_image_bytes(response)

        if not img_bytes:
            raise AIClientError("이미지 생성 응답에서 이미지 데이터를 찾지 못했습니다. 모델 응답 형식이 예상과 다를 수 있습니다.")

        try:
            processed_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            processed_image = self._deskew_exam_style_image(processed_image)
            processed_image = self._enforce_white_background(processed_image)
            buffer = io.BytesIO()
            processed_image.save(buffer, format="PNG")
            img_bytes = buffer.getvalue()
            mime = "image/png"
        except Exception:
            pass

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
    ) -> tuple[str, int]:
        if self._image_mode != "ai_generate":
            return script, 0
        if not script.strip():
            return script, 0

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
        return "\n".join(lines), generated_count

    @staticmethod
    def _strip_image_insertions(script: str) -> str:
        if not script.strip():
            return script
        lines = script.splitlines()
        image_call = re.compile(
            r"^\s*insert_(?:cropped|generated)_image\(|^\s*insert_local_figure\(|^\s*insert_python_figure\("
        )
        kept = [line for line in lines if not image_call.match(line.strip())]
        return "\n".join(kept).strip()

    def _apply_python_figure_pipeline(
        self,
        idx: int,
        script: str,
        log_fn,
    ) -> str:
        if not (script or "").strip():
            return script

        pattern = re.compile(
            r"(?ms)^(?P<indent>[ \t]*)insert_python_figure\(\s*(?P<quote>'''|\"\"\")(?P<code>.*?)(?P=quote)\s*\)\s*$"
        )
        call_count = 0
        rendered_count = 0
        failed_count = 0

        def _replace(match: re.Match[str]) -> str:
            nonlocal call_count, rendered_count, failed_count
            call_count += 1
            indent = match.group("indent")
            code = textwrap.dedent(match.group("code") or "").strip()
            if not code:
                failed_count += 1
                log_fn(f"[{idx}] Empty insert_python_figure block removed")
                return ""

            self.progress.emit(idx, "해설 그림 생성중...")
            try:
                generated_path = render_python_figure_code(code)
                rendered_count += 1
                log_fn(
                    f"[{idx}] Python figure #{rendered_count} rendered: {generated_path}"
                )
                return f"{indent}insert_generated_image({generated_path!r})"
            except FigureCodeRenderError as exc:
                failed_count += 1
                log_fn(f"[{idx}] Python figure render skipped: {exc}")
                return ""
            except Exception as exc:
                failed_count += 1
                log_fn(f"[{idx}] Unexpected python figure error: {exc}")
                return ""

        processed = pattern.sub(_replace, script)
        if call_count == 0:
            return processed
        if rendered_count > 0:
            log_fn(f"[{idx}] Python figure rendering complete: {rendered_count} item(s)")
        if failed_count > 0:
            log_fn(f"[{idx}] Python figure rendering skipped for {failed_count} item(s)")
        return processed

    def _apply_local_figure_pipeline(
        self,
        idx: int,
        script: str,
        log_fn,
    ) -> str:
        if not script.strip():
            return script

        lines = script.splitlines()
        figure_pattern = re.compile(r"^(\s*)insert_local_figure\((.+)\)\s*$")
        call_count = 0
        rendered_count = 0
        failed_count = 0

        for line_idx, line in enumerate(lines):
            match = figure_pattern.match(line)
            if not match:
                continue
            call_count += 1
            indent = match.group(1)
            parsed = self._parse_local_figure_call_args(match.group(2))
            if parsed is None:
                failed_count += 1
                lines[line_idx] = ""
                log_fn(f"[{idx}] Invalid insert_local_figure call removed at line {line_idx + 1}")
                continue

            kind, spec = parsed
            self.progress.emit(idx, "해설 그림 생성중...")
            try:
                generated_path = render_local_figure(kind, spec)
                lines[line_idx] = f"{indent}insert_generated_image({generated_path!r})"
                rendered_count += 1
                log_fn(
                    f"[{idx}] Local figure #{rendered_count} rendered "
                    f"({kind}): {generated_path}"
                )
            except LocalFigureRenderError as exc:
                failed_count += 1
                lines[line_idx] = ""
                log_fn(f"[{idx}] Local figure render skipped ({kind}): {exc}")
            except Exception as exc:
                failed_count += 1
                lines[line_idx] = ""
                log_fn(f"[{idx}] Unexpected local figure error ({kind}): {exc}")

        if rendered_count > 0:
            log_fn(f"[{idx}] Local figure rendering complete: {rendered_count} item(s)")
        if failed_count > 0:
            log_fn(f"[{idx}] Local figure rendering skipped for {failed_count} item(s)")
        return "\n".join(lines)

    def _apply_image_mode_pipeline(
        self,
        idx: int,
        image_path: str,
        script: str,
        log_fn,
    ) -> tuple[str, int]:
        processed = script
        image_credit_cost = 0
        if self._image_mode == "ai_generate":
            processed, image_credit_cost = self._apply_image_generation_pipeline(
                idx, image_path, processed, log_fn
            )
        elif self._image_mode == "no_image":
            stripped = self._strip_image_insertions(processed)
            if stripped != (processed or "").strip():
                log_fn(f"[{idx}] Image insertion lines removed by no-image mode")
            return stripped, 0
        processed = self._apply_python_figure_pipeline(idx, processed, log_fn)
        return self._apply_local_figure_pipeline(idx, processed, log_fn), image_credit_cost

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
            total = len(self._image_items)
            results: list[str] = [""] * total
            _log(f"Starting AI generation for {total} images")

            def _job(idx: int, upload_item: UploadItem) -> str:
                image_path = str(upload_item.ai_input_path or "").strip()
                if not image_path:
                    raise AIClientError("AI 입력 이미지 경로가 비어 있습니다.")
                _log(f"[{idx}] Processing: {image_path}")
                user = get_stored_user() or {}
                uid = str(user.get("uid") or "")
                tier = str(user.get("plan") or user.get("tier") or "free")
                generation_mode = getattr(self, "_generation_mode", "problem")
                base_usage_cost = 2 if generation_mode == "problem_and_explanation" else 1

                if uid and not check_usage_limit(uid, tier, amount=base_usage_cost):
                    limit = get_plan_limit(tier)
                    remaining = get_remaining_usage(uid, tier)
                    extra_hint = ""
                    if self._image_mode == "ai_generate":
                        extra_hint = (
                            "\nAI 이미지 생성 모드에서는 실제 이미지 생성이 성공한 건수만큼 "
                            "건당 1크레딧이 추가 차감됩니다."
                        )
                    raise AIClientError(
                        f"현재 모드 실행에 필요한 기본 크레딧이 부족합니다. "
                        f"(기본 필요: {base_usage_cost}, 남음: {remaining}, 한도: {limit})\n"
                        f"\uD604\uC7AC \uD50C\uB79C: {tier}\n"
                        "nova-ai.work\uC5D0\uC11C \uD50C\uB79C\uC744 \uC5C5\uADF8\uB808\uC774\uB4DC\uD574\uC8FC\uC138\uC694."
                        f"{extra_hint}"
                    )

                # 1 image : 1 AIClient wrapper. Each actual generate_* call inside
                # AIClient opens a fresh google.genai client and closes it after
                # the response, so concurrent batches do not share a live SDK client.
                try:
                    client = AIClient(check_usage=False)
                except Exception as e:
                    _log(f"[{idx}] AIClient creation failed: {e}")
                    raise

                # 1) Full OCR (fallback context)
                _log(f"[{idx}] Starting OCR...")
                ocr_text_full = ""
                try:
                    ocr_text_full = extract_text(image_path)
                    _log(f"[{idx}] OCR done, length: {len(ocr_text_full)}")
                except Exception as e:
                    _log(f"[{idx}] OCR failed (skipping): {type(e).__name__}: {e}")
                    ocr_text_full = ""

                def _append_explanation_if_needed(problem_code: str) -> str:
                    mode = generation_mode
                    if mode not in {"explanation", "problem_and_explanation"}:
                        return (problem_code or "").strip()
                    _log(f"[{idx}] Calling GPT explanation flow...")
                    explanation_raw = client.generate_explanation_for_image(
                        image_path,
                        ocr_text=ocr_text_full,
                    ) or ""
                    _log(f"[{idx}] Explanation response length: {len(explanation_raw)}")
                    explanation_code = self._extract_code(explanation_raw)
                    if mode == "explanation":
                        return explanation_code.strip()
                    problem_clean = (problem_code or "").strip()
                    explanation_clean = (explanation_code or "").strip()
                    if problem_clean and explanation_clean:
                        return "\n".join(
                            [
                                problem_clean,
                                "insert_enter()",
                                "insert_enter()",
                                "insert_enter()",
                                explanation_clean,
                            ]
                        ).strip()
                    return problem_clean or explanation_clean

                if generation_mode == "explanation":
                    final_code = _append_explanation_if_needed("")
                    final_code, image_credit_cost = self._apply_image_mode_pipeline(
                        idx, image_path, final_code, _log
                    )
                    if uid and final_code.strip():
                        total_usage_cost = base_usage_cost + image_credit_cost
                        if not check_usage_limit(uid, tier, amount=total_usage_cost):
                            limit = get_plan_limit(tier)
                            remaining = get_remaining_usage(uid, tier)
                            raise AIClientError(
                                "현재 모드 실행에 필요한 크레딧이 부족합니다. "
                                f"(기본: {base_usage_cost}, 이미지 생성 추가: {image_credit_cost}, "
                                f"총 필요: {total_usage_cost}, 남음: {remaining}, 한도: {limit})\n"
                                f"현재 플랜: {tier}"
                            )
                        increment_ai_usage(uid, amount=total_usage_cost)
                    return final_code

                # 2) Detect container and provide a layout hint, but keep
                # the problem generation in a single AI call.
                _log(f"[{idx}] Detecting container...")
                det = detect_container(image_path)
                _log(f"[{idx}] Container detected: template={det.template}, rect={det.rect}")
                generation_description = ""
                inside_box_ocr_hint = ""
                if det.template and det.rect:
                    generation_description = (
                        "Generate the FULL HWP automation code for the ENTIRE problem in ONE pass. "
                        f"A container was detected and the most likely template is '{det.template}'. "
                        "If the visible layout matches, use the correct template and placeholder flow in the final script. "
                        "Return one complete script covering the problem statement, box content, score, and answer choices "
                        "together in natural reading order. Do NOT return partial scripts split into outside text, box body, "
                        "and choices."
                    )
                    try:
                        inside_img = crop_inside_rect(image_path, det.rect)
                        if inside_img is not None:
                            inside_ocr = extract_text_from_pil_image(inside_img).strip()
                            compact_inside_ocr = " ".join(inside_ocr.split()).strip()
                            if compact_inside_ocr:
                                inside_box_ocr_hint = compact_inside_ocr[:1200]
                                if len(compact_inside_ocr) > 1200:
                                    inside_box_ocr_hint += "..."
                            if len(compact_inside_ocr) >= 20:
                                generation_description += (
                                    " The detected box/body contains readable text. "
                                    "Type the readable text inside the box using insert_text(...) and insert_equation(...). "
                                    "If the box also contains a figure, crop ONLY the actual non-text figure region. "
                                    "Never replace a text-heavy box body with one large cropped image."
                                )
                                _log(
                                    f"[{idx}] Inside-box OCR hint length: {len(compact_inside_ocr)}"
                                )
                    except Exception as exc:
                        _log(f"[{idx}] Inside-box OCR hint skipped: {exc}")
                    _log(f"[{idx}] Container hint enabled for single-pass generation")
                elif det.rect:
                    generation_description = (
                        "Generate the FULL HWP automation code for the ENTIRE problem in ONE pass. "
                        "A bordered rectangular region was detected in the source. "
                        "If that region is a real printed single-cell box/table containing text, equations, or a short paragraph, "
                        "preserve it as `insert_table(1, 1, ...)` instead of flattening it into normal lines. "
                        "Use a template only when literal '<보기>' text is visibly present."
                    )
                    try:
                        inside_img = crop_inside_rect(image_path, det.rect)
                        if inside_img is not None:
                            inside_ocr = extract_text_from_pil_image(inside_img).strip()
                            compact_inside_ocr = " ".join(inside_ocr.split()).strip()
                            if compact_inside_ocr:
                                inside_box_ocr_hint = compact_inside_ocr[:1200]
                                if len(compact_inside_ocr) > 1200:
                                    inside_box_ocr_hint += "..."
                                generation_description += (
                                    " The bordered region contains readable content; keep the visible reading order inside that 1x1 table "
                                    "and preserve centered equation lines or left-aligned paragraph text as seen."
                                )
                                _log(
                                    f"[{idx}] Generic bordered-region OCR hint length: {len(compact_inside_ocr)}"
                                )
                    except Exception as exc:
                        _log(f"[{idx}] Generic bordered-region OCR hint skipped: {exc}")
                    _log(f"[{idx}] Generic bordered-region hint enabled for single-pass generation")
                elif det.template:
                    generation_description = (
                        "Generate the FULL HWP automation code for the ENTIRE problem in ONE pass. "
                        f"A container/header pattern was detected and the most likely template is '{det.template}'. "
                        "If the visible layout matches, use the correct template and placeholder flow in the final script. "
                        "Return one complete script for the whole problem, not partial scripts for separate regions."
                    )
                    _log(f"[{idx}] Template hint enabled for single-pass generation")
                else:
                    _log(f"[{idx}] No container detected, calling AI once for full problem...")

                raw_result = client.generate_script_for_image(
                    image_path,
                    description=(generation_description or ""),
                    ocr_text=(
                        ocr_text_full
                        + (
                            "\n\nOCR hint from inside the detected box/body "
                            "(use this only as a hint and verify with the image):\n"
                            + inside_box_ocr_hint
                            if inside_box_ocr_hint
                            else ""
                        )
                    ),
                ) or ""
                _log(f"[{idx}] AI response length: {len(raw_result)}")
                if not raw_result.strip():
                    _log(f"[{idx}] WARNING: Empty AI response!")
                final_code = self._extract_code(raw_result)
                final_code = _append_explanation_if_needed(final_code)
                final_code, image_credit_cost = self._apply_image_mode_pipeline(
                    idx, image_path, final_code, _log
                )
                if uid and final_code.strip():
                    total_usage_cost = base_usage_cost + image_credit_cost
                    if not check_usage_limit(uid, tier, amount=total_usage_cost):
                        limit = get_plan_limit(tier)
                        remaining = get_remaining_usage(uid, tier)
                        raise AIClientError(
                            "현재 모드 실행에 필요한 크레딧이 부족합니다. "
                            f"(기본: {base_usage_cost}, 이미지 생성 추가: {image_credit_cost}, "
                            f"총 필요: {total_usage_cost}, 남음: {remaining}, 한도: {limit})\n"
                            f"현재 플랜: {tier}"
                        )
                    increment_ai_usage(uid, amount=total_usage_cost)
                return final_code

            # Generate code in batches while still allowing the environment
            # variable to lower or raise the default concurrency cap.
            max_workers_env = os.getenv("NOVA_AI_MAX_WORKERS")
            max_workers = max(1, min(total, 10))
            if max_workers_env:
                try:
                    max_workers = max(1, min(total, int(max_workers_env)))
                except Exception:
                    max_workers = max(1, min(total, 10))

            for batch_start in range(0, total, max_workers):
                batch_end = min(batch_start + max_workers, total)
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
                    future_to_idx: dict[concurrent.futures.Future[str], int] = {}
                    for idx in range(batch_start, batch_end):
                        upload_item = self._image_items[idx]
                        self.progress.emit(idx, "\uC0DD\uC131\uC911...")
                        future_to_idx[ex.submit(_job, idx, upload_item)] = idx

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
_MI_ADD = "\ue145"         # add
_MI_MIC = "\ue029"         # mic
_MI_ARROW_UP = "\ue5d8"    # arrow_upward


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


class CredentialsLoginDialog(QDialog):
    """Native email/password login popup."""

    def __init__(self, parent=None, *, email: str = ""):
        super().__init__(parent)
        self.setWindowTitle("Nova AI 로그인")
        self.setFixedSize(420, 300)
        self.setWindowFlags(
            Qt.WindowType.Dialog
            | Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        card = QFrame(self)
        card.setGeometry(0, 0, 420, 300)
        card.setStyleSheet(
            "QFrame { background-color: #ffffff; border: 1px solid #d1d5db; border-radius: 18px; }"
        )

        lay = QVBoxLayout(card)
        lay.setContentsMargins(28, 26, 28, 24)
        lay.setSpacing(0)

        title = QLabel("로그인")
        title.setStyleSheet(
            "font-size: 24px; font-weight: 700; color: #111827; background: transparent; border: none;"
        )
        lay.addWidget(title)

        lay.addSpacing(18)

        email_label = QLabel("이메일")
        email_label.setStyleSheet(
            "font-size: 12px; font-weight: 600; color: #374151; background: transparent; border: none;"
        )
        lay.addWidget(email_label)

        lay.addSpacing(8)

        self._email_input = QLineEdit()
        self._email_input.setPlaceholderText("you@example.com")
        self._email_input.setText(email or "")
        self._email_input.setFixedHeight(44)
        self._email_input.setStyleSheet(
            "QLineEdit { border: 1px solid #d1d5db; border-radius: 12px; padding: 0 14px;"
            "  font-size: 13px; color: #111827; background: #ffffff; }"
            "QLineEdit:focus { border: 1px solid #6366f1; }"
        )
        lay.addWidget(self._email_input)

        lay.addSpacing(14)

        password_label = QLabel("비밀번호")
        password_label.setStyleSheet(
            "font-size: 12px; font-weight: 600; color: #374151; background: transparent; border: none;"
        )
        lay.addWidget(password_label)

        lay.addSpacing(8)

        pw_row = QHBoxLayout()
        pw_row.setSpacing(8)

        self._password_input = QLineEdit()
        self._password_input.setPlaceholderText("비밀번호를 입력해주세요")
        self._password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._password_input.setFixedHeight(44)
        self._password_input.setStyleSheet(
            "QLineEdit { border: 1px solid #d1d5db; border-radius: 12px; padding: 0 14px;"
            "  font-size: 13px; color: #111827; background: #ffffff; }"
            "QLineEdit:focus { border: 1px solid #6366f1; }"
        )
        self._password_input.returnPressed.connect(self._submit)
        pw_row.addWidget(self._password_input, 1)

        self._toggle_btn = QPushButton("보기")
        self._toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._toggle_btn.setFixedSize(62, 44)
        self._toggle_btn.setStyleSheet(
            "QPushButton { background-color: #f3f4f6; color: #374151; border: none;"
            "  border-radius: 12px; font-size: 12px; font-weight: 600; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
            "QPushButton:pressed { background-color: #d1d5db; }"
        )
        self._toggle_btn.clicked.connect(self._toggle_password_visibility)
        pw_row.addWidget(self._toggle_btn)
        lay.addLayout(pw_row)

        lay.addSpacing(12)

        self._error_label = QLabel("")
        self._error_label.setWordWrap(True)
        self._error_label.setVisible(False)
        self._error_label.setStyleSheet(
            "font-size: 12px; color: #dc2626; background: #fef2f2;"
            "border: 1px solid #fecaca; border-radius: 10px; padding: 10px 12px;"
        )
        lay.addWidget(self._error_label)

        lay.addSpacing(18)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        cancel_btn = QPushButton("취소")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setFixedHeight(42)
        cancel_btn.setStyleSheet(
            "QPushButton { background-color: #f3f4f6; color: #374151; border: none;"
            "  border-radius: 12px; font-size: 13px; font-weight: 600; padding: 0 18px; }"
            "QPushButton:hover { background-color: #e5e7eb; }"
            "QPushButton:pressed { background-color: #d1d5db; }"
        )
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)

        signup_btn = QPushButton("회원가입")
        signup_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        signup_btn.setFixedHeight(42)
        signup_btn.setStyleSheet(
            "QPushButton { background-color: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe;"
            "  border-radius: 12px; font-size: 13px; font-weight: 700; padding: 0 18px; }"
            "QPushButton:hover { background-color: #e0e7ff; border: 1px solid #a5b4fc; }"
            "QPushButton:pressed { background-color: #c7d2fe; border: 1px solid #818cf8; }"
        )
        signup_btn.clicked.connect(self._open_signup_page)
        btn_row.addWidget(signup_btn)

        login_btn = QPushButton("로그인")
        login_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        login_btn.setFixedHeight(42)
        login_btn.setStyleSheet(
            "QPushButton { background-color: #DBEAFE; color: #1d4ed8; border: 1px solid #bfdbfe;"
            "  border-radius: 12px; font-size: 13px; font-weight: 700; padding: 0 18px; }"
            "QPushButton:hover { background-color: #bfdbfe; border: 1px solid #93c5fd; }"
            "QPushButton:pressed { background-color: #93c5fd; border: 1px solid #60a5fa; }"
        )
        login_btn.clicked.connect(self._submit)
        btn_row.addWidget(login_btn)
        lay.addLayout(btn_row)

        if self._email_input.text().strip():
            self._password_input.setFocus()
        else:
            self._email_input.setFocus()

    def _toggle_password_visibility(self) -> None:
        is_hidden = self._password_input.echoMode() == QLineEdit.EchoMode.Password
        self._password_input.setEchoMode(
            QLineEdit.EchoMode.Normal if is_hidden else QLineEdit.EchoMode.Password
        )
        self._toggle_btn.setText("숨김" if is_hidden else "보기")

    def _open_signup_page(self) -> None:
        base_url = str(os.getenv("NOVA_WEB_BASE_URL") or "https://www.nova-ai.work").rstrip("/")
        signup_url = f"{base_url}/login?mode=signup&source=desktop"
        try:
            webbrowser.open(signup_url)
        except Exception:
            pass

    def _submit(self) -> None:
        email = self._email_input.text().strip()
        password = self._password_input.text()
        if not email or not password:
            self.set_error("이메일과 비밀번호를 모두 입력해주세요.")
            return
        self.accept()

    def set_error(self, message: str) -> None:
        text = str(message or "").strip()
        self._error_label.setText(text)
        self._error_label.setVisible(bool(text))

    def credentials(self) -> tuple[str, str]:
        return self._email_input.text().strip(), self._password_input.text()

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
            painter.drawRoundedRect(self.rect().adjusted(i, i, -i, -i), 18, 18)
        painter.end()


class LoginResultDialog(QDialog):
    """Modern styled login result notification dialog."""

    def __init__(self, parent=None, *, success: bool = True, user_name: str = "", message: str = ""):
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
            sub_text = message or "\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694."
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

        ver = QLabel("Nova AI v2.1.1")
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


class ComboPopupItemDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index) -> None:  # type: ignore[override]
        opt = QStyleOptionViewItem(option)
        opt.state &= ~QStyle.StateFlag.State_HasFocus
        super().paint(painter, opt, index)


class DownwardPopupComboBox(QComboBox):
    """Always open combo popup below the control."""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        popup_view = QListView(self)
        popup_view.setMouseTracking(True)
        popup_view.setUniformItemSizes(True)
        popup_view.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        popup_view.setItemDelegate(ComboPopupItemDelegate(popup_view))
        popup_view.setStyleSheet(
            "QListView { background: #ffffff; border: 1px solid #d1d5db; outline: 0; "
            "selection-background-color: #f3f4f6; selection-color: #111827; }"
            "QListView::item { border: none; outline: 0; margin: 0; padding: 6px 10px; color: #111827; }"
            "QListView::item:hover { background: #f3f4f6; border: none; outline: 0; }"
            "QListView::item:selected { background: #f3f4f6; border: none; outline: 0; color: #111827; }"
        )
        self.setView(popup_view)

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

        self.selected_images: list[UploadItem] = []
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
        self._chat_typing_pending = False
        self._chat_pending_reply = ""
        self._chat_pipeline_status_item = None
        self._chat_pipeline_status_widget: ChatMessageWidget | None = None
        self._hide_voice_edit_ui = True
        self._queued_chat_messages: list[str] = []
        self._voice_session_active = False
        self._voice_audio_source: QAudioSource | None = None
        self._voice_audio_device = None
        self._voice_sd_stream = None
        self._voice_audio_lock = threading.Lock()
        self._voice_audio_backend = ""
        self._voice_pcm_buffer = bytearray()
        self._voice_last_active_at = 0.0
        self._voice_segment_started_at = 0.0
        self._voice_detected_speech = False
        self._voice_transcription_worker: VoiceTranscriptionWorker | None = None
        self._voice_chunk_counter = 0
        self._voice_preview_text = ""
        self._voice_preview_status = ""
        self._typing_text_font_name = "HYhwpEQ"
        self._typing_text_font_size_pt = 8.0
        self._typing_eq_font_name = "HYhwpEQ"
        self._typing_eq_font_size_pt = 8.0
        self._typing_generation_mode = "problem"
        self._image_mode = "no_image"
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
            "  width: 12px; height: 12px; margin-right: 3px; }"
            "QComboBox#typingSizeCombo::drop-down { width: 0px; border: none; }"
            "QComboBox#typingSizeCombo::down-arrow { image: none; width: 0px; height: 0px; }"
            "QComboBox QAbstractItemView { background: #ffffff; border: 1px solid #d1d5db;"
            "  outline: 0; selection-background-color: #f3f4f6; selection-color: #111827; }"
            "QComboBox QAbstractItemView::item { border: none; outline: 0; padding: 8px 12px; margin: 0; }"
            "QComboBox QAbstractItemView::item:hover { background-color: #f3f4f6; border: none; outline: 0; }"
            "QComboBox QAbstractItemView::item:selected { background-color: #f3f4f6; border: none; outline: 0; color: #111827; }"
        )
        _ts_root = QVBoxLayout(self._typing_style_bar)
        _ts_root.setContentsMargins(10, 6, 10, 6)
        _ts_root.setSpacing(6)

        self._typing_kind_row_widget = QWidget()
        _kind_row = QHBoxLayout(self._typing_kind_row_widget)
        _kind_row.setContentsMargins(0, 0, 0, 0)
        _kind_row.setSpacing(8)
        _kind_lbl = QLabel("종류")
        _kind_lbl.setObjectName("typingStyleLabel")
        _kind_row.addSpacing(2)
        _kind_lbl.setFixedWidth(52)
        _kind_row.addWidget(_kind_lbl)
        self._typing_kind_combo = DownwardPopupComboBox()
        self._typing_kind_combo.setObjectName("typingFontCombo")
        self._typing_kind_combo.setEditable(False)
        self._typing_kind_combo.addItems(
            [
                self._typing_generation_mode_text("problem"),
                self._typing_generation_mode_text("explanation"),
                self._typing_generation_mode_text("problem_and_explanation"),
            ]
        )
        self._typing_kind_combo.setFixedWidth(260)
        _kind_row.addWidget(self._typing_kind_combo)
        _kind_row.addStretch(1)
        _ts_root.addWidget(self._typing_kind_row_widget)

        self._image_mode_row_widget = QWidget()
        _img_mode_row = QHBoxLayout(self._image_mode_row_widget)
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
            [
                self._image_mode_text("no_image"),
                self._image_mode_text("crop"),
                self._image_mode_text("ai_generate"),
            ]
        )
        self._image_mode_combo.setFixedWidth(220)
        _img_mode_row.addWidget(self._image_mode_combo)
        _img_mode_row.addStretch(1)
        _ts_root.addWidget(self._image_mode_row_widget)
        self._typing_cost_hint_label = QLabel("")
        self._typing_cost_hint_label.setWordWrap(True)
        self._typing_cost_hint_label.setStyleSheet(
            "font-size: 11px; color: #6b7280; padding-left: 56px; padding-top: 2px;"
        )
        _ts_root.addWidget(self._typing_cost_hint_label)

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
        self._typing_kind_combo.currentTextChanged.connect(self._on_typing_generation_mode_changed)
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
            "  width: 12px; height: 12px; margin-right: 3px; }"
            "QComboBox#typingSizeCombo::drop-down { width: 0px; border: none; }"
            "QComboBox#typingSizeCombo::down-arrow { image: none; width: 0px; height: 0px; }"
            "QComboBox QAbstractItemView { background: #ffffff; border: 1px solid #d1d5db;"
            "  outline: 0; selection-background-color: #f3f4f6; selection-color: #111827; }"
            "QComboBox QAbstractItemView::item { border: none; outline: 0; padding: 8px 12px; margin: 0; }"
            "QComboBox QAbstractItemView::item:hover { background-color: #f3f4f6; border: none; outline: 0; }"
            "QComboBox QAbstractItemView::item:selected { background-color: #f3f4f6; border: none; outline: 0; color: #111827; }"
        )
        _tsc_v = QVBoxLayout(self._typing_style_bar_compact)
        _tsc_v.setContentsMargins(10, 6, 10, 6)
        _tsc_v.setSpacing(6)
        self._typing_kind_row_widget_compact = QWidget()
        _kind_row_c = QHBoxLayout(self._typing_kind_row_widget_compact)
        _kind_row_c.setContentsMargins(0, 0, 0, 0)
        _kind_row_c.setSpacing(6)
        _kind_lbl_c = QLabel("종류")
        _kind_lbl_c.setObjectName("typingStyleLabel")
        _kind_lbl_c.setFixedWidth(52)
        _kind_row_c.addWidget(_kind_lbl_c)
        self._typing_kind_combo_compact = DownwardPopupComboBox()
        self._typing_kind_combo_compact.setObjectName("typingFontCombo")
        self._typing_kind_combo_compact.setEditable(False)
        self._typing_kind_combo_compact.addItems(
            [
                self._typing_generation_mode_text("problem"),
                self._typing_generation_mode_text("explanation"),
                self._typing_generation_mode_text("problem_and_explanation"),
            ]
        )
        self._typing_kind_combo_compact.setMinimumWidth(190)
        _kind_row_c.addWidget(self._typing_kind_combo_compact, 1)
        _tsc_v.addWidget(self._typing_kind_row_widget_compact)

        self._image_mode_row_widget_compact = QWidget()
        _img_mode_row_c = QHBoxLayout(self._image_mode_row_widget_compact)
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
            [
                self._image_mode_text("no_image"),
                self._image_mode_text("crop"),
                self._image_mode_text("ai_generate"),
            ]
        )
        self._image_mode_combo_compact.setMinimumWidth(140)
        _img_mode_row_c.addWidget(self._image_mode_combo_compact, 1)
        _tsc_v.addWidget(self._image_mode_row_widget_compact)
        self._typing_cost_hint_label_compact = QLabel("")
        self._typing_cost_hint_label_compact.setWordWrap(True)
        self._typing_cost_hint_label_compact.setStyleSheet(
            "font-size: 11px; color: #6b7280; padding-left: 52px; padding-top: 2px;"
        )
        _tsc_v.addWidget(self._typing_cost_hint_label_compact)
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
        self._typing_kind_combo_compact.currentTextChanged.connect(
            self._on_typing_generation_mode_changed_compact
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
        self._sync_typing_generation_mode_controls(source="", mode_key=self._typing_generation_mode)
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

        self._chat_file_panel = QFrame()
        self._chat_file_panel.setObjectName("chatFilePanel")
        self._chat_file_panel.setFixedWidth(270)
        self._chat_file_panel.setStyleSheet(
            "QFrame#chatFilePanel { background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 20px; }"
            "QLabel#chatFilePanelTitle { color: #111827; font-size: 13px; font-weight: 700; background: transparent; }"
            "QLabel#chatFilePanelHint { color: #6b7280; font-size: 11px; background: transparent; }"
            "QListWidget#chatFileList { background: transparent; border: none; padding: 0px; }"
            "QListWidget#chatFileList::item { border: none; padding: 0px; margin: 0 0 8px 0; }"
        )
        _chat_file_panel_lay = QVBoxLayout(self._chat_file_panel)
        _chat_file_panel_lay.setContentsMargins(14, 14, 14, 14)
        _chat_file_panel_lay.setSpacing(10)
        self._chat_file_panel_title = QLabel("첨부 파일")
        self._chat_file_panel_title.setObjectName("chatFilePanelTitle")
        _chat_file_panel_lay.addWidget(self._chat_file_panel_title)
        self._chat_file_panel_hint = QLabel("이미지나 PDF를 드래그하거나 + 버튼으로 추가")
        self._chat_file_panel_hint.setObjectName("chatFilePanelHint")
        self._chat_file_panel_hint.setWordWrap(True)
        _chat_file_panel_lay.addWidget(self._chat_file_panel_hint)
        _chat_file_panel_stack_host = QWidget()
        _chat_file_panel_stack_host.setStyleSheet("background: transparent; border: none;")
        self._chat_file_panel_stack = QStackedLayout(_chat_file_panel_stack_host)
        self._chat_file_panel_stack.setContentsMargins(0, 0, 0, 0)
        self._chat_file_empty_placeholder = DropPlaceholder()
        self._chat_file_empty_placeholder.setMinimumHeight(220)
        self._chat_file_empty_placeholder.clicked.connect(self.on_upload_image)
        self._chat_file_empty_placeholder.filesDropped.connect(self._on_files_dropped)
        self._chat_file_list = OrderListWidget()
        self._chat_file_list.setObjectName("chatFileList")
        self._chat_file_list.setSelectionMode(QListWidget.SelectionMode.NoSelection)
        self._chat_file_list.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self._chat_file_list.setVerticalScrollMode(QListWidget.ScrollMode.ScrollPerPixel)
        self._chat_file_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._chat_file_list.setDragDropMode(QListWidget.DragDropMode.NoDragDrop)
        self._chat_file_list.setDragEnabled(False)
        self._chat_file_list.setAcceptDrops(True)
        self._chat_file_list.setDropIndicatorShown(False)
        self._chat_file_list.filesDropped.connect(self._on_files_dropped)
        self._chat_file_panel_stack.addWidget(self._chat_file_empty_placeholder)
        self._chat_file_panel_stack.addWidget(self._chat_file_list)
        _chat_file_panel_lay.addWidget(_chat_file_panel_stack_host, 1)

        self._chat_container = QFrame()
        self._chat_container.setObjectName("chatContainer")
        self._chat_container.setStyleSheet(
            "QFrame#chatContainer { background: transparent; border: none; }"
            "QListWidget#chatThread { background: transparent; border: none; padding: 10px 0 4px 0;"
            "  font-size: 12px; color: #111827; outline: 0; }"
            "QListWidget#chatThread::item { border: none; padding: 0px; margin: 0px; }"
            "QTextEdit#chatInput { background: transparent; border: none; padding: 0px;"
            "  font-size: 15px; color: #111827; selection-background-color: #c7d2fe; }"
            "QTextEdit#chatInput:focus { border: none; }"
            "QFrame#chatComposer { background-color: #f3f4f6; border: none;"
            "  border-radius: 26px; }"
            "QPushButton#chatAttachBtn { background: transparent; border: none; border-radius: 18px; padding: 0px; }"
            "QPushButton#chatAttachBtn:hover { background-color: #e5e7eb; }"
            "QPushButton#chatVoiceBtn { background-color: #f5f3ff; color: #7c3aed; border: 1px solid #c4b5fd;"
            "  border-radius: 18px; padding: 0 12px; font-size: 12px; font-weight: 700; text-align: center; }"
            "QPushButton#chatVoiceBtn:hover { background-color: #ede9fe; border-color: #a78bfa; }"
            "QPushButton#chatVoiceBtn:pressed { background-color: #ddd6fe; }"
            "QPushButton#chatVoiceBtn:disabled { background-color: #f5f3ff; color: #a78bfa; border-color: #ddd6fe; }"
            "QFrame#chatVoicePreview { background-color: #faf5ff; border: 1px solid #ddd6fe; border-radius: 12px; }"
            "QLabel#chatVoicePreviewLabel { color: #6d28d9; font-size: 11px; font-weight: 600; background: transparent; }"
            "QPushButton#chatSendBtn { background-color: #6366f1; color: white; border: none;"
            "  border-radius: 10px; padding: 0 12px; font-size: 13px; font-weight: 600; }"
            "QPushButton#chatSendBtn:hover { background-color: #4f46e5; }"
            "QPushButton#chatSendBtn:pressed { background-color: #4338ca; }"
            "QPushButton#chatSendBtn:disabled { background-color: #c7c7cc; color: #f0f0f0; }"
            "QScrollBar:vertical { background: transparent; width: 8px; margin: 4px 0 4px 0; }"
            "QScrollBar::handle:vertical { background: #d4d4d8; border-radius: 4px; min-height: 24px; }"
            "QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }"
            "QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }"
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
        self._chat_thread.setSpacing(8)
        _chat_lay.addWidget(self._chat_thread, 1)

        self._chat_composer = QFrame()
        self._chat_composer.setObjectName("chatComposer")
        _chat_input_wrap = QVBoxLayout(self._chat_composer)
        _chat_input_wrap.setContentsMargins(16, 8, 16, 8)
        _chat_input_wrap.setSpacing(6)
        _chat_meta_row = QHBoxLayout()
        _chat_meta_row.setContentsMargins(0, 0, 0, 0)
        _chat_meta_row.setSpacing(6)
        _chat_meta_row.addWidget(self._chat_filename_chip, 0, Qt.AlignmentFlag.AlignLeft)
        _chat_meta_row.addWidget(self._chat_page_badge, 0, Qt.AlignmentFlag.AlignLeft)
        _chat_meta_row.addStretch(1)
        _chat_input_wrap.addLayout(_chat_meta_row)
        self._chat_attachment_scroll = QScrollArea()
        self._chat_attachment_scroll.setObjectName("chatAttachmentScroll")
        self._chat_attachment_scroll.setWidgetResizable(True)
        self._chat_attachment_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self._chat_attachment_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._chat_attachment_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._chat_attachment_scroll.setVisible(False)
        self._chat_attachment_scroll.setFixedHeight(76)
        self._chat_attachment_scroll.setStyleSheet(
            "QScrollArea#chatAttachmentScroll { background: transparent; border: none; }"
            "QScrollBar:horizontal { background: transparent; height: 8px; margin: 4px 10px 0 10px; }"
            "QScrollBar::handle:horizontal { background: #d4d4d8; border-radius: 4px; min-width: 24px; }"
            "QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0px; }"
            "QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal { background: transparent; }"
        )
        self._chat_attachment_strip = QWidget()
        self._chat_attachment_strip.setStyleSheet("background: transparent; border: none;")
        self._chat_attachment_strip_layout = QHBoxLayout(self._chat_attachment_strip)
        self._chat_attachment_strip_layout.setContentsMargins(0, 0, 0, 0)
        self._chat_attachment_strip_layout.setSpacing(10)
        self._chat_attachment_strip_layout.addStretch(1)
        self._chat_attachment_scroll.setWidget(self._chat_attachment_strip)
        _chat_input_wrap.addWidget(self._chat_attachment_scroll)
        self._chat_input = ChatComposeTextEdit()
        self._chat_input.setObjectName("chatInput")
        self._chat_input.setPlaceholderText("예: y=f(x) 수식과 근의 공식을 삽입해줘")
        self._chat_input.setMinimumHeight(48)
        self._chat_input.setMaximumHeight(100)
        _chat_input_wrap.addWidget(self._chat_input, 1)

        _chat_action_row = QHBoxLayout()
        _chat_action_row.setContentsMargins(0, 0, 0, 0)
        _chat_action_row.setSpacing(10)
        self._chat_attach_btn = QPushButton()
        self._chat_attach_btn.setObjectName("chatAttachBtn")
        self._chat_attach_btn.setFixedSize(36, 36)
        self._chat_attach_btn.setIcon(_material_icon(_MI_ADD, 26, QColor("#7c7f87")))
        self._chat_attach_btn.setIconSize(QSize(24, 24))
        self._chat_attach_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._chat_attach_btn.setToolTip("이미지 또는 PDF 업로드")
        self._chat_attach_btn.clicked.connect(self.on_upload_image)
        _chat_action_row.addWidget(self._chat_attach_btn)
        _chat_action_row.addStretch(1)
        self._chat_send_btn = QPushButton()
        self._chat_send_btn.setObjectName("chatSendBtn")
        self._chat_send_btn.setText("보내기")
        self._chat_send_btn.setFixedHeight(36)
        self._chat_send_btn.setIcon(_material_icon(_MI_ARROW_UP, 18, QColor("#ffffff")))
        self._chat_send_btn.setIconSize(QSize(18, 18))
        self._chat_send_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        _chat_action_row.addWidget(self._chat_send_btn)
        _chat_input_wrap.addLayout(_chat_action_row)
        _chat_lay.addWidget(self._chat_composer)

        self._chat_send_btn.clicked.connect(self._on_chat_send_clicked)
        self._chat_input.submitted.connect(self._on_chat_send_clicked)
        self._chat_input.filesDropped.connect(self._on_files_dropped)

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

        _header_mode_btn_css = (
            "QPushButton { background: transparent; color: #9ca3af; border: none;"
            "  padding: 0 6px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { color: #6b7280; }"
            "QPushButton:pressed { color: #4f46e5; }"
        )
        self._header_typing_btn = QPushButton("타이핑 모드")
        self._header_typing_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_typing_btn.setFixedHeight(24)
        self._header_typing_btn.setStyleSheet(_header_mode_btn_css)
        self._header_typing_btn.clicked.connect(self._on_header_typing_clicked)
        self._header_chat_btn = QPushButton("채팅 편집 모드")
        self._header_chat_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_chat_btn.setFixedHeight(24)
        self._header_chat_btn.setStyleSheet(_header_mode_btn_css)
        self._header_chat_btn.clicked.connect(self._on_header_chat_clicked)
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
        _h_lay.addWidget(self._header_typing_btn)
        _h_lay.addSpacing(6)
        _h_lay.addWidget(self._header_chat_btn)
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
        self._chat_page.setObjectName("chatPage")
        self._chat_page.setStyleSheet(
            "QWidget#chatPage { background-color: #ffffff; border-radius: 28px; }"
        )
        _chat_page_layout = QVBoxLayout(self._chat_page)
        _chat_page_layout.setContentsMargins(10, 8, 10, 8)
        _chat_page_layout.setSpacing(10)
        self._chat_file_panel.setVisible(False)
        _chat_page_layout.addWidget(self._chat_container, 1)

        self._content_stack_container = QWidget()
        self._content_stack = QStackedLayout(self._content_stack_container)
        self._content_stack.setContentsMargins(0, 0, 0, 0)
        self._content_stack.setSpacing(0)
        self._content_stack.addWidget(self._typing_page)
        self._content_stack.addWidget(self._chat_page)
        layout.addWidget(self._content_stack_container, 1)
        self._main_mode = "typing"
        self._typing_generation_mode = "problem"
        self._set_main_mode("typing")
        self._refresh_typing_mode_labels()

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
        self._timer.setInterval(1000)
        self._timer.timeout.connect(self._schedule_filename_update)
        self._timer.start()
        self._session_guard_timer = QTimer(self)
        self._session_guard_timer.setInterval(4000)
        self._session_guard_timer.timeout.connect(self._schedule_session_guard_check)
        self._session_guard_timer.start()
        self.update_filename()
        self._auto_type_after_ai = False
        self._current_code_index = -1
        self._current_code_item_id: str | None = None
        self._code_view_updating = False
        self._ai_error_messages: dict[int, str] = {}
        # Animate "????? status in the list.
        self._status_anim_timer = QTimer(self)
        self._status_anim_timer.setInterval(120)
        self._status_anim_timer.timeout.connect(self._tick_status_animation)

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
        """Open native login popup and start email/password authentication."""
        self._close_sidebar()
        self._sidebar._login_btn.setEnabled(False)
        self._sidebar._login_btn.setText("\uB85C\uADF8\uC778 \uC911..")

        user = get_stored_user() or {}
        dlg = CredentialsLoginDialog(self, email=str(user.get("email") or ""))
        if dlg.exec() != QDialog.DialogCode.Accepted:
            self._sidebar._login_btn.setEnabled(True)
            self._sidebar._login_btn.setText("\uB85C\uADF8\uC778")
            return

        email, password = dlg.credentials()
        self._login_worker = LoginWorker(email, password)
        self._login_worker.finished.connect(self._on_login_finished)
        self._login_worker.start()

    def _on_login_finished(self, success: bool, error_message: str = "") -> None:
        """OAuth ???????"""
        self._login_worker = None
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
            dlg = LoginResultDialog(self, success=False, message=error_message)
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

    def _on_header_typing_clicked(self) -> None:
        self._set_main_mode("typing")

    def _on_header_chat_clicked(self) -> None:
        self._set_main_mode("chat")

    def _header_mode_button_style(self, *, active: bool) -> str:
        if active:
            return (
                "QPushButton { background: transparent; color: #6366f1; border: none;"
                "  padding: 0 6px; font-size: 12px; font-weight: 800; }"
                "QPushButton:hover { color: #4f46e5; }"
                "QPushButton:pressed { color: #4338ca; }"
            )
        return (
            "QPushButton { background: transparent; color: #9ca3af; border: none;"
            "  padding: 0 6px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { color: #6b7280; }"
            "QPushButton:pressed { color: #6366f1; }"
        )

    def _refresh_header_mode_buttons(self) -> None:
        if (
            not hasattr(self, "_header_typing_btn")
            or not hasattr(self, "_header_chat_btn")
        ):
            return
        typing_active = getattr(self, "_main_mode", "typing") == "typing"
        chat_active = getattr(self, "_main_mode", "typing") == "chat"
        self._header_typing_btn.setStyleSheet(self._header_mode_button_style(active=typing_active))
        self._header_chat_btn.setStyleSheet(self._header_mode_button_style(active=chat_active))

    def _refresh_typing_mode_labels(self) -> None:
        mode = getattr(self, "_typing_generation_mode", "problem")
        count = len(getattr(self, "selected_images", []) or [])
        if hasattr(self, "_generated_code_label"):
            label_map = {
                "problem": "생성 문제 코드",
                "explanation": "생성 해설 코드",
                "problem_and_explanation": "생성 문제+해설 코드",
            }
            self._generated_code_label.setText(label_map.get(mode, "생성 코드"))
        if hasattr(self, "order_title"):
            prefix_map = {
                "problem": "문제 타이핑 순서",
                "explanation": "해설 타이핑 순서",
                "problem_and_explanation": "문제+해설 타이핑 순서",
            }
            prefix = prefix_map.get(mode, "타이핑 순서")
            if count > 0:
                self.order_title.setText(f"{prefix}: {count}개 선택됨")
            else:
                self.order_title.setText(f"{prefix}: (없음)")
        self._refresh_typing_cost_hint_labels()
        self._refresh_header_mode_buttons()

    @staticmethod
    def _typing_generation_base_cost(mode_key: str) -> int:
        return 2 if mode_key == "problem_and_explanation" else 1

    @classmethod
    def _typing_generation_mode_text(cls, mode_key: str) -> str:
        cost = cls._typing_generation_base_cost(mode_key)
        mapping = {
            "problem": f"문제만 타이핑하기 ({cost}크레딧)",
            "explanation": f"해설만 타이핑하기 ({cost}크레딧)",
            "problem_and_explanation": f"문제+해설 타이핑하기 ({cost}크레딧)",
        }
        return mapping.get(mode_key, mapping["problem"])

    @staticmethod
    def _typing_generation_mode_key_from_text(text: str) -> str:
        normalized = (text or "").strip()
        if normalized.startswith("문제+해설 타이핑하기"):
            return "problem_and_explanation"
        if normalized.startswith("해설만 타이핑하기"):
            return "explanation"
        if normalized.startswith("문제만 타이핑하기"):
            return "problem"
        return "problem"

    def _sync_typing_generation_mode_controls(self, *, source: str, mode_key: str) -> None:
        mode_text = self._typing_generation_mode_text(mode_key)
        if source != "main" and hasattr(self, "_typing_kind_combo"):
            blocked = self._typing_kind_combo.blockSignals(True)
            self._typing_kind_combo.setCurrentText(mode_text)
            self._typing_kind_combo.blockSignals(blocked)
        if source != "compact" and hasattr(self, "_typing_kind_combo_compact"):
            blocked = self._typing_kind_combo_compact.blockSignals(True)
            self._typing_kind_combo_compact.setCurrentText(mode_text)
            self._typing_kind_combo_compact.blockSignals(blocked)

    def _set_typing_generation_mode(self, mode: str) -> None:
        normalized = (mode or "").strip().lower()
        if normalized not in {"problem", "explanation", "problem_and_explanation"}:
            normalized = "problem"
        next_mode = normalized
        self._typing_generation_mode = next_mode
        self._sync_typing_generation_mode_controls(source="", mode_key=next_mode)
        self._refresh_typing_mode_labels()

    def _set_main_mode(self, mode: str) -> None:
        next_mode = "chat" if mode == "chat" else "typing"
        self._main_mode = next_mode
        if not hasattr(self, "_content_stack"):
            return

        if next_mode == "chat":
            self._content_stack.setCurrentWidget(self._chat_page)
            if hasattr(self, "_header_typing_btn"):
                self._header_typing_btn.setToolTip("타이핑 화면을 엽니다.")
            if hasattr(self, "_header_chat_btn"):
                self._header_chat_btn.setToolTip("채팅 편집 화면을 엽니다.")
            if hasattr(self, "_chat_input"):
                self._chat_input.setFocus()
        else:
            self._content_stack.setCurrentWidget(self._typing_page)
            if hasattr(self, "_header_typing_btn"):
                self._header_typing_btn.setToolTip("타이핑 화면을 엽니다.")
            if hasattr(self, "_header_chat_btn"):
                self._header_chat_btn.setToolTip("채팅 편집 화면을 엽니다.")

        self._refresh_header_mode_buttons()
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
        self._refresh_chat_message_widths()
        if hasattr(self, "_header_user_btn") and hasattr(self, "_header_user_area"):
            self._header_user_btn.setGeometry(
                0, 0, self._header_user_area.width(), self._header_user_area.height()
            )
        
        if hasattr(self, "_sidebar_overlay") and self._sidebar_overlay.isVisible():
            self._sidebar_overlay.setGeometry(0, 0, self.width(), self.height())
        if hasattr(self, "_sidebar") and self._sidebar.isVisible():
            self._sidebar.setGeometry(0, 0, 300, self.height())

    def _chat_message_max_width(self) -> int:
        if hasattr(self, "_chat_thread") and self._chat_thread.viewport() is not None:
            viewport_width = max(240, self._chat_thread.viewport().width())
            return min(420, max(220, int(viewport_width * 0.72)))
        return 360

    def _refresh_chat_message_widths(self) -> None:
        if not hasattr(self, "_chat_thread"):
            return
        max_width = self._chat_message_max_width()
        for idx in range(self._chat_thread.count()):
            item = self._chat_thread.item(idx)
            widget = self._chat_thread.itemWidget(item)
            if isinstance(widget, ChatMessageWidget):
                widget.set_max_width(max_width)
                item.setSizeHint(widget.sizeHint())

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
            "Nova AI v2.1.1\n\n"
            "\uC218\uB2A5 \uD615\uC2DD \uD0C0\uC774\uD551 AI\n\n"
            "https://nova-ai.work",
        )

    def _tick_status_animation(self) -> None:
        try:
            if not self._should_run_order_animation():
                if self._status_anim_timer.isActive():
                    self._status_anim_timer.stop()
                return
            self._order_delegate.advance()
            self.order_list.viewport().update()
        except Exception:
            pass

    def _should_run_order_animation(self) -> bool:
        animating_statuses = {"생성중...", "타이핑중..."}
        return any(status in animating_statuses for status in self._gen_statuses)

    def _sync_order_animation_timer(self) -> None:
        should_run = self._should_run_order_animation()
        if should_run and not self._status_anim_timer.isActive():
            self._status_anim_timer.start()
        elif not should_run and self._status_anim_timer.isActive():
            self._status_anim_timer.stop()

    def _refresh_order_status_items(self) -> None:
        if self.order_list.count() != len(self.selected_images):
            self._render_order_list()
            return
        for idx, upload_item in enumerate(self.selected_images):
            item = self.order_list.item(idx)
            if item is None:
                self._render_order_list()
                return
            name = upload_item.order_title
            status = self._gen_statuses[idx] if idx < len(self._gen_statuses) else "대기중"
            item.setText(f"{idx + 1}. {name} - {status}")
            item.setData(Qt.ItemDataRole.UserRole, upload_item.item_id)
        self._sync_order_animation_timer()

    @staticmethod
    def _upload_item_ai_path(upload_item: UploadItem | None) -> str | None:
        if upload_item is None:
            return None
        path = str(upload_item.ai_input_path or "").strip()
        return path or None

    @staticmethod
    def _upload_item_crop_source_path(upload_item: UploadItem | None) -> str | None:
        if upload_item is None:
            return None
        path = str(upload_item.crop_source_path or "").strip()
        return path or None

    @staticmethod
    def _upload_item_display_name(upload_item: UploadItem | None) -> str:
        if upload_item is None:
            return ""
        return upload_item.order_title

    def _selected_attachment_paths(self) -> list[str]:
        paths: list[str] = []
        for upload_item in self.selected_images:
            path = self._upload_item_ai_path(upload_item)
            if path:
                paths.append(path)
        return paths

    def _find_selected_index_by_item_id(self, item_id: str) -> int:
        normalized = str(item_id or "").strip()
        if not normalized:
            return -1
        for idx, upload_item in enumerate(self.selected_images):
            if upload_item.item_id == normalized:
                return idx
        return -1

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
            self._add_selected_images(file_paths)

    def _on_files_dropped(self, file_paths: list[str]) -> None:
        if file_paths:
            self._add_selected_images(file_paths)

    @staticmethod
    def _should_animate_chat_status(message: str) -> bool:
        normalized = (message or "").strip()
        if not normalized:
            return False
        if normalized.endswith("..."):
            return True
        return any(
            token in normalized
            for token in (
                "해석중",
                "입력하는 중",
                "적용하는 중",
                "반영합니다...",
            )
        )

    @staticmethod
    def _is_default_chat_completion_reply(message: str) -> bool:
        normalized = re.sub(r"\s+", " ", str(message or "")).strip()
        return normalized in {
            "",
            "감지된 한글 문서에 요청하신 내용을 입력합니다.",
            "감지된 한글 문서에 입력을 완료했습니다.",
            "처리를 완료했습니다.",
        }

    def _append_chat_message_widget(self, role: str, text: str) -> tuple[QListWidgetItem, ChatMessageWidget] | tuple[None, None]:
        message = (text or "").strip()
        if not message or not hasattr(self, "_chat_thread"):
            return None, None
        item = QListWidgetItem()
        item.setFlags(Qt.ItemFlag.NoItemFlags)
        widget = ChatMessageWidget(role, message, self._chat_message_max_width(), self._chat_thread)
        item.setSizeHint(widget.sizeHint())
        self._chat_thread.addItem(item)
        self._chat_thread.setItemWidget(item, widget)
        self._chat_thread.scrollToBottom()
        return item, widget

    def _begin_chat_pipeline_status(self, text: str) -> None:
        item, widget = self._append_chat_message_widget("status", text)
        if isinstance(widget, ChatMessageWidget):
            widget.set_status_animating(self._should_animate_chat_status(text))
        self._chat_pipeline_status_item = item
        self._chat_pipeline_status_widget = widget if isinstance(widget, ChatMessageWidget) else None

    def _update_chat_pipeline_status(self, text: str, *, finished: bool = False) -> None:
        if not isinstance(self._chat_pipeline_status_widget, ChatMessageWidget) or self._chat_pipeline_status_item is None:
            self._begin_chat_pipeline_status(text)
            return
        self._chat_pipeline_status_widget.set_text(text)
        self._chat_pipeline_status_widget.set_status_animating(
            False if finished else self._should_animate_chat_status(text)
        )
        self._chat_pipeline_status_item.setSizeHint(self._chat_pipeline_status_widget.sizeHint())
        self._chat_thread.scrollToBottom()

    def _clear_chat_pipeline_status(self) -> None:
        self._chat_pipeline_status_item = None
        self._chat_pipeline_status_widget = None

    def _append_chat_message(self, role: str, text: str) -> None:
        message = (text or "").strip()
        if not message:
            return
        if role != "status":
            self._clear_chat_pipeline_status()
        item, widget = self._append_chat_message_widget(role, message)
        if role == "status" and isinstance(widget, ChatMessageWidget):
            widget.set_status_animating(self._should_animate_chat_status(message))

    def _is_chat_pipeline_busy(self) -> bool:
        return bool(
            (self._chat_worker and self._chat_worker.isRunning())
            or self._chat_typing_pending
        )

    def _start_chat_worker(self, message: str) -> None:
        self._begin_chat_pipeline_status("AI가 해석중...")
        self._set_chat_busy(True)
        current_filename = self._current_detected_filename() or ""
        self._chat_worker = ChatWorker(
            message,
            current_filename,
            attachment_paths=self._selected_attachment_paths(),
        )
        self._chat_worker.finished.connect(self._on_chat_worker_finished)
        self._chat_worker.error.connect(self._on_chat_worker_error)
        self._chat_worker.start()

    def _submit_chat_message(self, message: str, *, from_voice: bool = False) -> None:
        normalized = (message or "").strip()
        if not normalized:
            return
        self._append_chat_message("user", normalized)
        if from_voice and self._is_chat_pipeline_busy():
            self._queued_chat_messages.append(normalized)
            self._append_chat_message("status", "이전 요청 처리 후 음성 명령을 이어서 반영합니다...")
            return
        if self._is_chat_pipeline_busy():
            self._queued_chat_messages.append(normalized)
            self._append_chat_message("status", "이전 요청 처리 후 이어서 반영합니다...")
            return
        self._start_chat_worker(normalized)

    def _drain_queued_chat_messages(self) -> None:
        if self._is_chat_pipeline_busy() or not self._queued_chat_messages:
            return
        next_message = self._queued_chat_messages.pop(0).strip()
        if next_message:
            self._start_chat_worker(next_message)

    def _set_chat_busy(self, busy: bool) -> None:
        self._chat_send_btn.setEnabled(not busy)
        if hasattr(self, "_chat_attach_btn"):
            self._chat_attach_btn.setEnabled(not busy)
        self._chat_input.setReadOnly(busy)
        if busy:
            self._chat_input.setPlaceholderText("AI가 편집 요청을 처리하는 중입니다...")
        else:
            self._chat_input.setPlaceholderText("예: y=f(x) 수식과 근의 공식을 삽입해줘")

    def _on_chat_send_clicked(self) -> None:
        message = self._chat_input.toPlainText().strip()
        if not message:
            return
        self._chat_input.clear()
        self._submit_chat_message(message)

    def _update_chat_voice_button(self) -> None:
        if not hasattr(self, "_chat_voice_btn"):
            return
        if self._hide_voice_edit_ui:
            self._chat_voice_btn.hide()
            return
        if self._voice_session_active:
            self._chat_voice_btn.setText("음성 편집중")
            self._chat_voice_btn.setIcon(_material_icon(_MI_MIC, 20, QColor("#ffffff")))
            self._chat_voice_btn.setIconSize(QSize(18, 18))
            self._chat_voice_btn.setStyleSheet(
                "QPushButton#chatVoiceBtn { background-color: #7c3aed; color: #ffffff; border: 1px solid #7c3aed;"
                "  border-radius: 18px; padding: 0 12px; font-size: 12px; font-weight: 700; text-align: center; }"
                "QPushButton#chatVoiceBtn:hover { background-color: #6d28d9; border-color: #6d28d9; }"
                "QPushButton#chatVoiceBtn:pressed { background-color: #5b21b6; }"
            )
        else:
            self._chat_voice_btn.setText("음성 편집")
            self._chat_voice_btn.setIcon(_material_icon(_MI_MIC, 20, QColor("#7c3aed")))
            self._chat_voice_btn.setIconSize(QSize(18, 18))
            self._chat_voice_btn.setStyleSheet(
                "QPushButton#chatVoiceBtn { background-color: #f5f3ff; color: #7c3aed; border: 1px solid #c4b5fd;"
                "  border-radius: 18px; padding: 0 12px; font-size: 12px; font-weight: 700; text-align: center; }"
                "QPushButton#chatVoiceBtn:hover { background-color: #ede9fe; border-color: #a78bfa; }"
                "QPushButton#chatVoiceBtn:pressed { background-color: #ddd6fe; }"
            )

    @staticmethod
    def _truncate_voice_preview(text: str, max_chars: int = 60) -> str:
        normalized = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(normalized) <= max_chars:
            return normalized
        return normalized[: max_chars - 1].rstrip() + "…"

    def _update_voice_preview(self) -> None:
        if not hasattr(self, "_chat_voice_preview"):
            return
        if self._hide_voice_edit_ui:
            self._chat_voice_preview.hide()
            self._chat_voice_preview_label.setText("")
            return
        show_preview = bool(self._voice_session_active or self._voice_preview_text or self._voice_preview_status)
        self._chat_voice_preview.setVisible(show_preview)
        if not show_preview:
            self._chat_voice_preview_label.setText("")
            return

        status = self._voice_preview_status.strip()
        preview = self._truncate_voice_preview(self._voice_preview_text)
        if status and preview:
            self._chat_voice_preview_label.setText(f"{status}  {preview}")
        elif status:
            self._chat_voice_preview_label.setText(status)
        else:
            self._chat_voice_preview_label.setText(preview)

    def _set_voice_preview(self, *, status: str | None = None, text: str | None = None) -> None:
        if status is not None:
            self._voice_preview_status = status
        if text is not None:
            self._voice_preview_text = text
        self._update_voice_preview()

    def _voice_bytes_per_ms(self) -> float:
        return 32.0

    def _append_voice_pcm_chunk(self, chunk: bytes) -> None:
        if not chunk:
            return
        with self._voice_audio_lock:
            self._voice_pcm_buffer.extend(chunk)
        if self._pcm_chunk_has_voice(chunk):
            self._voice_detected_speech = True
            self._voice_last_active_at = time.time()

    def _voice_buffer_duration_ms(self) -> float:
        with self._voice_audio_lock:
            return len(self._voice_pcm_buffer) / self._voice_bytes_per_ms()

    def _take_voice_pcm_buffer(self) -> bytes:
        with self._voice_audio_lock:
            pcm_data = bytes(self._voice_pcm_buffer)
            self._voice_pcm_buffer.clear()
        return pcm_data

    def _clear_voice_pcm_buffer(self) -> None:
        with self._voice_audio_lock:
            self._voice_pcm_buffer.clear()

    def _on_sounddevice_audio_callback(self, indata, frames, time_info, status) -> None:  # type: ignore[no-untyped-def]
        try:
            chunk = bytes(indata)
        except Exception:
            chunk = b""
        self._append_voice_pcm_chunk(chunk)

    def _pcm_chunk_has_voice(self, pcm_data: bytes) -> bool:
        if not pcm_data:
            return False
        usable = len(pcm_data) - (len(pcm_data) % 2)
        if usable <= 0:
            return False
        view = memoryview(pcm_data[:usable]).cast("h")
        if not view:
            return False
        sample_step = max(1, len(view) // 240)
        peak = max(abs(int(view[idx])) for idx in range(0, len(view), sample_step))
        return peak >= 900

    def _write_voice_wav_file(self, pcm_data: bytes) -> str:
        out_dir = Path(tempfile.gettempdir()) / "nova_ai" / "voice_segments"
        out_dir.mkdir(parents=True, exist_ok=True)
        self._voice_chunk_counter += 1
        wav_path = out_dir / f"voice_{int(time.time() * 1000)}_{self._voice_chunk_counter}.wav"
        with wave.open(str(wav_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)
            wav_file.writeframes(pcm_data)
        return str(wav_path)

    def _cleanup_voice_file(self, path: str) -> None:
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except Exception:
            pass

    def _start_voice_session(self) -> None:
        if self._voice_session_active:
            return
        self._voice_audio_backend = ""
        self._voice_audio_source = None
        self._voice_audio_device = None
        self._voice_sd_stream = None

        start_error = ""
        try:
            import sounddevice as sd  # type: ignore

            self._voice_sd_stream = sd.RawInputStream(
                samplerate=16000,
                channels=1,
                dtype="int16",
                callback=self._on_sounddevice_audio_callback,
            )
            self._voice_sd_stream.start()
            self._voice_audio_backend = "sounddevice"
        except Exception as exc:
            start_error = str(exc)
            self._voice_sd_stream = None

        if not self._voice_audio_backend:
            audio_input = QMediaDevices.defaultAudioInput()
            if audio_input.isNull():
                QMessageBox.warning(self, "알림", "사용 가능한 마이크를 찾지 못했습니다.")
                return

            audio_format = QAudioFormat()
            audio_format.setSampleRate(16000)
            audio_format.setChannelCount(1)
            audio_format.setSampleFormat(QAudioFormat.SampleFormat.Int16)

            try:
                self._voice_audio_source = QAudioSource(audio_input, audio_format, self)
                self._voice_audio_device = self._voice_audio_source.start()
            except Exception as exc:
                self._voice_audio_source = None
                self._voice_audio_device = None
                QMessageBox.warning(self, "알림", f"마이크를 시작하지 못했습니다: {start_error or exc}")
                return

            if self._voice_audio_device is None:
                QMessageBox.warning(self, "알림", "마이크 입력 장치를 열지 못했습니다.")
                self._voice_audio_source = None
                return
            self._voice_audio_backend = "qt"

        self._clear_voice_pcm_buffer()
        self._voice_last_active_at = 0.0
        self._voice_segment_started_at = time.time()
        self._voice_detected_speech = False
        self._voice_preview_text = ""
        self._set_voice_preview(status="듣는 중...", text="")
        self._voice_session_active = True
        if self._voice_audio_backend == "qt" and self._voice_audio_device is not None:
            self._voice_audio_device.readyRead.connect(self._on_voice_audio_ready_read)
        self._voice_poll_timer.start()
        self._update_chat_voice_button()
        self._append_chat_message("status", "음성 편집을 시작했습니다. 말씀하시면 실시간으로 편집 요청을 반영합니다.")

    def _stop_voice_session(self) -> None:
        was_active = self._voice_session_active
        self._voice_session_active = False
        self._voice_poll_timer.stop()
        self._flush_voice_segment(force=True)
        if self._voice_sd_stream is not None:
            try:
                self._voice_sd_stream.stop()
                self._voice_sd_stream.close()
            except Exception:
                pass
        if self._voice_audio_source is not None:
            try:
                self._voice_audio_source.stop()
            except Exception:
                pass
        self._voice_sd_stream = None
        self._voice_audio_source = None
        self._voice_audio_device = None
        self._voice_audio_backend = ""
        self._clear_voice_pcm_buffer()
        self._voice_detected_speech = False
        self._voice_last_active_at = 0.0
        self._voice_segment_started_at = 0.0
        self._voice_preview_status = ""
        self._voice_preview_text = ""
        self._update_chat_voice_button()
        self._update_voice_preview()
        if was_active:
            self._append_chat_message("status", "음성 편집을 종료했습니다.")

    def _on_chat_voice_clicked(self) -> None:
        if self._voice_session_active:
            self._stop_voice_session()
        else:
            self._start_voice_session()

    def _on_voice_audio_ready_read(self) -> None:
        if not self._voice_session_active or self._voice_audio_device is None:
            return
        try:
            raw = self._voice_audio_device.readAll()
            chunk = bytes(raw.data()) if hasattr(raw, "data") else bytes(raw)
        except Exception:
            chunk = b""
        self._append_voice_pcm_chunk(chunk)
        if chunk and self._voice_detected_speech:
            self._set_voice_preview(status="듣는 중...", text=self._voice_preview_text)

    def _poll_voice_segment(self) -> None:
        if not self._voice_session_active:
            return
        if self._voice_transcription_worker and self._voice_transcription_worker.isRunning():
            self._set_voice_preview(status="인식 중...", text=self._voice_preview_text)
            return
        if self._voice_detected_speech:
            self._set_voice_preview(status="듣는 중...", text=self._voice_preview_text)
        else:
            self._set_voice_preview(status="대기 중...", text=self._voice_preview_text)
        duration_ms = self._voice_buffer_duration_ms()
        if duration_ms < 1200 or not self._voice_detected_speech:
            return
        now = time.time()
        silence_sec = (now - self._voice_last_active_at) if self._voice_last_active_at else 0.0
        if duration_ms >= 2500 or silence_sec >= 0.7:
            self._flush_voice_segment(force=False)

    def _flush_voice_segment(self, force: bool) -> None:
        if self._voice_transcription_worker and self._voice_transcription_worker.isRunning():
            return
        duration_ms = self._voice_buffer_duration_ms()
        if duration_ms <= 0:
            return
        if not self._voice_detected_speech:
            if force:
                self._clear_voice_pcm_buffer()
            return
        if not force and duration_ms < 1200:
            return
        pcm_data = self._take_voice_pcm_buffer()
        self._voice_detected_speech = False
        self._voice_last_active_at = 0.0
        self._voice_segment_started_at = time.time()
        self._set_voice_preview(status="인식 중...", text=self._voice_preview_text)
        wav_path = self._write_voice_wav_file(pcm_data)
        worker = VoiceTranscriptionWorker(wav_path, parent=self)
        worker.transcription_finished.connect(self._on_voice_transcription_finished)
        worker.transcription_error.connect(self._on_voice_transcription_error)
        worker.finished.connect(self._on_voice_transcription_thread_finished)
        self._voice_transcription_worker = worker
        worker.start()

    def _on_voice_transcription_finished(self, transcript: str, wav_path: str) -> None:
        self._cleanup_voice_file(wav_path)
        normalized = re.sub(r"\s+", " ", str(transcript or "")).strip()
        if not normalized:
            self._set_voice_preview(status="듣는 중...", text=self._voice_preview_text)
            return
        merged_preview = f"{self._voice_preview_text} {normalized}".strip()
        self._set_voice_preview(status="미리보기", text=merged_preview)
        self._submit_chat_message(normalized, from_voice=True)

    def _on_voice_transcription_error(self, message: str, wav_path: str) -> None:
        self._cleanup_voice_file(wav_path)
        clean = _normalize_runtime_error_message(message)
        self._set_voice_preview(status="오류", text=clean)
        self._append_chat_message("assistant", f"음성 인식 중 오류가 발생했습니다: {clean}")

    def _on_voice_transcription_thread_finished(self) -> None:
        worker = self.sender()
        if isinstance(worker, QThread):
            worker.deleteLater()
        if worker is self._voice_transcription_worker:
            self._voice_transcription_worker = None

    def closeEvent(self, event) -> None:  # type: ignore[override]
        try:
            if self._voice_session_active:
                self._stop_voice_session()
            worker = self._voice_transcription_worker
            if worker is not None and worker.isRunning():
                worker.wait(5000)
        except Exception:
            pass
        super().closeEvent(event)

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
        script = ""
        if isinstance(payload, dict):
            reply = str(payload.get("reply") or "").strip()
            raw_actions = payload.get("actions")
            if isinstance(raw_actions, list):
                actions = [a for a in raw_actions if isinstance(a, dict)]
            script = str(payload.get("script") or "").strip()
        if actions:
            self._update_chat_pipeline_status("적용하는 중...")
        action_logs = self._execute_chat_actions(actions)
        for log in action_logs:
            self._update_chat_pipeline_status(log)
        if script:
            self._ensure_typing_worker()
            self._chat_typing_pending = True
            self._chat_pending_reply = reply or ""
            queue_target = ""
            if not any(str(action.get("name") or "") == "open_new_file" for action in actions):
                queue_target = self._current_detected_filename()
            self._update_chat_pipeline_status("감지된 한글 문서에 입력하는 중...")
            self._typing_worker.enqueue(-2, script, queue_target or None)
            return
        if not reply:
            reply = "처리를 완료했습니다."
        self._append_chat_message("assistant", reply)
        self._set_chat_busy(False)
        self._drain_queued_chat_messages()

    def _on_chat_worker_error(self, message: str) -> None:
        self._chat_typing_pending = False
        self._chat_pending_reply = ""
        self._set_chat_busy(False)
        self._chat_worker = None
        self._update_chat_pipeline_status("요청 처리 중 오류가 발생했습니다.", finished=True)
        self._append_chat_message("assistant", f"요청 처리 중 오류가 발생했습니다: {message}")
        self._drain_queued_chat_messages()

    def on_ai_run(self) -> None:
        self._start_ai_run(auto_type=False)

    def on_ai_type_run(self) -> None:
        generation_mode = getattr(self, "_typing_generation_mode", "problem")
        if generation_mode == "explanation":
            self._set_typing_status("해설 생성중...")
        elif generation_mode == "problem_and_explanation":
            self._set_typing_status("문제+해설 생성중...")
        elif self._image_mode == "ai_generate":
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
        remaining_credits = self._get_remaining_send_quota()
        base_cost = self._typing_generation_base_cost(getattr(self, "_typing_generation_mode", "problem"))
        remaining_slots = remaining_credits // max(1, base_cost)
        if remaining_slots <= 0:
            QMessageBox.warning(self, "\uC54C\uB9BC", "\uB0A8\uC740 \uC0AC\uC6A9 \uD69F\uC218\uAC00 \uC5C6\uC5B4 \uC2E4\uD589\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.")
            return
        if len(self.selected_images) > remaining_slots:
            exceeded = len(self.selected_images) - remaining_slots
            QMessageBox.warning(
                self,
                "\uC54C\uB9BC",
                f"\uD604\uC7AC \uB0A8\uC740 \uD06C\uB808\uB527\uC740 {remaining_credits}\uC785\uB2C8\uB2E4.\n"
                f"\uD604\uC7AC \uBAA8\uB4DC\uB294 \uBB38\uC81C\uB2F9 {base_cost}\uD06C\uB808\uB527\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.\n"
                f"\uC120\uD0DD\uD55C {len(self.selected_images)}\uAC1C \uC911 {exceeded}\uAC1C\uB294 \uC81C\uC678\uB429\uB2C8\uB2E4.\n"
                "\uB0A8\uC740 \uD06C\uB808\uB527 \uBC94\uC704 \uB0B4\uC5D0\uC11C\uB9CC \uCC98\uB9AC\uB429\uB2C8\uB2E4.",
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
            list(self.selected_images),
            image_mode=self._image_mode,
            generation_mode=self._typing_generation_mode,
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
        self._chat_file_list.clear()
        if hasattr(self, "_chat_attachment_strip_layout"):
            while self._chat_attachment_strip_layout.count():
                item = self._chat_attachment_strip_layout.takeAt(0)
                widget = item.widget()
                if widget is not None:
                    widget.deleteLater()
        if not self.selected_images:
            self._refresh_typing_mode_labels()
            if hasattr(self, "_chat_attachment_scroll"):
                self._chat_attachment_scroll.setVisible(False)
            self._update_order_list_visibility()
            self._update_replay_button_visibility()
            return
        self._refresh_typing_mode_labels()
        for idx, upload_item in enumerate(self.selected_images):
            name = self._upload_item_display_name(upload_item)
            status = self._gen_statuses[idx] if idx < len(self._gen_statuses) else "\uB300\uAE30\uC911"
            item = QListWidgetItem(f"{idx + 1}. {name} - {status}")
            item.setData(Qt.ItemDataRole.UserRole, upload_item.item_id)
            self.order_list.addItem(item)
            chat_item = QListWidgetItem()
            chat_item.setData(Qt.ItemDataRole.UserRole, upload_item.item_id)
            chat_card = ChatAttachmentCard(
                upload_item,
                removable=self._is_order_editable(),
                parent=self._chat_file_list,
            )
            chat_card.remove_clicked.connect(self._on_chat_attachment_remove_clicked)
            chat_item.setSizeHint(chat_card.sizeHint())
            self._chat_file_list.addItem(chat_item)
            self._chat_file_list.setItemWidget(chat_item, chat_card)
            if hasattr(self, "_chat_attachment_strip_layout"):
                inline_card = ChatAttachmentCard(
                    upload_item,
                    removable=self._is_order_editable(),
                    parent=self._chat_attachment_strip,
                    compact=True,
                )
                inline_card.setFixedWidth(188)
                inline_card.remove_clicked.connect(self._on_chat_attachment_remove_clicked)
                self._chat_attachment_strip_layout.addWidget(inline_card, 0, Qt.AlignmentFlag.AlignLeft)
        if hasattr(self, "_chat_attachment_strip_layout"):
            self._chat_attachment_strip_layout.addStretch(1)
        if hasattr(self, "_chat_attachment_scroll"):
            self._chat_attachment_scroll.setVisible(True)
        self._update_order_list_visibility()
        self._update_replay_button_visibility()
        self._sync_order_animation_timer()

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
        self._refresh_order_status_items()

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
                    self._refresh_order_status_items()
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
            self._refresh_order_status_items()
            self._set_typing_status("\uD0C0\uC774\uD551 \uC9C4\uD589\uC911...")
            target_filename = self._current_detected_filename()
            # Pass original image path so insert_cropped_image can crop from it
            src_item = self.selected_images[idx] if idx < len(self.selected_images) else None
            src_img = self._upload_item_crop_source_path(src_item)
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
            "ai_generate": "AI 이미지 생성하기 (성공 건당 +1크레딧)",
        }
        return mapping.get(mode_key, mapping["crop"])

    @staticmethod
    def _image_mode_key_from_text(text: str) -> str:
        normalized = (text or "").strip()
        if normalized.startswith("AI 이미지 생성하기"):
            return "ai_generate"
        if normalized.startswith("이미지 없이 생성하기"):
            return "no_image"
        if normalized.startswith("이미지 크롭해서 생성하기"):
            return "crop"
        return "crop"

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
        self._refresh_typing_cost_hint_labels()

    def _current_typing_cost_hint_text(self) -> str:
        mode = getattr(self, "_typing_generation_mode", "problem")
        image_mode = getattr(self, "_image_mode", "crop")
        base_cost = self._typing_generation_base_cost(mode)
        if image_mode == "ai_generate":
            return (
                f"기본 차감: {base_cost}크레딧. "
                "AI 이미지 생성이 실제로 성공한 경우에만 이미지 1건당 1크레딧이 추가 차감됩니다."
            )
        return f"기본 차감: {base_cost}크레딧."

    def _refresh_typing_cost_hint_labels(self) -> None:
        text = self._current_typing_cost_hint_text()
        if hasattr(self, "_typing_cost_hint_label"):
            self._typing_cost_hint_label.setText(text)
        if hasattr(self, "_typing_cost_hint_label_compact"):
            self._typing_cost_hint_label_compact.setText(text)

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

    def _on_typing_generation_mode_changed(self) -> None:
        if not hasattr(self, "_typing_kind_combo"):
            return
        key = self._typing_generation_mode_key_from_text(self._typing_kind_combo.currentText())
        self._set_typing_generation_mode(key)
        self._sync_typing_generation_mode_controls(source="main", mode_key=key)

    def _on_typing_generation_mode_changed_compact(self) -> None:
        if not hasattr(self, "_typing_kind_combo_compact"):
            return
        key = self._typing_generation_mode_key_from_text(
            self._typing_kind_combo_compact.currentText()
        )
        self._set_typing_generation_mode(key)
        self._sync_typing_generation_mode_controls(source="compact", mode_key=key)

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
            self._refresh_order_status_items()
        self._set_typing_status("\uD0C0\uC774\uD551 \uC9C4\uD589\uC911...")

    def _on_typing_item_finished(self, idx: int) -> None:
        if idx == -2 and self._chat_typing_pending:
            self._chat_typing_pending = False
            reply = self._chat_pending_reply or ""
            self._chat_pending_reply = ""
            self._update_chat_pipeline_status("감지된 한글 문서에 요청하신 내용을 입력합니다.", finished=True)
            if not self._is_default_chat_completion_reply(reply):
                self._append_chat_message("assistant", reply)
            self._set_chat_busy(False)
            self._drain_queued_chat_messages()
            if not self._auto_type_after_ai and self._auto_type_pending_idx is None:
                self._set_typing_status("\uD0C0\uC774\uD551 \uC644\uB8CC")
            return
        if idx >= 0 and idx < len(self._gen_statuses):
            self._gen_statuses[idx] = "\uD0C0\uC774\uD551 \uC644\uB8CC"
            self._refresh_order_status_items()
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
        if self._chat_typing_pending:
            self._chat_typing_pending = False
            self._chat_pending_reply = ""
            self._set_chat_busy(False)
            self._update_chat_pipeline_status("\uD55C\uAE00 \uBB38\uC11C \uC785\uB825\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", finished=True)
            self._drain_queued_chat_messages()
        pending_idx = self._auto_type_pending_idx
        self._auto_type_after_ai = False
        self._auto_type_pending_idx = None
        if pending_idx is not None and 0 <= pending_idx < len(self._gen_statuses):
            self._gen_statuses[pending_idx] = "\uCDE8\uC18C\uB428"
            self._refresh_order_status_items()
        self._set_typing_status("")
        QMessageBox.information(self, "\uC54C\uB9BC", "\uD0C0\uC774\uD551\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.")

    def _on_typing_error(self, message: str) -> None:
        clean_message = _normalize_runtime_error_message(message)
        if self._chat_typing_pending:
            self._chat_typing_pending = False
            self._chat_pending_reply = ""
            self._set_chat_busy(False)
            self._update_chat_pipeline_status("\uD55C\uAE00 \uBB38\uC11C \uC785\uB825 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.", finished=True)
            self._append_chat_message(
                "assistant",
                f"\uD55C\uAE00 \uBB38\uC11C \uC785\uB825 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4: {clean_message}",
            )
            self._drain_queued_chat_messages()
            return
        pending_idx = self._auto_type_pending_idx
        self._auto_type_after_ai = False
        self._auto_type_pending_idx = None
        if pending_idx is not None and 0 <= pending_idx < len(self._gen_statuses):
            self._gen_statuses[pending_idx] = f"\uC624\uB958({clean_message})"
            self._refresh_order_status_items()
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
        new_items = list(self.selected_images)
        new_items.append(build_upload_item(path, source_kind="image"))
        self._set_selected_images(new_items)
        return len(self.selected_images) > before_count

    def _should_restore_hwp_after_click(self, obj: object) -> bool:
        current_mode = getattr(self, "_main_mode", "typing")
        if current_mode not in {"typing", "chat"}:
            return False
        if QApplication.activeModalWidget() is not None:
            return False
        if not isinstance(obj, QWidget):
            return False
        if not (obj is self or self.isAncestorOf(obj)):
            return False
        if isinstance(obj, (QTextEdit, QLineEdit)):
            return False
        if current_mode == "chat" and not isinstance(obj, QPushButton):
            return False
        return True

    def _restore_hwp_caret_visibility(self) -> None:
        target_filename = (
            self._current_detected_filename()
            or HwpController.get_last_detected_filename()
            or None
        )
        try:
            HwpController.focus_target_window(target_filename)
        except Exception:
            pass

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
            self._current_code_item_id = None
            self._set_code_view_text("")
            self._update_code_type_button_state()
            return
        self._current_code_index = idx
        item_id = item.data(Qt.ItemDataRole.UserRole)
        self._current_code_item_id = item_id if isinstance(item_id, str) else None
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
            src_item = self.selected_images[idx] if idx < len(self.selected_images) else None
            src_img = self._upload_item_crop_source_path(src_item)
            self._typing_worker.enqueue(idx, f"{prefix}{code}\n", target_filename, src_img)

    def _on_order_rows_moved(self, *args) -> None:
        # Rebuild selected_images order based on list widget items.
        if not self.selected_images:
            return
        new_item_ids: list[str] = []
        for i in range(self.order_list.count()):
            item = self.order_list.item(i)
            item_id = item.data(Qt.ItemDataRole.UserRole)
            if isinstance(item_id, str) and item_id:
                new_item_ids.append(item_id)
        if not new_item_ids or len(new_item_ids) != len(self.selected_images):
            return
        old_index_by_id = {item.item_id: i for i, item in enumerate(self.selected_images)}
        item_by_id = {item.item_id: item for item in self.selected_images}
        if any(item_id not in item_by_id for item_id in new_item_ids):
            return
        self.selected_images = [item_by_id[item_id] for item_id in new_item_ids]
        if self._generated_codes_by_index:
            self._generated_codes_by_index = [
                self._generated_codes_by_index[old_index_by_id[item_id]]
                for item_id in new_item_ids
                if item_id in old_index_by_id
            ]
        if self._gen_statuses:
            self._gen_statuses = [
                self._gen_statuses[old_index_by_id[item_id]]
                for item_id in new_item_ids
                if item_id in old_index_by_id
            ]
        self._render_order_list()
        if self._current_code_item_id and self._current_code_item_id in new_item_ids:
            self._current_code_index = new_item_ids.index(self._current_code_item_id)
            code = self._generated_codes_by_index[self._current_code_index] or ""
            self._set_code_view_text(code)
        else:
            self._current_code_index = -1
            self._current_code_item_id = None
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
        self._remove_selected_file_at(idx)

    def _remove_selected_file_at(self, idx: int) -> None:
        if idx < 0 or idx >= len(self.selected_images):
            return
        self.selected_images.pop(idx)
        if idx < len(self._generated_codes_by_index):
            self._generated_codes_by_index.pop(idx)
        if idx < len(self._gen_statuses):
            self._gen_statuses.pop(idx)
        self._render_order_list()

    def _on_chat_attachment_remove_clicked(self, item_id: str) -> None:
        if not self._is_order_editable():
            QMessageBox.information(self, "알림", "생성 중에는 항목을 삭제할 수 없습니다.")
            return
        idx = self._find_selected_index_by_item_id(item_id)
        if idx < 0:
            return
        self._remove_selected_file_at(idx)

    def _set_selected_images(self, upload_items: list[UploadItem]) -> None:
        next_images = [item for item in upload_items if isinstance(item, UploadItem)]
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
            self._chat_file_list.clear()
            self._gen_statuses = []
            self._generated_codes_by_index = []
            self._current_code_index = -1
            self._current_code_item_id = None
            self._set_code_view_text("")
            self._update_code_type_button_state()
            self._refresh_typing_mode_labels()
            self._update_order_list_visibility()
            self._update_replay_button_visibility()
            return
        self._refresh_typing_mode_labels()
        self._generated_codes_by_index = [""] * len(self.selected_images)
        self._gen_statuses = ["\uB300\uAE30\uC911"] * len(self.selected_images)
        self._render_order_list()
        self._current_code_index = -1
        self._current_code_item_id = None
        self._set_code_view_text("")
        self._update_code_type_button_state()
        self._update_order_list_visibility()
        self._update_replay_button_visibility()

    def _add_selected_images(self, file_paths: list[str]) -> None:
        supported_exts = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".pdf"}
        next_images: list[UploadItem] = []
        seen: set[str] = set()
        warnings: list[str] = []
        previous_status = self.typing_status_label.text().strip()
        processing_pdf = False
        try:
            for path in (file_paths or []):
                normalized = str(path or "").strip()
                if not normalized or normalized in seen:
                    continue
                if not os.path.isfile(normalized):
                    continue
                ext = Path(normalized).suffix.lower()
                if ext not in supported_exts:
                    continue
                if ext == ".pdf":
                    if not processing_pdf:
                        processing_pdf = True
                        self._set_typing_status("PDF 문제 분석중...")
                        QApplication.processEvents()
                    summary = split_pdf_into_problem_items(normalized)
                    next_images.extend(summary.items)
                    if summary.warnings:
                        warnings.append(f"{os.path.basename(normalized)}: {' / '.join(summary.warnings)}")
                    if not summary.items:
                        warnings.append(f"{os.path.basename(normalized)}: 검출된 문제가 없어 추가하지 않았습니다.")
                else:
                    next_images.append(build_upload_item(normalized, source_kind="image"))
                seen.add(normalized)
        finally:
            if processing_pdf:
                self._set_typing_status(previous_status)
        self._set_selected_images(next_images)
        if warnings:
            QMessageBox.information(self, "PDF 분석 결과", "\n".join(dict.fromkeys(warnings)))

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
        if self.selected_images:
            self._render_order_list()

    def _is_order_editable(self) -> bool:
        return self.order_list.dragDropMode() != QListWidget.DragDropMode.NoDragDrop

    def _update_order_list_visibility(self) -> None:
        if not self.selected_images:
            self._order_list_stack.setCurrentWidget(self._empty_placeholder)
            self._chat_file_panel_stack.setCurrentWidget(self._chat_file_empty_placeholder)
        else:
            self._order_list_stack.setCurrentWidget(self.order_list)
            self._chat_file_panel_stack.setCurrentWidget(self._chat_file_list)

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
        self, image_items: list[UploadItem], show_message: bool = True
    ) -> list[UploadItem]:
        if not image_items:
            return image_items
        remaining_credits = self._get_remaining_send_quota()
        base_cost = self._typing_generation_base_cost(getattr(self, "_typing_generation_mode", "problem"))
        remaining_slots = remaining_credits // max(1, base_cost)
        if remaining_slots <= 0:
            if show_message:
                QMessageBox.warning(
                    self,
                    "\uC54C\uB9BC",
                    "\uB0A8\uC740 \uC0AC\uC6A9 \uD69F\uC218\uAC00 \uC5C6\uC5B4 \uC774\uBBF8\uC9C0\uB97C \uCD94\uAC00\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
                )
            return []
        if len(image_items) <= remaining_slots:
            return image_items

        exceeded = len(image_items) - remaining_slots
        if show_message:
            QMessageBox.information(
                self,
                "\uC54C\uB9BC",
                f"\uD604\uC7AC \uB0A8\uC740 \uD06C\uB808\uB527\uC740 {remaining_credits}\uC785\uB2C8\uB2E4.\n"
                f"\uD604\uC7AC \uBAA8\uB4DC\uB294 \uBB38\uC81C\uB2F9 {base_cost}\uD06C\uB808\uB527\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.\n"
                f"\uC120\uD0DD\uD55C {len(image_items)}\uAC1C \uC911 {exceeded}\uAC1C\uB9CC \uC81C\uC678\uD558\uACE0 \uCD94\uAC00\uB429\uB2C8\uB2E4.",
            )
        return image_items[:remaining_slots]

    def _update_send_button_state(self) -> None:
        has_images = bool(self.selected_images)
        status = self.typing_status_label.text().strip()
        if not has_images:
            self.btn_ai_type.setEnabled(False)
            return
        remaining_credits = self._get_remaining_send_quota()
        base_cost = self._typing_generation_base_cost(getattr(self, "_typing_generation_mode", "problem"))
        remaining_slots = remaining_credits // max(1, base_cost)
        if remaining_slots <= 0:
            self.btn_ai_type.setEnabled(False)
            return
        if len(self.selected_images) > remaining_slots:
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
        src_item = self.selected_images[idx] if idx < len(self.selected_images) else None
        src_img = self._upload_item_crop_source_path(src_item)
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
        title = f"{idx + 1}. {self._upload_item_display_name(self.selected_images[idx])}"
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
            self._add_selected_images(file_paths)


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

    normalized_ai = normalize_ai_error_message(text)
    if normalized_ai != text:
        return normalized_ai

    lower = text.lower()
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
        last_resolved_target: str | None = None
        last_style_snapshot: tuple[str, float, str, float] | None = None
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
                        t_font, t_size, e_font, e_size = self._snapshot_typing_styles()
                        style_snapshot = (t_font, t_size, e_font, e_size)
                        controller.activate_target_window(resolved_target)
                        controller.configure_typing_styles(
                            text_font_name=t_font,
                            text_font_size_pt=t_size,
                            eq_font_name=e_font,
                            eq_font_size_pt=e_size,
                        )
                        last_resolved_target = resolved_target
                        last_style_snapshot = style_snapshot
                        runner = ScriptRunner(controller)
                    else:
                        t_font, t_size, e_font, e_size = self._snapshot_typing_styles()
                        style_snapshot = (t_font, t_size, e_font, e_size)
                        if resolved_target != last_resolved_target:
                            controller.activate_target_window(resolved_target)
                            last_resolved_target = resolved_target
                        if style_snapshot != last_style_snapshot:
                            controller.configure_typing_styles(
                                text_font_name=t_font,
                                text_font_size_pt=t_size,
                                eq_font_name=e_font,
                                eq_font_size_pt=e_size,
                            )
                            last_style_snapshot = style_snapshot

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
                            style_snapshot = (t_font, t_size, e_font, e_size)
                            controller.configure_typing_styles(
                                text_font_name=t_font,
                                text_font_size_pt=t_size,
                                eq_font_name=e_font,
                                eq_font_size_pt=e_size,
                            )
                            last_resolved_target = resolved_target
                            last_style_snapshot = style_snapshot
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
                            style_snapshot = (t_font, t_size, e_font, e_size)
                            controller.configure_typing_styles(
                                text_font_name=t_font,
                                text_font_size_pt=t_size,
                                eq_font_name=e_font,
                                eq_font_size_pt=e_size,
                            )
                            last_resolved_target = resolved_target
                            last_style_snapshot = style_snapshot
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


class ChatAttachmentCard(QFrame):
    remove_clicked = Signal(str)

    def __init__(
        self,
        upload_item: UploadItem,
        removable: bool = True,
        parent=None,
        compact: bool = False,
    ) -> None:
        super().__init__(parent)
        self._item_id = upload_item.item_id
        is_pdf = upload_item.is_pdf
        badge_text = upload_item.badge_text
        badge_bg = "#fee2e2" if is_pdf else "#dbeafe"
        badge_fg = "#dc2626" if is_pdf else "#2563eb"
        file_type = upload_item.file_type_label
        radius = 12 if compact else 14
        badge_size = 34 if compact else 44
        badge_radius = 10 if compact else 12
        name_font_size = 11 if compact else 13
        type_font_size = 10 if compact else 11
        remove_btn_size = 20 if compact else 24
        remove_icon_size = 12 if compact else 14
        layout_margins = (10, 8, 8, 8) if compact else (12, 10, 10, 10)
        layout_spacing = 8 if compact else 10

        self.setStyleSheet(
            f"QFrame {{ background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: {radius}px; }}"
        )
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(*layout_margins)
        layout.setSpacing(layout_spacing)

        badge = QLabel(badge_text)
        badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        badge.setFixedSize(badge_size, badge_size)
        badge.setStyleSheet(
            f"background-color: {badge_bg}; color: {badge_fg}; border-radius: {badge_radius}px; "
            f"font-size: {name_font_size}px; font-weight: 700;"
        )
        layout.addWidget(badge, 0, Qt.AlignmentFlag.AlignTop)

        text_col = QVBoxLayout()
        text_col.setContentsMargins(0, 0, 0, 0)
        text_col.setSpacing(2 if compact else 3)
        name_label = QLabel(upload_item.order_title)
        name_label.setWordWrap(not compact)
        name_label.setStyleSheet(
            f"color: #111827; font-size: {name_font_size}px; font-weight: 700; background: transparent; border: none;"
        )
        type_label = QLabel(file_type)
        type_label.setStyleSheet(
            f"color: #6b7280; font-size: {type_font_size}px; font-weight: 500; background: transparent; border: none;"
        )
        text_col.addWidget(name_label)
        text_col.addWidget(type_label)
        text_col.addStretch(1)
        layout.addLayout(text_col, 1)

        remove_btn = QPushButton()
        remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        remove_btn.setFixedSize(remove_btn_size, remove_btn_size)
        remove_btn.setEnabled(removable)
        remove_btn.setIcon(_material_icon(_MI_CLOSE, 16, QColor("#9ca3af")))
        remove_btn.setIconSize(QSize(remove_icon_size, remove_icon_size))
        remove_btn.setStyleSheet(
            "QPushButton { background-color: transparent; border: none; border-radius: 12px; }"
            "QPushButton:hover { background-color: #f3f4f6; }"
            "QPushButton:disabled { background-color: transparent; }"
        )
        remove_btn.clicked.connect(lambda: self.remove_clicked.emit(self._item_id))
        layout.addWidget(remove_btn, 0, Qt.AlignmentFlag.AlignTop)


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


def _clear_comtypes_cache() -> None:
    """Remove stale comtypes generated wrappers that can trigger console popups."""
    try:
        import comtypes.client  # type: ignore
        import shutil

        cache_dir = getattr(comtypes.client, "gen_dir", None)
        if cache_dir and Path(cache_dir).exists():
            shutil.rmtree(cache_dir, ignore_errors=True)
    except Exception:
        pass


def _load_runtime_env_files() -> None:
    """Load packaged runtime settings from shared runtime env files."""
    load_runtime_env(__file__)


def _format_env_group(group: tuple[str, ...]) -> str:
    return " 또는 ".join(group)


def _hostname_from_url(raw_url: str) -> str:
    text = str(raw_url or "").strip()
    if not text:
        return ""
    if "://" not in text:
        text = f"https://{text}"
    try:
        return str(urlparse(text).hostname or "").strip().lower()
    except Exception:
        return ""


def _collect_startup_preflight_issues() -> tuple[list[str], list[str]]:
    _load_runtime_env_files()
    blocking: list[str] = []
    warnings: list[str] = []

    required_keys = [
        ("GEMINI_API_KEY",),
        ("NEXT_PUBLIC_FIREBASE_API_KEY", "FIREBASE_API_KEY"),
        ("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID"),
    ]
    missing_groups = missing_env_keys(required_keys)
    if missing_groups:
        missing_text = ", ".join(_format_env_group(group) for group in missing_groups)
        blocking.append(
            "배포용 설정 파일에서 필수 값이 누락되었습니다.\n"
            f"누락 항목: {missing_text}\n"
            "운영자에게 최신 설치 파일을 다시 받아 설치해 주세요."
        )
        return blocking, warnings

    checks = [
        ("로그인 서버", "identitytoolkit.googleapis.com"),
        ("AI 서버", "generativelanguage.googleapis.com"),
    ]
    web_base_url = first_env_value(
        "NOVA_USAGE_API_BASE_URL",
        "NOVA_WEB_BASE_URL",
        "NOVA_APP_BASE_URL",
        "NEXT_PUBLIC_APP_URL",
    ) or "https://www.nova-ai.work"
    web_host = _hostname_from_url(web_base_url)
    if web_host:
        checks.append(("Nova 웹 서버", web_host))

    for label, host in checks:
        ok, detail = can_connect(host, timeout_sec=2.0)
        if ok:
            continue
        hint = (
            f"{label}({host})에 연결하지 못했습니다."
            if label != "Nova 웹 서버"
            else f"{label}({host})에 연결하지 못했습니다. 사용량 동기화나 세션 확인이 지연될 수 있습니다."
        )
        if detail:
            hint = f"{hint}\n세부 오류: {detail}"
        warnings.append(hint)

    return blocking, warnings


def _show_startup_preflight(parent: QWidget) -> bool:
    enabled = str(os.getenv("NOVA_STARTUP_PREFLIGHT", "1")).strip().lower()
    if enabled in {"0", "false", "off", "no"}:
        return True

    blocking, warnings = _collect_startup_preflight_issues()
    if blocking:
        QMessageBox.critical(parent, "배포 설정 오류", "\n\n".join(blocking))
        return False
    if warnings:
        QMessageBox.warning(
            parent,
            "네트워크 점검 안내",
            "\n\n".join(warnings) + "\n\n계속 실행은 가능하지만 로그인 또는 AI 기능이 실패할 수 있습니다.",
        )
    return True


def _version_to_tuple(version_text: str) -> tuple[int, ...]:
    numbers = re.findall(r"\d+", str(version_text or ""))
    if not numbers:
        return (0,)
    return tuple(int(item) for item in numbers[:4])


def _is_newer_version(latest_version: str, current_version: str) -> bool:
    latest = _version_to_tuple(latest_version)
    current = _version_to_tuple(current_version)
    max_len = max(len(latest), len(current))
    latest = latest + (0,) * (max_len - len(latest))
    current = current + (0,) * (max_len - len(current))
    return latest > current


def _fetch_update_manifest(manifest_url: str, timeout_sec: int = 3) -> dict[str, str]:
    req = urllib_request.Request(
        manifest_url,
        headers={"User-Agent": "NovaAI-Desktop/1.0"},
        method="GET",
    )
    with urllib_request.urlopen(req, timeout=timeout_sec) as response:
        payload = response.read().decode("utf-8", errors="replace")
    data = json.loads(payload)
    if not isinstance(data, dict):
        return {}
    return {
        "latest_version": str(data.get("latest_version") or "").strip(),
        "min_supported_version": str(data.get("min_supported_version") or "").strip(),
        "download_url": str(data.get("download_url") or "").strip(),
        "release_notes": str(data.get("release_notes") or "").strip(),
    }


def _maybe_show_update_notice(parent: QWidget) -> None:
    enabled = str(os.getenv("NOVA_UPDATE_CHECK_ENABLED", "1")).strip().lower()
    if enabled in {"0", "false", "off", "no"}:
        return

    current_version = str(os.getenv("NOVA_APP_VERSION") or "2.1.1").strip() or "2.1.1"
    manifest_url = str(os.getenv("NOVA_UPDATE_MANIFEST_URL") or "").strip()
    latest_version = ""
    min_supported_version = ""
    download_url = str(os.getenv("NOVA_UPDATE_DOWNLOAD_URL") or "").strip()
    release_notes = str(os.getenv("NOVA_UPDATE_MESSAGE") or "").strip()

    if manifest_url:
        try:
            remote = _fetch_update_manifest(manifest_url)
            latest_version = remote.get("latest_version", "")
            min_supported_version = remote.get("min_supported_version", "")
            download_url = remote.get("download_url") or download_url
            release_notes = remote.get("release_notes") or release_notes
        except (urllib_error.URLError, TimeoutError, OSError, ValueError):
            return
        except Exception:
            return
    else:
        latest_version = str(os.getenv("NOVA_LATEST_VERSION") or "").strip()

    if not latest_version or not _is_newer_version(latest_version, current_version):
        return

    is_mandatory = bool(
        min_supported_version and _is_newer_version(min_supported_version, current_version)
    )
    title = "필수 업데이트 안내" if is_mandatory else "업데이트 안내"
    lines = [
        f"새 버전(v{latest_version})이 배포되었습니다.",
        f"현재 버전: v{current_version}",
        "",
        "지금 업데이트하시겠어요?",
    ]
    if release_notes:
        lines.insert(2, f"변경 내용: {release_notes}")
    message = "\n".join(lines)

    msg = QMessageBox(parent)
    msg.setIcon(QMessageBox.Icon.Information)
    msg.setWindowTitle(title)
    msg.setText(message)
    update_btn = msg.addButton("업데이트", QMessageBox.ButtonRole.AcceptRole)
    later_btn = None
    if not is_mandatory:
        later_btn = msg.addButton("나중에", QMessageBox.ButtonRole.RejectRole)
    msg.setDefaultButton(update_btn)  # type: ignore[arg-type]
    msg.exec()

    if msg.clickedButton() == update_btn:
        target_url = download_url or manifest_url
        if target_url:
            try:
                webbrowser.open(target_url)
            except Exception:
                QMessageBox.information(
                    parent,
                    "업데이트 링크",
                    f"아래 주소로 접속해 업데이트를 진행해주세요.\n{target_url}",
                )
        else:
            QMessageBox.information(
                parent,
                "업데이트 안내",
                "다운로드 링크가 설정되지 않았습니다. 운영자에게 문의해주세요.",
            )
    elif is_mandatory and (msg.clickedButton() == later_btn or msg.clickedButton() is None):
        # Never terminate the app from update notice flow.
        # Some users may close the dialog unintentionally and perceive this as a crash.
        QMessageBox.information(
            parent,
            "업데이트 권장",
            "최신 버전으로 업데이트하면 더 안정적으로 사용할 수 있습니다.",
        )


def main() -> None:
    _clear_win32com_cache()
    _clear_comtypes_cache()
    _load_runtime_env_files()
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
    QTimer.singleShot(200, lambda: None if _show_startup_preflight(window) else app.quit())
    QTimer.singleShot(800, lambda: _maybe_show_update_notice(window))
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

