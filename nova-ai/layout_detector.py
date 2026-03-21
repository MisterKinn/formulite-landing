from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Literal, Optional, Tuple
from image_path_utils import load_cv2_image, load_pil_image


def _debug(msg: str) -> None:
    if sys.stderr is not None:
        try:
            sys.stderr.write(f"[Layout Debug] {msg}\n")
            sys.stderr.flush()
        except Exception:
            # Windowed executables may not have a writable stderr handle.
            pass


ContainerTemplate = Literal["header.hwp", "box.hwp"]


@dataclass(frozen=True)
class ContainerDetection:
    """
    Result of container detection on an image.

    - template: which HWP template should be inserted
    - rect: (x, y, w, h) bounding box of the container (in original image coordinates),
            if detected. For header-only detection (no border), rect can be None.
    - has_view_text: whether "<보기>"-like header text was detected
    - border_score: 0..1 score indicating border strength along detected rectangle
    """

    template: Optional[ContainerTemplate]
    rect: Optional[Tuple[int, int, int, int]]
    has_view_text: bool
    border_score: float


def detect_container(image_path: str) -> ContainerDetection:
    """
    Detect a printed container and choose the correct template.

    Heuristics:
    - Detect the best rectangle candidate (container border) using edge + contour geometry.
    - Compute border strength along the rectangle perimeter.
    - Detect '<보기>' text using pytesseract word boxes; tolerate spaced '< 보 기 >'.
    - Decision:
        - If explicit '<보기>' text is found AND it belongs to the detected box: header.hwp
        - Else if a strong bordered rectangular box is found: box.hwp
        - Else: template=None
    """
    _debug(f"Detecting container for: {image_path}")

    has_view_text, view_bbox = _detect_view_text_bbox(image_path)
    _debug(f"View text detected: {has_view_text}, bbox: {view_bbox}")
    
    rect, border_score = _detect_best_rectangle(image_path)
    _debug(f"Rectangle detected: {rect}, border_score: {border_score:.3f}")

    template: Optional[ContainerTemplate] = None
    explicit_view_box = bool(has_view_text and rect is not None and _view_text_matches_rect(view_bbox, rect))
    if explicit_view_box:
        template = "header.hwp"
    elif rect is not None and float(border_score) >= 0.12:
        template = "box.hwp"

    _debug(
        "Template decision: "
        f"explicit_view_box={explicit_view_box}, has_view_text={has_view_text}, rect={rect}, template={template}"
    )
    return ContainerDetection(
        template=template,
        rect=rect,
        has_view_text=explicit_view_box,
        border_score=float(border_score),
    )


def _detect_view_text_bbox(image_path: str) -> tuple[bool, Optional[Tuple[int, int, int, int]]]:
    """
    Returns (has_view_text, bbox).
    bbox is best-effort union bbox of the detected '<보기>' token(s).
    """

    try:
        from PIL import Image  # type: ignore[import-not-found]
        import pytesseract  # type: ignore[import-not-found]
    except Exception:
        return False, None

    # Respect optional environment override used elsewhere in Nova AI Lite.
    try:
        import os

        tesseract_cmd = os.getenv("TESSERACT_CMD")
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    except Exception:
        pass

    try:
        img = load_pil_image(image_path, mode="RGB")
    except Exception:
        return False, None

    # Fallback: raw OCR string (bbox not guaranteed, but better than missing the signal)
    try:
        raw = pytesseract.image_to_string(img, lang="kor+eng")
        # Remove all whitespace (spaces/newlines/tabs) for robust matching.
        raw_norm = "".join((raw or "").split())
        raw_norm = raw_norm.replace("〈", "<").replace("〉", ">").replace("《", "<").replace("》", ">")
        raw_norm = raw_norm.replace("＜", "<").replace("＞", ">")
        if "보기" in raw_norm or "<보기>" in raw_norm or "<보기" in raw_norm:
            # We don't know bbox here; return True with bbox=None.
            return True, None
        # spaced "<보 기>" style
        if ("보" in raw_norm and "기" in raw_norm) and ("<" in raw_norm or ">" in raw_norm):
            return True, None
    except Exception:
        pass

    try:
        data = pytesseract.image_to_data(img, lang="kor+eng", output_type=pytesseract.Output.DICT)
    except Exception:
        return False, None

    n = len(data.get("text", []))
    tokens: list[tuple[str, int, int, int, int, int]] = []
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        # Some Korean headers are low-confidence; keep a low threshold.
        conf = int(float(data.get("conf", ["-1"] * n)[i] or -1))
        # If token looks like a header marker, keep it even with low conf.
        if conf < 5:
            txt_probe = (data["text"][i] or "").strip()
            if not any(ch in txt_probe for ch in ("보", "기", "<", ">", "〈", "〉", "《", "》", "＜", "＞")):
                continue
        if not txt:
            continue
        x = int(data["left"][i])
        y = int(data["top"][i])
        w = int(data["width"][i])
        h = int(data["height"][i])
        line = int(data.get("line_num", [0] * n)[i] or 0)
        tokens.append((txt, x, y, w, h, line))

    # Direct hit: '보기' or '<보기>' variants
    for txt, x, y, w, h, _line in tokens:
        normalized = txt.replace(" ", "")
        normalized = normalized.replace("〈", "<").replace("〉", ">").replace("《", "<").replace("》", ">")
        normalized = normalized.replace("＜", "<").replace("＞", ">")
        if "보기" in normalized:
            return True, (x, y, w, h)
        if "<보기>" in normalized:
            return True, (x, y, w, h)

    # Spaced pattern: '<' '보' '기' '>' (or without brackets)
    # Group by line and y proximity.
    by_line: dict[int, list[tuple[str, int, int, int, int]]] = {}
    for txt, x, y, w, h, line in tokens:
        by_line.setdefault(line, []).append((txt, x, y, w, h))
    for line, items in by_line.items():
        if not line:
            continue
        items.sort(key=lambda t: t[1])
        texts = [t[0] for t in items]
        joined = "".join(texts).replace(" ", "")
        joined = joined.replace("〈", "<").replace("〉", ">").replace("《", "<").replace("》", ">")
        joined = joined.replace("＜", "<").replace("＞", ">")
        if "보기" not in joined:
            continue
        # best-effort bbox: union of tokens that include 보/기 or brackets on that line
        xs: list[int] = []
        ys: list[int] = []
        xe: list[int] = []
        ye: list[int] = []
        for txt, x, y, w, h in items:
            t = txt.replace(" ", "")
            if any(ch in t for ch in ("보", "기", "<", ">", "〈", "〉", "《", "》", "＜", "＞")):
                xs.append(x)
                ys.append(y)
                xe.append(x + w)
                ye.append(y + h)
        if xs:
            return True, (min(xs), min(ys), max(xe) - min(xs), max(ye) - min(ys))

    return False, None


def _detect_best_rectangle(image_path: str) -> tuple[Optional[Tuple[int, int, int, int]], float]:
    """
    Detect the most likely container rectangle and return (rect, border_score).
    rect is (x, y, w, h) in original image coords.
    border_score is 0..1 edge density along perimeter.
    """

    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return None, 0.0

    img = load_cv2_image(image_path)
    if img is None:
        return None, 0.0
    h, w = img.shape[:2]
    if h < 10 or w < 10:
        return None, 0.0

    # 이미지가 너무 크면 리사이즈해서 처리
    max_dim = 2000
    scale = 1.0
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        img = cv2.resize(img, (new_w, new_h))
        _debug(f"Resized image from {w}x{h} to {new_w}x{new_h} (scale={scale:.3f})")
        h, w = new_h, new_w

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Line-based detection (more robust when borders are broken by '<보기>' header).
    try:
        bw = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 21, 10
        )
        # Extract long horizontal/vertical strokes.
        hk = max(30, w // 25)
        vk = max(30, h // 25)
        h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (hk, 1))
        v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vk))
        horizontal = cv2.erode(bw, h_kernel, iterations=1)
        horizontal = cv2.dilate(horizontal, h_kernel, iterations=1)
        vertical = cv2.erode(bw, v_kernel, iterations=1)
        vertical = cv2.dilate(vertical, v_kernel, iterations=1)
        grid = cv2.add(horizontal, vertical)
        grid = cv2.dilate(grid, np.ones((3, 3), np.uint8), iterations=1)
        contours, _ = cv2.findContours(grid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        edge_map = grid
        _debug(f"Grid-based contours found: {len(contours)}")
    except Exception as e:
        _debug(f"Grid method failed: {e}, using Canny fallback")
        # Edge fallback
        edges = cv2.Canny(gray, 40, 140)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        edge_map = edges
    candidates: list[Tuple[int, int, int, int, float]] = []
    img_area = float(w * h)
    _debug(f"Image size: {w}x{h}, area: {img_area}")

    for cnt in contours:
        x, y, ww, hh = cv2.boundingRect(cnt)
        area = float(ww * hh)
        if area < img_area * 0.02:
            continue
        if area > img_area * 0.90:
            continue
        if ww < 40 or hh < 20:
            continue
        aspect = ww / max(1.0, float(hh))
        # Accept both wide view-boxes and tall reading-passage boxes.
        if aspect < 0.45 or aspect > 30:
            continue
        # Exclude near full-page frames and very near borders (likely page edge)
        margin = int(min(w, h) * 0.02)
        if x <= margin and y <= margin:
            continue
        if (x + ww) >= (w - margin) and (y + hh) >= (h - margin):
            continue

        score = _border_score_on_rect(edge_map, (x, y, ww, hh))
        _debug(f"Candidate: ({x},{y},{ww},{hh}) aspect={aspect:.2f} score={score:.3f}")
        candidates.append((x, y, ww, hh, score))

    _debug(f"Total candidates after filtering: {len(candidates)}")
    if not candidates:
        return None, 0.0

    # Choose the best: prioritize larger area, then stronger border.
    candidates.sort(key=lambda t: (t[2] * t[3], t[4]), reverse=True)
    x, y, ww, hh, score = candidates[0]
    
    # 리사이즈한 경우 원래 좌표로 복원
    if scale < 1.0:
        x = int(x / scale)
        y = int(y / scale)
        ww = int(ww / scale)
        hh = int(hh / scale)
        _debug(f"Restored coordinates to original scale: ({x},{y},{ww},{hh})")
    
    return (int(x), int(y), int(ww), int(hh)), float(score)


def _border_score_on_rect(edges, rect: Tuple[int, int, int, int]) -> float:
    import numpy as np  # type: ignore[import-not-found]

    x, y, w, h = rect
    hh, ww = edges.shape[:2]
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(ww - 1, x + w)
    y1 = min(hh - 1, y + h)
    if x1 <= x0 or y1 <= y0:
        return 0.0

    # Sample a 2px band around the perimeter and compute edge density.
    band = 2
    top = edges[max(0, y0 - band) : min(hh, y0 + band), x0:x1]
    bottom = edges[max(0, y1 - band) : min(hh, y1 + band), x0:x1]
    left = edges[y0:y1, max(0, x0 - band) : min(ww, x0 + band)]
    right = edges[y0:y1, max(0, x1 - band) : min(ww, x1 + band)]

    total_pixels = float(top.size + bottom.size + left.size + right.size)
    if total_pixels <= 1:
        return 0.0
    edge_pixels = float(np.count_nonzero(top) + np.count_nonzero(bottom) + np.count_nonzero(left) + np.count_nonzero(right))
    return max(0.0, min(1.0, edge_pixels / total_pixels))


def _view_text_matches_rect(
    view_bbox: Optional[Tuple[int, int, int, int]],
    rect: Tuple[int, int, int, int],
) -> bool:
    """
    Require explicit '<보기>' text to be located near the top area of the same box.
    When OCR only gives a global string hit (bbox=None), reject it to avoid false
    positives on plain problems that merely mention '보기' in the body text.
    """
    if view_bbox is None:
        return False

    vx, vy, vw, vh = view_bbox
    rx, ry, rw, rh = rect
    if rw <= 0 or rh <= 0 or vw <= 0 or vh <= 0:
        return False

    view_cx = vx + (vw / 2.0)
    view_top = vy
    rect_left = rx
    rect_right = rx + rw
    rect_top = ry
    rect_header_bottom = ry + max(18.0, rh * 0.28)

    if not (rect_left <= view_cx <= rect_right):
        return False
    if not (rect_top - max(8.0, rh * 0.08) <= view_top <= rect_header_bottom):
        return False
    return True


def crop_inside_rect(image_path: str, rect: Tuple[int, int, int, int], *, inset: int = 4) -> Optional["object"]:
    """
    Return a PIL Image cropped to the inside of rect (excluding border by `inset`).
    """
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        img = load_pil_image(image_path, mode="RGB")
    except Exception:
        return None
    x, y, w, h = rect
    x0 = max(0, x + inset)
    y0 = max(0, y + inset)
    x1 = min(img.width, x + w - inset)
    y1 = min(img.height, y + h - inset)
    if x1 <= x0 or y1 <= y0:
        return None
    refined = refine_content_rect(
        image_path,
        (x0, y0, x1 - x0, y1 - y0),
        min_padding=max(4, inset),
    )
    if refined is not None:
        rx, ry, rw, rh = refined
        return img.crop((rx, ry, rx + rw, ry + rh))
    return img.crop((x0, y0, x1, y1))


def mask_rect_on_image(image_path: str, rect: Tuple[int, int, int, int], *, pad: int = 2) -> Optional["object"]:
    """
    Return a PIL Image with the given rect area masked to white.
    """
    try:
        from PIL import Image, ImageDraw  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        img = load_pil_image(image_path, mode="RGB")
    except Exception:
        return None
    x, y, w, h = rect
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(img.width, x + w + pad)
    y1 = min(img.height, y + h + pad)
    draw = ImageDraw.Draw(img)
    draw.rectangle([x0, y0, x1, y1], fill=(255, 255, 255))
    return img


def _union_bbox(
    a: Optional[Tuple[int, int, int, int]],
    b: Optional[Tuple[int, int, int, int]],
) -> Optional[Tuple[int, int, int, int]]:
    if a is None:
        return b
    if b is None:
        return a
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    left = min(ax, bx)
    top = min(ay, by)
    right = max(ax + aw, bx + bw)
    bottom = max(ay + ah, by + bh)
    return (left, top, max(1, right - left), max(1, bottom - top))


def _mask_bbox(mask) -> Optional[Tuple[int, int, int, int]]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return None
    if mask is None or getattr(mask, "size", 0) == 0:
        return None
    points = cv2.findNonZero(mask)
    if points is None:
        return None
    x, y, w, h = cv2.boundingRect(points)
    if w <= 0 or h <= 0:
        return None
    return (int(x), int(y), int(w), int(h))


def _trim_dense_edge_lines(mask, *, max_trim_ratio: float = 0.12):
    try:
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return mask
    if mask is None or getattr(mask, "size", 0) == 0:
        return mask
    trimmed = mask.copy()
    h, w = trimmed.shape[:2]
    if h < 8 or w < 8:
        return trimmed

    top = 0
    bottom = h
    left = 0
    right = w
    max_trim_y = max(1, int(h * max_trim_ratio))
    max_trim_x = max(1, int(w * max_trim_ratio))
    band = 2
    density_threshold = 0.22

    while top < max_trim_y:
        sample = trimmed[top : min(h, top + band), left:right]
        if sample.size == 0:
            break
        density = float(np.count_nonzero(sample)) / float(sample.size)
        if density < density_threshold:
            break
        top += 1

    while (h - bottom) < max_trim_y and bottom > top:
        sample = trimmed[max(top, bottom - band) : bottom, left:right]
        if sample.size == 0:
            break
        density = float(np.count_nonzero(sample)) / float(sample.size)
        if density < density_threshold:
            break
        bottom -= 1

    while left < max_trim_x:
        sample = trimmed[top:bottom, left : min(w, left + band)]
        if sample.size == 0:
            break
        density = float(np.count_nonzero(sample)) / float(sample.size)
        if density < density_threshold:
            break
        left += 1

    while (w - right) < max_trim_x and right > left:
        sample = trimmed[top:bottom, max(left, right - band) : right]
        if sample.size == 0:
            break
        density = float(np.count_nonzero(sample)) / float(sample.size)
        if density < density_threshold:
            break
        right -= 1

    if top > 0:
        trimmed[:top, :] = 0
    if bottom < h:
        trimmed[bottom:, :] = 0
    if left > 0:
        trimmed[:, :left] = 0
    if right < w:
        trimmed[:, right:] = 0
    return trimmed


def _filter_small_components(mask):
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return mask
    if mask is None or getattr(mask, "size", 0) == 0:
        return mask
    h, w = mask.shape[:2]
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    filtered = np.zeros_like(mask)
    min_area = max(10, int((h * w) * 0.00015))
    min_span_w = max(10, int(w * 0.08))
    min_span_h = max(10, int(h * 0.08))
    for label in range(1, num_labels):
        x, y, comp_w, comp_h, area = stats[label]
        if area >= min_area or comp_w >= min_span_w or comp_h >= min_span_h:
            filtered[labels == label] = 255
    return filtered


def _detect_ocr_bbox_in_rect(
    image_path: str,
    rect: Tuple[int, int, int, int],
) -> Optional[Tuple[int, int, int, int]]:
    try:
        import os
        import pytesseract  # type: ignore[import-not-found]
    except Exception:
        return None

    x, y, w, h = rect
    if w <= 0 or h <= 0:
        return None

    try:
        tesseract_cmd = os.getenv("TESSERACT_CMD")
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    except Exception:
        pass

    try:
        img = load_pil_image(image_path, mode="RGB").crop((x, y, x + w, y + h))
    except Exception:
        return None

    try:
        data = pytesseract.image_to_data(
            img,
            lang="kor+eng",
            output_type=pytesseract.Output.DICT,
        )
    except Exception:
        return None

    xs: list[int] = []
    ys: list[int] = []
    xe: list[int] = []
    ye: list[int] = []
    count = len(data.get("text", []))
    for i in range(count):
        text = str(data["text"][i] or "").strip()
        if not text:
            continue
        try:
            conf = float(data.get("conf", ["-1"] * count)[i] or -1)
        except Exception:
            conf = -1
        if conf < 20 and len(text) < 2:
            continue
        left = int(data["left"][i])
        top = int(data["top"][i])
        width = int(data["width"][i])
        height = int(data["height"][i])
        if width <= 0 or height <= 0:
            continue
        xs.append(left)
        ys.append(top)
        xe.append(left + width)
        ye.append(top + height)
    if not xs:
        return None
    return (min(xs), min(ys), max(xe) - min(xs), max(ye) - min(ys))


def refine_content_rect(
    image_path: str,
    rect: Tuple[int, int, int, int],
    *,
    min_padding: int = 6,
) -> Optional[Tuple[int, int, int, int]]:
    """
    Tighten a proposed crop rectangle to the actual visible content.

    Strategy:
    - start from an existing coarse rectangle
    - build an ink/edge mask from threshold + adaptive threshold + edges
    - remove frame-like edge lines near the crop boundary
    - union the visual mask with OCR word boxes when available
    - add a small padding back so the result still looks human-trimmed
    """
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception:
        return None

    img = load_cv2_image(image_path)
    if img is None:
        return None

    img_h, img_w = img.shape[:2]
    x, y, w, h = rect
    x = max(0, min(int(x), img_w - 1))
    y = max(0, min(int(y), img_h - 1))
    w = max(1, min(int(w), img_w - x))
    h = max(1, min(int(h), img_h - y))
    if w < 4 or h < 4:
        return (x, y, w, h)

    roi = img[y : y + h, x : x + w]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)

    try:
        _, otsu = cv2.threshold(
            blurred,
            0,
            255,
            cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
        )
    except Exception:
        otsu = cv2.threshold(blurred, 200, 255, cv2.THRESH_BINARY_INV)[1]

    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        11,
    )
    edges = cv2.Canny(blurred, 50, 150)

    mask = cv2.bitwise_or(otsu, adaptive)
    mask = cv2.bitwise_or(mask, edges)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    mask = _trim_dense_edge_lines(mask)
    mask = _filter_small_components(mask)

    visual_bbox = _mask_bbox(mask)
    ocr_bbox = _detect_ocr_bbox_in_rect(image_path, (x, y, w, h))
    bbox = _union_bbox(visual_bbox, ocr_bbox)
    if bbox is None:
        return (x, y, w, h)

    bx, by, bw, bh = bbox
    if bw <= 0 or bh <= 0:
        return (x, y, w, h)

    area_ratio = float(bw * bh) / float(max(1, w * h))
    if area_ratio < 0.01:
        return (x, y, w, h)

    pad_x = max(int(min_padding), int(bw * 0.03))
    pad_y = max(int(min_padding), int(bh * 0.04))

    rx0 = max(0, x + bx - pad_x)
    ry0 = max(0, y + by - pad_y)
    rx1 = min(img_w, x + bx + bw + pad_x)
    ry1 = min(img_h, y + by + bh + pad_y)
    if rx1 <= rx0 or ry1 <= ry0:
        return (x, y, w, h)
    return (rx0, ry0, rx1 - rx0, ry1 - ry0)

