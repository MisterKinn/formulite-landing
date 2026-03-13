from __future__ import annotations

import io
from pathlib import Path
from typing import Optional


def _read_image_bytes(image_path: str | Path) -> bytes:
    return Path(image_path).read_bytes()


def load_pil_image(image_path: str | Path, *, mode: Optional[str] = None):
    from PIL import Image  # type: ignore[import-not-found]

    image = Image.open(io.BytesIO(_read_image_bytes(image_path)))
    if mode:
        image = image.convert(mode)
    return image


def load_cv2_image(image_path: str | Path):
    import cv2  # type: ignore[import-not-found]
    import numpy as np  # type: ignore[import-not-found]

    raw = _read_image_bytes(image_path)
    if not raw:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    if arr.size == 0:
        return None
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)
