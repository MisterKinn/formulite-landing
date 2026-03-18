from __future__ import annotations

import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
SOURCE_ENV_PATH = PROJECT_DIR / ".env"
RELEASE_DIR = PROJECT_DIR / "release"
OUTPUT_ENV_PATH = RELEASE_DIR / ".env.runtime"
REQUIRED_KEYS = (
    "GEMINI_API_KEY",
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
)


def parse_env_file(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        normalized_key = key.strip().lstrip("\ufeff")
        normalized_value = value.strip().strip('"').strip("'")
        if normalized_key:
            values[normalized_key] = normalized_value
    return values


def main() -> int:
    if not SOURCE_ENV_PATH.exists():
        print(f"[release] 배포용 원본 설정 파일이 없습니다: {SOURCE_ENV_PATH.name}")
        return 1

    text = SOURCE_ENV_PATH.read_text(encoding="utf-8-sig")
    values = parse_env_file(text)
    missing = [key for key in REQUIRED_KEYS if not values.get(key, "").strip()]
    if missing:
        print("[release] .env에서 필수 값이 누락되었습니다:")
        for key in missing:
            print(f"  - {key}")
        return 1

    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_ENV_PATH.write_text(text, encoding="utf-8")
    print(f"[release] 배포용 런타임 설정 생성 완료: {OUTPUT_ENV_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
