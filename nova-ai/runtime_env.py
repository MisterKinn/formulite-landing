from __future__ import annotations

import os
import socket
import sys
from pathlib import Path
from typing import Iterable

try:
    from dotenv import dotenv_values, load_dotenv
except Exception:
    dotenv_values = None
    load_dotenv = None


def _project_root(anchor_file: str) -> Path:
    return Path(anchor_file).resolve().parent


def _runtime_root(anchor_file: str) -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return _project_root(anchor_file)


def iter_runtime_env_candidates(anchor_file: str) -> list[tuple[Path, bool]]:
    project_root = _project_root(anchor_file)
    runtime_root = _runtime_root(anchor_file)
    cwd_root = Path.cwd()
    return [
        (runtime_root / ".env.runtime", False),
        (project_root / ".env.runtime", False),
        (cwd_root / ".env.runtime", False),
        (runtime_root / ".env", False),
        (project_root / ".env", False),
        (cwd_root / ".env", False),
        (runtime_root / ".env.local", True),
        (project_root / ".env.local", True),
        (cwd_root / ".env.local", True),
    ]


def load_runtime_env(anchor_file: str) -> None:
    seen_paths: set[Path] = set()

    for path, override in iter_runtime_env_candidates(anchor_file):
        try:
            resolved = path.resolve()
        except Exception:
            resolved = path
        if resolved in seen_paths or not path.exists():
            continue
        seen_paths.add(resolved)

        def existing_value(key: str) -> str:
            return str(os.environ.get(key) or "").strip()

        if dotenv_values is not None:
            try:
                loaded = dotenv_values(path)
                for key, value in loaded.items():
                    normalized_key = str(key or "").strip().lstrip("\ufeff")
                    if not normalized_key:
                        continue
                    normalized_value = str(value or "").strip().strip('"').strip("'")
                    if override or not existing_value(normalized_key):
                        os.environ[normalized_key] = normalized_value
                continue
            except Exception:
                pass

        if load_dotenv is not None:
            try:
                load_dotenv(dotenv_path=path, override=override)
                continue
            except Exception:
                pass

        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                normalized_key = key.strip().lstrip("\ufeff")
                normalized_value = value.strip().strip('"').strip("'")
                if not normalized_key:
                    continue
                if override or not existing_value(normalized_key):
                    os.environ[normalized_key] = normalized_value
        except Exception:
            continue


def first_env_value(*keys: str) -> str:
    for key in keys:
        value = str(os.environ.get(key) or "").strip()
        if value:
            return value
    return ""


def missing_env_keys(key_groups: Iterable[tuple[str, ...]]) -> list[tuple[str, ...]]:
    missing: list[tuple[str, ...]] = []
    for group in key_groups:
        if not first_env_value(*group):
            missing.append(group)
    return missing


def can_connect(host: str, port: int = 443, timeout_sec: float = 2.5) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout_sec):
            return True, ""
    except Exception as exc:
        return False, str(exc)
