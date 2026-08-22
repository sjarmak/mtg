#!/usr/bin/env python3
"""Regenerate `src/text/metrics-data.ts` from locally installed serif fonts.

Why this exists
---------------
The renderer wraps oracle text by *measuring* it, so it needs advance widths.
It has no font file of its own (see `README.md` — the lab ships no font, and
draws its own mana symbols so no symbol font is needed either), and an SVG is
laid out by whatever font the viewer happens to resolve from the declared
stack. The table below is therefore a deliberate **upper bound**: per character,
the widest advance across the reference serif faces, so a line that fits under
this table fits under any of them.

Reference faces (both free, both safely usable as a *measurement* reference —
no font bytes are copied into this tree):

  * DejaVu Serif      — Bitstream Vera License + public-domain additions
  * Liberation Serif  — SIL Open Font License 1.1 (metric-compatible with Times)

Widths are advance widths at a 1000-unit em, so `width(text, size) =
sum(advance) * size / 1000`.

Usage:
    python3 packages/card-render/tools/measure-font-metrics.py
    python3 packages/card-render/tools/measure-font-metrics.py --bold-report

`--bold-report` prints the bold-to-regular advance ratios that back
`BOLD_WIDTH_FACTOR` in `metrics.ts` and writes nothing.

Requires Pillow (pre-installed in this lab). Fails loudly if a reference face is
missing rather than silently emitting a narrower table.
"""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

from PIL import ImageFont

EM = 1000

REFERENCE_FACES = {
    "DejaVu Serif": "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "Liberation Serif": "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
}

BOLD_FACES = {
    "DejaVu Serif": "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "Liberation Serif": "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
}

BOLD_SAMPLE = (
    "abcdefghijklmnopqrstuvwxyz" "ABCDEFGHIJKLMNOPQRSTUVWXYZ" "0123456789"
)


def bold_report() -> int:
    worst = 0.0
    for name, regular_path in REFERENCE_FACES.items():
        bold_path = BOLD_FACES[name]
        if not Path(regular_path).is_file() or not Path(bold_path).is_file():
            print(f"missing face pair for {name}", file=sys.stderr)
            return 1
        regular = ImageFont.truetype(regular_path, EM)
        bold = ImageFont.truetype(bold_path, EM)
        ratios = [bold.getlength(c) / regular.getlength(c) for c in BOLD_SAMPLE]
        print(
            f"{name:20s} mean {statistics.mean(ratios):.3f}  max {max(ratios):.3f}"
        )
        worst = max(worst, max(ratios))
    print(f"BOLD_WIDTH_FACTOR should be >= {worst:.3f}")
    return 0

# Printable ASCII plus the punctuation the DSL's own renderers emit: the em dash
# in type lines, curly quotes and the ellipsis in generated flavor-ish names.
CHARS = "".join(chr(code) for code in range(0x20, 0x7F)) + "—‘’“”…"

OUT = Path(__file__).resolve().parent.parent / "src" / "text" / "metrics-data.ts"

HEADER = '''/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with `python3 packages/card-render/tools/measure-font-metrics.py`.
 *
 * Advance widths at a 1000-unit em, taken as the per-character maximum across
 * the reference serif faces listed in that script. The maximum is the point:
 * an SVG is laid out by whatever font the viewer resolves, so the renderer
 * measures against an upper bound and a line that fits here fits under any
 * reference face. `DEFAULT_WIDTH_SAFETY` in `metrics.ts` adds the allowance for
 * faces outside the reference set.
 *
 * No font file is bundled or distributed by this package; these are measured
 * numbers, not glyphs. Reference faces and their licenses are named in the
 * generator script and in this package's README.
 */

'''


def main() -> int:
    if "--bold-report" in sys.argv[1:]:
        return bold_report()
    fonts = []
    for name, path in REFERENCE_FACES.items():
        if not Path(path).is_file():
            print(f"missing reference face {name}: {path}", file=sys.stderr)
            return 1
        fonts.append((name, ImageFont.truetype(path, EM)))

    widths = []
    for char in CHARS:
        advance = max(font.getlength(char) for _, font in fonts)
        if advance <= 0:
            print(f"zero advance for {char!r}", file=sys.stderr)
            return 1
        widths.append(round(advance))

    chars_literal = (
        CHARS.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("—", "\\u2014")
        .replace("‘", "\\u2018")
        .replace("’", "\\u2019")
        .replace("“", "\\u201c")
        .replace("”", "\\u201d")
        .replace("…", "\\u2026")
    )

    rows = []
    for start in range(0, len(widths), 16):
        rows.append("  " + ", ".join(str(w) for w in widths[start : start + 16]) + ",")

    body = (
        HEADER
        + "/** Units per em that `METRIC_ADVANCES` is expressed in. */\n"
        + f"export const METRIC_EM = {EM};\n\n"
        + "/** Characters covered by the table, in table order. */\n"
        + f"export const METRIC_CHARS = '{chars_literal}';\n\n"
        + "/** Advance width per character of `METRIC_CHARS`, in `METRIC_EM` units. */\n"
        + "export const METRIC_ADVANCES: readonly number[] = [\n"
        + "\n".join(rows)
        + "\n];\n\n"
        + "/** Reference faces the table was measured from, for provenance. */\n"
        + "export const METRIC_SOURCES: readonly string[] = [\n"
        + "".join(f"  '{name}',\n" for name in REFERENCE_FACES)
        + "];\n"
    )

    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT} ({len(widths)} characters)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
