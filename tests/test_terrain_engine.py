from __future__ import annotations

import numpy as np

from ferrocat.terrain import TerrainPlannerConfig, plan_alignment


def test_valley_is_preferred_before_tunnel() -> None:
    dem = np.zeros((70, 90), dtype=float)
    # North-south mountain barrier with a low pass toward the top.
    dem[:, 42:48] = 500.0
    dem[8:18, 42:48] = 0.0
    cfg = TerrainPlannerConfig(cell_size_m=100.0, corridor_radius_cells=35, exceptional_gradient_permille=35)
    plan = plan_alignment(dem, (8, 35), (82, 35), [(8,35),(45,12),(82,35)], config=cfg)
    assert plan.surface_feasible
    assert not plan.used_tunnels
    assert not any(s.kind == "tunnel" for s in plan.structures)


def test_closed_mountain_barrier_generates_tunnel() -> None:
    dem = np.zeros((45, 85), dtype=float)
    dem[:, 38:47] = 800.0
    cfg = TerrainPlannerConfig(cell_size_m=100.0, corridor_radius_cells=12, exceptional_gradient_permille=35, minimum_tunnel_length_m=100)
    plan = plan_alignment(dem, (5,22), (79,22), [(5,22),(79,22)], config=cfg)
    assert not plan.surface_feasible
    assert plan.used_tunnels
    assert any(s.kind == "tunnel" and s.length_m > 0 for s in plan.structures)
    assert plan.cost.tunnel_m_eur > 0


def test_vertical_profile_respects_exceptional_gradient() -> None:
    dem = np.zeros((20, 70), dtype=float)
    dem[:, 30:40] = 500.0
    cfg = TerrainPlannerConfig(cell_size_m=100.0, corridor_radius_cells=6, exceptional_gradient_permille=35, minimum_tunnel_length_m=100)
    plan = plan_alignment(dem, (3,10), (66,10), config=cfg)
    assert plan.max_gradient_permille <= cfg.exceptional_gradient_permille + 1e-6
