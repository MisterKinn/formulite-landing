from __future__ import annotations

from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def _read_prompt(filename: str) -> str:
    path = PROMPT_DIR / filename
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    marker = "[PROMPT]"
    if marker in text:
        text = text.split(marker, 1)[1]
    lines = [line for line in text.splitlines() if not line.strip().startswith("#")]
    return "\n".join(lines).strip()


def get_image_instructions_prompt() -> str:
    split_files = [
        "image_instructions_common.txt",
        "image_instructions_subjects.txt",
        "image_instructions_visual.txt",
    ]
    parts = [_read_prompt(name) for name in split_files]
    parts = [part for part in parts if part]
    return "\n\n".join(parts).strip()


def get_chat_hwp_actions_prompt() -> str:
    return _read_prompt("chat_hwp_actions_prompt.txt")


def get_chat_actiontable_prompt() -> str:
    return _read_prompt("chat_actiontable_prompt.txt")


def get_image_generation_prompt() -> str:
    return _read_prompt("image-prompt.txt")


def get_solve_algorithm_prompt() -> str:
    return _read_prompt("solve_algorithm.txt")


def get_solve_prompt() -> str:
    return _read_prompt("solve_prompt.txt")
