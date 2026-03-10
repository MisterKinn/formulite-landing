from __future__ import annotations

import os
import sys
import base64
from pathlib import Path
from typing import Optional

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


SYSTEM_PROMPT = """
You are generating a minimal Python script for HWP automation.
Use ONLY the following functions:
- insert_text("text")
- insert_enter()
- insert_space()
- insert_small_paragraph()
- insert_equation("hwp_equation_syntax")
- insert_latex_equation("latex_math")
- insert_template("header.hwp|box.hwp|box_white.hwp")
- focus_placeholder("@@@|###")
- insert_box()
- exit_box()
- insert_view_box()
- insert_table(rows, cols, cell_data=[...], merged_cells=[...], align_center=False, exit_after=True)
- insert_highlighted_text("text", "yellow")
- insert_colored_text("text", "red")
- insert_styled_text("text", color="red", highlight="yellow", bold=True, underline=True, italic=True, strike=True)
- set_italic(True/False)
- set_strike(True/False)
- set_bold(True/False)
- set_underline(True/False)
- set_table_border_white()
- set_align_right_next_line()
- set_align_justify_next_line()
- insert_cropped_image(x1_pct, y1_pct, x2_pct, y2_pct)  # crop & insert a region from the source image (0.0–1.0 percentages)

Return ONLY Python code. No explanations.

For complex tables from images, prefer reconstructing the table with `insert_table(...)`
instead of inserting the table as an image. You may use structured cell objects inside
`cell_data`, for example:
- {"text": "주제", "colspan": 4, "align": "center"}
- {"text": "구분", "rowspan": 2, "align": "center"}
- {"text": "람다", "fill_color": "#ffa24a", "border_color": "#d36b2c", "align": "center"}
- {"text": "구분", "fill_color": "연회색", "border_type": "solid", "border_width": "0.3mm", "align": "center"}
- {"text": "합계", "fill_color": "#fff2cc", "border_type": "dotted", "border_width": "0.2mm"}
- {"text": "a", "border_width_top": "0.3mm", "border_width_bottom": "0.1mm", "border_width_left": "0.3mm", "border_width_right": "0.1mm"}
Covered cells may be omitted or written as None.
If explicit merge metadata is easier, you may also pass:
- merged_cells=[{"row": 0, "col": 0, "rowspan": 1, "colspan": 4}]
When a whole header row has the same fill, repeat that `fill_color` on each visible cell in that row.
When only one highlighted cell is colored, apply style ONLY to that cell object.
If border thickness/style is visually distinct, include `border_type` and `border_width`.
If outside borders differ from inside borders, use side-specific keys such as
`border_type_left`, `border_type_right`, `border_width_top`, `border_width_bottom`.
If a text run is visibly marked with a highlighter effect, use
`insert_highlighted_text("...", "yellow")` for only that highlighted run.
If a text run is visibly colored, use `insert_colored_text("...", "red")`
or another clear color such as `blue`, `green`, `purple`, `black`, `#RRGGBB`.
If a text run combines multiple styles at once, prefer one
`insert_styled_text(...)` call instead of splitting the same text into
separate color/highlight/bold/underline/italic/strike commands.

수학 문제라고 판단되면 코드 맨 위에 아래 한 줄을 추가한다 ( [CODE] 표시는 쓰지 말 것 ):
MATH_CHOICES_EQUATION = True
""".strip()

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None


class AIClientError(RuntimeError):
    """Raised when AI client setup or call fails."""


def _load_env() -> None:
    candidates = [
        Path(__file__).resolve().parent / ".env",
        Path.cwd() / ".env",
    ]
    for path in candidates:
        if not path.exists():
            continue
        if load_dotenv is not None:
            load_dotenv(dotenv_path=path)
            break
        # Fallback: minimal .env parsing when python-dotenv is unavailable.
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        except Exception:
            pass
        break


def _resolve_model(model: Optional[str]) -> str:
    if model:
        return model
    env_model = (
        os.getenv("NOVA_AI_MODEL")
        or os.getenv("GEMINI_MODEL")
        or os.getenv("LITEPRO_MODEL")
    )
    return env_model or "gemini-2.5-flash"


class AIClient:
    @staticmethod
    def _safe_response_text(response: object) -> str:
        chunks: list[str] = []

        def _append_text(value: object) -> None:
            if isinstance(value, str) and value:
                chunks.append(value)

        def _iter_parts(parts_obj: object) -> None:
            try:
                parts = list(parts_obj) if parts_obj is not None else []
            except Exception:
                parts = []
            for part in parts:
                text = None
                try:
                    text = getattr(part, "text", None)
                except Exception:
                    text = None
                _append_text(text)

        try:
            text_prop = getattr(response, "text", None)
            if isinstance(text_prop, str) and text_prop.strip():
                return text_prop.strip()
        except Exception as text_err:
            _debug(f"[AI Debug] response.text 접근 실패, parts fallback 사용: {text_err}")

        try:
            _iter_parts(getattr(response, "parts", None))
        except Exception:
            pass

        try:
            candidates = getattr(response, "candidates", None)
            try:
                candidates = list(candidates) if candidates is not None else []
            except Exception:
                candidates = []
            for candidate in candidates:
                try:
                    content = getattr(candidate, "content", None)
                except Exception:
                    content = None
                try:
                    _iter_parts(getattr(content, "parts", None))
                except Exception:
                    continue
        except Exception:
            pass

        return "".join(chunks).strip()

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        check_usage: bool = True,
    ) -> None:
        _load_env()
        self.model = _resolve_model(model)
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise AIClientError("GEMINI_API_KEY is missing.")

        try:
            import google.generativeai as genai
        except Exception as exc:
            raise AIClientError("google-generativeai package is not installed.") from exc

        genai.configure(api_key=self.api_key)
        self._genai = genai
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

    def _encode_image_to_base64(self, image_path: str) -> Optional[str]:
        try:
            with open(image_path, "rb") as image_file:
                return base64.b64encode(image_file.read()).decode("utf-8")
        except Exception:
            return None

    def _generate_script_gemini(
        self,
        prompt: str,
        image_path: Optional[str] = None,
        *,
        model_name: str,
    ) -> str:
        try:
            model = self._genai.GenerativeModel(model_name)
            if image_path:
                from PIL import Image  # type: ignore[import-not-found]

                image = Image.open(image_path).convert("RGB")
                max_dim = max(image.size)
                if max_dim > MAX_IMAGE_DIM:
                    scale = MAX_IMAGE_DIM / max_dim
                    new_size = (int(image.size[0] * scale), int(image.size[1] * scale))
                    image = image.resize(new_size, Image.LANCZOS)
                response = model.generate_content([prompt, image])
            else:
                response = model.generate_content(prompt)
            
            result_text = self._safe_response_text(response)
            
        except AIClientError:
            raise
        except Exception as exc:
            _debug(f"[AI Debug] generate_content 예외: {exc}")
            raise AIClientError(str(exc)) from exc

        if not result_text.strip():
            # 빈 결과일 때 디버그 정보 출력
            _debug(f"[AI Debug] 빈 응답 받음")
            if hasattr(response, "prompt_feedback"):
                _debug(f"[AI Debug] Prompt feedback: {response.prompt_feedback}")
            if hasattr(response, "candidates") and response.candidates:
                for i, c in enumerate(response.candidates):
                    if hasattr(c, "finish_reason"):
                        _debug(f"[AI Debug] Candidate {i} finish_reason: {c.finish_reason}")
                    if hasattr(c, "safety_ratings"):
                        _debug(f"[AI Debug] Candidate {i} safety_ratings: {c.safety_ratings}")
            return ""
        
        return result_text.strip()

    def generate_script(
        self,
        prompt: str,
        image_path: Optional[str] = None,
        *,
        model_override: Optional[str] = None,
    ) -> str:
        if not prompt.strip():
            return ""

        self._check_usage_limit()
        model_name = (model_override or self.model or "").strip() or self.model
        result_text = self._generate_script_gemini(
            prompt,
            image_path=image_path,
            model_name=model_name,
        )

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
                "verify with the image and fix obvious OCR errors):\n"
                f"{ocr_text}"
            )
        if description:
            parts.append(f"User request: {description}")
        else:
            parts.append("User request: Extract the image content and type it into HWP.")
        return "\n\n".join(parts)

    def generate_script_for_image(
        self, image_path: str, description: str = "", ocr_text: str = ""
    ) -> str:
        prompt = self.build_prompt(description, image_path=image_path, ocr_text=ocr_text)
        image_model = (
            os.getenv("IMAGE_AI_MODEL")
            or os.getenv("NOVA_IMAGE_MODEL")
            or ""
        ).strip()
        return self.generate_script(
            prompt,
            image_path=image_path,
            model_override=(image_model or None),
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
            os.getenv("SOLVE_AI_MODEL")
            or os.getenv("EXPLANATION_AI_MODEL")
            or os.getenv("NOVA_AI_MODEL")
            or os.getenv("GEMINI_MODEL")
            or "gemini-3.1-pro-preview"
        ).strip()
        return self.generate_script(
            prompt,
            image_path=image_path,
            model_override=(explanation_model or "gemini-3.1-pro-preview"),
        )
