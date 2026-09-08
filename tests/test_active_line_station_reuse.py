from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_active_line_lock_is_loaded_after_route_editing() -> None:
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    assert 'ACTIVE_LINE_LOCK_JS = FRONTEND / "active_line_lock.js"' in app
    assert app.index("{route_editing_js}") < app.index("{active_line_lock_js}")


def test_foreign_station_does_not_steal_active_line() -> None:
    patch = (ROOT / "frontend" / "active_line_lock.js").read_text(encoding="utf-8")

    # While a line is active, station and route hit-testing are restricted to it.
    assert "const active = activeLine();" in patch
    assert "return stationHitOnLine(active, cx, cy, maxPx);" in patch
    assert "return {line: active, ...row" in patch

    # In station mode, a station from another scenario line is left to the
    # normal click handler so addStation() appends it to the still-active line.
    assert "foreignStationUnderPointer(active, cx, cy)" in patch
    assert "state.tool === 'stations'" in patch
    assert "return null;" in patch


def test_line_switching_remains_explicit() -> None:
    app_js = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    assert "[data-edit]" in app_js
    assert "state.activeId=b.dataset.edit" in app_js
