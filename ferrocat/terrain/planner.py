from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
from math import hypot
from typing import Iterable

import numpy as np

from ferrocat.domain.cost import CostBreakdown, CostParameters, estimate_cost

GridPoint = tuple[int, int]


@dataclass(frozen=True)
class TerrainPlannerConfig:
    cell_size_m: float = 100.0
    normal_gradient_permille: float = 25.0
    exceptional_gradient_permille: float = 35.0
    corridor_radius_cells: int = 30
    slope_soft_penalty: float = 12.0
    slope_hard_penalty: float = 250.0
    deviation_penalty: float = 0.08
    heading_penalty: float = 0.6
    tunnel_penalty_per_m: float = 3.2
    tunnel_trigger_permille: float = 35.0
    tunnel_merge_gap_m: float = 250.0
    minimum_tunnel_length_m: float = 250.0
    viaduct_trigger_m: float = 18.0
    tunnel_cover_trigger_m: float = 24.0


@dataclass(frozen=True)
class StructureInterval:
    kind: str
    start_m: float
    end_m: float
    length_m: float
    max_height_or_cover_m: float = 0.0


@dataclass(frozen=True)
class AlignmentPlan:
    grid_path: tuple[GridPoint, ...]
    xy_path_m: tuple[tuple[float, float], ...]
    terrain_profile_m: tuple[float, ...]
    rail_profile_m: tuple[float, ...]
    structures: tuple[StructureInterval, ...]
    max_gradient_permille: float
    surface_feasible: bool
    used_tunnels: bool
    length_m: float
    cost: CostBreakdown
    warnings: tuple[str, ...]


def _bresenham(a: GridPoint, b: GridPoint) -> list[GridPoint]:
    x0, y0 = a
    x1, y1 = b
    points: list[GridPoint] = []
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        points.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return points


def corridor_mask(shape: tuple[int, int], trace: Iterable[GridPoint], radius_cells: int) -> np.ndarray:
    trace = list(trace)
    if len(trace) < 2:
        raise ValueError("El traçat necessita com a mínim dos punts")
    base: set[GridPoint] = set()
    for a, b in zip(trace, trace[1:]):
        base.update(_bresenham(a, b))
    mask = np.zeros(shape, dtype=bool)
    rr = radius_cells * radius_cells
    for x, y in base:
        y0 = max(0, y - radius_cells)
        y1 = min(shape[0] - 1, y + radius_cells)
        x0 = max(0, x - radius_cells)
        x1 = min(shape[1] - 1, x + radius_cells)
        for yy in range(y0, y1 + 1):
            dy = yy - y
            for xx in range(x0, x1 + 1):
                dx = xx - x
                if dx * dx + dy * dy <= rr:
                    mask[yy, xx] = True
    return mask


def _distance_to_trace(point: GridPoint, trace: list[GridPoint]) -> float:
    x, y = point
    return min(hypot(x - tx, y - ty) for tx, ty in trace)


def _neighbors(p: GridPoint, shape: tuple[int, int]) -> Iterable[tuple[GridPoint, float]]:
    x, y = p
    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
        nx, ny = x + dx, y + dy
        if 0 <= ny < shape[0] and 0 <= nx < shape[1]:
            yield (nx, ny), hypot(dx, dy)


def _astar(
    dem: np.ndarray,
    start: GridPoint,
    goal: GridPoint,
    trace: list[GridPoint],
    mask: np.ndarray,
    cfg: TerrainPlannerConfig,
    *,
    allow_tunnels: bool,
) -> tuple[list[GridPoint], bool]:
    shape = dem.shape
    open_heap: list[tuple[float, float, GridPoint, tuple[int,int] | None]] = []
    heappush(open_heap, (0.0, 0.0, start, None))
    best: dict[tuple[GridPoint, tuple[int,int] | None], float] = {(start, None): 0.0}
    parent: dict[tuple[GridPoint, tuple[int,int] | None], tuple[GridPoint, tuple[int,int] | None] | None] = {(start, None): None}
    goal_state: tuple[GridPoint, tuple[int,int] | None] | None = None

    while open_heap:
        _, g, current, prev_dir = heappop(open_heap)
        state = (current, prev_dir)
        if g != best.get(state):
            continue
        if current == goal:
            goal_state = state
            break
        cx, cy = current
        cz = float(dem[cy, cx])
        for nxt, step_cells in _neighbors(current, shape):
            nx, ny = nxt
            if not mask[ny, nx] and nxt != goal:
                continue
            nz = float(dem[ny, nx])
            step_m = step_cells * cfg.cell_size_m
            grade = abs(nz - cz) / max(step_m, 1.0) * 1000.0
            if grade > cfg.exceptional_gradient_permille and not allow_tunnels:
                continue
            cost = step_m
            if grade > cfg.normal_gradient_permille:
                cost += (grade - cfg.normal_gradient_permille) * cfg.slope_soft_penalty
            if grade > cfg.exceptional_gradient_permille:
                cost += (grade - cfg.exceptional_gradient_permille) * cfg.slope_hard_penalty
                if allow_tunnels:
                    cost += step_m * cfg.tunnel_penalty_per_m
            cost += _distance_to_trace(nxt, trace) * cfg.cell_size_m * cfg.deviation_penalty
            direction = (nx - cx, ny - cy)
            if prev_dir is not None and direction != prev_dir:
                cost += cfg.heading_penalty * cfg.cell_size_m
            ng = g + cost
            nstate = (nxt, direction)
            if ng >= best.get(nstate, float("inf")):
                continue
            best[nstate] = ng
            parent[nstate] = state
            h = hypot(goal[0] - nx, goal[1] - ny) * cfg.cell_size_m
            heappush(open_heap, (ng + h, ng, nxt, direction))

    if goal_state is None:
        return [], False
    path: list[GridPoint] = []
    s: tuple[GridPoint, tuple[int,int] | None] | None = goal_state
    while s is not None:
        path.append(s[0])
        s = parent[s]
    path.reverse()
    return path, allow_tunnels


def _distance_axis(path: list[GridPoint], cell_size_m: float) -> np.ndarray:
    out = [0.0]
    for a, b in zip(path, path[1:]):
        out.append(out[-1] + hypot(b[0]-a[0], b[1]-a[1]) * cell_size_m)
    return np.asarray(out, dtype=float)


def _bounded_profile(terrain: np.ndarray, distances: np.ndarray, max_permille: float) -> np.ndarray:
    """Construct a smooth prefaisability rail profile constrained by grade.

    It starts from the terrain at both portals and repeatedly enforces the maximum
    vertical change forward/backward. Where terrain remains above this envelope
    the difference is interpreted as tunnel cover; where the profile stays above
    terrain it may imply fill/viaduct.
    """
    rail = terrain.astype(float).copy()
    if len(rail) < 2:
        return rail
    max_grade = max_permille / 1000.0
    for _ in range(6):
        for i in range(1, len(rail)):
            ds = distances[i] - distances[i-1]
            hi = rail[i-1] + max_grade * ds
            lo = rail[i-1] - max_grade * ds
            rail[i] = min(max(rail[i], lo), hi)
        for i in range(len(rail)-2, -1, -1):
            ds = distances[i+1] - distances[i]
            hi = rail[i+1] + max_grade * ds
            lo = rail[i+1] - max_grade * ds
            rail[i] = min(max(rail[i], lo), hi)
        # keep endpoints close to ground so portals/stations stay realistic
        rail[0] = terrain[0]
        rail[-1] = terrain[-1]
    return rail


def _merge_intervals(intervals: list[tuple[int,int]], distances: np.ndarray, gap_m: float) -> list[tuple[int,int]]:
    if not intervals:
        return []
    out = [list(intervals[0])]
    for start, end in intervals[1:]:
        prev = out[-1]
        gap = distances[start] - distances[prev[1]]
        if gap <= gap_m:
            prev[1] = end
        else:
            out.append([start, end])
    return [(a,b) for a,b in out]


def _intervals(mask: np.ndarray) -> list[tuple[int,int]]:
    out: list[tuple[int,int]] = []
    start: int | None = None
    for i, value in enumerate(mask):
        if value and start is None:
            start = i
        elif not value and start is not None:
            out.append((start, i-1)); start = None
    if start is not None:
        out.append((start, len(mask)-1))
    return out


def _structures(terrain: np.ndarray, rail: np.ndarray, distances: np.ndarray, cfg: TerrainPlannerConfig) -> tuple[StructureInterval, ...]:
    delta = rail - terrain
    tunnel_mask = delta <= -cfg.tunnel_cover_trigger_m
    viaduct_mask = delta >= cfg.viaduct_trigger_m
    tunnel_ranges = _merge_intervals(_intervals(tunnel_mask), distances, cfg.tunnel_merge_gap_m)
    structures: list[StructureInterval] = []
    for a,b in tunnel_ranges:
        length = max(0.0, distances[b] - distances[a])
        if length >= cfg.minimum_tunnel_length_m:
            structures.append(StructureInterval("tunnel", float(distances[a]), float(distances[b]), float(length), float(np.max(terrain[a:b+1]-rail[a:b+1]))))
    for a,b in _intervals(viaduct_mask):
        length = max(0.0, distances[b] - distances[a])
        if length >= cfg.cell_size_m * 2:
            structures.append(StructureInterval("viaduct", float(distances[a]), float(distances[b]), float(length), float(np.max(delta[a:b+1]))))
    return tuple(sorted(structures, key=lambda s: s.start_m))


def plan_alignment(
    dem: np.ndarray,
    start: GridPoint,
    goal: GridPoint,
    user_trace: Iterable[GridPoint] | None = None,
    *,
    config: TerrainPlannerConfig = TerrainPlannerConfig(),
    costs: CostParameters = CostParameters(),
) -> AlignmentPlan:
    if dem.ndim != 2 or dem.size == 0:
        raise ValueError("DEM invàlid")
    trace = list(user_trace or [start, goal])
    if trace[0] != start:
        trace.insert(0, start)
    if trace[-1] != goal:
        trace.append(goal)
    mask = corridor_mask(dem.shape, trace, config.corridor_radius_cells)
    path, used_tunnels = _astar(dem, start, goal, trace, mask, config, allow_tunnels=False)
    surface_feasible = bool(path)
    warnings: list[str] = []
    if not path:
        warnings.append("No s'ha trobat una alternativa superficial ferroviàriament raonable dins del corredor.")
        path, used_tunnels = _astar(dem, start, goal, trace, mask, config, allow_tunnels=True)
    if not path:
        raise RuntimeError("No s'ha pogut trobar cap traçat dins del corredor")

    distances = _distance_axis(path, config.cell_size_m)
    terrain = np.asarray([float(dem[y, x]) for x,y in path], dtype=float)
    rail = _bounded_profile(terrain, distances, config.exceptional_gradient_permille)
    if used_tunnels:
        # The A* tunnel fallback identifies where surface grades are impossible;
        # the bounded vertical profile converts those barriers into contiguous
        # engineering structures rather than simply rejecting the alignment.
        structs = _structures(terrain, rail, distances, config)
        if not any(s.kind == "tunnel" for s in structs):
            # Ensure a mountain barrier is surfaced as at least one tunnel when
            # fallback was required, using the strongest terrain/profile delta.
            delta = terrain - rail
            peak = int(np.argmax(delta))
            a = max(0, peak - 2); b = min(len(path)-1, peak + 2)
            if distances[b] - distances[a] >= config.cell_size_m:
                structs = tuple(sorted((*structs, StructureInterval(
                    "tunnel", float(distances[a]), float(distances[b]),
                    float(distances[b]-distances[a]), float(max(0.0, delta[peak]))
                )), key=lambda s: s.start_m))
        warnings.append("El traçat requereix una o més obres subterrànies de prefactibilitat.")
    else:
        structs = _structures(terrain, rail, distances, config)

    grades = np.diff(rail) / np.maximum(np.diff(distances), 1.0) * 1000.0
    max_grade = float(np.max(np.abs(grades))) if len(grades) else 0.0
    length_m = float(distances[-1]) if len(distances) else 0.0
    tunnel_m = sum(s.length_m for s in structs if s.kind == "tunnel")
    viaduct_m = sum(s.length_m for s in structs if s.kind == "viaduct")
    surface_m = max(0.0, length_m - tunnel_m - viaduct_m)
    cost = estimate_cost(
        new_surface_km=surface_m/1000.0,
        tunnel_km=tunnel_m/1000.0,
        viaduct_km=viaduct_m/1000.0,
        params=costs,
    )
    xy = tuple((x*config.cell_size_m, y*config.cell_size_m) for x,y in path)
    return AlignmentPlan(
        grid_path=tuple(path), xy_path_m=xy,
        terrain_profile_m=tuple(float(v) for v in terrain),
        rail_profile_m=tuple(float(v) for v in rail),
        structures=structs, max_gradient_permille=max_grade,
        surface_feasible=surface_feasible, used_tunnels=used_tunnels,
        length_m=length_m, cost=cost, warnings=tuple(warnings),
    )
