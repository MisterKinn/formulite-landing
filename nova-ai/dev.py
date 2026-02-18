"""
Nova AI Lite - Development Hot-Reload Runner
=============================================
파일을 수정하면 자동으로 gui_app.py를 재시작합니다.
추가 패키지 설치 없이 동작합니다.

사용법:
    python dev.py
"""
from __future__ import annotations

import os
import sys
import time
import subprocess
from pathlib import Path

# ── 설정 ──────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent
WATCH_EXTENSIONS = {".py", ".txt", ".json"}      # 감시할 확장자
IGNORE_DIRS = {"__pycache__", ".git", "dist", "build", "output", ".vscode", "venv", ".venv"}
POLL_INTERVAL = 1.0                                # 초 단위 (파일 변경 확인 주기)
ENTRY_SCRIPT = ROOT_DIR / "gui_app.py"
# ───────────────────────────────────────────────────────


def _collect_mtimes(root: Path) -> dict[str, float]:
    """감시 대상 파일들의 수정 시각을 수집합니다."""
    mtimes: dict[str, float] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        # 무시할 디렉터리 제거 (os.walk가 하위 탐색도 건너뜀)
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fname in filenames:
            if Path(fname).suffix not in WATCH_EXTENSIONS:
                continue
            fp = os.path.join(dirpath, fname)
            try:
                mtimes[fp] = os.path.getmtime(fp)
            except OSError:
                pass
    return mtimes


def _diff_mtimes(
    old: dict[str, float], new: dict[str, float]
) -> list[str]:
    """변경된 파일 목록을 반환합니다."""
    changed: list[str] = []
    for fp, mtime in new.items():
        if fp not in old or old[fp] != mtime:
            changed.append(fp)
    # 삭제된 파일
    for fp in old:
        if fp not in new:
            changed.append(fp)
    return changed


def main() -> None:
    print("=" * 56)
    print("  Nova AI Lite - Dev Hot-Reload Runner")
    print("  App restarts automatically when you save files.")
    print(f"  Watch: {WATCH_EXTENSIONS}")
    print(f"  Poll: {POLL_INTERVAL}s")
    print("  Quit: Ctrl+C")
    print("=" * 56)
    print()

    mtimes = _collect_mtimes(ROOT_DIR)
    process: subprocess.Popen | None = None

    def _start() -> subprocess.Popen:
        print(f"\033[92m[>] gui_app.py running...\033[0m")
        return subprocess.Popen(
            [sys.executable, str(ENTRY_SCRIPT)],
            cwd=str(ROOT_DIR),
        )

    def _stop(proc: subprocess.Popen) -> None:
        if proc.poll() is None:
            print(f"\033[93m[*] Stopping app (pid={proc.pid})...\033[0m")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

    process = _start()

    try:
        while True:
            time.sleep(POLL_INTERVAL)

            new_mtimes = _collect_mtimes(ROOT_DIR)
            changed = _diff_mtimes(mtimes, new_mtimes)

            if changed:
                # dev.py 자체가 변경되면 무시 (자기 자신 재시작은 하지 않음)
                changed_filtered = [
                    f for f in changed
                    if os.path.basename(f) != "dev.py"
                ]
                if not changed_filtered:
                    mtimes = new_mtimes
                    continue

                rel_paths = [
                    os.path.relpath(f, ROOT_DIR) for f in changed_filtered
                ]
                print()
                print(f"\033[96m[~] Changed: {', '.join(rel_paths)}\033[0m")

                if process is not None:
                    _stop(process)

                mtimes = new_mtimes
                process = _start()

            # 프로세스가 스스로 종료된 경우 (에러 등) 알림
            if process is not None and process.poll() is not None:
                exit_code = process.returncode
                if exit_code != 0:
                    print(f"\033[91m[x] App exited (exit code={exit_code}). "
                          f"Edit a file to restart.\033[0m")
                else:
                    print(f"\033[93m[*] App stopped. "
                          f"Edit a file to restart.\033[0m")
                process = None

    except KeyboardInterrupt:
        print("\n\033[93mShutting down...\033[0m")
        if process is not None:
            _stop(process)
        sys.exit(0)


if __name__ == "__main__":
    main()
