/* Ferrocat interaction contract: the line explicitly being edited owns the map.
 *
 * A station may belong to several scenario lines. Clicking a station already
 * used by another line while one line is active must therefore add/reuse that
 * municipality in the ACTIVE line; it must never silently switch activeId to
 * the other line. Switching lines remains an explicit UI action (Edita).
 */
(function installActiveLineEditingLock() {
  const originalBestSelectedStationHit = bestSelectedStationHit;
  const originalBestScenarioLineHit = bestScenarioLineHit;

  function stationHitOnLine(line, cx, cy, maxPx = 18) {
    if (!line) return null;
    const p = routeClientPoint(cx, cy);
    const limit = maxPx * routeUserUnitsPerPixel();
    let best = null;

    for (let stationIndex = 0; stationIndex < (line.stations || []).length; stationIndex++) {
      const m = muniById[line.stations[stationIndex]];
      if (!m) continue;
      const q = project(m.lon, m.lat);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d <= limit && (!best || d < best.d)) {
        best = {line, stationIndex, m, d, score: d - 1e-7};
      }
    }
    return best;
  }

  function foreignStationUnderPointer(active, cx, cy, maxPx = 18) {
    if (!active) return false;
    const activeStations = new Set((active.stations || []).map(String));
    const p = routeClientPoint(cx, cy);
    const limit = maxPx * routeUserUnitsPerPixel();

    for (const line of state.lines) {
      if (line.id === active.id) continue;
      for (const stationId of (line.stations || [])) {
        if (activeStations.has(String(stationId))) continue;
        const m = muniById[stationId];
        if (!m) continue;
        const q = project(m.lon, m.lat);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= limit) return true;
      }
    }
    return false;
  }

  bestSelectedStationHit = function(cx, cy, maxPx = 18) {
    const active = activeLine();
    if (!active) return originalBestSelectedStationHit(cx, cy, maxPx);

    // While editing, only stations that already belong to the active line are
    // draggable. A foreign station is deliberately left to the normal click
    // handler, which calls addStation() on the still-active line.
    return stationHitOnLine(active, cx, cy, maxPx);
  };

  bestScenarioLineHit = function(cx, cy) {
    const active = activeLine();
    if (!active) return originalBestScenarioLineHit(cx, cy);

    // In station mode a foreign station has semantic priority over nearby
    // geometry: it means "this line also stops here", not "edit that line".
    if (state.tool === 'stations' && foreignStationUnderPointer(active, cx, cy)) {
      return null;
    }

    // No implicit line switching while an edit session is active. Route drag
    // and geometry editing are restricted to the active line until the user
    // presses Edita on another card or stops/finishes editing.
    const row = routeHit(active, cx, cy);
    if (!row) return null;
    return {line: active, ...row, score: row.hit.d - 1e-7};
  };
})();
