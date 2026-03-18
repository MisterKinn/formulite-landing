from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from upload_items import UploadItem, build_upload_item


QUESTION_START_RE = re.compile(r"^\s*(\d{1,3})\s*[\.\)]\s*.+$")
SCORE_RE = re.compile(r"[\[\(]?\s*\d+(?:\.\d+)?\s*점\s*[\]\)]?")
CHOICE_TEXT = "①②③④⑤"


@dataclass(frozen=True)
class PdfSplitSummary:
    items: list[UploadItem]
    warnings: list[str]


def split_pdf_into_problem_items(pdf_path: str) -> PdfSplitSummary:
    normalized_pdf_path = str(pdf_path or "").strip()
    if not normalized_pdf_path:
        return PdfSplitSummary(items=[], warnings=["빈 PDF 경로는 분석할 수 없습니다."])

    try:
        import fitz  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]
    except Exception as exc:
        return PdfSplitSummary(items=[], warnings=[f"PDF 분석에 필요한 패키지를 불러오지 못했습니다: {exc}"])

    warnings: list[str] = []
    items: list[UploadItem] = []
    temp_root = Path(tempfile.gettempdir()) / "nova_ai" / "pdf_problem_crops"
    temp_root.mkdir(parents=True, exist_ok=True)

    try:
        doc = fitz.open(normalized_pdf_path)
    except Exception as exc:
        return PdfSplitSummary(items=[], warnings=[f"PDF를 열지 못했습니다: {exc}"])

    try:
        pdf_stem = Path(normalized_pdf_path).stem
        for page_idx in range(len(doc)):
            page = doc.load_page(page_idx)
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            page_image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            page_items = _split_page_into_problem_items(
                page_image,
                pdf_path=normalized_pdf_path,
                pdf_stem=pdf_stem,
                page_number=page_idx + 1,
                temp_root=temp_root,
            )
            items.extend(page_items)
    except Exception as exc:
        warnings.append(f"PDF 분석 중 오류가 발생했습니다: {exc}")
    finally:
        doc.close()

    if not items and not warnings:
        warnings.append("문항 번호와 선지/배점 패턴을 찾지 못했습니다.")
    return PdfSplitSummary(items=items, warnings=warnings)


def _split_page_into_problem_items(
    page_image,
    *,
    pdf_path: str,
    pdf_stem: str,
    page_number: int,
    temp_root: Path,
) -> list[UploadItem]:
    lines = _extract_ocr_lines(page_image)
    if not lines:
        return []

    candidates: list[tuple[int, str]] = []
    for idx, line in enumerate(lines):
        match = QUESTION_START_RE.match(line["text"])
        if match:
            candidates.append((idx, match.group(1)))
    if not candidates:
        return []

    width, height = page_image.size
    items: list[UploadItem] = []
    for pos, (line_idx, problem_number) in enumerate(candidates):
        end_line_idx = candidates[pos + 1][0] if pos + 1 < len(candidates) else len(lines)
        region_lines = lines[line_idx:end_line_idx]
        region_text = "\n".join(str(line["text"]) for line in region_lines).strip()
        if not _looks_like_exam_problem(region_text):
            continue

        x1 = min(int(line["x1"]) for line in region_lines)
        y1 = min(int(line["y1"]) for line in region_lines)
        x2 = max(int(line["x2"]) for line in region_lines)
        y2 = max(int(line["y2"]) for line in region_lines)
        cropped = _crop_with_padding(page_image, x1, y1, x2, y2, width=width, height=height)
        if cropped is None:
            continue

        crop_name = f"{Path(pdf_path).stem}_p{page_number}_{problem_number}_{line_idx}.png"
        crop_path = temp_root / crop_name
        cropped.save(crop_path)
        items.append(
            build_upload_item(
                pdf_path,
                display_name=f"{pdf_stem} p{page_number} #{problem_number}",
                source_kind="pdf_problem",
                page_number=page_number,
                problem_number=problem_number,
                origin_pdf_path=pdf_path,
                ai_input_path=str(crop_path),
            )
        )
    return items


def _extract_ocr_lines(image) -> list[dict[str, Any]]:
    try:
        import pytesseract  # type: ignore[import-not-found]
    except Exception:
        return []

    tesseract_cmd = os.getenv("TESSERACT_CMD")
    if tesseract_cmd:
        try:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        except Exception:
            pass

    try:
        data = pytesseract.image_to_data(image, lang="kor+eng", output_type=pytesseract.Output.DICT)
    except Exception:
        return []

    total = len(data.get("text", []))
    grouped: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for idx in range(total):
        raw_text = str(data["text"][idx] or "").strip()
        if not raw_text:
            continue
        try:
            conf = float(data.get("conf", ["-1"] * total)[idx] or -1)
        except Exception:
            conf = -1.0
        if conf < 0 and not re.search(r"\d|[①②③④⑤점\.\)]", raw_text):
            continue
        key = (
            int(data.get("block_num", [0] * total)[idx] or 0),
            int(data.get("par_num", [0] * total)[idx] or 0),
            int(data.get("line_num", [0] * total)[idx] or 0),
        )
        grouped.setdefault(key, []).append(
            {
                "text": raw_text,
                "left": int(data["left"][idx]),
                "top": int(data["top"][idx]),
                "width": int(data["width"][idx]),
                "height": int(data["height"][idx]),
            }
        )

    lines: list[dict[str, Any]] = []
    for tokens in grouped.values():
        tokens.sort(key=lambda token: (token["left"], token["top"]))
        text = " ".join(token["text"] for token in tokens).strip()
        if not text:
            continue
        x1 = min(token["left"] for token in tokens)
        y1 = min(token["top"] for token in tokens)
        x2 = max(token["left"] + token["width"] for token in tokens)
        y2 = max(token["top"] + token["height"] for token in tokens)
        lines.append({"text": text, "x1": x1, "y1": y1, "x2": x2, "y2": y2})
    lines.sort(key=lambda line: (line["y1"], line["x1"]))
    return lines


def _looks_like_exam_problem(region_text: str) -> bool:
    normalized = " ".join(str(region_text or "").split())
    if not normalized:
        return False
    has_choices = any(choice in normalized for choice in CHOICE_TEXT)
    has_score = SCORE_RE.search(normalized) is not None
    return bool(has_choices or has_score)


def _crop_with_padding(image, x1: int, y1: int, x2: int, y2: int, *, width: int, height: int):
    pad_x = max(24, int((x2 - x1) * 0.04))
    pad_y = max(24, int((y2 - y1) * 0.06))
    left = max(0, x1 - pad_x)
    top = max(0, y1 - pad_y)
    right = min(width, x2 + pad_x)
    bottom = min(height, y2 + pad_y)
    if right <= left or bottom <= top:
        return None
    return image.crop((left, top, right, bottom))
