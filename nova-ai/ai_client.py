from __future__ import annotations

import os
import io
import re
import sys
import time
from pathlib import Path
from typing import Optional
from image_path_utils import load_pil_image
from runtime_env import load_runtime_env

def _debug(msg: str) -> None:
    if sys.stderr is not None:
        try:
            sys.stderr.write(msg + "\n")
            sys.stderr.flush()
        except Exception:
            # Windowed executables may not have a writable stderr handle.
            pass

from prompt_loader import (
    get_image_instructions_prompt,
    get_solve_algorithm_prompt,
    get_solve_prompt,
)
from backend.oauth_desktop import get_stored_user
from backend.firebase_profile import (
    check_usage_limit,
    increment_ai_usage,
    get_remaining_usage,
    get_plan_limit,
)


MAX_IMAGE_DIM = 2048  # Higher cap to improve recognition
DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"


SYSTEM_PROMPT = """
You are generating a minimal Python script for HWP automation.
Use ONLY the following functions:
- insert_text("text")
- insert_enter()
- insert_space()
- insert_small_paragraph()
- insert_equation("hwp_equation_syntax")
- insert_latex_equation("latex_math")
- insert_template("header.hwp")
- focus_placeholder("@@@|###")
- insert_box()
- exit_box()
- insert_view_box()
- insert_table(rows, cols, cell_data=[...], merged_cells=[...], align_center=False, exit_after=True)
- insert_styled_text("text", bold=True, underline=True, italic=True, strike=True)
- set_italic(True/False)
- set_strike(True/False)
- set_bold(True/False)
- set_underline(True/False)
- set_table_border_white()
- set_align_center_next_line()
- set_align_right_next_line()
- set_align_justify_next_line()
- insert_cropped_image(x1_pct, y1_pct, x2_pct, y2_pct)  # crop & insert a region from the source image (0.0–1.0 percentages)

Return ONLY Python code. No explanations.

For complex tables from images, prefer reconstructing the table with `insert_table(...)`
instead of inserting the table as an image. You may use structured cell objects inside
`cell_data`, for example:
- {"text": "주제", "colspan": 4, "align": "center"}
- {"text": "구분", "rowspan": 2, "align": "center"}
- {"equation": "x ^{2} + x + 1 = 0", "align": "center"}
- {"content": ["조건 ", {"type": "equation", "value": "x ^{2} + x + 1"}, " 을 만족한다."], "align": "left"}
- {"lines": [{"type": "equation", "value": "H_2 O_2 + 색소 -> 색 변화"}, "설명"], "align": "center"}
- {"text": "", "diagonal": "\\"}
- {"text": "", "diagonal": "/"}
- {"text": "", "diagonal": "x"}
Covered cells may be omitted or written as None.
If explicit merge metadata is easier, you may also pass:
- merged_cells=[{"row": 0, "col": 0, "rowspan": 1, "colspan": 4}]
For table-cell math:
- use `{"equation": "..."}` for a pure equation cell
- use `{"content": ["text", {"type": "equation", "value": "..."}, "text"]}` for mixed text+math
- `{"text": "EQ:..."}` is still allowed for simple equation-only cells
If a printed rectangular block is actually a single bordered cell containing text/equations,
preserve it as `insert_table(1, 1, ...)` rather than flattening the content into plain lines.
Generate the final table structure in a SINGLE pass.
Do not leave table structure for a later pass or a follow-up correction step.
Ignore visible table background colors and border styling.
Do not emit `fill_color`, `background_color`, `bg_color`, `border`, `border_color`,
`border_type`, or `border_width` for table cells.
If a cell visibly contains a diagonal line or X mark, include `diagonal: "\\"`, `diagonal: "/"`, or `diagonal: "x"`.
Do NOT use text color functions or `color=...` for text runs; ignore visible font color differences and type the text normally.
If a text run combines multiple styles at once, prefer one
`insert_styled_text(...)` call instead of splitting the same text into
separate bold/underline/italic/strike commands.

수학 문제라고 판단되면 코드 맨 위에 아래 한 줄을 추가한다 ( [CODE] 표시는 쓰지 말 것 ):
MATH_CHOICES_EQUATION = True
""".strip()

class AIClientError(RuntimeError):
    """Raised when AI client setup or call fails."""


def _load_env() -> None:
    load_runtime_env(__file__)


def _resolve_model(model: Optional[str]) -> str:
    if model:
        return model
    env_model = (
        os.getenv("GEMINI_CHAT_MODEL")
        or os.getenv("GEMINI_SOLVE_MODEL")
        or os.getenv("NOVA_AI_MODEL")
    )
    return env_model or DEFAULT_GEMINI_MODEL


def _normalize_model_name(model: str) -> str:
    text = (model or "").strip()
    if not text:
        return text
    return re.sub(r"\s+", "-", text.lower())


def _normalize_thinking_level(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip().lower()
    if not text or text in {"off", "none", "false", "0", "disabled"}:
        return None
    aliases = {
        "min": "minimal",
        "minimal": "minimal",
        "low": "low",
        "medium": "medium",
        "med": "medium",
        "high": "high",
    }
    normalized = aliases.get(text)
    if normalized is None:
        raise AIClientError(
            "thinking_level must be one of: minimal, low, medium, high, none/off."
        )
    return normalized


def _is_retryable_gemini_error(message: str) -> bool:
    text = str(message or "").lower()
    retry_markers = (
        "503",
        "unavailable",
        "high demand",
        "resource_exhausted",
        "rate limit",
        "deadline exceeded",
        "timeout",
        "timed out",
        "temporarily unavailable",
    )
    return any(marker in text for marker in retry_markers)


def normalize_ai_error_message(message: str) -> str:
    text = str(message or "").strip()
    if not text:
        return "AI 서비스 오류가 발생했습니다."

    lower = text.lower()
    if "gemini_api_key is missing" in lower:
        return "배포용 Gemini 설정이 누락되었습니다. 운영자에게 설치 파일을 다시 받아 주세요."
    if "google-genai package is not installed" in lower:
        return "AI 실행 모듈이 누락되었습니다. 프로그램을 다시 설치해 주세요."
    if "client initialization failed" in lower:
        return "AI 실행 환경 초기화에 실패했습니다. 프로그램을 다시 설치하거나 운영자에게 문의해 주세요."
    if (
        "generativelanguage.googleapis.com" in lower
        or "max retries exceeded" in lower
        or "name or service not known" in lower
        or "failed to establish a new connection" in lower
        or "connection aborted" in lower
        or "connection reset" in lower
    ):
        return (
            "Google AI 서버에 연결하지 못했습니다. 현재 네트워크 또는 보안 프로그램에서 "
            "Google API 접속을 차단하고 있을 수 있습니다."
        )
    if "ssl" in lower or "certificate verify failed" in lower:
        return "AI 서버 보안 연결(SSL)에 실패했습니다. 회사/학원 네트워크나 보안 프로그램 설정을 확인해 주세요."
    if "resource_exhausted" in lower or "quota exceeded" in lower or "429" in lower:
        return "현재 AI 호출 한도를 초과했습니다. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요."
    if "deadline exceeded" in lower or "timed out" in lower or "timeout" in lower:
        return "AI 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
    return text


class AIClient:
    def _create_genai_client(self):
        api_key = self.api_key or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise AIClientError("GEMINI_API_KEY is missing.")
        try:
            from google import genai
        except Exception as exc:
            raise AIClientError("google-genai package is not installed.") from exc
        try:
            return genai.Client(api_key=api_key)
        except Exception as exc:
            raise AIClientError(f"google-genai client initialization failed: {exc}") from exc

    @staticmethod
    def _safe_gemini_response_text(response: object) -> str:
        if isinstance(response, str) and response.strip():
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

        payload = None
        for attr_name in ("to_dict", "model_dump"):
            try:
                reader = getattr(response, attr_name, None)
                if callable(reader):
                    payload = reader()
                    break
            except Exception:
                payload = None

        if isinstance(payload, dict):
            texts: list[str] = []
            for candidate in payload.get("candidates", []) or []:
                if not isinstance(candidate, dict):
                    continue
                content = candidate.get("content") or {}
                if not isinstance(content, dict):
                    continue
                for part in content.get("parts", []) or []:
                    if not isinstance(part, dict):
                        continue
                    part_text = part.get("text")
                    if isinstance(part_text, str) and part_text.strip():
                        texts.append(part_text.strip())
            if texts:
                return "\n".join(texts).strip()

        return ""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        check_usage: bool = True,
    ) -> None:
        _load_env()
        self.model = _normalize_model_name(_resolve_model(model))
        self.provider = "gemini"

        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self._check_usage = check_usage

    def _get_user_info(self) -> tuple[str | None, str]:
        """현재 사용자 정보 반환: (uid, tier)"""
        user = get_stored_user()
        if user and user.get("uid"):
            return user.get("uid"), str(user.get("plan") or user.get("tier") or "free")
        return None, "free"

    def _check_usage_limit(self) -> None:
        """사용량 제한 체크"""
        if not self._check_usage:
            return
        
        uid, tier = self._get_user_info()
        if not uid:
            return  # 비로그인 상태에서는 체크 안함
        
        if not check_usage_limit(uid, tier):
            limit = get_plan_limit(tier)
            normalized_tier = str(tier or "free").lower()
            tier_label = {
                "free": "무료",
                "standard": "Plus",
                "plus": "Plus",
                "test": "Plus",
                "pro": "Ultra",
                "ultra": "Ultra",
            }.get(normalized_tier, tier)

            # 업그레이드 안내 메시지 (월 기준)
            upgrade_msg = ""
            if normalized_tier == "free":
                upgrade_msg = "\n\n💡 Plus 플랜으로 업그레이드하면 월 330회까지 사용 가능!"
            elif normalized_tier in ("plus", "standard", "test"):
                upgrade_msg = "\n\n💡 Ultra 플랜으로 업그레이드하면 월 2200회까지 사용 가능!"

            raise AIClientError(
                f"⚠️ 월 사용량 한도 초과! ({limit}/{limit})\n"
                f"현재 플랜: {tier_label}"
                f"{upgrade_msg}\n\n"
                "nova-ai.work에서 플랜을 업그레이드하거나 결제 주기 초기화 후 다시 시도해주세요."
            )

    def _record_usage(self) -> None:
        """사용량 기록"""
        if not self._check_usage:
            return
        
        uid, tier = self._get_user_info()
        if not uid:
            return
        
        increment_ai_usage(uid)

    def _prepare_gemini_image(self, image_path: str):
        try:
            image = load_pil_image(image_path, mode="RGB")
            max_dim = max(image.size)
            if max_dim > MAX_IMAGE_DIM:
                scale = MAX_IMAGE_DIM / max_dim
                new_size = (int(image.size[0] * scale), int(image.size[1] * scale))
                from PIL import Image  # type: ignore[import-not-found]

                image = image.resize(new_size, Image.LANCZOS)
            return image
        except ImportError as exc:
            raise AIClientError("Pillow package is required for Gemini image requests.") from exc
        except Exception as exc:
            raise AIClientError(f"이미지 인코딩 실패: {exc}") from exc

    def _prepare_gemini_image_part(self, image_path: str, types_module):
        try:
            image = self._prepare_gemini_image(image_path)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return types_module.Part.from_bytes(data=buffer.getvalue(), mime_type="image/png")
        except AIClientError:
            raise
        except Exception as exc:
            raise AIClientError(f"Gemini 이미지 파트 생성 실패: {exc}") from exc

    @staticmethod
    def _resolve_generation_thinking_level(
        *,
        thinking_level: Optional[str],
        reasoning_effort: Optional[str],
    ) -> Optional[str]:
        normalized = _normalize_thinking_level(thinking_level)
        if normalized is not None:
            return normalized
        effort = str(reasoning_effort or "").strip().lower()
        if effort == "high":
            return "high"
        if effort == "medium":
            return "medium"
        if effort == "low":
            return "low"
        return None

    def _generate_script_gemini(
        self,
        prompt: str,
        image_path: Optional[str] = None,
        *,
        model_name: str,
        reasoning_effort: Optional[str] = None,
        thinking_level: Optional[str] = None,
    ) -> str:
        normalized_thinking_level = self._resolve_generation_thinking_level(
            thinking_level=thinking_level,
            reasoning_effort=reasoning_effort,
        )
        client = None
        try:
            from google.genai import types

            client = self._create_genai_client()
            content: list[object] = [prompt]
            if image_path:
                content.append(self._prepare_gemini_image_part(image_path, types))
            config = None
            if normalized_thinking_level is not None:
                config = types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(
                        thinking_level=normalized_thinking_level
                    )
                )
            if config is None:
                response = client.models.generate_content(
                    model=model_name,
                    contents=content,
                )
            else:
                response = client.models.generate_content(
                    model=model_name,
                    contents=content,
                    config=config,
                )
            result_text = self._safe_gemini_response_text(response)
        except AIClientError:
            raise
        except Exception as exc:
            _debug(f"[AI Debug] Gemini response 예외: {exc}")
            raise AIClientError(str(exc)) from exc
        finally:
            try:
                if client is not None:
                    client.close()
            except Exception:
                pass

        if not result_text.strip():
            _debug("[AI Debug] Gemini 빈 응답 받음")
            return ""
        return result_text.strip()

    def generate_script(
        self,
        prompt: str,
        image_path: Optional[str] = None,
        *,
        model_override: Optional[str] = None,
        reasoning_effort: Optional[str] = None,
        thinking_level: Optional[str] = None,
    ) -> str:
        if not prompt.strip():
            return ""

        self._check_usage_limit()
        model_name = _normalize_model_name((model_override or self.model or "").strip() or self.model)
        retry_count_raw = (
            os.getenv("GEMINI_RETRY_COUNT")
            or os.getenv("NOVA_AI_GEMINI_RETRY_COUNT")
            or "2"
        ).strip()
        try:
            retry_count = max(0, int(retry_count_raw))
        except Exception:
            retry_count = 2

        backoff_base_raw = (
            os.getenv("GEMINI_RETRY_BACKOFF_SECONDS")
            or os.getenv("NOVA_AI_GEMINI_RETRY_BACKOFF_SECONDS")
            or "3"
        ).strip()
        try:
            backoff_base = max(0.5, float(backoff_base_raw))
        except Exception:
            backoff_base = 3.0

        last_exc: AIClientError | None = None
        for attempt in range(retry_count + 1):
            try:
                result_text = self._generate_script_gemini(
                    prompt,
                    image_path=image_path,
                    model_name=model_name,
                    reasoning_effort=reasoning_effort,
                    thinking_level=thinking_level,
                )
                break
            except AIClientError as exc:
                last_exc = exc
                if attempt >= retry_count or not _is_retryable_gemini_error(str(exc)):
                    raise
                sleep_s = backoff_base * (attempt + 1)
                _debug(
                    f"[AI Debug] Retryable Gemini error on attempt {attempt + 1}/{retry_count + 1}: {exc}"
                )
                time.sleep(sleep_s)
        else:
            if last_exc is not None:
                raise last_exc
            raise AIClientError("Gemini 호출이 실패했습니다.")

        if result_text.strip():
            self._record_usage()
        return result_text.strip()

    def build_prompt(
        self,
        description: str,
        image_path: Optional[str] = None,
        ocr_text: str = "",
    ) -> str:
        parts = [SYSTEM_PROMPT]
        if image_path:
            instructions = get_image_instructions_prompt()
            if instructions:
                parts.append(instructions)
        if ocr_text:
            parts.append(
                "OCR extracted text (use this to improve accuracy; "
                "verify with the image, fix obvious OCR errors, and ignore handwritten annotations/marks):\n"
                f"{ocr_text}"
            )
        if description:
            parts.append(f"User request: {description}")
        else:
            parts.append(
                "User request: Extract the printed exam content from the image, ignore handwritten annotations, and type it into HWP."
            )
        return "\n\n".join(parts)

    def generate_script_for_image(
        self, image_path: str, description: str = "", ocr_text: str = ""
    ) -> str:
        prompt = self.build_prompt(description, image_path=image_path, ocr_text=ocr_text)
        image_model = (
            os.getenv("GEMINI_TYPING_MODEL")
            or os.getenv("NOVA_AI_MODEL")
            or "gemini-3-flash-preview"
        ).strip()
        typing_thinking_level = (
            os.getenv("GEMINI_TYPING_THINKING_LEVEL")
            or ""
        ).strip()
        return self.generate_script(
            prompt,
            image_path=image_path,
            model_override=(image_model or None),
            thinking_level=typing_thinking_level,
        )

    def build_explanation_prompt(self, ocr_text: str = "") -> str:
        solve_algorithm_prompt = get_solve_algorithm_prompt().strip()
        solve_prompt = get_solve_prompt().strip()
        if not solve_algorithm_prompt:
            solve_algorithm_prompt = (
                "Write a Korean exam-solution handout as HWP automation Python code. "
                "Return ONLY executable Python code."
            )
        parts = [solve_algorithm_prompt]
        if solve_prompt:
            parts.append(
                "Shared solve/math formatting rules for HWP automation "
                "(follow these especially for equations, OCR correction, and math layout):\n"
                f"{solve_prompt}"
            )
        if ocr_text:
            parts.append(
                "OCR extracted text from the problem image "
                "(use it only as a hint and correct obvious OCR mistakes by checking the image):\n"
                f"{ocr_text}"
            )
        parts.append(
            "Task:\n"
            "- Read the attached problem image carefully.\n"
            "- Solve the problem from the image.\n"
            "- Write a Korean explanation in HWP automation code.\n"
            "- Make the result feel like a real exam-solution handout.\n\n"
            "Important generation policy:\n"
            "- Prioritize correctness and readability over decorative wording.\n"
            "- If the image contains multiple subparts, explain them in a sensible order.\n"
            "- If the answer is multiple choice and can be identified, explicitly mention the correct choice.\n"
            "- If the image is partially unclear, avoid fake precision and explain only what can be supported from the visible content."
        )
        return "\n\n".join(parts)

    def generate_explanation_for_image(self, image_path: str, ocr_text: str = "") -> str:
        prompt = self.build_explanation_prompt(ocr_text=ocr_text)
        explanation_model = (
            os.getenv("GEMINI_SOLVE_MODEL")
            or os.getenv("NOVA_AI_MODEL")
            or DEFAULT_GEMINI_MODEL
        ).strip()
        return self.generate_script(
            prompt,
            image_path=image_path,
            model_override=(explanation_model or DEFAULT_GEMINI_MODEL),
            reasoning_effort="high",
        )
