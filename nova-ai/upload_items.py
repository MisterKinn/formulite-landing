from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class UploadItem:
    item_id: str
    source_path: str
    ai_input_path: str
    display_name: str
    source_kind: str = "image"
    page_number: int | None = None
    problem_number: str | None = None
    origin_pdf_path: str | None = None

    @property
    def extension(self) -> str:
        return Path(self.ai_input_path).suffix.lower()

    @property
    def is_pdf(self) -> bool:
        return self.source_kind in {"pdf", "pdf_problem"} or self.extension == ".pdf"

    @property
    def badge_text(self) -> str:
        return "PDF" if self.is_pdf else "IMG"

    @property
    def file_type_label(self) -> str:
        if self.source_kind == "pdf_problem":
            parts: list[str] = ["PDF 문제"]
            if self.page_number is not None:
                parts.append(f"{self.page_number}페이지")
            if self.problem_number:
                parts.append(f"{self.problem_number}번")
            return " / ".join(parts)
        return "pdf 파일" if self.is_pdf else "이미지 파일"

    @property
    def order_title(self) -> str:
        return self.display_name or os.path.basename(self.ai_input_path)

    @property
    def crop_source_path(self) -> str:
        if self.source_kind == "pdf_problem":
            return self.ai_input_path
        return self.source_path


def build_upload_item(
    path: str,
    *,
    display_name: str | None = None,
    source_kind: str = "image",
    page_number: int | None = None,
    problem_number: str | None = None,
    origin_pdf_path: str | None = None,
    ai_input_path: str | None = None,
) -> UploadItem:
    normalized_path = str(path or "").strip()
    input_path = str(ai_input_path or normalized_path).strip()
    name = (display_name or os.path.basename(normalized_path or input_path)).strip()
    return UploadItem(
        item_id=uuid.uuid4().hex,
        source_path=normalized_path,
        ai_input_path=input_path,
        display_name=name,
        source_kind=(source_kind or "image").strip() or "image",
        page_number=page_number,
        problem_number=(str(problem_number).strip() or None) if problem_number is not None else None,
        origin_pdf_path=str(origin_pdf_path or "").strip() or None,
    )
