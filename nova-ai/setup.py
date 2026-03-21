from __future__ import annotations

from pathlib import Path

from setuptools import find_packages, setup


ROOT = Path(__file__).resolve().parent


def _read_text(path: Path, default: str = "") -> str:
    if not path.exists():
        return default
    return path.read_text(encoding="utf-8").strip()


def _read_requirements(path: Path) -> list[str]:
    if not path.exists():
        return []

    requirements: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        requirements.append(line)
    return requirements


def _discover_py_modules() -> list[str]:
    excluded = {"setup", "__init__"}
    modules = []
    for file_path in ROOT.glob("*.py"):
        module_name = file_path.stem
        if module_name in excluded:
            continue
        modules.append(module_name)
    return sorted(modules)


description = "Nova AI desktop and CLI tools for HWP automation"
long_description = _read_text(ROOT / "README.md", default=description)


setup(
    name="nova-ai",
    version="2.1.1",
    description=description,
    long_description=long_description,
    long_description_content_type="text/markdown",
    python_requires=">=3.10",
    install_requires=_read_requirements(ROOT / "requirements.txt"),
    py_modules=_discover_py_modules(),
    packages=find_packages(include=["backend", "backend.*"]),
    include_package_data=True,
    entry_points={
        "console_scripts": [
            "nova-ai=app:main",
            "nova-ai-gui=gui_app:main",
        ]
    },
)
