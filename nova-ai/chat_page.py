from __future__ import annotations

import os
import re
from pathlib import Path

from PySide6.QtCore import Qt, QThread, Signal, QSize, QTimer
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QLinearGradient
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QSizePolicy,
    QTextEdit,
    QWidget,
)

from ai_client import AIClient
from ocr_pipeline import OcrError, extract_text
from prompt_loader import (
    get_chat_actiontable_prompt,
    get_chat_hwp_actions_prompt,
    get_image_instructions_prompt,
)


class ChatComposeTextEdit(QTextEdit):
    submitted = Signal()
    filesDropped = Signal(list)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptRichText(False)
        self.setAcceptDrops(True)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setTabChangesFocus(False)

    def keyPressEvent(self, event) -> None:  # type: ignore[override]
        if (
            event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter)
            and not (event.modifiers() & Qt.KeyboardModifier.ShiftModifier)
        ):
            self.submitted.emit()
            return
        super().keyPressEvent(event)

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


class AnimatedStatusLabel(QLabel):
    def __init__(self, text: str = "", parent=None) -> None:
        super().__init__(text, parent)
        self._base_color = QColor("#6b7684")
        self._wave_color = QColor("#4b6bfb")
        self._animated = False
        self._phase = 0.0
        self._timer = QTimer(self)
        self._timer.setInterval(80)
        self._timer.timeout.connect(self._advance_wave)

    def _advance_wave(self) -> None:
        self._phase += 0.08
        if self._phase > 1.0:
            self._phase = 0.0
        self.update()

    def setAnimated(self, animated: bool) -> None:
        self._animated = bool(animated)
        if self._animated:
            if not self._timer.isActive():
                self._timer.start()
        else:
            self._timer.stop()
            self._phase = 0.0
        self.update()

    def paintEvent(self, event) -> None:  # type: ignore[override]
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)
        painter.setFont(self.font())
        rect = self.contentsRect()
        flags = int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter | Qt.TextFlag.TextWordWrap)
        if self._animated and rect.width() > 0:
            span = max(rect.width(), 1)
            shift = self._phase * span
            gradient = QLinearGradient(rect.left() - span + shift, 0, rect.right() + shift, 0)
            gradient.setColorAt(0.00, self._base_color)
            gradient.setColorAt(0.35, self._base_color)
            gradient.setColorAt(0.50, self._wave_color)
            gradient.setColorAt(0.65, self._base_color)
            gradient.setColorAt(1.00, self._base_color)
            painter.setPen(QPen(gradient, 0))
        else:
            painter.setPen(self._base_color)
        painter.drawText(rect, flags, self.text())


class ChatMessageWidget(QWidget):
    def __init__(self, role: str, text: str, max_width: int, parent=None) -> None:
        super().__init__(parent)
        self._role = role
        self._bubble = QFrame()
        self._bubble.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Preferred)
        self._bubble.setObjectName(f"chatBubble-{role}")

        root = QHBoxLayout(self)
        root.setContentsMargins(0, 2, 0, 2)
        root.setSpacing(0)

        if role == "user":
            root.addStretch(1)

        bubble_layout = QHBoxLayout(self._bubble)
        bubble_layout.setContentsMargins(16, 12, 16, 12)
        bubble_layout.setSpacing(8)

        if role == "user":
            self._bubble.setStyleSheet(
                "QFrame { background-color: #4b6bfb; border: none; border-radius: 24px; }"
            )
            label_style = (
                "color: #ffffff; font-size: 15px; font-weight: 600; "
                "padding: 0; background: transparent;"
            )
        elif role == "assistant":
            self._bubble.setStyleSheet(
                "QFrame { background-color: #ffffff; border: 1px solid #edf2f7; "
                "border-radius: 24px; }"
            )
            label_style = (
                "color: #191f28; font-size: 15px; font-weight: 500; "
                "padding: 0; background: transparent;"
            )
        else:
            self._bubble.setStyleSheet(
                "QFrame { background-color: #f2f4f6; border: 1px solid #e7ebf0; "
                "border-radius: 20px; }"
            )
            label_style = (
                "color: #6b7684; font-size: 13px; font-weight: 600; "
                "padding: 0; background: transparent;"
            )

        self._text_label = AnimatedStatusLabel(text) if role == "status" else QLabel(text)
        self._text_label.setWordWrap(True)
        if role != "status":
            self._text_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self._text_label.setStyleSheet(label_style)
        bubble_layout.addWidget(self._text_label)

        root.addWidget(
            self._bubble,
            0,
            Qt.AlignmentFlag.AlignRight if role == "user" else Qt.AlignmentFlag.AlignLeft,
        )

        if role != "user":
            root.addStretch(1)

        self.set_max_width(max_width)
        if role == "status" and isinstance(self._text_label, AnimatedStatusLabel):
            self._text_label.setAnimated(False)

    def set_max_width(self, max_width: int) -> None:
        safe_width = max(220, int(max_width))
        self._bubble.setMaximumWidth(safe_width)
        self._text_label.setMaximumWidth(max(170, safe_width - 36))
        self.updateGeometry()

    def set_text(self, text: str) -> None:
        self._text_label.setText(text)
        self._text_label.updateGeometry()
        self.updateGeometry()

    def set_status_animating(self, animating: bool) -> None:
        if self._role == "status" and isinstance(self._text_label, AnimatedStatusLabel):
            self._text_label.setAnimated(animating)

    def is_status(self) -> bool:
        return self._role == "status"


class ChatWorker(QThread):
    finished = Signal(object)
    error = Signal(str)
    _SCRIPT_MARKERS = (
        "insert_text(",
        "insert_enter(",
        "insert_space(",
        "insert_paragraph(",
        "insert_small_paragraph(",
        "insert_equation(",
        "insert_template(",
        "focus_placeholder(",
        "insert_box(",
        "exit_box(",
        "insert_view_box(",
        "insert_table(",
        "insert_highlighted_text(",
        "insert_colored_text(",
        "insert_styled_text(",
        "set_italic(",
        "set_strike(",
        "insert_cropped_image(",
        "insert_generated_image(",
        "set_bold(",
        "set_underline(",
        "set_char_width_ratio(",
        "set_table_border_white(",
        "set_align_right_next_line(",
        "set_align_justify_next_line(",
        "run_hwp_action(",
        "execute_hwp_action(",
        "call_hwp_method(",
    )

    def __init__(
        self,
        user_message: str,
        current_filename: str = "",
        attachment_paths: list[str] | None = None,
    ) -> None:
        super().__init__()
        self._user_message = user_message
        self._current_filename = current_filename
        self._attachment_paths = [str(path) for path in (attachment_paths or []) if str(path).strip()]
        self._attachment_context_cache: str | None = None

    @staticmethod
    def _truncate_attachment_text(text: str, max_chars: int = 1800) -> str:
        cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(cleaned) <= max_chars:
            return cleaned
        return cleaned[: max_chars - 1].rstrip() + "…"

    @classmethod
    def _extract_pdf_text_preview(cls, path: str) -> str:
        try:
            import fitz  # type: ignore[import-not-found]

            doc = fitz.open(path)
            try:
                chunks: list[str] = []
                for page_idx in range(min(3, len(doc))):
                    text = (doc.load_page(page_idx).get_text("text") or "").strip()
                    if text:
                        chunks.append(text)
                return cls._truncate_attachment_text("\n".join(chunks))
            finally:
                doc.close()
        except Exception:
            pass

        for module_name in ("pypdf", "PyPDF2"):
            try:
                module = __import__(module_name, fromlist=["PdfReader"])
                reader = module.PdfReader(path)
                chunks = []
                for page in reader.pages[:3]:
                    text = (page.extract_text() or "").strip()
                    if text:
                        chunks.append(text)
                return cls._truncate_attachment_text("\n".join(chunks))
            except Exception:
                continue
        return ""

    @classmethod
    def _build_attachment_context(cls, attachment_paths: list[str]) -> str:
        if not attachment_paths:
            return ""
        lines = ["Attached reference files:"]
        for idx, path in enumerate(attachment_paths[:5], start=1):
            suffix = Path(path).suffix.lower()
            kind = "PDF" if suffix == ".pdf" else "image"
            preview = ""
            if suffix == ".pdf":
                preview = cls._extract_pdf_text_preview(path)
            else:
                try:
                    preview = cls._truncate_attachment_text(extract_text(path))
                except (OcrError, FileNotFoundError):
                    preview = ""
                except Exception:
                    preview = ""
            lines.append(f"{idx}. {os.path.basename(path)} ({kind})")
            if preview:
                lines.append(f"   Preview: {preview}")
        extra = len(attachment_paths) - 5
        if extra > 0:
            lines.append(f"... and {extra} more attachment(s).")
        return "\n".join(lines).strip()

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
    def _normalize_script(text: str) -> str:
        script = ChatWorker._strip_code_fence(text)
        lines = [line.rstrip() for line in script.splitlines() if line.strip()]
        return "\n".join(lines).strip()

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

    @staticmethod
    def _looks_like_edit_request(message: str) -> bool:
        text = (message or "").strip().lower()
        if not text:
            return False
        keywords = (
            "입력", "삽입", "적어", "써", "작성", "추가", "넣어", "붙여넣",
            "타이핑", "수식", "공식", "표", "테이블", "셀", "행", "열",
            "필드", "저장", "다른 이름", "pdf", "이동", "선택", "찾기", "바꿔",
            "서식", "정렬", "머리말", "꼬리말", "페이지", "쪽번호", "그림", "이미지",
            "배경", "도형", "박스", "보기", "템플릿", "하이퍼링크", "링크", "메모",
            "책갈피", "바탕쪽", "구역", "개체", "글상자", "캡션", "테두리", "음영",
            "대화상자", "속성", "수정", "검토", "변경 추적", "교정", "개인정보", "보안",
            "암호", "배포용", "워터마크", "흑백", "run", "action", "method",
            "latex", "equation", "insert", "write", "type", "append", "add",
            "save", "table", "field", "select", "find", "replace", "header", "footer",
            "hyperlink", "memo", "security", "password", "review", "masterpage",
            "section", "caption", "textbox", "dialog",
        )
        return any(keyword in text for keyword in keywords)

    @staticmethod
    def _build_basic_script(message: str) -> str:
        lines = [line.strip() for line in re.split(r"\r?\n", message) if line.strip()]
        out: list[str] = []
        for idx, line in enumerate(lines):
            if idx > 0:
                out.append("insert_enter()")
            out.append(f"insert_text({line!r})")
        return "\n".join(out).strip()

    @staticmethod
    def _is_literal_typing_request(message: str) -> bool:
        text = (message or "").strip().lower()
        if not text:
            return False
        typing_markers = (
            "라고 입력",
            "그대로 입력",
            "그대로 타이핑",
            "문장 입력",
            "텍스트 입력",
            "다음을 입력",
            "아래를 입력",
            "내용을 입력",
            "문서에 입력",
            "문서에 써",
        )
        command_markers = (
            "pdf",
            "저장",
            "다른 이름",
            "선택",
            "이동",
            "표",
            "테이블",
            "필드",
            "찾기",
            "바꾸",
            "정렬",
            "머리말",
            "꼬리말",
            "페이지",
            "쪽번호",
            "행",
            "열",
            "셀",
            "하이퍼링크",
            "링크",
            "메모",
            "바탕쪽",
            "구역",
            "개체",
            "글상자",
            "캡션",
            "테두리",
            "음영",
            "대화상자",
            "속성",
            "수정",
            "변경 추적",
            "검토",
            "개인정보",
            "보안",
            "암호",
            "배포용",
            "이미지",
            "그림",
            "박스",
            "템플릿",
        )
        has_typing_marker = any(marker in text for marker in typing_markers)
        has_command_marker = any(marker in text for marker in command_markers)
        return has_typing_marker and not has_command_marker

    @classmethod
    def _contains_supported_script_call(cls, script: str) -> bool:
        text = (script or "").strip()
        if not text:
            return False
        return any(marker in text for marker in cls._SCRIPT_MARKERS)

    @staticmethod
    def _contains_any(text: str, needles: tuple[str, ...]) -> bool:
        return any(needle in text for needle in needles)

    @staticmethod
    def _extract_quoted_strings(message: str) -> list[str]:
        if not message:
            return []
        return [m.group(1).strip() for m in re.finditer(r'["\']([^"\']+)["\']', message) if m.group(1).strip()]

    @staticmethod
    def _extract_first_url_or_email(message: str) -> tuple[str, int]:
        text = message or ""
        url_match = re.search(r"(https?://[^\s\"']+)", text, re.IGNORECASE)
        if url_match:
            return (url_match.group(1), 1)
        email_match = re.search(r"([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})", text, re.IGNORECASE)
        if email_match:
            return (f"mailto:{email_match.group(1)}", 2)
        return ("", 0)

    @staticmethod
    def _extract_first_file_path(message: str, exts: tuple[str, ...]) -> str:
        if not message:
            return ""
        quoted = re.findall(r'["\']([^"\']+)["\']', message)
        candidates = quoted + re.findall(r"([A-Za-z]:\\[^\s\"']+)", message)
        lower_exts = tuple(ext.lower() for ext in exts)
        for candidate in candidates:
            path = str(candidate or "").strip()
            if path.lower().endswith(lower_exts):
                return path
        return ""

    @staticmethod
    def _infer_file_format_from_path(path: str) -> str:
        lower = str(path or "").lower()
        if lower.endswith(".hwpx"):
            return "HWPX"
        if lower.endswith(".hwp"):
            return "HWP"
        if lower.endswith(".html") or lower.endswith(".htm"):
            return "HTML"
        if lower.endswith(".txt"):
            return "TEXT"
        if lower.endswith(".xml") or lower.endswith(".hml"):
            return "HWPML2X"
        return "HWP"

    @staticmethod
    def _build_hwp_arg_string(options: dict[str, object]) -> str:
        parts: list[str] = []
        for key, value in options.items():
            name = str(key or "").strip()
            if not name:
                continue
            if isinstance(value, bool):
                parts.append(f"{name}:{str(value).lower()}")
            else:
                parts.append(f"{name}:{value}")
        return ";".join(parts) + (";" if parts else "")

    @staticmethod
    def _mm_to_hwpunit(mm: float) -> int:
        return max(0, int(round(float(mm) * 283.465)))

    @staticmethod
    def _parse_color_value(text: str) -> int | None:
        lowered = (text or "").lower()
        color_map = {
            "검정": 0x000000,
            "검은색": 0x000000,
            "black": 0x000000,
            "흰색": 0xFFFFFF,
            "white": 0xFFFFFF,
            "빨강": 0x0000FF,
            "빨간색": 0x0000FF,
            "red": 0x0000FF,
            "파랑": 0xFF0000,
            "파란색": 0xFF0000,
            "blue": 0xFF0000,
            "초록": 0x00FF00,
            "초록색": 0x00FF00,
            "녹색": 0x00FF00,
            "green": 0x00FF00,
            "노랑": 0x00FFFF,
            "노란색": 0x00FFFF,
            "yellow": 0x00FFFF,
            "회색": 0x808080,
            "회색빛": 0x808080,
            "gray": 0x808080,
            "grey": 0x808080,
            "연회색": 0xC0C0C0,
            "밝은 회색": 0xC0C0C0,
            "light gray": 0xC0C0C0,
            "보라": 0x800080,
            "보라색": 0x800080,
            "purple": 0x800080,
        }
        for name, value in color_map.items():
            if name in lowered:
                return value
        return None

    @staticmethod
    def _parse_line_style_value(text: str) -> int | None:
        lowered = (text or "").lower()
        if "실선" in lowered:
            return 1
        if "긴 점선" in lowered:
            return 2
        if "점선" in lowered:
            return 3
        if "쇄선" in lowered:
            return 4
        return None

    @staticmethod
    def _parse_line_width_value(text: str) -> int | None:
        lowered = (text or "").lower()
        mm_match = re.search(r"(\d+(?:\.\d+)?)\s*mm", lowered)
        if not mm_match:
            return None
        mm = float(mm_match.group(1))
        width_map = [
            (0.1, 0), (0.12, 1), (0.15, 2), (0.2, 3), (0.25, 4),
            (0.3, 5), (0.4, 6), (0.5, 7), (0.6, 8), (0.7, 9),
            (1.0, 10), (1.5, 11), (2.0, 12), (3.0, 13), (4.0, 14), (5.0, 15),
        ]
        closest = min(width_map, key=lambda item: abs(item[0] - mm))
        return closest[1]

    @classmethod
    def _build_page_setup_script(cls, raw_text: str, lowered_text: str) -> str:
        params: dict[str, int] = {}
        if "a4" in lowered_text:
            params["PaperWidth"] = cls._mm_to_hwpunit(210.0)
            params["PaperHeight"] = cls._mm_to_hwpunit(297.0)
        if "가로" in lowered_text and "세로" not in lowered_text:
            params["Landscape"] = 1
        elif "세로" in lowered_text:
            params["Landscape"] = 0

        margin_patterns = {
            "LeftMargin": r"왼쪽\s*(\d+(?:\.\d+)?)\s*mm",
            "RightMargin": r"오른쪽\s*(\d+(?:\.\d+)?)\s*mm",
            "TopMargin": r"(?:위|상단)\s*(\d+(?:\.\d+)?)\s*mm",
            "BottomMargin": r"(?:아래|하단)\s*(\d+(?:\.\d+)?)\s*mm",
            "HeaderLen": r"머리말\s*(\d+(?:\.\d+)?)\s*mm",
            "FooterLen": r"꼬리말\s*(\d+(?:\.\d+)?)\s*mm",
        }
        for key, pattern in margin_patterns.items():
            match = re.search(pattern, raw_text, re.IGNORECASE)
            if match:
                params[key] = cls._mm_to_hwpunit(float(match.group(1)))

        if not params:
            return ""
        return f'execute_hwp_action("PageSetup", "HPageDef", {params!r})'

    @classmethod
    def _build_header_footer_script(cls, lowered_text: str) -> str:
        params: dict[str, int] = {}
        if "머리말" in lowered_text:
            params["HeaderFooterCtrlType"] = 0
        elif "꼬리말" in lowered_text:
            params["HeaderFooterCtrlType"] = 1
        else:
            return ""

        if "짝수" in lowered_text:
            params["Type"] = 1
        elif "홀수" in lowered_text:
            params["Type"] = 2
        else:
            params["Type"] = 0
        return f'execute_hwp_action("HeaderFooter", "HHeaderFooter", {params!r})'

    @classmethod
    def _build_hyperlink_insert_script(cls, raw_text: str, lowered_text: str) -> str:
        target, link_type = cls._extract_first_url_or_email(raw_text)
        if not target or link_type not in (1, 2):
            return ""
        quoted = cls._extract_quoted_strings(raw_text)
        label = target
        for candidate in quoted:
            if candidate and candidate != target and candidate != target.replace("mailto:", ""):
                label = candidate
                break
        params = {
            "Text": label,
            "Command": f"{target};{link_type};0;0",
            "DirectInsert": 1,
        }
        if "선택" in lowered_text:
            params["DirectInsert"] = 0
        return f'execute_hwp_action("InsertHyperlink", "HHyperLink", {params!r})'

    @classmethod
    def _build_find_replace_script(cls, raw_text: str, lowered_text: str) -> str:
        quoted = cls._extract_quoted_strings(raw_text)
        if cls._contains_any(lowered_text, ("찾아", "검색", "찾기")) and quoted:
            params: dict[str, object] = {
                "FindString": quoted[0],
                "IgnoreMessage": 1,
            }
            if "문서 전체" in lowered_text or "전체" in lowered_text:
                params["Direction"] = 2
            if cls._contains_any(lowered_text, ("대소문자", "match case")):
                params["MatchCase"] = 1
            if cls._contains_any(lowered_text, ("정규식", "regex", "regexp")):
                params["FindRegExp"] = 1
            return f'execute_hwp_action("RepeatFind", "HFindReplace", {params!r})'
        return ""

    @classmethod
    def _build_hwp_method_file_script(cls, raw_text: str, lowered_text: str) -> str:
        doc_path = cls._extract_first_file_path(
            raw_text,
            (".hwp", ".hwpx", ".html", ".htm", ".txt", ".xml", ".hml"),
        )
        image_path = cls._extract_first_file_path(
            raw_text,
            (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"),
        )

        if doc_path and cls._contains_any(lowered_text, ("열어", "열기", "open")):
            options: dict[str, object] = {}
            if "템플릿" in lowered_text:
                options["template"] = True
            if cls._contains_any(lowered_text, ("암호창 없이", "암호창없이")):
                options["suspendpassword"] = True
            if cls._contains_any(lowered_text, ("강제로", "force")):
                options["forceopen"] = True
            if cls._contains_any(lowered_text, ("현재 폴더", "작업 폴더")):
                options["setcurdir"] = True
            arg = cls._build_hwp_arg_string(options)
            return f'call_hwp_method("Open", {doc_path!r}, "", {arg!r})'

        if doc_path and cls._contains_any(lowered_text, ("다른 이름", "save as", "내보내기")) and cls._contains_any(lowered_text, ("저장", "save")):
            options: dict[str, object] = {}
            if "압축" in lowered_text:
                options["compress"] = True
            if cls._contains_any(lowered_text, ("전체 저장", "full save")):
                options["fullsave"] = True
            if "백업" in lowered_text:
                options["backup"] = True
            format_name = cls._infer_file_format_from_path(doc_path)
            arg = cls._build_hwp_arg_string(options)
            return f'call_hwp_method("SaveAs", {doc_path!r}, {format_name!r}, {arg!r})'

        if doc_path and cls._contains_any(lowered_text, ("끼워", "삽입", "insert")) and not cls._contains_any(lowered_text, ("필드", "링크", "상호참조")):
            return f'call_hwp_method("Insert", {doc_path!r}, "", "")'

        if image_path and cls._contains_any(lowered_text, ("그림 삽입", "이미지 삽입", "그림 넣", "이미지 넣")):
            embedded = not cls._contains_any(lowered_text, ("링크 그림", "연결 그림"))
            return f'call_hwp_method("InsertPicture", {image_path!r}, {embedded!r}, 0, False, False, 0, 0, 0)'

        if cls._contains_any(lowered_text, ("저장", "save")) and not cls._contains_any(lowered_text, ("다른 이름", "pdf", "배포용", "암호")):
            if cls._contains_any(lowered_text, ("변경된 경우만", "변경 시만")):
                return 'call_hwp_method("Save", True)'
            return 'call_hwp_method("Save")'

        return ""

    @classmethod
    def _build_hwp_method_field_script(cls, raw_text: str, lowered_text: str) -> str:
        quoted = cls._extract_quoted_strings(raw_text)
        if cls._contains_any(lowered_text, ("필드 목록", "필드 리스트")):
            return 'print(call_hwp_method("GetFieldList", 0, 0))'

        if "필드" in lowered_text and cls._contains_any(lowered_text, ("있는지", "존재", "존재해")) and quoted:
            return f'print(call_hwp_method("FieldExist", {quoted[0]!r}))'

        if "필드" in lowered_text and cls._contains_any(lowered_text, ("값", "내용")) and cls._contains_any(lowered_text, ("읽", "보여", "가져")) and quoted:
            return f'print(call_hwp_method("GetFieldText", {quoted[0]!r}))'

        if "필드" in lowered_text and cls._contains_any(lowered_text, ("이동", "가", "점프")) and quoted:
            return f'call_hwp_method("MoveToField", {quoted[0]!r})'

        if "필드" in lowered_text and cls._contains_any(lowered_text, ("넣어", "입력", "채워", "설정")) and len(quoted) >= 2:
            return f'call_hwp_method("PutFieldText", {quoted[0]!r}, {quoted[1]!r})'

        if "필드" in lowered_text and cls._contains_any(lowered_text, ("만들", "생성", "추가")) and quoted:
            return f'call_hwp_method("CreateField", "", "", {quoted[0]!r})'

        return ""

    @classmethod
    def _build_hwp_method_read_script(cls, raw_text: str, lowered_text: str) -> str:
        if cls._contains_any(lowered_text, ("문서 텍스트", "전체 텍스트", "본문 텍스트")) and cls._contains_any(lowered_text, ("추출", "읽", "가져", "보여")):
            option = "saveblock" if "선택 영역" in lowered_text else ""
            return f'print(call_hwp_method("GetTextFile", "TEXT", {option!r}))'

        if cls._contains_any(lowered_text, ("페이지 텍스트", "페이지 내용")) and cls._contains_any(lowered_text, ("읽", "가져", "보여", "추출")):
            page_match = re.search(r"(\d+)\s*페이지", raw_text)
            if page_match:
                page_no = max(0, int(page_match.group(1)) - 1)
                return f'print(call_hwp_method("GetPageText", {page_no}, 0))'
        return ""

    @classmethod
    def _build_table_property_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블", "셀")):
            return ""
        params: dict[str, object] = {}
        if cls._contains_any(lowered_text, ("제목 행 반복", "제목행 반복", "머리행 반복", "첫 행 반복")):
            params["RepeatHeader"] = 0 if cls._contains_any(lowered_text, ("해제", "끄", "취소")) else 1
        if cls._contains_any(lowered_text, ("글자처럼", "인라인", "본문처럼")):
            params["TreatAsChar"] = 0 if cls._contains_any(lowered_text, ("해제", "끄", "취소")) else 1

        spacing_match = re.search(r"셀\s*간격\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if spacing_match:
            params["CellSpacing"] = cls._mm_to_hwpunit(float(spacing_match.group(1)))

        margin_match = re.search(r"셀\s*여백\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if margin_match:
            margin = cls._mm_to_hwpunit(float(margin_match.group(1)))
            params["CellMarginLeft"] = margin
            params["CellMarginRight"] = margin
            params["CellMarginTop"] = margin
            params["CellMarginBottom"] = margin

        if not params:
            return ""
        return f'execute_hwp_action("TablePropertyDialog", "HTable", {params!r})'

    @classmethod
    def _build_table_template_script(cls, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블")):
            return ""
        if not cls._contains_any(lowered_text, ("스타일", "서식", "표마당", "템플릿", "회색조", "배경")):
            return ""

        format_bits = 0
        if cls._contains_any(lowered_text, ("테두리", "선")):
            format_bits |= 0x0001
        if cls._contains_any(lowered_text, ("글자", "문단", "텍스트")):
            format_bits |= 0x0002
        if cls._contains_any(lowered_text, ("배경", "음영", "채우기")):
            format_bits |= 0x0004
        if cls._contains_any(lowered_text, ("회색조", "그레이", "흑백")):
            format_bits |= 0x0008
        if format_bits == 0:
            format_bits = 0x0001 | 0x0004

        params = {"Format": format_bits}
        return f'execute_hwp_action("TableTemplate", "HTableTemplate", {params!r})'

    @classmethod
    def _build_cell_property_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("셀", "칸")):
            return ""
        cell_params: dict[str, object] = {}
        if cls._contains_any(lowered_text, ("제목 셀", "머리 셀", "헤더 셀")):
            cell_params["Header"] = 0 if cls._contains_any(lowered_text, ("해제", "취소")) else 1
        if cls._contains_any(lowered_text, ("잠가", "잠금", "보호")):
            cell_params["Protected"] = 0 if cls._contains_any(lowered_text, ("해제", "취소")) else 1
        if cls._contains_any(lowered_text, ("편집 가능", "입력 가능")):
            cell_params["Editable"] = 0 if cls._contains_any(lowered_text, ("불가", "못", "금지")) else 1

        width_match = re.search(r"셀\s*너비\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if width_match:
            cell_params["Width"] = cls._mm_to_hwpunit(float(width_match.group(1)))
        height_match = re.search(r"셀\s*높이\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if height_match:
            cell_params["Height"] = cls._mm_to_hwpunit(float(height_match.group(1)))

        if not cell_params:
            return ""
        return f'execute_hwp_action("TablePropertyDialog", "HTable", {{"Cell": {cell_params!r}}})'

    @classmethod
    def _build_cell_border_script(cls, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("셀", "칸")):
            return ""
        if "대각선" in lowered_text:
            params = {"DiagonalType": 1, "BackSlashFlag": 0x02}
            return f'execute_hwp_action("CellBorder", "BorderFill", {params!r})'
        if cls._contains_any(lowered_text, ("가운데 세로선", "중심 세로선")):
            params = {"DiagonalType": 1, "CenterLineFlag": 1, "CrookedSlashFlag2": 1}
            return f'execute_hwp_action("CellBorder", "BorderFill", {params!r})'
        if cls._contains_any(lowered_text, ("가운데 가로선", "중심 가로선")):
            params = {"DiagonalType": 1, "CenterLineFlag": 1, "CrookedSlashFlag1": 1}
            return f'execute_hwp_action("CellBorder", "BorderFill", {params!r})'
        return ""

    @classmethod
    def _build_cell_fill_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블", "셀", "칸")):
            return ""
        if not cls._contains_any(lowered_text, ("배경", "채워", "채우기", "색", "색칠")):
            return ""

        fill_attr: dict[str, object] = {}
        if cls._contains_any(lowered_text, ("채우기 없음", "배경 없음", "채우기 해제")):
            fill_attr["Type"] = 0
        else:
            color = cls._parse_color_value(lowered_text)
            if color is None and not cls._contains_any(lowered_text, ("그라데이션", "이미지 채우기", "그림 채우기")):
                return ""
            if "그라데이션" in lowered_text:
                fill_attr["Type"] = 3
                fill_attr["GradationType"] = 1
            elif cls._contains_any(lowered_text, ("이미지 채우기", "그림 채우기")):
                image_path = cls._extract_first_file_path(raw_text, (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"))
                if not image_path:
                    return ""
                fill_attr["Type"] = 2
                fill_attr["FileName"] = image_path
                fill_attr["Embedded"] = 1
            else:
                fill_attr["Type"] = 1
                fill_attr["WinBrushFaceColor"] = color

        if cls._contains_any(lowered_text, ("표 전체", "전체 셀")):
            params = {"ApplyTo": 1, "AllCellsBorderFill": {"FillAttr": fill_attr}}
            return f'execute_hwp_action("TableCellBorderFill", "HTableCellBorderFill", {params!r})'

        params = {"ApplyTo": 0, "SelCellsBorderFill": {"FillAttr": fill_attr}}
        if cls._contains_any(lowered_text, ("이웃 셀 영향 없이", "주변 셀 영향 없이", "주변 셀 제외")):
            params["NoNeighborCell"] = 1
        return f'execute_hwp_action("CellBorderFill", "HCellBorderFill", {params!r})'

    @classmethod
    def _build_scoped_table_fill_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블", "셀", "칸", "행")):
            return ""
        if not cls._contains_any(lowered_text, ("배경", "채워", "채우기", "색", "색칠")):
            return ""

        fill_script = cls._build_cell_fill_script(raw_text, lowered_text)
        if not fill_script:
            return ""

        scope_prelude = cls._build_table_scope_prelude(lowered_text)
        if scope_prelude:
            return "\n".join([*scope_prelude, fill_script])
        return ""

    @classmethod
    def _build_table_scope_prelude(cls, lowered_text: str) -> list[str]:
        if cls._contains_any(lowered_text, ("선택한 셀만", "선택 셀만", "선택한 셀", "선택 셀")):
            return ['run_hwp_action("TableCellBlock")']

        if cls._contains_any(lowered_text, ("첫 행만", "첫행만", "첫 번째 행만", "첫째 행만", "머리행만", "머리 행만", "헤더 행만", "헤더행만", "머리행 전체", "헤더 행 전체", "헤더행 전체")):
            return [
                'for _ in range(50):',
                '    run_hwp_action("TableUpperCell")',
                'for _ in range(50):',
                '    run_hwp_action("TableLeftCell")',
                'run_hwp_action("TableCellBlockRow")',
            ]

        if cls._contains_any(lowered_text, ("마지막 행만", "끝 행만", "마지막 줄만", "끝 줄만", "마지막 행 전체", "끝 행 전체")):
            return [
                'for _ in range(50):',
                '    run_hwp_action("TableLowerCell")',
                'for _ in range(50):',
                '    run_hwp_action("TableLeftCell")',
                'run_hwp_action("TableCellBlockRow")',
            ]

        if cls._contains_any(lowered_text, ("첫 열만", "첫열만", "첫 번째 열만", "첫째 열만", "첫 열 전체", "첫열 전체")):
            return [
                'for _ in range(50):',
                '    run_hwp_action("TableUpperCell")',
                'for _ in range(50):',
                '    run_hwp_action("TableLeftCell")',
                'run_hwp_action("TableCellBlockCol")',
            ]

        if cls._contains_any(lowered_text, ("마지막 열만", "끝 열만", "마지막 열 전체", "끝 열 전체")):
            return [
                'for _ in range(50):',
                '    run_hwp_action("TableUpperCell")',
                'for _ in range(50):',
                '    run_hwp_action("TableRightCell")',
                'run_hwp_action("TableCellBlockCol")',
            ]

        return []

    @classmethod
    def _build_table_border_style_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블")):
            return ""
        if not cls._contains_any(lowered_text, ("테두리", "선", "테두리색", "선색", "선 색", "테두리 색")):
            return ""

        color = cls._parse_color_value(lowered_text)
        line_style = cls._parse_line_style_value(lowered_text)
        line_width = cls._parse_line_width_value(raw_text)

        if color is None and line_style is None and line_width is None:
            return ""

        params: dict[str, object] = {"ApplyTo": 1, "AllCellsBorderFill": {}}
        border_fill: dict[str, object] = {}

        if color is not None:
            for key in (
                "BorderColor",
                "BorderColorLeft",
                "BorderColorRight",
                "BorderColorTop",
                "BorderColorBottom",
            ):
                border_fill[key] = color
        if line_style is not None:
            for key in (
                "BorderType",
                "BorderTypeLeft",
                "BorderTypeRight",
                "BorderTypeTop",
                "BorderTypeBottom",
            ):
                border_fill[key] = line_style
        if line_width is not None:
            for key in (
                "BorderWidth",
                "BorderWidthLeft",
                "BorderWidthRight",
                "BorderWidthTop",
                "BorderWidthBottom",
            ):
                border_fill[key] = line_width

        params["AllCellsBorderFill"] = border_fill
        return f'execute_hwp_action("TableCellBorderFill", "HTableCellBorderFill", {params!r})'

    @classmethod
    def _build_table_border_scope_action_script(cls, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블", "셀", "칸")):
            return ""
        if not cls._contains_any(lowered_text, ("선", "테두리", "바깥선", "안쪽선", "외곽선")):
            return ""

        if cls._contains_any(lowered_text, ("바깥선만", "바깥 선만", "바깥 테두리만", "외곽선만", "외곽 테두리만")):
            return "\n".join([
                'run_hwp_action("TableCellBlock")',
                'run_hwp_action("TableCellBorderOutside")',
            ])

        if cls._contains_any(lowered_text, ("안쪽선만", "안쪽 선만", "안쪽 테두리만", "내부선만", "내부 선만")):
            if cls._contains_any(lowered_text, ("가로", "수평")):
                return "\n".join([
                    'run_hwp_action("TableCellBlock")',
                    'run_hwp_action("TableCellBorderInsideHorz")',
                ])
            if cls._contains_any(lowered_text, ("세로", "수직")):
                return "\n".join([
                    'run_hwp_action("TableCellBlock")',
                    'run_hwp_action("TableCellBorderInsideVert")',
                ])
            return "\n".join([
                'run_hwp_action("TableCellBlock")',
                'run_hwp_action("TableCellBorderInside")',
            ])

        return ""

    @classmethod
    def _build_scoped_table_border_style_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("표", "테이블", "셀", "칸", "행", "열")):
            return ""
        if not cls._contains_any(lowered_text, ("선", "테두리", "테두리색", "선색", "선 색", "테두리 색")):
            return ""

        color = cls._parse_color_value(lowered_text)
        line_style = cls._parse_line_style_value(lowered_text)
        line_width = cls._parse_line_width_value(raw_text)
        if color is None and line_style is None and line_width is None:
            return ""

        prelude = cls._build_table_scope_prelude(lowered_text)
        border_action = ""
        if cls._contains_any(lowered_text, ("바깥선만", "바깥 선만", "바깥 테두리만", "외곽선만", "외곽 테두리만")):
            prelude = ['run_hwp_action("TableCellBlock")']
            border_action = 'run_hwp_action("TableCellBorderOutside")'
        elif cls._contains_any(lowered_text, ("안쪽선만", "안쪽 선만", "안쪽 테두리만", "내부선만", "내부 선만")):
            prelude = ['run_hwp_action("TableCellBlock")']
            if cls._contains_any(lowered_text, ("가로", "수평")):
                border_action = 'run_hwp_action("TableCellBorderInsideHorz")'
            elif cls._contains_any(lowered_text, ("세로", "수직")):
                border_action = 'run_hwp_action("TableCellBorderInsideVert")'
            else:
                border_action = 'run_hwp_action("TableCellBorderInside")'

        if not prelude and not border_action:
            return ""

        border_fill: dict[str, object] = {}
        if color is not None:
            for key in (
                "BorderColor",
                "BorderColorLeft",
                "BorderColorRight",
                "BorderColorTop",
                "BorderColorBottom",
            ):
                border_fill[key] = color
        if line_style is not None:
            for key in (
                "BorderType",
                "BorderTypeLeft",
                "BorderTypeRight",
                "BorderTypeTop",
                "BorderTypeBottom",
            ):
                border_fill[key] = line_style
        if line_width is not None:
            for key in (
                "BorderWidth",
                "BorderWidthLeft",
                "BorderWidthRight",
                "BorderWidthTop",
                "BorderWidthBottom",
            ):
                border_fill[key] = line_width

        execute_line = (
            'execute_hwp_action("CellBorderFill", "HCellBorderFill", '
            f'{{"ApplyTo": 0, "SelCellsBorderFill": {border_fill!r}}})'
        )
        lines = [*prelude]
        if border_action:
            lines.append(border_action)
        lines.append(execute_line)
        return "\n".join(lines)

    @classmethod
    def _build_shape_style_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("그림", "이미지", "개체", "도형", "글상자")):
            return ""

        color = cls._parse_color_value(lowered_text)
        line_style = cls._parse_line_style_value(lowered_text)
        line_width = cls._parse_line_width_value(raw_text)

        if cls._contains_any(lowered_text, ("선색", "테두리색", "선 색", "테두리 색", "테두리", "선 스타일", "선 굵기")) and (color is not None or line_style is not None or line_width is not None):
            params: dict[str, object] = {}
            if color is not None:
                params["Color"] = color
            if line_style is not None:
                params["Style"] = line_style
            if line_width is not None:
                params["Width"] = line_width
            return f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {{"ShapeDrawLineAttr": {params!r}}})'

        if cls._contains_any(lowered_text, ("채우기", "배경색", "배경 색", "면색", "채움")):
            fill_params: dict[str, object] = {}
            if cls._contains_any(lowered_text, ("채우기 없음", "배경 없음", "채우기 해제")):
                fill_params["Type"] = 0
            elif "그라데이션" in lowered_text:
                fill_params["Type"] = 3
                fill_params["GradationType"] = 1
                if color is not None:
                    fill_params["GradationColor"] = [color]
            elif cls._contains_any(lowered_text, ("이미지 채우기", "그림 채우기")):
                image_path = cls._extract_first_file_path(raw_text, (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"))
                if not image_path:
                    return ""
                fill_params["Type"] = 2
                fill_params["FileName"] = image_path
                fill_params["Embedded"] = 1
            else:
                if color is None:
                    return ""
                fill_params["Type"] = 1
                fill_params["WinBrushFaceColor"] = color
            return f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {{"ShapeDrawFillAttr": {fill_params!r}}})'

        if cls._contains_any(lowered_text, ("회전", "돌려")):
            deg_match = re.search(r"(-?\d+(?:\.\d+)?)\s*도", raw_text)
            angle = int(round(float(deg_match.group(1)) * 100)) if deg_match else 900
            params: dict[str, object] = {"Angle": angle}
            if cls._contains_any(lowered_text, ("내용도 같이", "이미지도 같이")):
                params["RotateImage"] = 1
            return f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {{"ShapeDrawRotate": {params!r}}})'

        if "그림자" in lowered_text:
            params: dict[str, object] = {"ShadowType": 1}
            if color is not None:
                params["ShadowColor"] = color
            offset_match = re.search(r"(\d+(?:\.\d+)?)\s*mm", raw_text)
            if offset_match:
                offset = cls._mm_to_hwpunit(float(offset_match.group(1)))
                params["ShadowOffsetX"] = offset
                params["ShadowOffsetY"] = offset
            else:
                params["ShadowOffsetX"] = 10
                params["ShadowOffsetY"] = 10
            return f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {{"ShapeDrawShadow": {params!r}}})'

        if cls._contains_any(lowered_text, ("기울여", "기울이기", "shear")):
            factor_match = re.search(r"(-?\d+)", raw_text)
            factor = int(factor_match.group(1)) if factor_match else 10
            params: dict[str, object] = {}
            if cls._contains_any(lowered_text, ("세로", "y축")):
                params["YFactor"] = factor
            else:
                params["XFactor"] = factor
            return f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {{"ShapeDrawShear": {params!r}}})'

        return ""

    @classmethod
    def _build_bullet_number_script(cls, raw_text: str, lowered_text: str) -> str:
        if cls._contains_any(lowered_text, ("글머리표", "불릿", "bullet", "체크 불릿", "체크박스 불릿")):
            bullet_params: dict[str, object] = {}
            if cls._contains_any(lowered_text, ("체크", "체크박스")):
                bullet_params["Checkable"] = 1
                bullet_params["BulletChar"] = ord("□")
                bullet_params["CheckedBulletChar"] = ord("■")
            elif cls._contains_any(lowered_text, ("네모", "사각")):
                bullet_params["BulletChar"] = ord("■")
            else:
                bullet_params["BulletChar"] = ord("●")
            if "자동 들여쓰기" in lowered_text:
                bullet_params["AutoIndent"] = 1
            if "가운데" in lowered_text:
                bullet_params["Alignment"] = 1
            elif "오른쪽" in lowered_text:
                bullet_params["Alignment"] = 2
            else:
                bullet_params["Alignment"] = 0
            offset_match = re.search(r"(?:간격|들여쓰기|오프셋)\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
            if offset_match:
                bullet_params["TextOffsetType"] = 1
                bullet_params["TextOffset"] = cls._mm_to_hwpunit(float(offset_match.group(1)))
            return f'execute_hwp_action("ParaShape", "HParaShape", {{"HeadingType": 3, "Bullet": {bullet_params!r}}})'

        if cls._contains_any(lowered_text, ("문단 번호", "번호 매기기", "번호 목록", "번호 문단")):
            return 'execute_hwp_action("ParaShape", "HParaShape", {"HeadingType": 2})'

        if "번호" in lowered_text and cls._contains_any(lowered_text, ("새로 시작", "1부터", "재시작")) and cls._contains_any(lowered_text, ("쪽", "그림", "표", "수식", "각주", "미주")):
            num_type = 0
            if "각주" in lowered_text:
                num_type = 1
            elif "미주" in lowered_text:
                num_type = 2
            elif "그림" in lowered_text:
                num_type = 3
            elif "표" in lowered_text:
                num_type = 4
            elif "수식" in lowered_text:
                num_type = 5
            new_number = 1
            match = re.search(r"(\d+)\s*부터", raw_text)
            if match:
                new_number = max(1, int(match.group(1)))
            return f'execute_hwp_action("AutoNum", "AutoNum", {{"NumType": {num_type}, "NewNumber": {new_number}}})'
        return ""

    @classmethod
    def _build_caption_script(cls, raw_text: str, lowered_text: str) -> str:
        if "캡션" not in lowered_text:
            return ""

        if cls._contains_any(lowered_text, ("제거", "삭제", "없애", "해제")):
            return 'run_hwp_action("ShapeObjDetachCaption")'

        caption_params: dict[str, object] = {}
        if cls._contains_any(lowered_text, ("왼쪽",)):
            caption_params["Side"] = 0
        elif cls._contains_any(lowered_text, ("오른쪽",)):
            caption_params["Side"] = 1
        elif cls._contains_any(lowered_text, ("위", "상단")):
            caption_params["Side"] = 2
        elif cls._contains_any(lowered_text, ("아래", "하단")):
            caption_params["Side"] = 3

        width_match = re.search(r"캡션\s*폭\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if width_match:
            caption_params["Width"] = cls._mm_to_hwpunit(float(width_match.group(1)))
        gap_match = re.search(r"캡션\s*(?:간격|여백)\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if gap_match:
            caption_params["Gap"] = cls._mm_to_hwpunit(float(gap_match.group(1)))
        if cls._contains_any(lowered_text, ("여백 포함", "폭에 여백 포함")):
            caption_params["CapFullSize"] = 1

        if caption_params:
            lines: list[str] = []
            if cls._contains_any(lowered_text, ("달아", "붙여", "추가", "삽입")):
                lines.append('run_hwp_action("ShapeObjAttachCaption")')
            lines.append(f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {{"ShapeCaption": {caption_params!r}}})')
            return "\n".join(lines)

        if cls._contains_any(lowered_text, ("달아", "붙여", "추가", "삽입")):
            return 'run_hwp_action("ShapeObjAttachCaption")'
        return ""

    @classmethod
    def _build_shape_object_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("그림", "이미지", "개체", "도형", "글상자")):
            return ""
        params: dict[str, object] = {}
        if cls._contains_any(lowered_text, ("글자처럼", "인라인", "본문처럼")):
            params["TreatAsChar"] = 0 if cls._contains_any(lowered_text, ("해제", "취소", "끄")) else 1
            if params["TreatAsChar"] == 1:
                params["TextWrap"] = 0
        if cls._contains_any(lowered_text, ("겹치기 허용", "겹치게", "오버랩 허용")):
            params["AllowOverlap"] = 1
        elif cls._contains_any(lowered_text, ("겹치기 금지", "겹치지 않게", "오버랩 금지")):
            params["AllowOverlap"] = 0
        if cls._contains_any(lowered_text, ("크기 고정", "사이즈 고정")):
            params["ProtectSize"] = 1
        if cls._contains_any(lowered_text, ("잠가", "잠금")):
            params["Lock"] = 0 if cls._contains_any(lowered_text, ("해제", "취소")) else 1

        width_match = re.search(r"(?:개체|그림|이미지|도형)?\s*너비\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if width_match:
            params["Width"] = cls._mm_to_hwpunit(float(width_match.group(1)))
        height_match = re.search(r"(?:개체|그림|이미지|도형)?\s*높이\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if height_match:
            params["Height"] = cls._mm_to_hwpunit(float(height_match.group(1)))

        outside_match = re.search(r"(?:바깥\s*여백|개체\s*여백)\s*(\d+(?:\.\d+)?)\s*mm", raw_text, re.IGNORECASE)
        if outside_match:
            margin = cls._mm_to_hwpunit(float(outside_match.group(1)))
            params["OutsideMarginLeft"] = margin
            params["OutsideMarginRight"] = margin
            params["OutsideMarginTop"] = margin
            params["OutsideMarginBottom"] = margin

        if not params:
            return ""
        return f'execute_hwp_action("ShapeObjDialog", "HShapeObject", {params!r})'

    @classmethod
    def _build_picture_change_script(cls, raw_text: str, lowered_text: str) -> str:
        if not cls._contains_any(lowered_text, ("그림", "이미지")) or not cls._contains_any(lowered_text, ("교체", "바꿔")):
            return ""
        path = cls._extract_first_file_path(raw_text, (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"))
        if not path:
            return ""
        params = {
            "PicturePath": path,
            "PictureEmbed": 0 if cls._contains_any(lowered_text, ("링크", "연결 그림")) else 1,
        }
        return f'execute_hwp_action("PictureChange", "PictureChange", {params!r})'

    @classmethod
    def _build_bookmark_or_crossref_script(cls, raw_text: str, lowered_text: str) -> str:
        quoted = cls._extract_quoted_strings(raw_text)
        if "책갈피" in lowered_text:
            name = quoted[0] if quoted else ""
            if not name:
                return ""
            command = 0
            if cls._contains_any(lowered_text, ("이동", "가", "점프")):
                command = 1
            elif cls._contains_any(lowered_text, ("수정", "변경")):
                command = 2
            bookmark_type = 1 if "블록" in lowered_text else 0
            return f'execute_hwp_action("BookMark", "BookMark", {{"Name": {name!r}, "Type": {bookmark_type}, "Command": {command}}})'

        if "상호참조" in lowered_text:
            if cls._contains_any(lowered_text, ("수정", "변경")):
                if quoted:
                    return f'execute_hwp_action("ModifyCrossReference", "ActionCrossRef", {{"Command": {quoted[0]!r}}})'
                return 'run_hwp_action("ModifyCrossReference")'
            if quoted:
                return f'execute_hwp_action("InsertCrossReference", "ActionCrossRef", {{"Command": {quoted[0]!r}}})'
            return 'run_hwp_action("InsertCrossReference")'
        return ""

    @classmethod
    def _infer_local_edit_script(cls, message: str) -> str:
        raw = (message or "").strip()
        text = raw.lower()
        if not text:
            return ""

        def _emit(*lines: str) -> str:
            return "\n".join(line for line in lines if line).strip()

        find_replace_script = cls._build_find_replace_script(raw, text)
        if find_replace_script:
            return find_replace_script

        hwp_method_field_script = cls._build_hwp_method_field_script(raw, text)
        if hwp_method_field_script:
            return hwp_method_field_script

        hwp_method_file_script = cls._build_hwp_method_file_script(raw, text)
        if hwp_method_file_script:
            return hwp_method_file_script

        hwp_method_read_script = cls._build_hwp_method_read_script(raw, text)
        if hwp_method_read_script:
            return hwp_method_read_script

        page_setup_script = cls._build_page_setup_script(raw, text)
        if page_setup_script:
            return page_setup_script

        bullet_number_script = cls._build_bullet_number_script(raw, text)
        if bullet_number_script:
            return bullet_number_script

        bookmark_or_crossref_script = cls._build_bookmark_or_crossref_script(raw, text)
        if bookmark_or_crossref_script:
            return bookmark_or_crossref_script

        table_property_script = cls._build_table_property_script(raw, text)
        if table_property_script:
            return table_property_script

        cell_property_script = cls._build_cell_property_script(raw, text)
        if cell_property_script:
            return cell_property_script

        cell_border_script = cls._build_cell_border_script(text)
        if cell_border_script:
            return cell_border_script

        scoped_table_border_style_script = cls._build_scoped_table_border_style_script(raw, text)
        if scoped_table_border_style_script:
            return scoped_table_border_style_script

        table_border_scope_action_script = cls._build_table_border_scope_action_script(text)
        if table_border_scope_action_script:
            return table_border_scope_action_script

        scoped_table_fill_script = cls._build_scoped_table_fill_script(raw, text)
        if scoped_table_fill_script:
            return scoped_table_fill_script

        table_border_style_script = cls._build_table_border_style_script(raw, text)
        if table_border_style_script:
            return table_border_style_script

        cell_fill_script = cls._build_cell_fill_script(raw, text)
        if cell_fill_script:
            return cell_fill_script

        table_template_script = cls._build_table_template_script(text)
        if table_template_script:
            return table_template_script

        caption_script = cls._build_caption_script(raw, text)
        if caption_script:
            return caption_script

        picture_change_script = cls._build_picture_change_script(raw, text)
        if picture_change_script:
            return picture_change_script

        shape_style_script = cls._build_shape_style_script(raw, text)
        if shape_style_script:
            return shape_style_script

        shape_object_script = cls._build_shape_object_script(raw, text)
        if shape_object_script:
            return shape_object_script

        if "배포용" in text:
            no_print = 1 if cls._contains_any(text, ("인쇄 금지", "출력 금지", "인쇄 못")) else 0
            no_copy = 1 if cls._contains_any(text, ("복사 금지", "복제 금지", "복사 못")) else 0
            return _emit(
                f'execute_hwp_action("FileSetSecurity", "FileSetSecurity", {{"Password": "1234567", "NoPrint": {no_print}, "NoCopy": {no_copy}}})'
            )

        if "개인정보" in text:
            if cls._contains_any(text, ("암호 변경", "암호 바꿔", "비밀번호 변경", "비밀번호 바꿔")):
                return 'run_hwp_action("PrivateInfoChangePassword")'
            if cls._contains_any(text, ("암호", "비밀번호")):
                return 'run_hwp_action("PrivateInfoSetPassword")'
            if cls._contains_any(text, ("해제", "복원", "다시 보이", "표시")):
                if "현재" in text:
                    return 'run_hwp_action("DeletePrivateInfoMarkAtCurrentPos")'
                return 'run_hwp_action("DeletePrivateInfoMark")'
            if cls._contains_any(text, ("찾", "검색")):
                return 'run_hwp_action("SearchPrivateInfo")'
            if cls._contains_any(text, ("숨", "감춰", "가려", "마스킹")):
                return 'run_hwp_action("MarkPrivateInfo")'

        if cls._contains_any(text, ("문서 암호", "파일 암호")):
            if cls._contains_any(text, ("변경", "바꿔")):
                return 'run_hwp_action("FilePasswordChange")'
            return 'run_hwp_action("FilePassword")'

        if cls._contains_any(text, ("읽기 암호", "쓰기 암호", "읽기/쓰기 암호")):
            if cls._contains_any(text, ("변경", "바꿔")):
                return 'run_hwp_action("FileRWPasswordChange")'
            return 'run_hwp_action("FileRWPasswordNew")'

        header_footer_script = cls._build_header_footer_script(text)
        if header_footer_script and cls._contains_any(text, ("홀수", "짝수", "양쪽", "모든 페이지")):
            return header_footer_script

        if "바탕쪽" in text:
            if cls._contains_any(text, ("삭제", "지워", "제거")):
                return _emit(
                    'run_hwp_action("MasterPageEntry")',
                    'run_hwp_action("MasterPageDelete")',
                )
            if cls._contains_any(text, ("다음", "이후")) and cls._contains_any(text, ("적용", "이어", "연결")):
                return 'run_hwp_action("MasterPageToNext")'
            if cls._contains_any(text, ("이전", "앞 구역")) and cls._contains_any(text, ("적용", "사용")):
                return 'run_hwp_action("MasterPageToPrevious")'
            if cls._contains_any(text, ("첫 쪽 제외", "첫쪽 제외", "첫 페이지 제외")):
                return 'run_hwp_action("MasterPageExcept")'
            return 'run_hwp_action("MasterPageEntry")'

        if "구역" in text and cls._contains_any(text, ("나눠", "나누기", "분리")):
            return 'run_hwp_action("BreakSection")'

        if cls._contains_any(text, ("머리말", "꼬리말")):
            if "필드" in text and cls._contains_any(text, ("넣", "삽입", "추가")):
                return _emit(
                    'run_hwp_action("HeaderFooterModify")',
                    'run_hwp_action("HeaderFooterInsField")',
                )
            if cls._contains_any(text, ("삭제", "지워", "제거")):
                return 'run_hwp_action("HeaderFooterDelete")'
            if cls._contains_any(text, ("다음", "뒤")) and cls._contains_any(text, ("이동", "넘어", "연결")):
                return 'run_hwp_action("HeaderFooterToNext")'
            if cls._contains_any(text, ("이전", "앞")) and cls._contains_any(text, ("이동", "돌아", "연결")):
                return 'run_hwp_action("HeaderFooterToPrev")'
            return 'run_hwp_action("HeaderFooterModify")'

        if "메모" in text:
            if cls._contains_any(text, ("수정", "고쳐", "편집")):
                return 'run_hwp_action("EditFieldMemo")'
            if cls._contains_any(text, ("삭제", "지워", "제거")):
                return 'run_hwp_action("DeleteFieldMemo")'
            if cls._contains_any(text, ("다음",)) and cls._contains_any(text, ("이동", "메모")):
                return 'run_hwp_action("MemoToNext")'
            if cls._contains_any(text, ("이전",)) and cls._contains_any(text, ("이동", "메모")):
                return 'run_hwp_action("MemoToPrev")'
            return 'run_hwp_action("InsertFieldMemo")'

        if cls._contains_any(text, ("하이퍼링크", "hyperlink")) or ("링크" in text and cls._contains_any(text, ("삽입", "추가", "수정", "이동", "걸", "연결"))):
            if cls._contains_any(text, ("수정", "고쳐", "편집")):
                return 'run_hwp_action("ModifyHyperlink")'
            if cls._contains_any(text, ("이동", "열어", "점프")):
                return 'run_hwp_action("HyperlinkJump")'
            hyperlink_script = cls._build_hyperlink_insert_script(raw, text)
            if hyperlink_script:
                return hyperlink_script
            return 'run_hwp_action("InsertHyperlink")'

        if ("필드" in text or cls._contains_any(text, ("날짜", "시간"))) and cls._contains_any(text, ("수정", "고쳐", "형식")):
            if cls._contains_any(text, ("날짜", "시간")):
                format_match = re.search(
                    r"(yyyy[-./]mm[-./]dd|yy[-./]mm[-./]dd|yyyy[-./]mm|yyyy년\s*mm월\s*dd일|yyyy년\s*mm월|hh:mm|hh:mm:ss)",
                    raw,
                    re.IGNORECASE,
                )
                if format_match:
                    fmt = format_match.group(1)
                    params: dict[str, object] = {"DateStyleDataForm": fmt}
                    if cls._contains_any(text, ("문자열", "텍스트")):
                        params["DateStyleType"] = 0
                    elif cls._contains_any(text, ("코드", "필드 코드")):
                        params["DateStyleType"] = 1
                    return f'execute_hwp_action("ModifyFieldDateTime", "HInputDateStyle", {params!r})'
                return 'run_hwp_action("ModifyFieldDateTime")'
            if "경로" in text:
                return 'run_hwp_action("ModifyFieldPath")'
            if cls._contains_any(text, ("요약", "summary")):
                return 'run_hwp_action("ModifyFieldSummary")'
            if cls._contains_any(text, ("개인정보", "사용자 정보")):
                return 'run_hwp_action("ModifyFieldUserInfo")'
        if cls._contains_any(text, ("만든 날짜 필드", "작성 날짜 필드", "날짜 필드")) and cls._contains_any(text, ("삽입", "넣", "추가")):
            return 'execute_hwp_action("InsertFieldTemplate", "HInsertFieldTemplate", {"ShowSingle": 3, "TemplateType": 3, "Editable": 1})'

        table_context = cls._contains_any(text, ("표", "테이블", "셀"))
        if table_context:
            if cls._contains_any(text, ("합쳐", "병합")):
                return _emit(
                    'run_hwp_action("TableCellBlock")',
                    'run_hwp_action("TableMergeCell")',
                )
            if cls._contains_any(text, ("바깥", "외곽")) and "테두리" in text:
                return _emit(
                    'run_hwp_action("TableCellBlock")',
                    'run_hwp_action("TableCellBorderOutside")',
                )
            if "안쪽" in text and cls._contains_any(text, ("가로", "수평")) and "테두리" in text:
                return _emit(
                    'run_hwp_action("TableCellBlock")',
                    'run_hwp_action("TableCellBorderInsideHorz")',
                )
            if "안쪽" in text and "세로" in text and "테두리" in text:
                return _emit(
                    'run_hwp_action("TableCellBlock")',
                    'run_hwp_action("TableCellBorderInsideVert")',
                )
            if cls._contains_any(text, ("너비", "가로폭")) and cls._contains_any(text, ("균등", "같게", "맞춰")):
                return 'run_hwp_action("TableDistributeCellWidth")'
            if "높이" in text and cls._contains_any(text, ("균등", "같게", "맞춰")):
                return 'run_hwp_action("TableDistributeCellHeight")'
            if cls._contains_any(text, ("두 칸", "2칸")) and cls._contains_any(text, ("나눠", "나누")):
                return 'run_hwp_action("TableSplitCellCol2")'
            if cls._contains_any(text, ("두 줄", "2줄", "두 행", "2행")) and cls._contains_any(text, ("나눠", "나누")):
                return 'run_hwp_action("TableSplitCellRow2")'
            if cls._contains_any(text, ("합계", "sum")):
                if cls._contains_any(text, ("오른쪽", "가로")):
                    return 'run_hwp_action("TableFormulaSumHor")'
                if cls._contains_any(text, ("아래", "세로")):
                    return 'run_hwp_action("TableFormulaSumVer")'
                return 'run_hwp_action("TableFormulaSumAuto")'
            if cls._contains_any(text, ("평균", "average", "avg")):
                if cls._contains_any(text, ("오른쪽", "가로")):
                    return 'run_hwp_action("TableFormulaAvgHor")'
                if cls._contains_any(text, ("아래", "세로")):
                    return 'run_hwp_action("TableFormulaAvgVer")'
                return 'run_hwp_action("TableFormulaAvgAuto")'

        if cls._contains_any(text, ("그림", "이미지", "개체", "도형", "글상자")):
            if cls._contains_any(text, ("흑백", "black and white")):
                return 'run_hwp_action("PictureEffect2")'
            if cls._contains_any(text, ("워터마크", "엷게", "옅게")):
                return 'run_hwp_action("PictureEffect3")'
            if cls._contains_any(text, ("그룹 해제", "묶음 해제", "ungroup")):
                return 'run_hwp_action("ShapeObjUngroup")'
            if cls._contains_any(text, ("그룹", "묶어", "묶기")):
                return 'run_hwp_action("ShapeObjGroup")'
            if cls._contains_any(text, ("크기 고정", "사이즈 고정")):
                return 'run_hwp_action("ShapeObjProtectSize")'
            if "글상자" in text and cls._contains_any(text, ("편집", "들어가", "수정")):
                return 'run_hwp_action("ShapeObjTextBoxEdit")'

        return ""

    def _generate_edit_script(self, message: str, chat_model: str) -> str:
        shared_prompt = get_image_instructions_prompt().strip()
        chat_actions_prompt = get_chat_hwp_actions_prompt().strip()
        actiontable_prompt = get_chat_actiontable_prompt().strip()
        if self._attachment_context_cache is None:
            self._attachment_context_cache = self._build_attachment_context(self._attachment_paths)
        attachment_context = self._attachment_context_cache or "No attached reference files."
        prompt = (
            "You are generating a minimal Python script for HWP automation.\n"
            "The user request may not include an image.\n"
            "Use the shared prompts below as the primary source of formatting and HWP automation rules.\n"
            "Use ONLY the following functions:\n"
            '- insert_text("text")\n'
            "- insert_enter()\n"
            "- insert_space()\n"
            "- insert_paragraph()\n"
            "- insert_small_paragraph()\n"
            '- insert_equation("hwp_equation_syntax")\n'
            '- insert_template("header.hwp|box.hwp|box_white.hwp")\n'
            '- focus_placeholder("@@@|###|&&&")\n'
            "- insert_box()\n"
            "- exit_box()\n"
            "- insert_view_box()\n"
            "- insert_table(rows, cols, cell_data=[...], align_center=False, exit_after=True)\n"
            "- insert_cropped_image(x1_pct, y1_pct, x2_pct, y2_pct)\n"
            '- insert_generated_image("path")\n'
            "- set_bold(True/False)\n"
            "- set_underline(True/False)\n\n"
            "- set_char_width_ratio(100)\n"
            "- set_table_border_white()\n"
            "- set_align_right_next_line()\n"
            "- set_align_justify_next_line()\n"
            '- run_hwp_action("ActionName")\n'
            '- execute_hwp_action("ActionName", "ParameterSetName", {"Key": value})\n'
            '- call_hwp_method("MethodName", arg1, arg2, ...)\n\n'
            "Return ONLY Python code. No markdown. No explanation.\n"
            "If the user wants normal text inserted, prefer insert_text(...).\n"
            "If the user asks for a math formula, ALWAYS use insert_equation(...).\n"
            "Never use insert_latex_equation(...).\n"
            "Math must follow the HwpEqn syntax rules from the shared prompt exactly.\n"
            "If both text and formulas are needed, combine them with insert_enter().\n"
            "If an ActionTable action has a PDF precondition, generate any required mode-entry or selection steps before the final action.\n"
            "If the PDF says Run() is not allowed or a ParameterSet is clearly needed, prefer execute_hwp_action(...).\n"
            "For header/footer and master-page commands, enter the proper edit mode first when needed.\n"
            "For table merge/border/distribute actions, ensure table context and add cell-block selection first when required.\n"
            "For field, memo, hyperlink, and date-time modification commands, only use modify actions when the request clearly targets an existing field/control.\n"
            "For object, picture, equation, and textbox commands, prefer sequences that assume object selection or object edit mode when the PDF implies it.\n"
            "For password, privacy, distribution, and security requests, prefer execute_hwp_action(..., params) rather than a bare run_hwp_action(...).\n"
            "Do not open or save files in code.\n"
            "Return executable code for direct typing into the detected HWP document.\n\n"
            "[SHARED PROMPT START]\n"
            f"{shared_prompt}\n"
            "[SHARED PROMPT END]\n\n"
            "[CHAT HWP ACTIONS PROMPT START]\n"
            f"{chat_actions_prompt}\n"
            "[CHAT HWP ACTIONS PROMPT END]\n\n"
            "[ACTIONTABLE PROMPT START]\n"
            f"{actiontable_prompt}\n"
            "[ACTIONTABLE PROMPT END]\n\n"
            "[ATTACHED FILE CONTEXT START]\n"
            f"{attachment_context}\n"
            "[ATTACHED FILE CONTEXT END]\n\n"
            f"Current detected HWP document: {self._current_filename or '없음'}\n"
            f"User request: {message}\n"
        )
        client = AIClient(model=chat_model, check_usage=False)
        raw = client.generate_script(prompt)
        script = self._normalize_script(raw)
        if not self._contains_supported_script_call(script):
            return ""
        return script

    def run(self) -> None:  # type: ignore[override]
        message = (self._user_message or "").strip()
        if not message:
            self.finished.emit({"reply": "", "actions": [], "script": "", "model": ""})
            return

        try:
            from ai_client import _load_env as _load_ai_env  # type: ignore

            _load_ai_env()
        except Exception:
            pass

        chat_model = (os.getenv("CHAT_AI_MODEL") or "").strip() or "gemini-2.5-flash"
        actions = self._infer_local_actions(message)
        has_attachments = bool(self._attachment_paths)

        try:
            script = ""
            if self._looks_like_edit_request(message):
                script = self._infer_local_edit_script(message)
                if not script:
                    script = self._generate_edit_script(message, chat_model)

            if not script and self._is_literal_typing_request(message):
                script = self._build_basic_script(message)

            if actions and script:
                reply = "첨부 파일을 참고해 요청한 문서 작업을 실행한 뒤 내용을 입력합니다." if has_attachments else "요청한 문서 작업을 실행한 뒤 내용을 입력합니다."
            elif actions:
                reply = "첨부 파일을 참고해 요청한 문서 작업을 실행합니다." if has_attachments else "요청한 문서 작업을 실행합니다."
            elif script:
                reply = "첨부 파일을 참고해 감지된 한글 문서에 요청하신 내용을 입력합니다." if has_attachments else "감지된 한글 문서에 요청하신 내용을 입력합니다."
            else:
                reply = "첨부 파일과 요청을 확인했지만 아직 자동 입력으로 처리할 수 있는 편집 명령이 아니었습니다." if has_attachments else "요청을 확인했지만 아직 자동 입력으로 처리할 수 있는 편집 명령이 아니었습니다."

            self.finished.emit(
                {
                    "reply": reply,
                    "actions": actions,
                    "script": script,
                    "model": chat_model,
                }
            )
        except Exception as exc:
            if self._is_literal_typing_request(message):
                fallback_script = self._build_basic_script(message)
                self.finished.emit(
                    {
                        "reply": "AI 해석에 제한이 있어 요청 문장을 그대로 입력합니다.",
                        "actions": actions,
                        "script": fallback_script,
                        "model": "local-fallback",
                    }
                )
                return
            self.error.emit(str(exc))
