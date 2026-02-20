from __future__ import annotations

import textwrap
import traceback
import re
import os
from typing import Callable, Dict, List
import ast

from hwp_controller import HwpController


LogFn = Callable[[str], None]
CancelCheck = Callable[[], bool]

SAFE_BUILTINS: Dict[str, object] = {
    "range": range,
    "len": len,
    "min": min,
    "max": max,
    "enumerate": enumerate,
    "sum": sum,
    "print": print,
    "abs": abs,
}


class ScriptCancelled(RuntimeError):
    """Raised when script execution is cancelled."""


class ScriptRunner:
    def __init__(self, controller: HwpController) -> None:
        self._controller = controller

    def _is_view_item_line(self, stripped_line: str) -> bool:
        """
        Return True if the line looks like a <??> item starter (?./?./?. ...).
        Supports insert_text(...) and insert_equation(...), with minor punctuation variants.
        """
        m = re.match(
            r"^\s*insert_(?:text|equation)\(\s*['\"]\s*([^'\"]+)",
            stripped_line,
        )
        if not m:
            return False
        head = (m.group(1) or "").strip()
        if not head:
            return False
        return bool(
            re.match(
                r"^(?:(?:[\u3131-\u314e]|[\u3260-\u326d])(?:\s|[.)\uff0e]|,|$)|(?:\uac00|\ub098|\ub2e4|\ub77c|\ub9c8|\ubc14|\uc0ac|\uc544|\uc790|\ucc28|\uce74|\ud0c0|\ud30c|\ud558)\s*[.\uff0e])",
                head,
            )
        )

    def _looks_like_hwpeq_text(self, text: str) -> bool:
        s = (text or "").strip()
        if not s:
            return False
        strong_markers = (
            "{rm",
            "rm ",
            "{bold",
            "bold ",
            "vec{",
            "CDOT",
            "dint",
            "curl",
            "div",
            "LEFT",
            "RIGHT",
            "over",
            "sqrt",
            "it ",
            "SIM",
            "DEG",
            "ANGLE",
            "pi",
        )
        if not any(marker in s for marker in strong_markers):
            return False
        return bool(
            re.search(
                r"[=^_{}()]|CDOT|LEFT|RIGHT|dint|curl|div|vec|rm|bold",
                s,
            )
        )

    def _promote_math_insert_text_calls(self, lines: List[str]) -> List[str]:
        """
        If a line uses insert_text(...) but the payload clearly looks like
        HwpEqn syntax, promote it to insert_equation(...).
        """
        out: List[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped.startswith("insert_text("):
                out.append(line)
                continue
            try:
                node = ast.parse(stripped, mode="eval")
            except Exception:
                out.append(line)
                continue
            call = node.body
            if not isinstance(call, ast.Call):
                out.append(line)
                continue
            if not isinstance(call.func, ast.Name) or call.func.id != "insert_text":
                out.append(line)
                continue
            if len(call.args) != 1 or call.keywords:
                out.append(line)
                continue

            arg = call.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                text_arg = arg.value
            elif isinstance(arg, ast.Str):
                text_arg = arg.s
            else:
                out.append(line)
                continue

            if not self._looks_like_hwpeq_text(text_arg):
                out.append(line)
                continue

            indent = line[: len(line) - len(line.lstrip())]
            out.append(f"{indent}insert_equation({text_arg!r})")
        return out

    def _split_concat_calls(self, line: str) -> List[str]:
        if " + " not in line:
            return [line]
        parts: List[str] = []
        buf: List[str] = []
        quote: str | None = None
        escaped = False
        i = 0
        while i < len(line):
            ch = line[i]
            if escaped:
                buf.append(ch)
                escaped = False
                i += 1
                continue
            if ch == "\\":
                buf.append(ch)
                escaped = True
                i += 1
                continue
            if ch in ("'", '"'):
                if quote is None:
                    quote = ch
                elif quote == ch:
                    quote = None
                buf.append(ch)
                i += 1
                continue
            # split only on " + " outside quotes
            if quote is None and line[i:i+3] == " + ":
                part = "".join(buf).strip()
                if part:
                    parts.append(part)
                buf = []
                i += 3
                continue
            buf.append(ch)
            i += 1
        tail = "".join(buf).strip()
        if tail:
            parts.append(tail)
        return parts if parts else [line]

    def _repair_multiline_calls(self, lines: List[str]) -> List[str]:
        def _count_unescaped(text: str, quote: str) -> int:
            count = 0
            escaped = False
            for ch in text:
                if escaped:
                    escaped = False
                    continue
                if ch == "\\":
                    escaped = True
                    continue
                if ch == quote:
                    count += 1
            return count

        repaired: List[str] = []
        buffer: List[str] = []
        quote_char: str | None = None
        for line in lines:
            if quote_char is None:
                if "insert_text(" in line or "insert_equation(" in line or "insert_latex_equation(" in line:
                    if _count_unescaped(line, "'") % 2 == 1:
                        quote_char = "'"
                        buffer = [line]
                        continue
                    if _count_unescaped(line, '"') % 2 == 1:
                        quote_char = '"'
                        buffer = [line]
                        continue
                repaired.append(line)
            else:
                buffer.append(line)
                count = sum(_count_unescaped(chunk, quote_char) for chunk in buffer)
                if count % 2 == 0:
                    joined = " ".join(part.strip() for part in buffer)
                    repaired.append(joined)
                    buffer = []
                    quote_char = None
        if buffer:
            joined = " ".join(part.strip() for part in buffer)
            if quote_char == "'" and not joined.strip().endswith("')"):
                joined = f"{joined}')"
            elif quote_char == '"' and not joined.strip().endswith('")'):
                joined = f'{joined}")'
            repaired.append(joined)
        return repaired

    def _sanitize_unterminated_equation_strings(self, script: str) -> str:
        lines = script.split("\n")
        out: List[str] = []
        for line in lines:
            if "insert_equation('" in line and line.count("'") % 2 == 1:
                out.append(line + "')")
            elif 'insert_equation("' in line and line.count('"') % 2 == 1:
                out.append(line + '")')
            else:
                out.append(line)
        return "\n".join(out)

    def _normalize_inline_calls(self, script: str) -> str:
        targets = ("insert_text(", "insert_equation(", "insert_latex_equation(")
        out: List[str] = []
        i = 0
        in_call = False
        quote_char: str | None = None
        quote_open = False
        while i < len(script):
            if not in_call:
                for t in targets:
                    if script.startswith(t, i):
                        in_call = True
                        break
            ch = script[i]
            if in_call:
                if ch in ("'", '"'):
                    if quote_char is None:
                        quote_char = ch
                        quote_open = True
                    elif quote_char == ch:
                        quote_open = not quote_open
                        if not quote_open:
                            quote_char = None
                if ch in ("\n", "\r", "\u2028", "\u2029"):
                    out.append(" ")
                    i += 1
                    continue
                if ch == ")" and not quote_open:
                    in_call = False
            out.append(ch)
            i += 1
        if in_call and quote_open:
            out.append(quote_char or "'")
            out.append(")")
        return "".join(out)

    def _sanitize_multiline_strings(self, script: str) -> str:
        out: List[str] = []
        quote_char: str | None = None
        escaped = False
        for ch in script:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch in ("'", '"'):
                if quote_char is None:
                    quote_char = ch
                elif quote_char == ch:
                    quote_char = None
                out.append(ch)
                continue
            if ch in ("\n", "\r", "\u2028", "\u2029") and quote_char is not None:
                out.append(" ")
                continue
            out.append(ch)
        if quote_char is not None:
            out.append(quote_char)
        return "".join(out)

    def _strip_code_markers(self, script: str) -> str:
        lines = script.split("\n")
        cleaned: List[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped in ("[CODE]", "[/CODE]", "CODE"):
                continue
            cleaned.append(line)
        return "\n".join(cleaned)

    def _normalize_primes_in_equations(self, script: str) -> str:
        """
        Normalize prime notation inside insert_equation/insert_latex_equation strings.
        - Replace \\prime or \\Prime or unicode primes with apostrophe (')
        """
        def _fix(s: str) -> str:
            s = s.replace("′", "'").replace("’", "'")
            s = re.sub(r"\\+prime\b", "'", s, flags=re.IGNORECASE)
            # Some models emit backslash as prime marker: F\  -> F'
            # Only convert when backslash is NOT starting a command (e.g. \sqrt).
            s = re.sub(r"\\'+", "'", s)  # remove escaped apostrophes: \' -> '
            s = re.sub(r"([A-Za-z])\\(?![A-Za-z])", r"\1'", s)
            s = re.sub(r"\brm\s*([A-Za-z])\s*\\(?![A-Za-z])", r"rm\1'", s)
            # Special rule: F prime should be 'rm F prime' (with single spaces).
            s = re.sub(r"\brm\s*F\s*'", "rm F prime", s)
            s = re.sub(r"\brm\s*F\s*\\\\(?![A-Za-z])", "rm F prime", s)
            s = re.sub(r"\brm\s*F\s*prime\b", "rm F prime", s, flags=re.IGNORECASE)
            # Prime with rm should be tight: rm X' -> rmX'
            s = re.sub(r"\brm\s+([A-Za-z])'", r"rm\1'", s)
            return s

        pattern = re.compile(r"(insert_(?:equation|latex_equation)\()(['\"])(.*?)(\2\))", re.DOTALL)

        def repl(m: re.Match) -> str:
            return f"{m.group(1)}{m.group(2)}{_fix(m.group(3))}{m.group(4)}"

        return pattern.sub(repl, script)

    def _ensure_score_right_align(self, lines: List[str]) -> List[str]:
        out: List[str] = []
        score_re = re.compile(
            r"^\s*(insert_(?:text|equation|latex_equation))\(\s*(['\"])\s*(\[\s*(\d+)\s*점\s*\])\s*\2\s*\)\s*$"
        )
        need_extra_blank_line = False
        in_line_content = False
        for idx, line in enumerate(lines):
            stripped = line.strip()

            # Track whether the current line already has content (since last paragraph break)
            if stripped in ("insert_paragraph()", "insert_enter()"):
                in_line_content = False
                if need_extra_blank_line:
                    # This paragraph can serve as the blank line after score.
                    need_extra_blank_line = False
                out.append(line)
                continue

            if stripped == "insert_small_paragraph()":
                in_line_content = False
                if need_extra_blank_line:
                    need_extra_blank_line = False
                out.append(line)
                continue

            if need_extra_blank_line and stripped:
                # Ensure exactly one blank line after score before the next content.
                out.append("insert_enter()")
                need_extra_blank_line = False

            m = score_re.match(line)
            if m:
                # Remove extra blank lines before score (keep at most ONE paragraph break)
                while out and out[-1].strip() in (
                    "insert_small_paragraph()",
                    "insert_paragraph()",
                    "insert_enter()",
                ):
                    last = out[-1].strip()
                    if last in ("insert_paragraph()", "insert_enter()"):
                        # If there is another paragraph right before, drop extras
                        if len(out) >= 2 and out[-2].strip() in (
                            "insert_paragraph()",
                            "insert_enter()",
                        ):
                            out.pop()
                            continue
                        # Keep exactly one paragraph break
                        break
                    # Small paragraph before score creates visible blank space; remove it
                    out.pop()

                # Ensure score starts on a new line (single paragraph break only)
                if out and out[-1].strip() not in ("insert_paragraph()", "insert_enter()"):
                    out.append("insert_enter()")
                in_line_content = False

                # Right align score line
                prev = out[-1].strip() if out else ""
                if prev != "set_align_right_next_line()":
                    out.append("set_align_right_next_line()")

                # Force score to be plain text (not equation)
                score_num = m.group(4)
                out.append(f"insert_text('[{score_num}점]')")
                out.append("insert_enter()")  # move to next line after score
                in_line_content = False
                need_extra_blank_line = True  # ensure one blank line below the score
                continue

            out.append(line)
            if stripped:
                in_line_content = True
        return out

    def _sanitize_tabs(self, lines: List[str]) -> List[str]:
        """
        Only keep insert_text('\\t') when it immediately precedes an insert_equation(...) line.
        Otherwise replace it with a single space.
        """
        out: List[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.strip() == "insert_text('\\t')" or line.strip() == 'insert_text("\\t")':
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines) and lines[j].lstrip().startswith("insert_equation("):
                    out.append(line)
                else:
                    out.append("insert_space()")
                i += 1
                continue
            out.append(line)
            i += 1
        return out

    def _normalize_placeholders(self, lines: List[str]) -> List[str]:
        """
        Ensure placeholder usage order is stable.
        - After entering the box placeholder (###), any later @@@ is treated as
          "move after box" to type choices outside.
        """
        out: List[str] = []
        seen_inside = False
        inserted_inside = False
        saw_template = False
        has_choices_placeholder = False
        saw_outside = False
        saw_after_box = False
        fp_re = re.compile(r"^\s*focus_placeholder\(\s*(['\"])(.*?)\1\s*\)\s*$")
        content_re = re.compile(
            r"^\s*(insert_text|insert_equation|set_bold|set_underline|insert_underline|set_align_justify_next_line|set_align_right_next_line)\("
        )
        box_start_re = re.compile(
            r"^\s*insert_text\(\s*['\"]\s*(?:(?:[\u3131-\u314e]|[\u3260-\u326d])(?:\s|[.)\uff0e]|,|$)|(?:\uac00|\ub098|\ub2e4|\ub77c|\ub9c8|\ubc14|\uc0ac|\uc544|\uc790|\ucc28|\uce74|\ud0c0|\ud30c|\ud558)\s*[.\uff0e])"
        )
        choice_re = re.compile(
            r"^\s*insert_(?:text|equation)\(\s*['\"]\s*(?:[\u2460-\u2473]|[1-9][.)])"
        )
        # --- Dual template detection (header.hwp + box.hwp/box_white.hwp) ---
        # When both templates are present, their ### placeholders collide.
        # Fix: skip the plain-box template and use insert_box() instead.
        _has_header_tpl = any(
            l.strip().startswith("insert_template(") and "header.hwp" in l.strip().lower()
            for l in lines
        )
        _has_plain_box_tpl = any(
            l.strip().startswith("insert_template(")
            and ("box.hwp" in l.strip().lower() or "box_white.hwp" in l.strip().lower())
            and "header.hwp" not in l.strip().lower()
            for l in lines
        )
        _dual_mode = _has_header_tpl and _has_plain_box_tpl
        _dual_hash_count = 0
        _dual_box_phase = 0  # 0=before, 1=in condition box, 2=exited condition box
        for line in lines:
            stripped = line.strip()
            stripped_lower = stripped.lower()
            if stripped.startswith("insert_template(") and any(
                name in stripped_lower for name in ("header.hwp", "box.hwp", "box_white.hwp")
            ):
                # Dual mode: skip plain box template (replaced by insert_box())
                if _dual_mode and ("box.hwp" in stripped_lower or "box_white.hwp" in stripped_lower) and "header.hwp" not in stripped_lower:
                    continue
                saw_template = True
                if (
                    "header.hwp" in stripped_lower
                    or "box_white.hwp" in stripped_lower
                    or "box.hwp" in stripped_lower
                ):
                    has_choices_placeholder = True
                out.append(line)
                continue
            m = fp_re.match(stripped)
            if not m:
                # Dual mode: track condition box exit to reset box state
                if _dual_mode and _dual_box_phase == 1 and stripped == "exit_box()":
                    _dual_box_phase = 2
                    seen_inside = False
                    inserted_inside = False
                if saw_template and not saw_outside and content_re.match(stripped):
                    out.append("focus_placeholder('@@@')")
                    saw_outside = True
                if (
                    not seen_inside
                    and saw_template
                    and has_choices_placeholder
                    and saw_outside
                    and not saw_after_box
                    and (
                        stripped == "set_align_justify_next_line()"
                        or self._is_view_item_line(stripped)
                        or box_start_re.match(stripped)
                    )
                ):
                    out.append("focus_placeholder('###')")
                    seen_inside = True
                    inserted_inside = True
                if (
                    not seen_inside
                    and saw_template
                    and saw_outside
                    and self._is_view_item_line(stripped)
                ):
                    if out and out[-1].strip() == "set_align_justify_next_line()":
                        out.pop()
                        out.append("focus_placeholder('###')")
                        out.append("set_align_justify_next_line()")
                    else:
                        out.append("focus_placeholder('###')")
                    seen_inside = True
                    inserted_inside = True
                if (
                    seen_inside
                    and saw_template
                    and has_choices_placeholder
                    and not saw_after_box
                    and choice_re.match(stripped)
                ):
                    out.append("exit_box()")
                    out.append("insert_enter()")
                    out.append("focus_placeholder('&&&')")
                    saw_after_box = True
                out.append(line)
                continue
            marker = m.group(2)
            if marker == "###":
                if _dual_mode:
                    _dual_hash_count += 1
                    if _dual_hash_count == 1:
                        # First ### in dual mode → create condition box via insert_box()
                        out.append("insert_box()")
                        seen_inside = True
                        _dual_box_phase = 1
                    else:
                        # Second+ ### → navigate to header.hwp's 보기 box
                        if _dual_box_phase == 1:
                            # Still in condition box; exit first
                            out.append("exit_box()")
                            out.append("insert_enter()")
                            _dual_box_phase = 2
                            seen_inside = False
                        out.append(line)
                        seen_inside = True
                    continue
                if not inserted_inside:
                    seen_inside = True
                    out.append(line)
                continue
            if marker == "@@@":
                saw_outside = True
                if seen_inside:
                    out.append("exit_box()")
                    out.append("insert_enter()")
                    continue
                # If we're using a template with placeholders, consume @@@ here.
                if saw_template:
                    out.append(line)
                continue
            if marker == "&&&":
                if has_choices_placeholder:
                    saw_after_box = True
                    if seen_inside:
                        # Only add exit_box() if not already present after the last ### / box entry
                        already_exited = False
                        for j in range(len(out) - 1, max(len(out) - 20, -1), -1):
                            s = out[j].strip()
                            if s == "exit_box()":
                                already_exited = True
                                break
                            if s in (
                                "focus_placeholder('###')",
                                'focus_placeholder("###")',
                                "insert_box()",
                                "insert_view_box()",
                            ):
                                break
                        if not already_exited:
                            out.append("exit_box()")
                            out.append("insert_enter()")
                        out.append(line)
                        continue
                    out.append(line)
                    continue
                # If template has no &&& placeholder, ignore this marker.
                continue
            out.append(line)
        return out

    def _relocate_early_header_template(self, lines: List[str]) -> List[str]:
        """
        Ensure header.hwp is positioned right before the <??> item block.

        - If inserted too early: move down near first ?? item.
        - If inserted too late: move up before first ?? item.
        """
        header_idx = -1
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("insert_template(") and "header.hwp" in stripped.lower():
                header_idx = i
                break
        if header_idx < 0:
            return lines

        first_box_idx = -1
        for i, line in enumerate(lines):
            if self._is_view_item_line(line.strip()):
                first_box_idx = i
                break
        if first_box_idx < 0:
            return lines
        if header_idx == first_box_idx:
            return lines

        # Template block = header template line + immediate blanks + optional @@@ focus.
        block_end = header_idx + 1
        while block_end < len(lines) and not lines[block_end].strip():
            block_end += 1
        if block_end < len(lines) and lines[block_end].strip() in (
            "focus_placeholder('@@@')",
            'focus_placeholder("@@@")',
        ):
            block_end += 1

        # Early case only: keep conservative threshold to avoid unnecessary relocation.
        if header_idx < first_box_idx:
            content_re = re.compile(
                r"^\s*(insert_text|insert_equation|insert_enter|insert_cropped_image|set_bold|set_underline|insert_underline|set_align_right_next_line)\("
            )
            content_count = 0
            for i in range(block_end, first_box_idx):
                if content_re.match(lines[i].strip()):
                    content_count += 1
            if content_count < 8:
                return lines

        # Remove current header block.
        out = lines[:header_idx] + lines[block_end:]

        # Find box start again in updated list.
        first_box_idx2 = -1
        for i, line in enumerate(out):
            if self._is_view_item_line(line.strip()):
                first_box_idx2 = i
                break
        if first_box_idx2 < 0:
            return lines

        insert_at = first_box_idx2
        if insert_at > 0 and out[insert_at - 1].strip() == "set_align_justify_next_line()":
            insert_at -= 1

        header_block = ["insert_template('header.hwp')"]
        if header_idx < first_box_idx:
            # In early case, preserve outside-placeholder flow after relocation.
            header_block.append("focus_placeholder('@@@')")

        return out[:insert_at] + header_block + out[insert_at:]

    def _split_dual_content_in_header(self, lines: List[str]) -> List[str]:
        """
        When header.hwp template is used and its ### block contains both
        condition text (ⓐ/ⓑ/ⓒ etc.) AND 보기 items (ㄱ/ㄴ/ㄷ), split them:
          - condition text  → insert_box()  (separate plain box)
          - question text   → outside any box
          - 보기 items      → keep in header's ### block
        This handles the case where the AI puts everything into a single
        header.hwp box instead of using two separate templates.
        """
        # Only apply when header.hwp template is present
        has_header = any(
            "header.hwp" in l.lower() and "insert_template(" in l
            for l in lines
        )
        if not has_header:
            return lines

        # Skip if dual mode already created an insert_box()
        if any(l.strip() == "insert_box()" for l in lines):
            return lines

        # Find the ### entry and the matching exit_box()
        hash_idx = -1
        exit_idx = -1
        for i, line in enumerate(lines):
            stripped = line.strip()
            if hash_idx < 0 and stripped in (
                "focus_placeholder('###')",
                'focus_placeholder("###")',
            ):
                hash_idx = i
            elif hash_idx >= 0 and exit_idx < 0 and stripped == "exit_box()":
                exit_idx = i

        if hash_idx < 0 or exit_idx < 0:
            return lines

        # Find first 보기 item (ㄱ./ㄴ./ㄷ.) inside the ### block
        first_bogi_idx = -1
        for i in range(hash_idx + 1, exit_idx):
            if self._is_view_item_line(lines[i].strip()):
                first_bogi_idx = i
                break

        if first_bogi_idx < 0:
            return lines  # No 보기 items; nothing to split

        # Check if there's substantial text content BEFORE the first 보기 item
        pre_text_lines = [
            i for i in range(hash_idx + 1, first_bogi_idx)
            if lines[i].strip().startswith("insert_text(")
            or lines[i].strip().startswith("insert_equation(")
        ]
        if not pre_text_lines:
            return lines  # No condition text before 보기 items

        # --- Detect question-text boundary by scanning backward from ㄱ. ---
        question_re = re.compile(
            r"(이에\s*대한|것은\s*\??|것만을|옳은|옳지|<\s*보\s*기\s*>"
            r"|보기>|바르게|짝지은|대로\s*고|고른|맞게|맞는|틀린|아닌|설명으로)"
        )
        question_start = first_bogi_idx  # default: no question text detected
        found_question = False

        i = first_bogi_idx - 1
        while i > hash_idx:
            stripped = lines[i].strip()
            # Skip paragraph / blank lines
            if not stripped or stripped in (
                "insert_paragraph()",
                "insert_enter()",
                "insert_small_paragraph()",
            ):
                i -= 1
                continue
            # Skip formatting-only lines
            if stripped in (
                "set_align_justify_next_line()",
                "set_bold(True)",
                "set_bold(False)",
                "set_underline(True)",
                "set_underline(False)",
                "insert_underline(True)",
                "insert_underline(False)",
            ):
                if found_question:
                    question_start = i
                i -= 1
                continue
            # Check text/equation content
            if stripped.startswith("insert_text(") or stripped.startswith(
                "insert_equation("
            ):
                text_match = re.search(r"['\"](.+?)['\"]", stripped)
                if text_match and question_re.search(text_match.group(1)):
                    question_start = i
                    found_question = True
                    i -= 1
                    continue
                else:
                    break  # Not question text → end of condition text
            else:
                break

        # Include preceding paragraph break(s) in question section
        while (
            question_start > hash_idx + 1
            and lines[question_start - 1].strip()
            in ("insert_paragraph()", "insert_enter()", "")
        ):
            question_start -= 1

        # Determine condition text end (strip trailing paragraphs)
        condition_end = question_start
        while (
            condition_end > hash_idx + 1
            and lines[condition_end - 1].strip()
            in ("insert_paragraph()", "insert_enter()", "")
        ):
            condition_end -= 1

        # Verify there's actual condition text remaining after stripping
        has_real_condition = any(
            lines[j].strip().startswith("insert_text(")
            or lines[j].strip().startswith("insert_equation(")
            for j in range(hash_idx + 1, condition_end)
        )
        if not has_real_condition:
            return lines

        # --- Build the new output ---
        out: List[str] = []

        # 1) Lines before ### (unchanged)
        out.extend(lines[:hash_idx])

        # 2) Condition box (insert_box replaces the original focus_placeholder('###'))
        out.append("insert_box()")
        content_start = hash_idx + 1
        # Carry over set_align_justify_next_line if present right after ###
        if (
            content_start < condition_end
            and lines[content_start].strip() == "set_align_justify_next_line()"
        ):
            out.append(lines[content_start])
            content_start += 1
        for j in range(content_start, condition_end):
            out.append(lines[j])
        out.append("exit_box()")
        out.append("insert_enter()")

        # 3) Question text (outside any box)
        has_question_content = False
        for j in range(question_start, first_bogi_idx):
            stripped = lines[j].strip()
            if stripped == "set_align_justify_next_line()":
                continue  # Don't carry box alignment into outside text
            out.append(lines[j])
            if stripped.startswith("insert_text(") or stripped.startswith(
                "insert_equation("
            ):
                has_question_content = True
        # Ensure paragraph break before 보기 block
        if has_question_content and (
            not out or out[-1].strip() not in ("insert_paragraph()", "insert_enter()")
        ):
            out.append("insert_enter()")

        # 4) 보기 items in header's ### block
        out.append("focus_placeholder('###')")
        out.append("set_align_justify_next_line()")
        for j in range(first_bogi_idx, exit_idx):
            out.append(lines[j])
        out.append(lines[exit_idx])  # exit_box()

        # 5) Lines after exit_box (unchanged)
        out.extend(lines[exit_idx + 1:])

        return out

    def _normalize_box_paragraphs(self, lines: List[str]) -> List[str]:
        """
        Inside a box, collapse multiple blank lines and avoid trailing blanks.
        This keeps <보기> content compact (single-spaced list items).
        """
        out: List[str] = []
        in_box = False
        last_was_para_in_box = False
        fp_re = re.compile(r"^\s*focus_placeholder\(\s*(['\"])(.*?)\1\s*\)\s*$")

        for line in lines:
            stripped = line.strip()
            m = fp_re.match(stripped)
            if m:
                marker = m.group(2)
                if marker == "###":
                    in_box = True
                    last_was_para_in_box = False
                elif marker in ("&&&", "@@@"):
                    if in_box and out and out[-1].strip() in ("insert_paragraph()", "insert_enter()"):
                        out.pop()
                    in_box = False
                    last_was_para_in_box = False
                out.append(line)
                continue

            if stripped in ("insert_box()", "insert_view_box()"):
                in_box = True
                last_was_para_in_box = False
                out.append(line)
                continue

            if stripped == "exit_box()":
                if in_box and out and out[-1].strip() in ("insert_paragraph()", "insert_enter()"):
                    out.pop()
                in_box = False
                last_was_para_in_box = False
                out.append(line)
                continue

            if in_box and stripped in (
                "insert_paragraph()",
                "insert_enter()",
                "insert_small_paragraph()",
                "insert_small_paragraph_3px()",
            ):
                if last_was_para_in_box:
                    continue
                out.append("insert_enter()")
                last_was_para_in_box = True
                continue

            if stripped:
                last_was_para_in_box = False
            out.append(line)

        return out

    def _drop_enter_after_exit_box(self, lines: List[str]) -> List[str]:
        """
        Avoid extra blank lines caused by exit_box() followed by insert_enter().
        exit_box() already moves the cursor below the box.
        """
        out: List[str] = []
        skip_next = False
        for line in lines:
            stripped = line.strip()
            if skip_next:
                skip_next = False
                if stripped in ("insert_enter()", "insert_paragraph()"):
                    continue
            out.append(line)
            if stripped == "exit_box()":
                skip_next = True
        return out

    def _ensure_exit_after_plain_box(self, lines: List[str]) -> List[str]:
        """
        If a plain box is opened with insert_box() and never closed,
        insert exit_box() before the next outside marker or at EOF.
        """
        out: List[str] = []
        in_box = False
        fp_re = re.compile(r"^\s*focus_placeholder\(\s*(['\"])(.*?)\1\s*\)\s*$")
        for line in lines:
            stripped = line.strip()
            if stripped == "insert_box()":
                in_box = True
                out.append(line)
                continue
            if stripped == "exit_box()":
                in_box = False
                out.append(line)
                continue
            # If we're in a plain box and we hit an outside marker, close first.
            if in_box:
                m = fp_re.match(stripped)
                if (
                    stripped.startswith("insert_template(")
                    or stripped in ("focus_placeholder('###')", 'focus_placeholder("###")')
                    or stripped in ("focus_placeholder('&&&')", 'focus_placeholder("&&&")')
                    or (m and m.group(2) in ("@@@", "###", "&&&"))
                ):
                    out.append("exit_box()")
                    in_box = False
            out.append(line)
        if in_box:
            out.append("exit_box()")
        return out

    def _normalize_box_template_order(self, lines: List[str]) -> List[str]:
        """
        When box.hwp is used, ensure focus_placeholder('@@@') appears
        immediately after insert_template('box.hwp').
        """
        out: List[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            if stripped.startswith("insert_template(") and "box.hwp" in stripped.lower():
                out.append(line)
                # Skip any existing @@@ right after; reinsert if missing.
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    out.append(lines[j])
                    j += 1
                if j < len(lines) and lines[j].strip() in (
                    "focus_placeholder('@@@')",
                    'focus_placeholder("@@@")',
                ):
                    out.append(lines[j])
                    i = j + 1
                    continue
                out.append("focus_placeholder('@@@')")
                i = j
                continue
            if stripped in ("focus_placeholder('@@@')", 'focus_placeholder("@@@")'):
                # If @@@ appears before box.hwp, drop it (will be reinserted after template).
                if any(
                    l.strip().startswith("insert_template(") and "box.hwp" in l.strip().lower()
                    for l in lines[i + 1 :]
                ):
                    i += 1
                    continue
            out.append(line)
            i += 1
        return out

    def _fix_header_view_box_order(self, lines: List[str]) -> List[str]:
        """
        When header.hwp is used, ensure the <보기> content (ㄱ/ㄴ/ㄷ) is
        inside the ### placeholder and choices are after &&&.
        """
        has_header = any(
            l.strip().startswith("insert_template(") and "header.hwp" in l.strip().lower()
            for l in lines
        )
        if not has_header:
            return lines

        choice_re = re.compile(
            r"^\s*insert_(?:text|equation)\(\s*['\"]\s*(?:[\u2460-\u2473]|[1-9][.)])"
        )

        def _analyze(cur: List[str]) -> tuple[int, int, int, int]:
            first_box = -1
            first_choice = -1
            hash_pos = -1
            amp_pos = -1
            for idx, row in enumerate(cur):
                stripped = row.strip()
                if first_box < 0 and self._is_view_item_line(stripped):
                    first_box = idx
                if first_choice < 0 and choice_re.match(stripped):
                    first_choice = idx
                if hash_pos < 0 and stripped in (
                    "focus_placeholder('###')",
                    'focus_placeholder("###")',
                ):
                    hash_pos = idx
                if amp_pos < 0 and stripped in (
                    "focus_placeholder('&&&')",
                    'focus_placeholder("&&&")',
                ):
                    amp_pos = idx
            return first_box, first_choice, hash_pos, amp_pos

        out = list(lines)
        first_box_idx, first_choice_idx, hash_idx, amp_idx = _analyze(out)
        if first_box_idx < 0:
            return lines

        # 1) Ensure ### is placed right before the <보기> items.
        if hash_idx >= 0 and hash_idx > first_box_idx:
            out.pop(hash_idx)
        first_box_idx, first_choice_idx, hash_idx, amp_idx = _analyze(out)
        if hash_idx < 0 or hash_idx > first_box_idx:
            insert_at = first_box_idx
            if insert_at > 0 and out[insert_at - 1].strip() == "set_align_justify_next_line()":
                insert_at -= 1
            out.insert(insert_at, "focus_placeholder('###')")
            first_box_idx, first_choice_idx, hash_idx, amp_idx = _analyze(out)

        # 2) For choices, force: ... box content -> exit_box() -> focus_placeholder('&&&') -> choices.
        if first_choice_idx >= 0:
            if amp_idx >= 0:
                out.pop(amp_idx)
                first_box_idx, first_choice_idx, hash_idx, amp_idx = _analyze(out)

            # Insert &&& immediately before choices.
            out.insert(first_choice_idx, "focus_placeholder('&&&')")
            first_choice_idx += 1

            # Ensure exit_box() is immediately before &&& (ignoring blanks).
            probe = first_choice_idx - 1
            while probe >= 0 and not out[probe].strip():
                probe -= 1
            if probe < 0 or out[probe].strip() != "exit_box()":
                out.insert(first_choice_idx - 1, "exit_box()")

        return out

    def _normalize_choice_leading_space(self, lines: List[str]) -> List[str]:
        """
        Ensure choices start with insert_text('①') (no leading space).
        """
        out: List[str] = []
        # Match insert_text(' ①') or insert_text(" ①")
        leading_choice_re = re.compile(
            r"^(?P<prefix>\s*insert_text\(\s*['\"])\s+①(?P<suffix>['\"]\s*\)\s*)$"
        )
        for line in lines:
            stripped = line.strip()
            m = leading_choice_re.match(stripped)
            if m:
                out.append(f"{m.group('prefix')}①{m.group('suffix')}")
                continue
            out.append(line)
        return out

    def _drop_unused_choices_placeholder(self, lines: List[str]) -> List[str]:
        """
        Ensure focus_placeholder('&&&') is handled correctly.
        - If no choices exist, move cursor to &&& once and remove the marker.
        - If choices exist, drop any &&& that appear after the last choice.
        """
        choice_re = re.compile(
            r"^\s*insert_(?:text|equation)\(\s*['\"]\s*(?:[\u2460-\u2473]|[1-9][.)])"
        )
        
        has_choices_placeholder = any(
            l.strip().startswith("insert_template(")
            and any(name in l.strip().lower() for name in ("header.hwp", "box.hwp", "box_white.hwp"))
            for l in lines
        )
        last_choice_idx = -1
        for i, line in enumerate(lines):
            if choice_re.match(line.strip()):
                last_choice_idx = i
        if last_choice_idx < 0:
            # No choices anywhere: ensure we still clear &&& once.
            out = [
                l
                for l in lines
                if l.strip()
                not in ("focus_placeholder('&&&')", 'focus_placeholder("&&&")')
            ]
            if has_choices_placeholder:
                insert_at = len(out)
                for i in range(len(out) - 1, -1, -1):
                    if out[i].strip() == "exit_box()":
                        insert_at = i + 1
                        break
                out.insert(insert_at, "focus_placeholder('&&&')")
            return out
        out: List[str] = []
        for i, line in enumerate(lines):
            if (
                line.strip()
                in ("focus_placeholder('&&&')", 'focus_placeholder("&&&")')
                and i > last_choice_idx
            ):
                continue
            out.append(line)
        return out

    def _rewrite_first_hash_insert_to_direct_replace(self, lines: List[str]) -> List[str]:
        """
        Rewrite:
          focus_placeholder('###')
          insert_text('...')
        into:
          insert_text_at_hash_placeholder('...')

        This directly replaces the ### marker text in-place and reduces
        failures where cursor focus drifts outside the 보기 box.
        """
        out: List[str] = []
        i = 0
        while i < len(lines):
            stripped = lines[i].strip()
            if stripped in ("focus_placeholder('###')", 'focus_placeholder("###")'):
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines):
                    nxt = lines[j].strip()
                    if nxt.startswith("insert_text(") and nxt.endswith(")"):
                        inner = lines[j][lines[j].find("(") + 1 : lines[j].rfind(")")]
                        out.append(f"insert_text_at_hash_placeholder({inner})")
                        i = j + 1
                        continue
            out.append(lines[i])
            i += 1
        return out

    def _force_first_view_item_into_hash_box(self, lines: List[str]) -> List[str]:
        """
        Ensure the first <보기> item line (ㄱ./ㄴ./ㄷ./가./나./다. etc.) is written
        via insert_text_at_hash_placeholder(...). This anchors the cursor inside
        the 보기 box so subsequent item lines stay inside.
        """
        out = list(lines)
        # If we already have a direct hash replace, don't do it again.
        if any(l.strip().startswith("insert_text_at_hash_placeholder(") for l in out):
            return out

        for i, row in enumerate(out):
            stripped = row.strip()
            if self._is_view_item_line(stripped):
                # Only handle insert_text(...) and insert_equation(...).
                if stripped.startswith("insert_text(") or stripped.startswith("insert_equation("):
                    inner = row[row.find("(") + 1 : row.rfind(")")]
                    func = "insert_text_at_hash_placeholder"
                    if stripped.startswith("insert_equation("):
                        # Keep equations inside the box by entering via hash, then insert equation.
                        out[i] = f"{func}({inner})"
                    else:
                        out[i] = f"{func}({inner})"
                    return out
        return out

    def _inject_view_box_test_text(self, lines: List[str]) -> List[str]:
        """
        Debug-only helper:
        If NOVA_VIEW_BOX_TEST_TEXT is set, force-insert that text inside the
        보기 box (### placeholder) so we can verify cursor routing.
        """
        test_text = (os.getenv("NOVA_VIEW_BOX_TEST_TEXT") or "").strip()
        if not test_text:
            return lines

        out = list(lines)
        header_idx = -1
        for i, row in enumerate(out):
            s = row.strip().lower()
            if s.startswith("insert_template(") and "header.hwp" in s:
                header_idx = i
                break
        if header_idx < 0:
            return lines

        hash_idx = -1
        for i, row in enumerate(out):
            s = row.strip()
            if s in ("focus_placeholder('###')", 'focus_placeholder("###")'):
                hash_idx = i
                break

        if hash_idx < 0:
            # Ensure we enter 보기 box for debug injection even when marker is missing.
            hash_idx = header_idx + 1
            out.insert(hash_idx, "focus_placeholder('###')")

        # Avoid duplicate insertions on repeated runs.
        exists = any(
            row.strip() == f"insert_text('{test_text}')"
            or row.strip() == f'insert_text("{test_text}")'
            for row in out
        )
        if not exists:
            out.insert(hash_idx + 1, f"insert_text('{test_text}')")
            out.insert(hash_idx + 2, "insert_paragraph()")

        return out

    def _execute_fallback(
        self, script: str, log_fn: LogFn, cancel_check: CancelCheck | None = None
    ) -> None:
        funcs_no_args = {
            "insert_paragraph": self._controller.insert_paragraph,
            "insert_enter": self._controller.insert_enter,
            "insert_space": self._controller.insert_space,
            "insert_box": self._controller.insert_box,
            "exit_box": self._controller.exit_box,
            "insert_view_box": self._controller.insert_view_box,
            "insert_small_paragraph": self._controller.insert_small_paragraph,
            "set_align_right_next_line": self._controller.set_align_right_next_line,
            "set_align_justify_next_line": self._controller.set_align_justify_next_line,
            "set_table_border_white": self._controller.set_table_border_white,
        }
        funcs_one_str = {
            "insert_text": self._controller.insert_text,
            "insert_text_at_hash_placeholder": self._controller.insert_text_at_hash_placeholder,
            "insert_equation": self._controller.insert_equation,
            "insert_latex_equation": self._controller.insert_latex_equation,
            "insert_template": self._controller.insert_template,
            "focus_placeholder": self._controller.focus_placeholder,
        }
        funcs_one_int = {
            "set_char_width_ratio": self._controller.set_char_width_ratio,
        }
        funcs_four_float = {
            "insert_cropped_image": self._controller.insert_cropped_image,
        }

        i = 0
        text = script
        names = sorted(
            list(funcs_no_args.keys())
            + list(funcs_one_str.keys())
            + list(funcs_one_int.keys())
            + list(funcs_four_float.keys())
            + ["set_bold", "set_underline", "insert_underline", "insert_table"],
            key=len,
            reverse=True,
        )
        while i < len(text):
            if cancel_check and cancel_check():
                raise ScriptCancelled("cancelled")
            matched = None
            for name in names:
                if text.startswith(name + "(", i):
                    matched = name
                    break
            if not matched:
                i += 1
                continue
            i += len(matched) + 1  # skip name + '('
            # parse args until matching ')', respecting quotes
            args = []
            depth = 1
            quote = None
            escaped = False
            while i < len(text) and depth > 0:
                ch = text[i]
                if escaped:
                    args.append(ch)
                    escaped = False
                    i += 1
                    continue
                if ch == "\\":
                    args.append(ch)
                    escaped = True
                    i += 1
                    continue
                if quote:
                    if ch == quote:
                        quote = None
                    args.append(ch)
                    i += 1
                    continue
                if ch in ("'", '"'):
                    quote = ch
                    args.append(ch)
                    i += 1
                    continue
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                args.append(ch)
                i += 1
            arg_str = "".join(args).strip()

            try:
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                if matched in funcs_no_args:
                    funcs_no_args[matched]()
                elif matched in funcs_one_str:
                    s = ""
                    if arg_str.startswith(("'", '"')):
                        q = arg_str[0]
                        end = arg_str.find(q, 1)
                        if end == -1:
                            s = arg_str[1:]
                        else:
                            s = arg_str[1:end]
                    else:
                        s = arg_str
                    funcs_one_str[matched](s)
                elif matched == "set_bold":
                    val = "true" in arg_str.lower()
                    self._controller.set_bold(val)
                elif matched in ("set_underline", "insert_underline"):
                    if not arg_str:
                        self._controller.set_underline()
                    else:
                        val = "true" in arg_str.lower()
                        self._controller.set_underline(val)
                elif matched in funcs_one_int:
                    try:
                        val = int(float(arg_str)) if arg_str else 0
                        funcs_one_int[matched](val)
                    except Exception:
                        pass
                elif matched in funcs_four_float:
                    try:
                        node = ast.parse(f"f({arg_str})", mode="eval")
                        call = node.body  # type: ignore[attr-defined]
                        if isinstance(call, ast.Call):
                            eval_args = [float(ast.literal_eval(a)) for a in call.args]
                            if len(eval_args) == 4:
                                funcs_four_float[matched](*eval_args)
                    except Exception:
                        pass
                elif matched == "insert_table":
                    # best-effort parse using literal_eval on args tuple
                    try:
                        node = ast.parse(f"f({arg_str})", mode="eval")
                        call = node.body  # type: ignore[attr-defined]
                        if isinstance(call, ast.Call):
                            eval_args = [ast.literal_eval(a) for a in call.args]
                            eval_kwargs = {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords if kw.arg}
                            self._controller.insert_table(*eval_args, **eval_kwargs)
                    except Exception:
                        pass
            except Exception as exc:
                log_fn(f"[Fallback] {matched} failed: {exc}")

    def run(
        self,
        script: str,
        log: LogFn | None = None,
        *,
        cancel_check: CancelCheck | None = None,
        source_image_path: str | None = None,
        **_: object,
    ) -> None:
        log_fn = log or (lambda *_: None)
        # Keep the source image path synchronized for insert_cropped_image().
        self._controller.set_source_image(source_image_path)
        cleaned = textwrap.dedent(script or "").strip()
        # Normalize line separators (Windows CRLF / unicode separators)
        cleaned = (
            cleaned.replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\u2028", "\n")
            .replace("\u2029", "\n")
        )
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        cleaned = self._strip_code_markers(cleaned).strip()

        if not cleaned:
            log_fn("빈 스크립트라서 실행하지 않았습니다.")
            return

        # Normalize newlines inside any quoted strings
        cleaned = self._sanitize_multiline_strings(cleaned)
        # Normalize newlines inside insert_* calls
        cleaned = self._normalize_inline_calls(cleaned)
        # Fix unterminated equation strings on same line
        cleaned = self._sanitize_unterminated_equation_strings(cleaned)
        # Normalize prime notation inside equation strings
        cleaned = self._normalize_primes_in_equations(cleaned)
        expanded_lines: List[str] = []
        for line in self._repair_multiline_calls(cleaned.split("\n")):
            for sub_line in self._split_concat_calls(line):
                expanded_lines.append(sub_line)
        expanded_lines = self._promote_math_insert_text_calls(expanded_lines)
        expanded_lines = self._relocate_early_header_template(expanded_lines)
        expanded_lines = self._normalize_placeholders(expanded_lines)
        expanded_lines = self._split_dual_content_in_header(expanded_lines)
        expanded_lines = self._normalize_box_paragraphs(expanded_lines)
        expanded_lines = self._normalize_box_template_order(expanded_lines)
        expanded_lines = self._ensure_exit_after_plain_box(expanded_lines)
        expanded_lines = self._drop_enter_after_exit_box(expanded_lines)
        expanded_lines = self._fix_header_view_box_order(expanded_lines)
        expanded_lines = self._rewrite_first_hash_insert_to_direct_replace(expanded_lines)
        expanded_lines = self._force_first_view_item_into_hash_box(expanded_lines)
        expanded_lines = self._inject_view_box_test_text(expanded_lines)
        expanded_lines = self._normalize_choice_leading_space(expanded_lines)
        expanded_lines = self._drop_unused_choices_placeholder(expanded_lines)
        expanded_lines = self._ensure_score_right_align(expanded_lines)
        expanded_lines = self._sanitize_tabs(expanded_lines)
        # Do not post-process choices; keep model output as-is.
        cleaned = "\n".join(expanded_lines).strip()

        def _wrap0(fn: Callable[[], None]) -> Callable[[], None]:
            def _inner() -> None:
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                return fn()

            return _inner

        def _wrap1(fn: Callable[[str], None]) -> Callable[[str], None]:
            def _inner(arg: str) -> None:
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                return fn(arg)

            return _inner

        def _wrap_bold(fn: Callable[[bool], None]) -> Callable[[bool], None]:
            def _inner(enabled: bool = True) -> None:
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                return fn(enabled)

            return _inner

        def _wrap_underline(fn: Callable[[bool | None], None]) -> Callable[[bool | None], None]:
            def _inner(enabled: bool | None = None) -> None:
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                return fn(enabled)

            return _inner

        def _wrap_table(fn: Callable[..., None]) -> Callable[..., None]:
            def _inner(*args, **kwargs) -> None:  # type: ignore[no-untyped-def]
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                return fn(*args, **kwargs)

            return _inner

        def _wrap_crop(fn: Callable[[float, float, float, float], None]) -> Callable[[float, float, float, float], None]:
            def _inner(x1: float, y1: float, x2: float, y2: float) -> None:
                if cancel_check and cancel_check():
                    raise ScriptCancelled("cancelled")
                return fn(x1, y1, x2, y2)

            return _inner

        env: Dict[str, object] = {
            "__builtins__": SAFE_BUILTINS,
            "insert_text": _wrap1(self._controller.insert_text),
            "insert_text_at_hash_placeholder": _wrap1(self._controller.insert_text_at_hash_placeholder),
            "insert_paragraph": _wrap0(self._controller.insert_paragraph),
            "insert_enter": _wrap0(self._controller.insert_enter),
            "insert_space": _wrap0(self._controller.insert_space),
            "insert_small_paragraph": _wrap0(self._controller.insert_small_paragraph),
            "insert_equation": _wrap1(self._controller.insert_equation),
            "insert_latex_equation": _wrap1(self._controller.insert_latex_equation),
            "insert_template": _wrap1(self._controller.insert_template),
            "focus_placeholder": _wrap1(self._controller.focus_placeholder),
            "insert_box": _wrap0(self._controller.insert_box),
            "exit_box": _wrap0(self._controller.exit_box),
            "insert_view_box": _wrap0(self._controller.insert_view_box),
            "insert_table": _wrap_table(self._controller.insert_table),
            "insert_cropped_image": _wrap_crop(self._controller.insert_cropped_image),
            "set_bold": _wrap_bold(self._controller.set_bold),
            "set_underline": _wrap_underline(self._controller.set_underline),
            "insert_underline": _wrap_underline(self._controller.set_underline),
            "set_char_width_ratio": self._controller.set_char_width_ratio,
            "set_table_border_white": _wrap0(self._controller.set_table_border_white),
            "set_align_right_next_line": _wrap0(self._controller.set_align_right_next_line),
            "set_align_justify_next_line": _wrap0(self._controller.set_align_justify_next_line),
        }

        log_fn("스크립트 실행 시작")
        try:
            if cancel_check and cancel_check():
                raise ScriptCancelled("cancelled")
            exec(cleaned, env, {})
        except SyntaxError:
            log_fn("[Fallback] SyntaxError detected, running fallback parser.")
            self._execute_fallback(cleaned, log_fn, cancel_check=cancel_check)
        except ScriptCancelled:
            log_fn("스크립트 실행 취소됨")
            raise
        except Exception as exc:
            log_fn(traceback.format_exc())
            raise exc
        else:
            # Final safety-net: remove any unresolved template markers.
            try:
                self._controller.cleanup_known_placeholders_near_cursor()
            except Exception:
                pass
            log_fn("스크립트 실행 완료")
