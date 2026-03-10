from __future__ import annotations

import ast
import math
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence


class LocalFigureRenderError(RuntimeError):
    """Raised when a local explanation figure cannot be rendered."""


def render_local_figure(kind: str, spec: Mapping[str, Any]) -> str:
    normalized_kind = (kind or "").strip().lower()
    if not normalized_kind:
        raise LocalFigureRenderError("로컬 그림 종류가 비어 있습니다.")
    if not isinstance(spec, Mapping):
        raise LocalFigureRenderError("로컬 그림 spec은 dict 형태여야 합니다.")

    plt, patches = _load_plotting_modules()
    fig = None
    try:
        if normalized_kind == "graph":
            fig = _render_graph(plt, spec)
        elif normalized_kind == "jacobian":
            fig = _render_jacobian(plt, patches, spec)
        elif normalized_kind == "geometry":
            fig = _render_geometry(plt, patches, spec)
        elif normalized_kind == "linear_algebra":
            fig = _render_linear_algebra(plt, patches, spec)
        elif normalized_kind == "physics":
            fig = _render_physics(plt, patches, spec)
        else:
            raise LocalFigureRenderError(f"지원하지 않는 로컬 그림 종류입니다: {kind}")

        out_dir = Path(tempfile.gettempdir()) / "nova_ai" / "local_figures"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{normalized_kind}_{os.getpid()}_{uuid.uuid4().hex[:10]}.png"
        fig.savefig(out_path, format="png", dpi=180, bbox_inches="tight", facecolor="white")
        return str(out_path)
    finally:
        if fig is not None:
            plt.close(fig)


def _load_plotting_modules():
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib import font_manager
        from matplotlib import patches
    except Exception as exc:
        raise LocalFigureRenderError(
            f"로컬 그림 렌더러를 불러오지 못했습니다: {exc}"
        ) from exc

    plt.rcParams["axes.unicode_minus"] = False
    available = {font.name for font in font_manager.fontManager.ttflist}
    for candidate in ("Malgun Gothic", "AppleGothic", "NanumGothic", "DejaVu Sans"):
        if candidate in available:
            plt.rcParams["font.family"] = candidate
            break
    return plt, patches


def _render_graph(plt, spec: Mapping[str, Any]):
    expr = str(spec.get("expr") or spec.get("function") or "").strip()
    if not expr:
        raise LocalFigureRenderError("graph 그림에는 expr 필드가 필요합니다.")
    x_start, x_end = _parse_range(spec.get("x_range"), "x_range")
    samples = _as_int(spec.get("samples", 401), "samples", minimum=50, maximum=4000)

    xs = [
        x_start + (x_end - x_start) * idx / (samples - 1)
        for idx in range(samples)
    ]
    ys = [_safe_eval_expr(expr, x) for x in xs]
    valid_pairs = [(x, y) for x, y in zip(xs, ys) if math.isfinite(y)]
    if not valid_pairs:
        raise LocalFigureRenderError("graph 그림에서 유효한 y값을 만들지 못했습니다.")

    fig, ax = plt.subplots(figsize=(6.2, 4.6))
    ax.plot(
        xs,
        ys,
        color=str(spec.get("line_color", "#1d4ed8")),
        linewidth=2.2,
        label=str(spec.get("curve_label", "곡선")),
    )
    ax.axhline(0.0, color="#6b7280", linewidth=1.0)
    ax.axvline(0.0, color="#6b7280", linewidth=1.0)
    ax.grid(True, alpha=0.25)

    points: list[tuple[float, float]] = list(valid_pairs)
    marks = {
        str(item).strip().lower()
        for item in _as_list(spec.get("mark", []), "mark")
        if str(item).strip()
    }

    if "roots" in marks:
        for x_val, y_val in _detect_roots(valid_pairs):
            ax.scatter([x_val], [y_val], color="#dc2626", s=32, zorder=5)
            ax.annotate(
                f"근 ({x_val:.2f}, {y_val:.2f})",
                (x_val, y_val),
                xytext=(6, 6),
                textcoords="offset points",
                fontsize=8,
            )
            points.append((x_val, y_val))

    if "critical_points" in marks:
        for x_val, y_val in _detect_local_extrema(valid_pairs):
            ax.scatter([x_val], [y_val], color="#7c3aed", s=34, zorder=5)
            ax.annotate(
                f"극값 ({x_val:.2f}, {y_val:.2f})",
                (x_val, y_val),
                xytext=(6, -12),
                textcoords="offset points",
                fontsize=8,
            )
            points.append((x_val, y_val))

    if "origin" in marks and x_start <= 0.0 <= x_end:
        origin_y = _safe_eval_expr(expr, 0.0)
        if math.isfinite(origin_y):
            ax.scatter([0.0], [origin_y], color="#059669", s=30, zorder=5)
            ax.annotate(
                f"(0, {origin_y:.2f})",
                (0.0, origin_y),
                xytext=(6, 6),
                textcoords="offset points",
                fontsize=8,
            )
            points.append((0.0, origin_y))

    for point_spec in _as_list(spec.get("points", []), "points"):
        if not isinstance(point_spec, Mapping):
            raise LocalFigureRenderError("graph points 항목은 dict여야 합니다.")
        x_val = _as_float(point_spec.get("x"), "points[].x")
        y_val = _as_float(point_spec.get("y"), "points[].y")
        label = str(point_spec.get("label", "")).strip()
        color = str(point_spec.get("color", "#111827"))
        ax.scatter([x_val], [y_val], color=color, s=32, zorder=5)
        if label:
            ax.annotate(
                label,
                (x_val, y_val),
                xytext=(6, 6),
                textcoords="offset points",
                fontsize=8,
                color=color,
            )
        points.append((x_val, y_val))

    tangent_spec = spec.get("tangent")
    if isinstance(tangent_spec, Mapping):
        x0 = _as_float(tangent_spec.get("x"), "tangent.x")
        y0 = _as_float(tangent_spec.get("y", _safe_eval_expr(expr, x0)), "tangent.y")
        slope = tangent_spec.get("slope")
        if slope is None:
            slope = _approximate_derivative(expr, x0)
        slope_f = _as_float(slope, "tangent.slope")
        line_x = [x_start, x_end]
        line_y = [y0 + slope_f * (value - x0) for value in line_x]
        ax.plot(
            line_x,
            line_y,
            linestyle="--",
            linewidth=1.6,
            color=str(tangent_spec.get("color", "#dc2626")),
            label=str(tangent_spec.get("label", "접선")),
        )
        ax.scatter([x0], [y0], color="#dc2626", s=34, zorder=6)
        points.extend([(x0, y0), (line_x[0], line_y[0]), (line_x[1], line_y[1])])

    y_range = spec.get("y_range")
    if y_range is not None:
        y_min, y_max = _parse_range(y_range, "y_range")
    else:
        y_min, y_max = _auto_axis_range([y for _, y in points], padding_ratio=0.15)

    ax.set_xlim(x_start, x_end)
    ax.set_ylim(y_min, y_max)
    ax.set_title(str(spec.get("title", "함수 그래프")))
    ax.set_xlabel(str(spec.get("x_label", "x")))
    ax.set_ylabel(str(spec.get("y_label", "y")))
    handles, labels = ax.get_legend_handles_labels()
    if any(label.strip() for label in labels):
        ax.legend(loc="best", fontsize=8)
    return fig


def _render_jacobian(plt, patches, spec: Mapping[str, Any]):
    source_rect_raw = spec.get("source_rect", [0.0, 1.0, 0.0, 1.0])
    source_rect = _as_list(source_rect_raw, "source_rect")
    if len(source_rect) != 4:
        raise LocalFigureRenderError("source_rect는 [u_min, u_max, v_min, v_max] 형식이어야 합니다.")
    u_min = _as_float(source_rect[0], "source_rect[0]")
    u_max = _as_float(source_rect[1], "source_rect[1]")
    v_min = _as_float(source_rect[2], "source_rect[2]")
    v_max = _as_float(source_rect[3], "source_rect[3]")
    if u_max <= u_min or v_max <= v_min:
        raise LocalFigureRenderError("source_rect 범위가 올바르지 않습니다.")

    target_vertices = _as_points(
        spec.get("target_vertices", [[0.0, 0.0], [2.0, 0.0], [2.8, 1.5], [0.8, 1.5]]),
        "target_vertices",
    )
    if len(target_vertices) != 4:
        raise LocalFigureRenderError("target_vertices는 꼭짓점 4개가 필요합니다.")

    grid_steps = _as_int(spec.get("grid_steps", 4), "grid_steps", minimum=2, maximum=10)
    source_label = str(spec.get("source_label", "R in uv-plane"))
    target_label = str(spec.get("target_label", "R' in xy-plane"))
    mapping_label = str(spec.get("mapping_label", "변수변환"))

    fig, axes = plt.subplots(1, 2, figsize=(8.4, 4.4))
    left_ax, right_ax = axes

    rect = patches.Rectangle(
        (u_min, v_min),
        u_max - u_min,
        v_max - v_min,
        fill=False,
        linewidth=2.0,
        edgecolor="#2563eb",
    )
    left_ax.add_patch(rect)
    if bool(spec.get("draw_grid", True)):
        for idx in range(1, grid_steps):
            ratio = idx / grid_steps
            u_val = u_min + (u_max - u_min) * ratio
            v_val = v_min + (v_max - v_min) * ratio
            left_ax.plot([u_val, u_val], [v_min, v_max], color="#93c5fd", linewidth=1.0)
            left_ax.plot([u_min, u_max], [v_val, v_val], color="#93c5fd", linewidth=1.0)

    left_ax.set_title(source_label)
    left_ax.set_xlabel(str(spec.get("source_x_label", "u")))
    left_ax.set_ylabel(str(spec.get("source_y_label", "v")))
    left_ax.set_aspect("equal", adjustable="box")
    _set_axis_limits(left_ax, [(u_min, v_min), (u_max, v_max)], padding_ratio=0.15, equal=True)
    left_ax.grid(True, alpha=0.2)

    polygon = patches.Polygon(
        target_vertices,
        closed=True,
        fill=False,
        linewidth=2.0,
        edgecolor="#7c3aed",
    )
    right_ax.add_patch(polygon)
    if bool(spec.get("draw_grid", True)):
        p00, p10, p11, p01 = target_vertices
        for idx in range(1, grid_steps):
            ratio = idx / grid_steps
            vertical = [_bilinear_point(p00, p10, p11, p01, ratio, t) for t in _grid_ratios(grid_steps)]
            horizontal = [_bilinear_point(p00, p10, p11, p01, t, ratio) for t in _grid_ratios(grid_steps)]
            right_ax.plot(
                [point[0] for point in vertical],
                [point[1] for point in vertical],
                color="#d8b4fe",
                linewidth=1.0,
            )
            right_ax.plot(
                [point[0] for point in horizontal],
                [point[1] for point in horizontal],
                color="#d8b4fe",
                linewidth=1.0,
            )

    right_ax.set_title(target_label)
    right_ax.set_xlabel(str(spec.get("target_x_label", "x")))
    right_ax.set_ylabel(str(spec.get("target_y_label", "y")))
    right_ax.set_aspect("equal", adjustable="box")
    _set_axis_limits(right_ax, target_vertices, padding_ratio=0.18, equal=True)
    right_ax.grid(True, alpha=0.2)

    arrow = patches.FancyArrowPatch(
        (0.47, 0.5),
        (0.53, 0.5),
        transform=fig.transFigure,
        arrowstyle="->",
        mutation_scale=16,
        linewidth=1.5,
        color="#374151",
    )
    fig.add_artist(arrow)
    fig.text(0.5, 0.56, mapping_label, ha="center", va="bottom", fontsize=10)
    fig.suptitle(str(spec.get("title", "자코비안 / 변수변환 도식")), fontsize=12)
    return fig


def _render_geometry(plt, patches, spec: Mapping[str, Any]):
    points_raw = spec.get("points")
    if not isinstance(points_raw, Mapping):
        raise LocalFigureRenderError("geometry 그림에는 points dict가 필요합니다.")
    points = {
        str(name): _as_point(value, f"points[{name}]")
        for name, value in points_raw.items()
    }

    fig, ax = plt.subplots(figsize=(6.0, 6.0))
    all_points: list[tuple[float, float]] = list(points.values())

    for polygon_raw in _as_list(spec.get("polygons", []), "polygons"):
        labels = [str(item) for item in _as_list(polygon_raw, "polygon")]
        polygon_points = [points[label] for label in labels]
        patch = patches.Polygon(
            polygon_points,
            closed=True,
            fill=bool(spec.get("fill_polygons", False)),
            alpha=0.12,
            edgecolor=str(spec.get("polygon_color", "#2563eb")),
            facecolor=str(spec.get("polygon_fill_color", "#93c5fd")),
            linewidth=1.8,
        )
        ax.add_patch(patch)
        all_points.extend(polygon_points)

    for segment_raw in _as_list(spec.get("segments", []), "segments"):
        segment = _as_list(segment_raw, "segment")
        if len(segment) != 2:
            raise LocalFigureRenderError("geometry segments 항목은 점 이름 2개가 필요합니다.")
        p1 = points[str(segment[0])]
        p2 = points[str(segment[1])]
        ax.plot(
            [p1[0], p2[0]],
            [p1[1], p2[1]],
            color=str(spec.get("segment_color", "#1f2937")),
            linewidth=1.6,
        )
        all_points.extend([p1, p2])

    for circle_raw in _as_list(spec.get("circles", []), "circles"):
        if not isinstance(circle_raw, Mapping):
            raise LocalFigureRenderError("geometry circles 항목은 dict여야 합니다.")
        center = _as_point(circle_raw.get("center"), "circles[].center")
        radius = _as_float(circle_raw.get("radius"), "circles[].radius")
        circle = patches.Circle(
            center,
            radius,
            fill=False,
            linewidth=1.6,
            edgecolor=str(circle_raw.get("color", "#dc2626")),
        )
        ax.add_patch(circle)
        label = str(circle_raw.get("label", "")).strip()
        if label:
            ax.text(center[0], center[1], label, fontsize=10, ha="left", va="bottom")
        all_points.extend(
            [
                center,
                (center[0] - radius, center[1] - radius),
                (center[0] + radius, center[1] + radius),
            ]
        )

    for vector_raw in _as_list(spec.get("vectors", []), "vectors"):
        if not isinstance(vector_raw, Mapping):
            raise LocalFigureRenderError("geometry vectors 항목은 dict여야 합니다.")
        start = _as_point(vector_raw.get("from", [0.0, 0.0]), "vectors[].from")
        end = _as_point(vector_raw.get("to"), "vectors[].to")
        arrow = patches.FancyArrowPatch(
            start,
            end,
            arrowstyle="->",
            mutation_scale=16,
            linewidth=1.8,
            color=str(vector_raw.get("color", "#059669")),
        )
        ax.add_patch(arrow)
        label = str(vector_raw.get("label", "")).strip()
        if label:
            mid_x = (start[0] + end[0]) / 2.0
            mid_y = (start[1] + end[1]) / 2.0
            ax.text(mid_x, mid_y, label, fontsize=9, color=str(vector_raw.get("color", "#059669")))
        all_points.extend([start, end])

    for label, point in points.items():
        ax.scatter([point[0]], [point[1]], color="#111827", s=28, zorder=5)
        ax.text(point[0] + 0.06, point[1] + 0.06, label, fontsize=10)

    if bool(spec.get("axes", True)):
        ax.axhline(0.0, color="#9ca3af", linewidth=1.0)
        ax.axvline(0.0, color="#9ca3af", linewidth=1.0)
    ax.grid(True, alpha=0.2)
    ax.set_title(str(spec.get("title", "기하 / 벡터 도식")))
    ax.set_xlabel(str(spec.get("x_label", "x")))
    ax.set_ylabel(str(spec.get("y_label", "y")))
    ax.set_aspect("equal", adjustable="box")
    _set_axis_limits(ax, all_points, padding_ratio=0.18, equal=True)
    return fig


def _render_linear_algebra(plt, patches, spec: Mapping[str, Any]):
    input_vectors = _as_vector_specs(spec.get("input_vectors"), "input_vectors")
    output_vectors = _as_vector_specs(spec.get("output_vectors"), "output_vectors")
    show_unit_square = bool(spec.get("show_unit_square", True))

    fig, axes = plt.subplots(1, 2, figsize=(8.4, 4.3))
    left_ax, right_ax = axes

    _draw_vector_panel(
        left_ax,
        patches,
        input_vectors,
        title=str(spec.get("input_label", "변환 전")),
        show_unit_square=show_unit_square,
    )
    _draw_vector_panel(
        right_ax,
        patches,
        output_vectors,
        title=str(spec.get("output_label", "변환 후")),
        show_unit_square=show_unit_square,
    )

    matrix_label = str(spec.get("matrix_label", "A"))
    arrow = patches.FancyArrowPatch(
        (0.47, 0.5),
        (0.53, 0.5),
        transform=fig.transFigure,
        arrowstyle="->",
        mutation_scale=16,
        linewidth=1.5,
        color="#374151",
    )
    fig.add_artist(arrow)
    fig.text(0.5, 0.56, matrix_label, ha="center", va="bottom", fontsize=11)
    fig.suptitle(str(spec.get("title", "선형대수 시각화")), fontsize=12)
    return fig


def _render_physics(plt, patches, spec: Mapping[str, Any]):
    fig, ax = plt.subplots(figsize=(6.0, 5.0))
    plot_points: list[tuple[float, float]] = []

    if bool(spec.get("axes", True)):
        ax.axhline(0.0, color="#9ca3af", linewidth=1.0)
        ax.axvline(0.0, color="#9ca3af", linewidth=1.0)

    ground_y = spec.get("ground_y")
    if ground_y is not None:
        y_val = _as_float(ground_y, "ground_y")
        ax.plot([-3.0, 3.0], [y_val, y_val], color="#6b7280", linewidth=1.2)
        plot_points.extend([(-3.0, y_val), (3.0, y_val)])

    body_spec = spec.get("body", {})
    if body_spec is None:
        body_spec = {}
    if not isinstance(body_spec, Mapping):
        raise LocalFigureRenderError("physics body 항목은 dict여야 합니다.")
    body_kind = str(body_spec.get("kind", "point")).strip().lower()
    center = _as_point(body_spec.get("center", [0.0, 0.0]), "body.center")
    plot_points.append(center)

    if body_kind == "block":
        size = _as_point(body_spec.get("size", [1.2, 0.8]), "body.size")
        rect = patches.Rectangle(
            (center[0] - size[0] / 2.0, center[1] - size[1] / 2.0),
            size[0],
            size[1],
            facecolor="#f3f4f6",
            edgecolor="#111827",
            linewidth=1.4,
        )
        ax.add_patch(rect)
        plot_points.extend(
            [
                (center[0] - size[0] / 2.0, center[1] - size[1] / 2.0),
                (center[0] + size[0] / 2.0, center[1] + size[1] / 2.0),
            ]
        )
    else:
        ax.scatter([center[0]], [center[1]], color="#111827", s=46, zorder=5)

    body_label = str(body_spec.get("label", "")).strip()
    if body_label:
        ax.text(center[0] + 0.08, center[1] + 0.08, body_label, fontsize=10)

    arrows_raw = spec.get("forces", spec.get("arrows", []))
    for arrow_raw in _as_list(arrows_raw, "forces"):
        if not isinstance(arrow_raw, Mapping):
            raise LocalFigureRenderError("physics force/arrow 항목은 dict여야 합니다.")
        start = _as_point(arrow_raw.get("from", center), "forces[].from")
        end = _as_point(arrow_raw.get("to"), "forces[].to")
        color = str(arrow_raw.get("color", "#dc2626"))
        arrow = patches.FancyArrowPatch(
            start,
            end,
            arrowstyle="->",
            mutation_scale=16,
            linewidth=1.8,
            color=color,
        )
        ax.add_patch(arrow)
        label = str(arrow_raw.get("label", "")).strip()
        if label:
            ax.text(
                (start[0] + end[0]) / 2.0,
                (start[1] + end[1]) / 2.0,
                label,
                fontsize=9,
                color=color,
            )
        plot_points.extend([start, end])

    ax.grid(True, alpha=0.2)
    ax.set_title(str(spec.get("title", "물리 도식")))
    ax.set_xlabel(str(spec.get("x_label", "x")))
    ax.set_ylabel(str(spec.get("y_label", "y")))
    ax.set_aspect("equal", adjustable="box")
    _set_axis_limits(ax, plot_points, padding_ratio=0.22, equal=True)
    return fig


def _draw_vector_panel(ax, patches, vectors, *, title: str, show_unit_square: bool) -> None:
    ax.axhline(0.0, color="#9ca3af", linewidth=1.0)
    ax.axvline(0.0, color="#9ca3af", linewidth=1.0)
    all_points = [(0.0, 0.0)]

    if show_unit_square and len(vectors) >= 2:
        v1 = vectors[0]["to"]
        v2 = vectors[1]["to"]
        square_points = [(0.0, 0.0), v1, (v1[0] + v2[0], v1[1] + v2[1]), v2]
        square = patches.Polygon(
            square_points,
            closed=True,
            facecolor="#bfdbfe",
            edgecolor="#60a5fa",
            alpha=0.22,
            linewidth=1.2,
        )
        ax.add_patch(square)
        all_points.extend(square_points)

    for vector_spec in vectors:
        start = vector_spec["from"]
        end = vector_spec["to"]
        color = vector_spec["color"]
        arrow = patches.FancyArrowPatch(
            start,
            end,
            arrowstyle="->",
            mutation_scale=16,
            linewidth=1.8,
            color=color,
        )
        ax.add_patch(arrow)
        label = vector_spec["label"]
        if label:
            ax.text(
                (start[0] + end[0]) / 2.0,
                (start[1] + end[1]) / 2.0,
                label,
                fontsize=9,
                color=color,
            )
        all_points.extend([start, end])

    ax.set_title(title)
    ax.grid(True, alpha=0.2)
    ax.set_aspect("equal", adjustable="box")
    _set_axis_limits(ax, all_points, padding_ratio=0.2, equal=True)


def _as_vector_specs(value: Any, name: str) -> list[dict[str, Any]]:
    vectors: list[dict[str, Any]] = []
    for idx, item in enumerate(_as_list(value, name)):
        if not isinstance(item, Mapping):
            raise LocalFigureRenderError(f"{name}[{idx}]는 dict여야 합니다.")
        start = _as_point(item.get("from", [0.0, 0.0]), f"{name}[{idx}].from")
        end = _as_point(item.get("to"), f"{name}[{idx}].to")
        vectors.append(
            {
                "from": start,
                "to": end,
                "label": str(item.get("label", "")).strip(),
                "color": str(item.get("color", "#2563eb")),
            }
        )
    if not vectors:
        raise LocalFigureRenderError(f"{name}에는 최소 1개의 벡터가 필요합니다.")
    return vectors


def _safe_eval_expr(expr: str, x_value: float) -> float:
    tree = ast.parse(expr, mode="eval")
    _validate_expr_tree(tree)
    compiled = compile(tree, "<local-figure-expr>", "eval")
    safe_globals = {"__builtins__": {}}
    safe_locals = {
        "x": float(x_value),
        "pi": math.pi,
        "e": math.e,
        "abs": abs,
        "sqrt": math.sqrt,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "asin": math.asin,
        "acos": math.acos,
        "atan": math.atan,
        "exp": math.exp,
        "log": math.log,
        "log10": math.log10,
        "ln": math.log,
        "sinh": math.sinh,
        "cosh": math.cosh,
        "tanh": math.tanh,
        "floor": math.floor,
        "ceil": math.ceil,
        "math": math,
    }
    try:
        value = eval(compiled, safe_globals, safe_locals)
    except Exception:
        return float("nan")
    try:
        return float(value)
    except Exception:
        return float("nan")


def _validate_expr_tree(node: ast.AST) -> None:
    allowed_names = {
        "x",
        "pi",
        "e",
        "abs",
        "sqrt",
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "exp",
        "log",
        "log10",
        "ln",
        "sinh",
        "cosh",
        "tanh",
        "floor",
        "ceil",
        "math",
    }
    allowed_attributes = {
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "exp",
        "log",
        "log10",
        "sqrt",
        "sinh",
        "cosh",
        "tanh",
        "pi",
        "e",
        "floor",
        "ceil",
    }
    allowed_nodes = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Call,
        ast.Name,
        ast.Load,
        ast.Constant,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Pow,
        ast.Mod,
        ast.UAdd,
        ast.USub,
        ast.Attribute,
    )
    for child in ast.walk(node):
        if not isinstance(child, allowed_nodes):
            raise LocalFigureRenderError("graph expr에 허용되지 않는 문법이 포함되어 있습니다.")
        if isinstance(child, ast.Name) and child.id not in allowed_names:
            raise LocalFigureRenderError(f"graph expr에서 허용되지 않는 이름입니다: {child.id}")
        if isinstance(child, ast.Attribute):
            if not isinstance(child.value, ast.Name) or child.value.id != "math":
                raise LocalFigureRenderError("graph expr에서는 math.<func> 형태만 허용됩니다.")
            if child.attr not in allowed_attributes:
                raise LocalFigureRenderError(
                    f"graph expr에서 허용되지 않는 math 속성입니다: {child.attr}"
                )
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Name):
                if func.id not in allowed_names:
                    raise LocalFigureRenderError(
                        f"graph expr에서 허용되지 않는 함수입니다: {func.id}"
                    )
            elif isinstance(func, ast.Attribute):
                if not isinstance(func.value, ast.Name) or func.value.id != "math":
                    raise LocalFigureRenderError("graph expr에서는 math.<func> 호출만 허용됩니다.")
                if func.attr not in allowed_attributes:
                    raise LocalFigureRenderError(
                        f"graph expr에서 허용되지 않는 math 함수입니다: {func.attr}"
                    )
            else:
                raise LocalFigureRenderError("graph expr의 호출 대상이 올바르지 않습니다.")


def _approximate_derivative(expr: str, x_value: float) -> float:
    h = 1e-4
    y1 = _safe_eval_expr(expr, x_value - h)
    y2 = _safe_eval_expr(expr, x_value + h)
    if not (math.isfinite(y1) and math.isfinite(y2)):
        raise LocalFigureRenderError("접선 기울기를 계산할 수 없습니다.")
    return (y2 - y1) / (2.0 * h)


def _detect_roots(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    roots: list[tuple[float, float]] = []
    for idx in range(len(points) - 1):
        x1, y1 = points[idx]
        x2, y2 = points[idx + 1]
        if not (math.isfinite(y1) and math.isfinite(y2)):
            continue
        if abs(y1) < 1e-8:
            _append_unique_point(roots, (x1, 0.0))
            continue
        if y1 * y2 > 0:
            continue
        if abs(y2 - y1) < 1e-12:
            continue
        ratio = -y1 / (y2 - y1)
        x_root = x1 + ratio * (x2 - x1)
        _append_unique_point(roots, (x_root, 0.0))
    return roots[:6]


def _detect_local_extrema(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    extrema: list[tuple[float, float]] = []
    for idx in range(1, len(points) - 1):
        x_prev, y_prev = points[idx - 1]
        x_cur, y_cur = points[idx]
        x_next, y_next = points[idx + 1]
        if not all(math.isfinite(value) for value in (y_prev, y_cur, y_next)):
            continue
        if (y_cur >= y_prev and y_cur >= y_next) or (y_cur <= y_prev and y_cur <= y_next):
            if x_prev < x_cur < x_next:
                _append_unique_point(extrema, (x_cur, y_cur))
    return extrema[:6]


def _append_unique_point(points: list[tuple[float, float]], candidate: tuple[float, float]) -> None:
    for x_val, y_val in points:
        if abs(x_val - candidate[0]) < 1e-3 and abs(y_val - candidate[1]) < 1e-3:
            return
    points.append(candidate)


def _grid_ratios(grid_steps: int) -> list[float]:
    return [idx / grid_steps for idx in range(grid_steps + 1)]


def _bilinear_point(
    p00: tuple[float, float],
    p10: tuple[float, float],
    p11: tuple[float, float],
    p01: tuple[float, float],
    u: float,
    v: float,
) -> tuple[float, float]:
    x_val = (
        (1 - u) * (1 - v) * p00[0]
        + u * (1 - v) * p10[0]
        + u * v * p11[0]
        + (1 - u) * v * p01[0]
    )
    y_val = (
        (1 - u) * (1 - v) * p00[1]
        + u * (1 - v) * p10[1]
        + u * v * p11[1]
        + (1 - u) * v * p01[1]
    )
    return (x_val, y_val)


def _set_axis_limits(ax, points: Sequence[tuple[float, float]], *, padding_ratio: float, equal: bool) -> None:
    x_values = [point[0] for point in points if math.isfinite(point[0])]
    y_values = [point[1] for point in points if math.isfinite(point[1])]
    if not x_values or not y_values:
        ax.set_xlim(-1.0, 1.0)
        ax.set_ylim(-1.0, 1.0)
        return

    x_min, x_max = _auto_axis_range(x_values, padding_ratio=padding_ratio)
    y_min, y_max = _auto_axis_range(y_values, padding_ratio=padding_ratio)
    if equal:
        span = max(x_max - x_min, y_max - y_min)
        center_x = (x_min + x_max) / 2.0
        center_y = (y_min + y_max) / 2.0
        half = max(span / 2.0, 1.0)
        x_min, x_max = center_x - half, center_x + half
        y_min, y_max = center_y - half, center_y + half
    ax.set_xlim(x_min, x_max)
    ax.set_ylim(y_min, y_max)


def _auto_axis_range(values: Sequence[float], *, padding_ratio: float) -> tuple[float, float]:
    finite_values = [float(value) for value in values if math.isfinite(value)]
    if not finite_values:
        return (-1.0, 1.0)
    min_value = min(finite_values)
    max_value = max(finite_values)
    if abs(max_value - min_value) < 1e-9:
        span = max(abs(max_value), 1.0)
        return (min_value - span * 0.5, max_value + span * 0.5)
    span = max_value - min_value
    padding = span * max(padding_ratio, 0.05)
    return (min_value - padding, max_value + padding)


def _parse_range(value: Any, name: str) -> tuple[float, float]:
    items = _as_list(value, name)
    if len(items) != 2:
        raise LocalFigureRenderError(f"{name}는 길이 2의 배열이어야 합니다.")
    start = _as_float(items[0], f"{name}[0]")
    end = _as_float(items[1], f"{name}[1]")
    if end <= start:
        raise LocalFigureRenderError(f"{name}의 끝값은 시작값보다 커야 합니다.")
    return (start, end)


def _as_list(value: Any, name: str) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    raise LocalFigureRenderError(f"{name}는 list 또는 tuple이어야 합니다.")


def _as_point(value: Any, name: str) -> tuple[float, float]:
    items = _as_list(value, name)
    if len(items) != 2:
        raise LocalFigureRenderError(f"{name}는 [x, y] 형식이어야 합니다.")
    return (_as_float(items[0], f"{name}[0]"), _as_float(items[1], f"{name}[1]"))


def _as_points(value: Any, name: str) -> list[tuple[float, float]]:
    return [_as_point(item, f"{name}[{idx}]") for idx, item in enumerate(_as_list(value, name))]


def _as_float(value: Any, name: str) -> float:
    if value is None:
        raise LocalFigureRenderError(f"{name} 값이 비어 있습니다.")
    try:
        return float(value)
    except Exception as exc:
        raise LocalFigureRenderError(f"{name}는 숫자여야 합니다: {value}") from exc


def _as_int(value: Any, name: str, *, minimum: int, maximum: int) -> int:
    try:
        result = int(value)
    except Exception as exc:
        raise LocalFigureRenderError(f"{name}는 정수여야 합니다: {value}") from exc
    if result < minimum or result > maximum:
        raise LocalFigureRenderError(
            f"{name}는 {minimum} 이상 {maximum} 이하여야 합니다: {result}"
        )
    return result
