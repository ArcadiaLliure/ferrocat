from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_stable_terrain_router_is_injected_after_main_frontend() -> None:
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    main_pos = app.index("{client_js}")
    help_pos = app.index("{help_js}")
    assert main_pos < help_pos

    patch = (ROOT / "frontend" / "help.js").read_text(encoding="utf-8")
    assert "installStableTerrainRouting" in patch
    assert "terrainRoute = routeLine" in patch
    assert "analyzeTerrain = analyzeLine" in patch


def test_frontend_router_preserves_waypoints_and_penalizes_heading_changes() -> None:
    patch = (ROOT / "frontend" / "help.js").read_text(encoding="utf-8")

    # Cada estació/punt de traça es converteix en un waypoint obligatori i el
    # resultat guarda els punts de ruptura per suavitzar cada tram sense saltar
    # una parada intermèdia.
    assert "for (let i = 1; i < waypoints.length; i++)" in patch
    assert "path.waypointBreaks = breaks" in patch
    assert "path.waypointLL = ll" in patch

    # L'estat de cerca incorpora direcció i penalitza girs; el motor vell només
    # identificava la cel·la i permetia ziga-zagues successives de 45/90 graus.
    assert "stateKey(x, y, dir, width)" in patch
    assert "headingPenalty(prevDir, nextDir, res)" in patch
    assert "if (turn === 4) return Infinity" in patch

    # Recuperem un corredor acotat i apliquem suavitzat geomètric després de
    # trobar la ruta topogràfica.
    assert "10000, 10000" in patch
    assert "chaikin(pts, 2)" in patch
    assert "routingVersion:'stable-v2'" in patch


def test_stopping_station_editing_runs_topographic_analysis() -> None:
    patch = (ROOT / "frontend" / "help.js").read_text(encoding="utf-8")
    assert "const stopButton = byId('btn-stop')" in patch
    assert "line.analysis = analyzeTerrain(line)" in patch
