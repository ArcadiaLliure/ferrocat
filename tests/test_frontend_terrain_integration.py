from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_full_terrain_extension_stack_is_wired_in_order() -> None:
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    markers = [
        "{client_js}",
        "{route_editing_js}",
        "{route_optimizer_js}",
        "{route_optimizer_costs_js}",
        "{profile_linking_js}",
        "{gesture_arbitration_js}",
        "{sidebar_resize_js}",
    ]
    positions = [app.index(marker) for marker in markers]
    assert positions == sorted(positions)


def test_cost_aware_router_restores_rerouting_and_engineering_structures() -> None:
    optimizer = (ROOT / "frontend" / "route_optimizer.js").read_text(encoding="utf-8")

    assert "function optSurfaceCandidate(section)" in optimizer
    assert "if(ce&&ce.totalM+.01<bestEval.totalM)" in optimizer
    assert "line.alignment=core.map" in optimizer
    assert "kind:'tunnel'" in optimizer or "'tunnel'" in optimizer
    assert "'viaduct'" in optimizer
    assert "TÚNEL" in optimizer
    assert "VIADUCTE" in optimizer
    assert "optEngineeringOverlay" in optimizer


def test_profile_restores_terrain_grade_axes_and_linked_hover() -> None:
    profile = (ROOT / "frontend" / "profile_linking.js").read_text(encoding="utf-8")

    assert '<path class="terrain"' in profile
    assert '<path class="rail"' in profile
    assert "km de via" in profile
    assert "metres d'alçada" in profile
    assert "bestAnalysedRouteHover" in profile
    assert "mapHoverToProfile" in profile
    assert "profilePointAtKm" in profile
    assert "Math.round(point.elevation)" in profile
