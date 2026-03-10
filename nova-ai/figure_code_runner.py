from __future__ import annotations

import ast
import math
import os
import tempfile
import textwrap
import uuid
from pathlib import Path
from typing import Any


class FigureCodeRenderError(RuntimeError):
    """Raised when AI-generated figure code cannot be rendered safely."""


def render_python_figure_code(code: str) -> str:
    source = textwrap.dedent(code or "").strip()
    if not source:
        raise FigureCodeRenderError("그림용 파이썬 코드가 비어 있습니다.")

    tree = _parse_and_validate(source)
    plt, patches, np = _load_plotting_modules()
    plt.close("all")

    safe_builtins = {
        "abs": abs,
        "all": all,
        "any": any,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "range": range,
        "reversed": reversed,
        "round": round,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
    }
    env: dict[str, Any] = {
        "__builtins__": safe_builtins,
        "plt": plt,
        "math": math,
        "np": np,
        "patches": patches,
    }
    locals_env: dict[str, Any] = {}

    try:
        exec(compile(tree, "<ai-figure-code>", "exec"), env, locals_env)
    except Exception as exc:
        plt.close("all")
        raise FigureCodeRenderError(f"그림용 파이썬 코드 실행 실패: {exc}") from exc

    fig = locals_env.get("fig")
    if fig is None:
        fig = env.get("fig")
    if fig is None and plt.get_fignums():
        fig = plt.gcf()
    if fig is None:
        plt.close("all")
        raise FigureCodeRenderError("코드 실행 후 matplotlib figure를 찾지 못했습니다.")
    if not getattr(fig, "axes", None):
        plt.close("all")
        raise FigureCodeRenderError("생성된 figure에 축 정보가 없습니다.")

    out_dir = Path(tempfile.gettempdir()) / "nova_ai" / "ai_python_figures"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"ai_figure_{os.getpid()}_{uuid.uuid4().hex[:10]}.png"
    try:
        fig.savefig(out_path, format="png", dpi=180, bbox_inches="tight", facecolor="white")
    except Exception as exc:
        raise FigureCodeRenderError(f"figure 저장 실패: {exc}") from exc
    finally:
        plt.close("all")
    return str(out_path)


def _load_plotting_modules():
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib import font_manager
        from matplotlib import patches
        import numpy as np
    except Exception as exc:
        raise FigureCodeRenderError(
            f"그림 렌더링 모듈을 불러오지 못했습니다: {exc}"
        ) from exc

    plt.rcParams["axes.unicode_minus"] = False
    available = {font.name for font in font_manager.fontManager.ttflist}
    for candidate in ("Malgun Gothic", "AppleGothic", "NanumGothic", "DejaVu Sans"):
        if candidate in available:
            plt.rcParams["font.family"] = candidate
            break
    return plt, patches, np


def _parse_and_validate(source: str) -> ast.AST:
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise FigureCodeRenderError(f"그림용 파이썬 코드 문법 오류: {exc}") from exc

    blocked_nodes = (
        ast.Import,
        ast.ImportFrom,
        ast.ClassDef,
        ast.FunctionDef,
        ast.AsyncFunctionDef,
        ast.Lambda,
        ast.Global,
        ast.Nonlocal,
        ast.Try,
        ast.With,
        ast.AsyncWith,
        ast.Delete,
    )
    blocked_names = {
        "__import__",
        "open",
        "exec",
        "eval",
        "compile",
        "input",
        "globals",
        "locals",
        "vars",
        "dir",
        "getattr",
        "setattr",
        "delattr",
        "os",
        "sys",
        "subprocess",
        "pathlib",
        "shutil",
    }

    for node in ast.walk(tree):
        if isinstance(node, blocked_nodes):
            raise FigureCodeRenderError(
                f"허용되지 않는 그림 코드 문법이 포함되어 있습니다: {type(node).__name__}"
            )
        if isinstance(node, ast.Name) and node.id in blocked_names:
            raise FigureCodeRenderError(
                f"허용되지 않는 이름이 포함되어 있습니다: {node.id}"
            )
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise FigureCodeRenderError("dunder 속성 접근은 허용되지 않습니다.")
    return tree
