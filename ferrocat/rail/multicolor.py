from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from typing import Iterable, Sequence

Point = tuple[float, float]


@dataclass(frozen=True)
class StripeGeometry:
    service_id: str
    color: str
    points: tuple[Point, ...]
    offset_px: float


def _unit_normal(a: Point, b: Point) -> Point:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = hypot(dx, dy)
    if length == 0:
        return (0.0, 0.0)
    return (-dy / length, dx / length)


def offset_polyline(points: Sequence[Point], offset: float) -> tuple[Point, ...]:
    """Offset a screen-space polyline with averaged segment normals.

    This is a rendering helper, not a GIS buffer operation. It is intentionally
    deterministic so service stripes do not swap sides between adjacent edges.
    """
    if len(points) < 2:
        return tuple(points)
    normals = [_unit_normal(points[i], points[i + 1]) for i in range(len(points) - 1)]
    out: list[Point] = []
    for i, p in enumerate(points):
        if i == 0:
            nx, ny = normals[0]
        elif i == len(points) - 1:
            nx, ny = normals[-1]
        else:
            nx = normals[i - 1][0] + normals[i][0]
            ny = normals[i - 1][1] + normals[i][1]
            mag = hypot(nx, ny)
            if mag:
                nx, ny = nx / mag, ny / mag
        out.append((p[0] + nx * offset, p[1] + ny * offset))
    return tuple(out)


def build_multicolor_stripes(
    points: Sequence[Point],
    services: Iterable[tuple[str, str]],
    stripe_width_px: float = 2.6,
    gap_px: float = 0.5,
) -> list[StripeGeometry]:
    ordered = sorted(services, key=lambda item: item[0])
    n = len(ordered)
    if n == 0:
        return []
    spacing = stripe_width_px + gap_px
    stripes: list[StripeGeometry] = []
    for index, (service_id, color) in enumerate(ordered):
        offset = (index - (n - 1) / 2) * spacing
        stripes.append(
            StripeGeometry(
                service_id=service_id,
                color=color,
                points=offset_polyline(points, offset),
                offset_px=offset,
            )
        )
    return stripes
