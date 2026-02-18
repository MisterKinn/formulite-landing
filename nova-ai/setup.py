from __future__ import annotations

from pathlib import Path
from setuptools import find_packages, setup


ROOT = Path(__file__).resolve().parent


def _read_requirements(path: Path) -> list[str]:
    requirements: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        requirements.append(line)
    return requirements


setup(
    name="nova-ai-lite",
    version="1.0.0",
    description="Nova AI Lite CLI and desktop app for HWP automation",
    long_description=(ROOT / "README.md").read_text(encoding="utf-8"),
    long_description_content_type="text/markdown",
    python_requires=">=3.10",
    install_requires=_read_requirements(ROOT / "requirements.txt"),
    py_modules=[
        "ai_client",
        "app",
        "equation",
        "hwp_controller",
        "layout_detector",
        "ocr_pipeline",
        "prompt_loader",
        "script_runner",
        "gui_app",
    ],
    packages=find_packages(include=["backend", "backend.*"]),
    include_package_data=True,
    entry_points={
        "console_scripts": [
            "nova-ai=app:main",
            "nova-ai-gui=gui_app:main",
        ]
    },
)
