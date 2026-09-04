(() => {
  // frontend/src/domain/mobility.js
  var RADI_TERRA_KM = 6371.0088;
  function distanciaKm(a, b) {
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * RADI_TERRA_KM * Math.asin(Math.sqrt(aa));
  }
  function construirCaptacions(municipis, estacions, radiCaptacioKm) {
    const rows = [];
    municipis.forEach((m) => {
      let best = null;
      estacions.forEach((e, idx) => {
        const d = distanciaKm(m, e);
        if (d <= radiCaptacioKm && (!best || d < best.d)) best = { idx, d };
      });
      if (best) rows.push({ m, stationIdx: best.idx, d: best.d });
    });
    return rows;
  }
  function assignacioZones(captacions) {
    const own = /* @__PURE__ */ new Map();
    captacions.forEach((r) => {
      const z = String(r.m.zone || "");
      if (!z) return;
      if (!own.has(z)) own.set(z, /* @__PURE__ */ new Map());
      const x = own.get(z);
      x.set(r.stationIdx, (x.get(r.stationIdx) || 0) + Number(r.m.pob || 0));
    });
    const result = /* @__PURE__ */ new Map();
    let shared = 0;
    own.forEach((stations, z) => {
      if (stations.size > 1) shared++;
      let best = null;
      let bestPop = -1;
      stations.forEach((pop, idx) => {
        if (pop > bestPop) {
          bestPop = pop;
          best = idx;
        }
      });
      result.set(z, best);
    });
    return { result, shared };
  }
  function odEntreEstacions(zoneMap, odPairs) {
    const pairs = /* @__PURE__ */ new Map();
    odPairs.forEach(([za, zb, trips]) => {
      const i = zoneMap.get(String(za));
      const j = zoneMap.get(String(zb));
      if (i === void 0 || j === void 0 || i === j) return;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const k = `${a}|${b}`;
      pairs.set(k, (pairs.get(k) || 0) + Number(trips || 0));
    });
    return pairs;
  }

  // frontend/src/domain/travel-time.js
  function tempsCirculacio({ distanciaKm: distanciaKm2, velocitatComercialKmh }) {
    if (velocitatComercialKmh <= 0) return 0;
    return distanciaKm2 / velocitatComercialKmh * 60;
  }
  function tempsParades({ paradesIntermedies, tempsPerParadaMin }) {
    return Math.max(0, paradesIntermedies) * tempsPerParadaMin;
  }
  function tempsAccesTotal({ tempsAccesMin }) {
    return 2 * tempsAccesMin;
  }
  function penalitzacioHorari({ frequenciaPerHora, factorHorari, maxPenaltyMin = 30 }) {
    const headwayMin = 60 / Math.max(frequenciaPerHora, 0.1);
    return Math.min(maxPenaltyMin, headwayMin * factorHorari);
  }
  function tempsGeneralitzatTren(params) {
    const inVehicleTime = tempsCirculacio(params);
    const dwellTime = tempsParades(params);
    const accessTime = tempsAccesTotal(params);
    const schedulePenalty = penalitzacioHorari(params);
    return {
      inVehicleTime,
      dwellTime,
      accessTime,
      schedulePenalty,
      total: inVehicleTime + dwellTime + accessTime + schedulePenalty
    };
  }

  // frontend/src/domain/car-time.js
  function distanciaPerCarretera({ distanciaRectaKm, factorCarretera }) {
    return distanciaRectaKm * factorCarretera;
  }
  function tempsGeneralitzatCotxe({
    distanciaRectaKm,
    factorCarretera,
    velocitatCotxeKmh,
    penalitzacioFixaMin
  }) {
    const roadDistanceKm = distanciaPerCarretera({ distanciaRectaKm, factorCarretera });
    const carTimeMin = (velocitatCotxeKmh > 0 ? roadDistanceKm / velocitatCotxeKmh : 0) * 60 + penalitzacioFixaMin;
    return { roadDistanceKm, carTimeMin };
  }

  // frontend/src/domain/modal-choice.js
  function probabilitatCanviModal({
    railGeneralizedTimeMin,
    carGeneralizedTimeMin,
    sensibilitat,
    biaix,
    maxDiversion
  }) {
    const delta = railGeneralizedTimeMin - carGeneralizedTimeMin;
    const z = Math.max(-30, Math.min(30, biaix + sensibilitat * delta));
    return maxDiversion / (1 + Math.exp(z));
  }

  // frontend/src/domain/line.js
  function segmentsFromStations(stationIds, previousSegments = []) {
    const previousByKey = new Map(
      previousSegments.map((s) => [`${s.fromStationId}|${s.toStationId}`, s.infrastructureType])
    );
    const segments = [];
    for (let i = 0; i < stationIds.length - 1; i++) {
      const fromStationId = stationIds[i];
      const toStationId = stationIds[i + 1];
      const key = `${fromStationId}|${toStationId}`;
      segments.push({
        fromStationId,
        toStationId,
        // Si no es pot determinar que el tram ja existia, es marca 'new'
        // explícitament (mai s'inventa infraestructura existent).
        infrastructureType: previousByKey.get(key) || "new"
      });
    }
    return segments;
  }
  function setInfrastructureType(segments, fromStationId, toStationId, infrastructureType) {
    return segments.map(
      (s) => s.fromStationId === fromStationId && s.toStationId === toStationId ? { ...s, infrastructureType } : s
    );
  }
  function migrarLineaASegments(lineaAntiga) {
    if (Array.isArray(lineaAntiga.segments) && lineaAntiga.segments.length) {
      return lineaAntiga.segments;
    }
    return segmentsFromStations(lineaAntiga.estacions || []);
  }

  // frontend/src/domain/cost.js
  function costEstimatLinia(segments, { costNouPerKm, costAdaptacioPerKm }) {
    let kmNous = 0;
    let kmExistents = 0;
    let costEstimat = 0;
    segments.forEach((s) => {
      const km = Number(s.longitudKm || 0);
      if (s.infrastructureType === "existing") {
        kmExistents += km;
        costEstimat += km * costAdaptacioPerKm;
      } else {
        kmNous += km;
        costEstimat += km * costNouPerKm;
      }
    });
    return { costEstimat, kmNous, kmExistents };
  }

  // frontend/src/domain/metrics.js
  var OCUPACIO_COTXE = 1.25;
  function calcularMetriquesLinia(linia, municipis, odPairs, parametres2) {
    const muniPerId = Object.fromEntries(municipis.map((m) => [String(m.id), m]));
    const estacions = linia.estacions.map((id) => muniPerId[String(id)]).filter(Boolean);
    const n = estacions.length;
    const segmentsBase = segmentsFromStations(linia.estacions, linia.segments);
    const segDist = [];
    for (let i = 0; i < n - 1; i++) {
      segDist.push(distanciaKm(estacions[i], estacions[i + 1]) * parametres2.intensitatMobilitat);
    }
    const prefix = [0];
    segDist.forEach((d) => prefix.push(prefix[prefix.length - 1] + d));
    const longitudKm = segDist.reduce((a, b) => a + b, 0);
    const segments = segmentsBase.map((s, i) => ({ ...s, longitudKm: segDist[i] || 0 }));
    const { costEstimat, kmNous, kmExistents } = costEstimatLinia(segments, {
      costNouPerKm: parametres2.costPerKm,
      costAdaptacioPerKm: 2
      // cost d'adaptació de via existent, M€/km (ADAPTATION_COST_MKM)
    });
    const tempsTotalViatge = n >= 2 ? tempsGeneralitzatTren({
      distanciaKm: longitudKm,
      velocitatComercialKmh: parametres2.velocitatTren,
      paradesIntermedies: Math.max(0, n - 2),
      tempsPerParadaMin: parametres2.tempsParada,
      tempsAccesMin: 0,
      frequenciaPerHora: parametres2.frequencia,
      factorHorari: 0
    }).inVehicleTime + Math.max(0, n - 2) * parametres2.tempsParada : 0;
    const captacions = construirCaptacions(municipis, estacions, parametres2.radiCaptacio);
    const poblacioDirecta = estacions.reduce((s, m) => s + Number(m.pob || 0), 0);
    const poblacioCaptacio = captacions.reduce((s, r) => s + Number(r.m.pob || 0), 0);
    const zones = assignacioZones(captacions);
    const od = odEntreEstacions(zones.result, odPairs);
    let observed = 0;
    let captured = 0;
    let vehicles = 0;
    let vkm = 0;
    const fluxos = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const obs = Number(od.get(`${i}|${j}`) || 0);
        if (obs <= 0) continue;
        const railKm = prefix[j] - prefix[i];
        const rail = tempsGeneralitzatTren({
          distanciaKm: railKm,
          velocitatComercialKmh: parametres2.velocitatTren,
          paradesIntermedies: Math.max(0, j - i - 1),
          tempsPerParadaMin: parametres2.tempsParada,
          tempsAccesMin: parametres2.tempsAcces,
          frequenciaPerHora: parametres2.frequencia,
          factorHorari: 0.3
          // TIMETABLE_FACTOR
        });
        const { roadDistanceKm, carTimeMin } = tempsGeneralitzatCotxe({
          distanciaRectaKm: distanciaKm(estacions[i], estacions[j]),
          factorCarretera: parametres2.sensibilitatDistancia,
          velocitatCotxeKmh: parametres2.velocitatCotxe,
          penalitzacioFixaMin: 4
          // CAR_FIXED_MIN
        });
        const carPerson = obs * parametres2.fraccioCotxeActual;
        const p = probabilitatCanviModal({
          railGeneralizedTimeMin: rail.total,
          carGeneralizedTimeMin: carTimeMin,
          sensibilitat: parametres2.sensibilitat,
          biaix: parametres2.biaix,
          maxDiversion: 0.65
          // MAX_DIVERSION
        });
        const cap = carPerson * p;
        const veh = cap / OCUPACIO_COTXE;
        observed += obs;
        captured += cap;
        vehicles += veh;
        vkm += veh * roadDistanceKm;
        fluxos.push({ origen: estacions[i], desti: estacions[j], despla\u00E7amentsCapturats: cap, probabilitatTren: p });
      }
    }
    const co2TonesAny = vkm * parametres2.emissioPerKm * parametres2.diesPerAny / 1e3;
    const costPerVehicle = vehicles > 0.5 ? costEstimat * 1e6 / vehicles : null;
    return {
      estacions,
      n,
      longitudKm,
      tempsTotalViatge,
      poblacioDirecta,
      poblacioCaptacio,
      totalOD: observed,
      totalDespla\u00E7amentsCapturats: captured,
      totalCotxesEliminats: vehicles,
      co2TonesAny,
      costEstimat,
      costPerVehicle,
      kmNous,
      kmExistents,
      segments,
      fluxos,
      sharedZones: zones.shared
    };
  }

  // frontend/src/domain/network.js
  function resumXarxa(metriquesPerLinia, linies2) {
    const sum = (key) => metriquesPerLinia.reduce((s, m) => s + Number(m[key] || 0), 0);
    const estacionsUniques = /* @__PURE__ */ new Set();
    linies2.forEach((l) => l.estacions.forEach((id) => estacionsUniques.add(id)));
    return {
      isNetworkAssignment: false,
      etiqueta: "Suma de l\xEDnies (pot contenir solapaments)",
      numLinies: linies2.length,
      kmXarxa: sum("longitudKm"),
      estacionsUniques: estacionsUniques.size,
      totalOD: sum("totalOD"),
      totalCaptats: sum("totalDespla\xE7amentsCapturats"),
      totalVehiclesEvitats: sum("totalCotxesEliminats"),
      totalCo2TonesAny: sum("co2TonesAny"),
      totalCostEstimat: sum("costEstimat")
    };
  }

  // frontend/src/app.js
  var COLORS_LINIA = ["#e63946", "#2a9d8f", "#f4a300", "#8338ec", "#3a86ff", "#06d6a0", "#ff6b35", "#c9184a"];
  var BASE_VB = { x: 0, y: 0, w: 800, h: 660 };
  var MARGE_PROJECCIO = 30;
  var linies = [];
  var comptadorLinies = 0;
  var lineaActivaId = null;
  var mostrarFluxos = true;
  var mostrarComarques = true;
  var layerMode = "procedural";
  var vb = { ...BASE_VB };
  var hoveredId = null;
  var parametres = {
    velocitatTren: 80,
    frequencia: 2,
    velocitatCotxe: 65,
    tempsAcces: 6,
    tempsParada: 1,
    intensitatMobilitat: 1.12,
    sensibilitatDistancia: 1.2,
    sensibilitat: 0.08,
    biaix: 0.8,
    fraccioCotxeActual: 0.75,
    costPerKm: 12,
    emissioPerKm: 0.15,
    diesPerAny: 250,
    radiCaptacio: 8
  };
  var MUNICIPI_PER_ID = Object.fromEntries(MUNICIPIS.map((m) => [String(m.id), m]));
  var svg = parentElement.querySelector("#mapa");
  var hoverBox = parentElement.querySelector("#hover-box");
  var layerSelect = parentElement.querySelector("#layer-select");
  var osmAttribution = parentElement.querySelector("#osm-attribution");
  function byId(id) {
    return parentElement.querySelector(`#${id}`);
  }
  function setLayerHTML(id, html) {
    const el = byId(id);
    if (!el) {
      console.warn(`[Catatrens] Falta #${id}`);
      return false;
    }
    el.innerHTML = html;
    return true;
  }
  function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString("ca-ES");
  }
  function fmt1(n) {
    return (Number(n) || 0).toFixed(1);
  }
  function dataLabel() {
    const days = Array.isArray(META?.days) ? META.days : [];
    if (days.length === 1) return days[0];
    if (days.length > 1) return `${days[0]} \u2192 ${days[days.length - 1]}`;
    return "darrera matriu disponible";
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = "catatrens-state-v9";
  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        linies,
        comptadorLinies,
        lineaActivaId,
        mostrarFluxos,
        mostrarComarques,
        layerMode,
        vb,
        parametres
      }));
    } catch {
    }
  }
  function restoreState() {
    try {
      let s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!s) {
        s = JSON.parse(sessionStorage.getItem("catatrens-state-v8") || "null");
      }
      if (!s) return;
      linies = Array.isArray(s.linies) ? s.linies : linies;
      linies = linies.map((l) => ({ ...l, segments: migrarLineaASegments(l) }));
      comptadorLinies = Number(s.comptadorLinies || 0);
      lineaActivaId = s.lineaActivaId ?? null;
      mostrarFluxos = s.mostrarFluxos ?? true;
      mostrarComarques = s.mostrarComarques ?? true;
      layerMode = s.layerMode || "procedural";
      if (s.vb) vb = s.vb;
      if (s.parametres) Object.assign(parametres, s.parametres);
    } catch {
    }
  }
  restoreState();
  function mercatorNorm(lon, lat) {
    const x = (Number(lon) + 180) / 360;
    const cl = clamp(Number(lat), -85.05112878, 85.05112878);
    const r = cl * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
    return [x, y];
  }
  var geoPts = [];
  MUNICIPIS.forEach((m) => geoPts.push([Number(m.lon), Number(m.lat)]));
  COMARQUES.forEach((c) => {
    const g = c.geom;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([lon, lat]) => geoPts.push([Number(lon), Number(lat)]))));
  });
  var mercPts = geoPts.map(([lon, lat]) => mercatorNorm(lon, lat));
  var minMX = Math.min(...mercPts.map((p) => p[0]));
  var maxMX = Math.max(...mercPts.map((p) => p[0]));
  var minMY = Math.min(...mercPts.map((p) => p[1]));
  var maxMY = Math.max(...mercPts.map((p) => p[1]));
  var scale = Math.min((BASE_VB.w - 2 * MARGE_PROJECCIO) / (maxMX - minMX), (BASE_VB.h - 2 * MARGE_PROJECCIO) / (maxMY - minMY));
  var drawW = (maxMX - minMX) * scale;
  var drawH = (maxMY - minMY) * scale;
  var offsetX = (BASE_VB.w - drawW) / 2;
  var offsetY = (BASE_VB.h - drawH) / 2;
  function projectarPunt(lon, lat) {
    const [mx, my] = mercatorNorm(lon, lat);
    return [offsetX + (mx - minMX) * scale, offsetY + (my - minMY) * scale];
  }
  function unproject(x, y) {
    const mx = minMX + (x - offsetX) / scale, my = minMY + (y - offsetY) / scale;
    const lon = mx * 360 - 180, n = Math.PI - 2 * Math.PI * my;
    return [lon, 180 / Math.PI * Math.atan(Math.sinh(n))];
  }
  MUNICIPIS.forEach((m) => {
    m.id = String(m.id);
    const [x, y] = projectarPunt(m.lon, m.lat);
    m.x = x;
    m.y = y;
  });
  COMARQUES.forEach((c) => {
    const cv = (ring) => ring.map(([lon, lat]) => projectarPunt(lon, lat));
    c.anellsProjectats = c.geom.type === "Polygon" ? [c.geom.coordinates.map(cv)] : c.geom.coordinates.map((poly) => poly.map(cv));
  });
  function metriquesLinia(l) {
    return calcularMetriquesLinia(l, MUNICIPIS, OD_PAIRS, parametres);
  }
  function seleccionarMunicipi(id) {
    id = String(id);
    if (lineaActivaId === null) {
      comptadorLinies++;
      const nova = { id: "linia-" + comptadorLinies, nom: "L\xEDnia " + comptadorLinies, color: COLORS_LINIA[(comptadorLinies - 1) % COLORS_LINIA.length], estacions: [id], segments: [] };
      linies.push(nova);
      lineaActivaId = nova.id;
    } else {
      const l = linies.find((x) => x.id === lineaActivaId);
      if (!l) {
        lineaActivaId = null;
        return;
      }
      if (l.estacions.includes(id)) return;
      l.estacions.push(id);
      l.segments = segmentsFromStations(l.estacions, l.segments);
    }
    saveState();
    render();
  }
  function aturarEdicio() {
    lineaActivaId = null;
    saveState();
    render();
  }
  function desferUltimaEstacio() {
    if (lineaActivaId === null) return;
    const l = linies.find((x) => x.id === lineaActivaId);
    if (!l) return;
    l.estacions.pop();
    if (!l.estacions.length) {
      linies = linies.filter((x) => x.id !== l.id);
      lineaActivaId = null;
    } else l.segments = segmentsFromStations(l.estacions, l.segments);
    saveState();
    render();
  }
  function esborrarLinia(id) {
    linies = linies.filter((l) => l.id !== id);
    if (lineaActivaId === id) lineaActivaId = null;
    saveState();
    render();
  }
  function editarLinia(id) {
    lineaActivaId = id;
    saveState();
    render();
  }
  function renombrarLinia(id, nom) {
    const l = linies.find((x) => x.id === id);
    if (l) {
      l.nom = nom || l.nom;
      saveState();
      render();
    }
  }
  function canviarInfraestructuraTram(lineaId, fromId, toId, tipus) {
    const l = linies.find((x) => x.id === lineaId);
    if (!l) return;
    l.segments = setInfrastructureType(l.segments || [], fromId, toId, tipus);
    saveState();
    render();
  }
  function zoomFactor() {
    return BASE_VB.w / vb.w;
  }
  function actualitzaViewBox() {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    renderMapa();
  }
  function puntSvg(cx, cy) {
    const r = svg.getBoundingClientRect();
    return [vb.x + (cx - r.left) / r.width * vb.w, vb.y + (cy - r.top) / r.height * vb.h];
  }
  function zoom(factor, cx, cy) {
    const [px, py] = puntSvg(cx, cy), nw = clamp(vb.w * factor, BASE_VB.w / 16, BASE_VB.w * 2.5), nh = nw * (BASE_VB.h / BASE_VB.w);
    vb.x = px - (px - vb.x) * (nw / vb.w);
    vb.y = py - (py - vb.y) * (nh / vb.h);
    vb.w = nw;
    vb.h = nh;
    saveState();
    actualitzaViewBox();
  }
  function screenPos(m) {
    const p = svg.createSVGPoint();
    p.x = m.x;
    p.y = m.y;
    const c = svg.getScreenCTM();
    if (!c) return null;
    const s = p.matrixTransform(c);
    return { x: s.x, y: s.y };
  }
  function nearestInPixels(cx, cy, maxPx = 26) {
    let best = null, bd = maxPx * maxPx;
    MUNICIPIS.forEach((m) => {
      const s = screenPos(m);
      if (!s) return;
      const dx = s.x - cx, dy = s.y - cy, d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = m;
      }
    });
    return best;
  }
  var dragging = false;
  var dragMoved = false;
  var start = null;
  var vbStart = null;
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });
  svg.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY };
    vbStart = { ...vb };
    dragging = true;
    dragMoved = false;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (dragging) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) dragMoved = true;
      if (dragMoved) {
        const r = svg.getBoundingClientRect();
        vb.x = vbStart.x - dx / r.width * vbStart.w;
        vb.y = vbStart.y - dy / r.height * vbStart.h;
        actualitzaViewBox();
      }
      return;
    }
    const m = nearestInPixels(e.clientX, e.clientY, 28), id = m?.id || null;
    if (id !== hoveredId) {
      hoveredId = id;
      if (m) {
        hoverBox.style.display = "block";
        hoverBox.textContent = `${m.nom} \xB7 ${fmt(m.pob)} hab. \xB7 ${m.com}`;
      } else hoverBox.style.display = "none";
      renderHover();
    }
  });
  svg.addEventListener("pointerup", (e) => {
    const moved = dragMoved;
    dragging = false;
    dragMoved = false;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {
    }
    if (!moved) {
      const m = nearestInPixels(e.clientX, e.clientY, 28);
      if (m) seleccionarMunicipi(m.id);
    } else saveState();
  });
  svg.addEventListener("pointercancel", () => {
    dragging = false;
    dragMoved = false;
  });
  svg.addEventListener("mouseleave", () => {
    if (!dragging) {
      hoveredId = null;
      hoverBox.style.display = "none";
      renderHover();
    }
  });
  byId("btn-zoom-in").onclick = () => {
    const r = svg.getBoundingClientRect();
    zoom(1 / 1.4, r.left + r.width / 2, r.top + r.height / 2);
  };
  byId("btn-zoom-out").onclick = () => {
    const r = svg.getBoundingClientRect();
    zoom(1.4, r.left + r.width / 2, r.top + r.height / 2);
  };
  byId("btn-zoom-reset").onclick = () => {
    vb = { ...BASE_VB };
    saveState();
    actualitzaViewBox();
  };
  byId("cerca-input").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLocaleLowerCase("ca");
    if (q.length < 2) return;
    const m = MUNICIPIS.find((x) => x.nom.toLocaleLowerCase("ca").startsWith(q));
    if (m) {
      vb.w = 90;
      vb.h = 90 * (BASE_VB.h / BASE_VB.w);
      vb.x = m.x - vb.w / 2;
      vb.y = m.y - vb.h / 2;
      saveState();
      actualitzaViewBox();
    }
  });
  function renderComarques() {
    const capa = byId("capa-comarques");
    if (!capa) {
      console.warn("[Catatrens] Falta #capa-comarques");
      return;
    }
    if (!mostrarComarques) {
      capa.innerHTML = "";
      return;
    }
    let s = "";
    COMARQUES.forEach((c) => c.anellsProjectats.forEach((poly) => {
      const d = poly.map((r) => "M " + r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ") + " Z").join(" ");
      s += `<path class="comarca-poligon"
  d="${d}"
  fill="rgba(173,216,230,0.025)"
  stroke="rgba(173,216,230,0.34)"
  stroke-width="1.1"
  vector-effect="non-scaling-stroke"
  pointer-events="none"><title>${esc(c.nom)}</title></path>`;
    }));
    capa.innerHTML = s;
  }
  function renderHover() {
    const capa = byId("capa-hover");
    if (!capa) {
      console.warn("[Catatrens] Falta #capa-hover");
      return;
    }
    const m = hoveredId ? MUNICIPI_PER_ID[hoveredId] : null;
    if (!m) {
      capa.innerHTML = "";
      return;
    }
    const r = 11 / Math.max(zoomFactor(), 0.01);
    capa.innerHTML = `<circle class="hover-ring" cx="${m.x}" cy="${m.y}" r="${r}"/>`;
  }
  function lonLatToTile(lon, lat, z) {
    const n = 2 ** z, r = lat * Math.PI / 180;
    return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
  }
  function tileToLonLat(x, y, z) {
    const n = 2 ** z, lon = x / n * 360 - 180, a = Math.PI - 2 * Math.PI * y / n;
    return [lon, 180 / Math.PI * Math.atan(Math.sinh(a))];
  }
  function renderOSM() {
    const capa = byId("capa-osm"), grid = byId("grid-bg"), bg = byId("map-bg");
    if (!capa || !grid || !bg) {
      console.warn("[Catatrens] Capes OSM incompletes");
      return;
    }
    if (layerMode !== "osm") {
      capa.innerHTML = "";
      grid.style.display = "";
      bg.setAttribute("fill", "#0d2a4a");
      bg.style.fill = "#0d2a4a";
      osmAttribution.style.display = "none";
      return;
    }
    grid.style.display = "none";
    bg.setAttribute("fill", "#e9eef1");
    osmAttribution.style.display = "block";
    const [lo1, la1] = unproject(vb.x, vb.y), [lo2, la2] = unproject(vb.x + vb.w, vb.y + vb.h);
    const west = Math.min(lo1, lo2), east = Math.max(lo1, lo2), south = Math.min(la1, la2), north = Math.max(la1, la2);
    const z = clamp(Math.round(7 + Math.log2(Math.max(1, zoomFactor()))), 6, 15);
    let [tx0, ty0] = lonLatToTile(west, north, z), [tx1, ty1] = lonLatToTile(east, south, z);
    const n = 2 ** z;
    const minX = clamp(Math.floor(tx0) - 1, 0, n - 1), maxX = clamp(Math.floor(tx1) + 1, 0, n - 1), minY = clamp(Math.floor(ty0) - 1, 0, n - 1), maxY = clamp(Math.floor(ty1) + 1, 0, n - 1);
    let s = "", count = 0;
    for (let x = minX; x <= maxX && count < 90; x++) for (let y = minY; y <= maxY && count < 90; y++) {
      count++;
      const [a, b] = tileToLonLat(x, y, z), [c, d] = tileToLonLat(x + 1, y + 1, z), [x1, y1] = projectarPunt(a, b), [x2, y2] = projectarPunt(c, d);
      s += `<image href="https://tile.openstreetmap.org/${z}/${x}/${y}.png" x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" preserveAspectRatio="none"/>`;
    }
    capa.innerHTML = s;
  }
  function labelThreshold() {
    const z = zoomFactor();
    if (z >= 12) return 0;
    if (z >= 9) return 250;
    if (z >= 7) return 700;
    if (z >= 5) return 1800;
    if (z >= 3.5) return 4500;
    if (z >= 2.4) return 1e4;
    if (z >= 1.6) return 22e3;
    return 5e4;
  }
  function overlap(a, b, p = 3) {
    return !(a.x2 + p < b.x1 || a.x1 - p > b.x2 || a.y2 + p < b.y1 || a.y1 - p > b.y2);
  }
  function chooseLabels(stations) {
    const z = zoomFactor(), thr = labelThreshold(), font = z >= 4 ? 10.5 : 10, cands = MUNICIPIS.filter((m) => stations.has(m.id) || m.pob >= thr).sort((a, b) => (stations.has(b.id) ? 1 : 0) - (stations.has(a.id) ? 1 : 0) || b.pob - a.pob), boxes = [], out = [];
    for (const m of cands) {
      const sx = (m.x - vb.x) / vb.w * BASE_VB.w, sy = (m.y - vb.y) / vb.h * BASE_VB.h;
      if (sx < -100 || sx > 900 || sy < -30 || sy > 690) continue;
      const st = stations.has(m.id), dx = st ? 11 : 7, w = Math.max(25, m.nom.length * font * 0.6), h = font * 1.3, box = { x1: sx + dx, y1: sy - h * 0.75, x2: sx + dx + w, y2: sy + h * 0.35 };
      if (!st && boxes.some((b) => overlap(box, b, 4))) continue;
      out.push({ m, st, font, dx });
      boxes.push(box);
      const max = z >= 10 ? 220 : z >= 7 ? 150 : z >= 5 ? 100 : z >= 3 ? 65 : z >= 2 ? 42 : 28;
      if (out.length >= max) break;
    }
    return out;
  }
  function renderMapa() {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    renderOSM();
    renderComarques();
    const metrics = linies.map((l) => ({ linia: l, m: metriquesLinia(l) })), z = zoomFactor(), inv = 1 / Math.max(z, 0.01);
    let flux = "";
    if (mostrarFluxos) metrics.forEach(({ linia, m }) => m.fluxos.forEach((f) => {
      if (f.despla\u00E7amentsCapturats < 5) return;
      const w = Math.max(0.6, Math.min(7, Math.log10(f.despla\u00E7amentsCapturats + 1) * 2.6)) / Math.max(1, Math.sqrt(z));
      flux += `<line class="flux-linia" x1="${f.origen.x}" y1="${f.origen.y}" x2="${f.desti.x}" y2="${f.desti.y}" stroke="${linia.color}" stroke-width="${w.toFixed(2)}" opacity=".42"/>`;
    }));
    setLayerHTML("capa-fluxos", flux);
    let lines = "";
    linies.forEach((l) => {
      const pts2 = l.estacions.map((id) => MUNICIPI_PER_ID[id]).filter(Boolean);
      if (pts2.length >= 2) {
        const d = "M " + pts2.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L "), w = (l.id === lineaActivaId ? 5 : 4) / Math.max(1, Math.sqrt(z));
        lines += `<path class="linia-tra\xE7a" d="${d}" stroke="${l.color}" stroke-width="${w}"/>`;
        for (let k = 0; k < pts2.length - 1; k++) {
          const dist = distanciaKm(pts2[k], pts2[k + 1]) * parametres.intensitatMobilitat, min = dist / parametres.velocitatTren * 60, mx = (pts2[k].x + pts2[k + 1].x) / 2, my = (pts2[k].y + pts2[k + 1].y) / 2;
          lines += `<g transform="translate(${mx} ${my}) scale(${inv})"><text class="etiqueta-tram" text-anchor="middle" y="-5">${dist.toFixed(1)} km \xB7 ${Math.max(1, Math.round(min))} min</text></g>`;
        }
      }
    });
    setLayerHTML("capa-linies", lines);
    const stationIds = /* @__PURE__ */ new Set(), owners = /* @__PURE__ */ new Map();
    linies.forEach((l) => l.estacions.forEach((id) => {
      stationIds.add(id);
      if (!owners.has(id)) owners.set(id, l);
    }));
    let pts = "";
    MUNICIPIS.forEach((m) => {
      if (stationIds.has(m.id)) {
        const o = owners.get(m.id);
        pts += `<g transform="translate(${m.x} ${m.y}) scale(${inv})"><circle class="estacio-punt" r="6" stroke="${o.color}" stroke-width="2.5"/></g>`;
      } else {
        const r = Math.max(1.3, Math.min(13, Math.sqrt(Math.max(m.pob, 1)) / 110 + 1.3));
        pts += `<circle class="municipi-punt" cx="${m.x}" cy="${m.y}" r="${r}" fill="rgba(220,232,244,0.55)"/>`;
      }
    });
    chooseLabels(stationIds).forEach(({ m, st, font, dx }) => {
      pts += `<g transform="translate(${m.x + dx / z} ${m.y + 3.5 / z}) scale(${inv})"><text class="etiqueta ${st ? "etiqueta-estacio" : ""}" font-size="${font}px">${esc(m.nom)}</text></g>`;
    });
    const active = linies.find((l) => l.id === lineaActivaId);
    if (active?.estacions?.length) {
      const last = MUNICIPI_PER_ID[active.estacions.at(-1)];
      pts += `<g transform="translate(${last.x} ${last.y}) scale(${inv})"><circle class="badge-actiu" r="12"/></g>`;
    }
    setLayerHTML("capa-municipis", pts);
    renderHover();
  }
  function renderLlistaLinies() {
    const box = byId("llista-linies");
    if (!linies.length) {
      box.innerHTML = '<p class="buida">Encara no has dibuixat cap l\xEDnia. Clica un municipi al mapa per comen\xE7ar-ne una.</p>';
      return;
    }
    box.innerHTML = linies.map((l) => {
      const m = metriquesLinia(l);
      const activa = l.id === lineaActivaId;
      const nomsEstacions = m.estacions.map((e) => e.nom).join(" \u2192 ");
      const nomPerId = (id) => MUNICIPI_PER_ID[id]?.nom || id;
      const tramsHtml = (m.segments || []).map((s) => {
        const label = s.infrastructureType === "existing" ? "Exist." : s.infrastructureType === "upgrade" ? "Millora" : "Nou";
        return `<div class="tram-item">
        <span class="tram-label tram-${esc(s.infrastructureType)}">${label}</span>
        <span class="tram-route">${esc(nomPerId(s.fromStationId))} \u2192 ${esc(nomPerId(s.toStationId))}</span>
        <span class="tram-km">${fmt1(s.longitudKm)} km</span>
        <select data-role="tram-tipus" data-linia="${l.id}" data-from="${s.fromStationId}" data-to="${s.toStationId}">
          <option value="new" ${s.infrastructureType === "new" ? "selected" : ""}>Nou</option>
          <option value="existing" ${s.infrastructureType === "existing" ? "selected" : ""}>Existent</option>
          <option value="upgrade" ${s.infrastructureType === "upgrade" ? "selected" : ""}>Millora</option>
        </select>
      </div>`;
      }).join("");
      return `
      <div class="linia-item ${activa ? "actiu" : ""}" style="border-left-color:${l.color}">
        <div class="linia-cap\xE7alera">
          <input type="text" data-role="rename" data-id="${l.id}" value="${esc(l.nom)}">
          <div class="mini-botons">
            <button class="secundari" data-action="edit" data-id="${l.id}">
              ${activa ? "Editant" : "Edita"}
            </button>
            <button class="perillos" data-action="delete" data-id="${l.id}">Esborra</button>
          </div>
        </div>

        <div class="linia-source">
          <span class="source-badge">MITMS OD</span>
          <span>${esc(dataLabel())}</span>
        </div>

        <div class="linia-route">${esc(nomsEstacions || "Primera estaci\xF3 seleccionada")}</div>

        <div class="linia-metrics">
          <div>Estacions: <b>${m.n}</b></div>
          <div>Longitud: <b>${fmt1(m.longitudKm)} km</b></div>

          <div>Temps cap a cap: <b>${fmt(m.tempsTotalViatge)} min</b></div>
          <div>Pobl. directa: <b>${fmt(m.poblacioDirecta)} hab.</b></div>

          <div>Pobl. influ\xE8ncia: <b>${fmt(m.poblacioCaptacio)} hab.</b></div>
          <div class="metric-observed">OD observat/dia: <b>${fmt(m.totalOD)}</b></div>

          <div>Captats pel tren/dia: <b>${fmt(m.totalDespla\u00E7amentsCapturats)}</b></div>
          <div>Vehicles evitats/dia: <b>${fmt(m.totalCotxesEliminats)}</b></div>

          <div>CO\u2082 estalviat: <b>${fmt(m.co2TonesAny)} t/any</b></div>
          <div>Cost estimat: <b>${fmt(m.costEstimat)} M\u20AC</b></div>
        </div>

        <details class="trams-detall">
          <summary>Trams (${m.segments.length}) \xB7 ${fmt1(m.kmNous)} km nous \xB7 ${fmt1(m.kmExistents)} km existents</summary>
          <div class="trams-llista">${tramsHtml || '<p class="buida">Cap tram encara.</p>'}</div>
        </details>

        <p class="linia-method">
          <b>OD observat/dia</b> prov\xE9 de la matriu origen\u2013destinaci\xF3 del MITMS.
          <b>Captats pel tren</b>, <b>vehicles evitats</b> i <b>CO\u2082</b> s\xF3n resultats
          del model modal aplicat sobre aquesta demanda observada; no s'estimen
          els viatges a partir de la poblaci\xF3.
        </p>

        ${m.sharedZones ? `<p class="linia-warning">${m.sharedZones} zones MITMS agregades toquen m\xE9s d'una estaci\xF3; s'assignen a l'estaci\xF3 que concentra m\xE9s poblaci\xF3 dins l'\xE0rea de captaci\xF3.</p>` : ""}
      </div>`;
    }).join("");
    box.querySelectorAll('[data-action="edit"]').forEach((b) => b.onclick = () => editarLinia(b.dataset.id));
    box.querySelectorAll('[data-action="delete"]').forEach((b) => b.onclick = () => esborrarLinia(b.dataset.id));
    box.querySelectorAll('[data-role="rename"]').forEach((i) => i.onchange = () => renombrarLinia(i.dataset.id, i.value));
    box.querySelectorAll('[data-role="tram-tipus"]').forEach((sel) => sel.onchange = () => {
      canviarInfraestructuraTram(sel.dataset.linia, sel.dataset.from, sel.dataset.to, sel.value);
    });
  }
  function renderResumGlobal() {
    const box = byId("resum-global");
    const titol = byId("resum-global-titol");
    if (!linies.length) {
      box.innerHTML = '<p class="buida" style="grid-column:1/3">Dibuixa alguna l\xEDnia per veure-hi el resum.</p>';
      return;
    }
    const ms = linies.map(metriquesLinia);
    const resum = resumXarxa(ms, linies);
    if (titol) titol.textContent = resum.etiqueta;
    const items = [
      ["L\xEDnies dibuixades", resum.numLinies],
      ["Km de xarxa", fmt1(resum.kmXarxa)],
      ["Estacions \xFAniques", resum.estacionsUniques],
      ["Suma OD observat/dia", fmt(resum.totalOD)],
      ["Captats pel tren/dia", fmt(resum.totalCaptats)],
      ["Vehicles evitats/dia", fmt(resum.totalVehiclesEvitats)],
      ["CO\u2082 estalviat (t/any)", fmt(resum.totalCo2TonesAny)],
      ["Cost estimat (M\u20AC)", fmt(resum.totalCostEstimat)]
    ];
    box.innerHTML = items.map(([l, n]) => `<div class="resum-item"><span class="num">${n}</span><span class="lbl">${l}</span></div>`).join("");
    if (!resum.isNetworkAssignment) {
      box.innerHTML += `<p class="linia-warning" style="grid-column:1/3">Aquesta xifra pot duplicar OD si dues l\xEDnies capten el mateix trajecte: encara no hi ha assignaci\xF3 de xarxa completa.</p>`;
    }
  }
  function render() {
    renderMapa();
    renderLlistaLinies();
    renderResumGlobal();
  }
  var defs = [["velocitatTren", "v-velocitatTren", (v) => v + " km/h"], ["frequencia", "v-frequencia", (v) => v + " trens/h"], ["velocitatCotxe", "v-velocitatCotxe", (v) => v + " km/h"], ["tempsAcces", "v-tempsAcces", (v) => v + " min"], ["tempsParada", "v-tempsParada", (v) => v + " min"], ["intensitatMobilitat", "v-intensitatMobilitat", (v) => "x" + v], ["sensibilitatDistancia", "v-sensibilitatDistancia", (v) => "x" + v], ["sensibilitat", "v-sensibilitat", (v) => v], ["biaix", "v-biaix", (v) => v], ["fraccioCotxeActual", "v-fraccioCotxeActual", (v) => Math.round(v * 100) + "%"], ["costPerKm", "v-costPerKm", (v) => v + " M\u20AC"], ["emissioPerKm", "v-emissioPerKm", (v) => v + " kg/km"], ["radiCaptacio", "v-radiCaptacio", (v) => v + " km"]];
  defs.forEach(([k, label, format]) => {
    const input = byId("s-" + k), out = byId(label);
    if (!input || !out) {
      console.warn("[Catatrens] Control no trobat:", k, "input=", !!input, "label=", !!out);
      return;
    }
    input.value = parametres[k];
    const upd = () => {
      parametres[k] = parseFloat(input.value);
      out.textContent = format(input.value);
      saveState();
      render();
    };
    input.addEventListener("input", upd);
    out.textContent = format(input.value);
  });
  var chkFluxos = byId("chk-fluxos");
  var chkComarques = byId("chk-comarques");
  if (chkFluxos) {
    chkFluxos.checked = mostrarFluxos;
    chkFluxos.onchange = (e) => {
      mostrarFluxos = e.target.checked;
      saveState();
      renderMapa();
    };
  }
  if (chkComarques) {
    chkComarques.checked = mostrarComarques;
    chkComarques.onchange = (e) => {
      mostrarComarques = e.target.checked;
      saveState();
      renderMapa();
    };
  }
  var btnStop = byId("btn-atura-edicio");
  var btnUndo = byId("btn-desfes");
  var btnReset = byId("btn-reset");
  if (btnStop) btnStop.onclick = aturarEdicio;
  if (btnUndo) btnUndo.onclick = desferUltimaEstacio;
  if (btnReset) btnReset.onclick = () => {
    linies = [];
    lineaActivaId = null;
    comptadorLinies = 0;
    saveState();
    render();
  };
  if (layerSelect) {
    layerSelect.value = layerMode;
    layerSelect.onchange = (e) => {
      layerMode = e.target.value;
      saveState();
      renderMapa();
    };
  }
  render();
})();
