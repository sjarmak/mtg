#!/usr/bin/env python3
"""Independent overflow check of rendered cards, against a real font.

`checkSvgOverflow` in TypeScript re-derives each run's box from the emitted
markup, but it shares a metrics table with the renderer it is checking. This
script does not: it loads an actual installed font, asks *it* how wide and how
tall each run really is at the size the file asked for, and compares that with
the region boxes the file declares.

Two things are checked per text run:

  ink extents      the real glyph bounding box, at the emitted font size and
                   position, must lie inside the declared region box;
  tracking slack   the natural width of the run must not exceed the committed
                   `textLength`, or the viewer would have to squeeze the
                   tracking to honor it.

Usage:
    python3 packages/card-render/tools/check-overflow.py <svg-dir> [font.ttf]

Exit code 0 means every card in the directory is clean.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import ImageFont

DEFAULT_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
]

# Pillow's truetype size is an integer, so every size is measured at 10x and
# divided back down; 0.1 user units is 0.01 mm, far below anything that matters.
SCALE = 10

REGION_RE = re.compile(r'<g\b[^>]*?\bdata-region="([^"]+)"[^>]*?>')
TEXT_RE = re.compile(r"<text\b([^>]*)>(.*?)</text>", re.S)
EPSILON = 0.05


def attr(source: str, name: str) -> str | None:
    match = re.search(rf'\b{re.escape(name)}="([^"]*)"', source)
    return None if match is None else match.group(1)


def unescape(value: str) -> str:
    for entity, char in (
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", '"'),
        ("&apos;", "'"),
        ("&amp;", "&"),
    ):
        value = value.replace(entity, char)
    return value


def region_boxes(svg: str) -> dict[str, tuple[float, float, float, float]]:
    boxes: dict[str, tuple[float, float, float, float]] = {}
    for match in REGION_RE.finditer(svg):
        tag = match.group(0)
        name = match.group(1)
        parts = [attr(tag, f"data-box-{axis}") for axis in ("x", "y", "w", "h")]
        if any(part is None for part in parts):
            continue
        boxes[name] = tuple(float(part) for part in parts)  # type: ignore[arg-type]
    return boxes


def check_file(path: Path, fonts: list[tuple[str, str]]) -> list[str]:
    svg = path.read_text(encoding="utf-8")
    boxes = region_boxes(svg)
    problems: list[str] = []
    runs = 0

    for match in TEXT_RE.finditer(svg):
        attrs, body = match.group(1), unescape(match.group(2).strip())
        region = attr(attrs, "data-region")
        if region is None:
            continue
        runs += 1
        if region not in boxes:
            problems.append(f"{path.name}: run in region {region!r} has no declared box")
            continue
        bx, by, bw, bh = boxes[region]
        x = float(attr(attrs, "x") or 0)
        y = float(attr(attrs, "y") or 0)
        size = float(attr(attrs, "font-size") or 0)
        committed = float(attr(attrs, "textLength") or 0)
        anchor = attr(attrs, "text-anchor") or "start"
        left = x - committed / 2 if anchor == "middle" else x - committed if anchor == "end" else x
        right = left + committed

        if left < bx - EPSILON:
            problems.append(f"{path.name}: {region} run {body!r} starts {bx - left:.2f}u left of box")
        if right > bx + bw + EPSILON:
            problems.append(
                f"{path.name}: {region} run {body!r} ends {right - bx - bw:.2f}u right of box"
            )

        for font_name, font_path in fonts:
            font = ImageFont.truetype(font_path, int(round(size * SCALE)))
            natural = font.getlength(body) / SCALE
            if natural > committed + EPSILON:
                problems.append(
                    f"{path.name}: {region} run {body!r} needs {natural:.2f}u in {font_name} "
                    f"but is committed to {committed:.2f}u"
                )
            x0, y0, x1, y1 = font.getbbox(body, anchor="ls")
            top, bottom = y + y0 / SCALE, y + y1 / SCALE
            if top < by - EPSILON:
                problems.append(
                    f"{path.name}: {region} run {body!r} ink rises {by - top:.2f}u above box "
                    f"in {font_name}"
                )
            if bottom > by + bh + EPSILON:
                problems.append(
                    f"{path.name}: {region} run {body!r} ink drops {bottom - by - bh:.2f}u below "
                    f"box in {font_name}"
                )

    if runs == 0:
        problems.append(f"{path.name}: no measurable text runs — the file is not a rendered card")
    return problems


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    directory = Path(argv[0])
    font_paths = argv[1:] or DEFAULT_FONTS
    fonts = []
    for path in font_paths:
        if not Path(path).is_file():
            print(f"missing font {path}", file=sys.stderr)
            return 1
        fonts.append((Path(path).stem, path))

    files = sorted(directory.glob("*.svg"))
    if not files:
        print(f"no .svg files in {directory}", file=sys.stderr)
        return 1

    problems: list[str] = []
    for file in files:
        problems.extend(check_file(file, fonts))

    print(f"checked {len(files)} cards against {', '.join(name for name, _ in fonts)}")
    if problems:
        for problem in problems[:60]:
            print(f"  {problem}")
        if len(problems) > 60:
            print(f"  ... and {len(problems) - 60} more")
        print(f"FAIL: {len(problems)} problems")
        return 1
    print("PASS: no run leaves its box and no run needs tracking compression")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
