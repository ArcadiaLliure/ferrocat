/* Ajuda contextual dels camps de paràmetres de Ferrocat.
 * S'injecta després del motor principal i no provoca reruns de Streamlit.
 */
const FERROCAT_FIELD_HELP = Object.freeze({
  's-velocitatTren': {
    title: 'Velocitat tren',
    text: "Velocitat mitjana de circulació entre estacions, en km/h. El temps de parada a les estacions intermèdies s'afegeix a part. Afecta el temps de viatge del tren i, per tant, la captació modal estimada."
  },
  's-frequencia': {
    title: 'Freqüència',
    text: "Nombre de trens per hora. Ferrocat en deriva l'interval mitjà entre trens (60/freqüència) i aplica un cost d'espera de referència del 30% d'aquest interval al temps generalitzat del tren."
  },
  's-velocitatCotxe': {
    title: 'Velocitat cotxe',
    text: "Velocitat mitjana assumida per al trajecte en cotxe, en km/h. S'utilitza per estimar el temps del cotxe quan no hi ha un temps viari observat o un routing més precís."
  },
  's-tempsAcces': {
    title: 'Accés estació',
    text: "Minuts d'accés o egrés associats a cada extrem del viatge ferroviari. El model els aplica tant a l'origen com a la destinació; per exemple, 6 min equivalen a 12 min totals afegits al viatge."
  },
  's-tempsParada': {
    title: 'Parada intermèdia',
    text: "Temps, en minuts, que s'afegeix per cada estació intermèdia entre origen i destinació. No s'aplica a les dues estacions extremes del trajecte."
  },
  's-intensitatMobilitat': {
    title: 'Factor traça fallback',
    text: "Factor que estima la longitud ferroviària quan encara no existeix una geometria real o dibuixada. Amb 1,12×, 50 km en línia directa es converteixen en 56 km estimats de via. Quan hi ha traçat real, aquest factor no hauria d'intervenir."
  },
  's-sensibilitatDistancia': {
    title: 'Factor carretera',
    text: "Factor que transforma la distància directa en una distància viària aproximada quan no hi ha routing real. Amb 1,20×, 50 km directes es consideren 60 km per carretera. També afecta els vehicle-km i el CO₂ evitats."
  },
  's-sensibilitat': {
    title: 'Beta logit',
    text: "Sensibilitat del model modal a la diferència de temps entre tren i cotxe. En P = 0,65 / (1 + exp(biaix + beta·(Ttren − Tcotxe))), una beta més alta fa que petites diferències de temps canviïn més fortament la probabilitat de passar del cotxe al tren."
  },
  's-biaix': {
    title: 'Biaix cotxe',
    text: "Preferència estructural pel cotxe dins del model logit, independent de la diferència de temps. Un valor més alt penalitza el tren i exigeix que sigui més competitiu per captar els mateixos viatges."
  },
  's-fraccioCotxeActual': {
    title: 'Quota cotxe',
    text: "Percentatge dels viatges OD observats pel MITMS que s'assumeix que actualment es fan en cotxe. El model de canvi modal s'aplica sobre aquesta fracció, no sobre tota la demanda observada."
  },
  's-radiCaptacio': {
    title: 'Radi captació',
    text: "Radi, en km, utilitzat per decidir quins municipis i zones MITMS queden servits per una estació. Si un municipi entra al radi de diverses estacions, s'assigna a la més propera; una zona MITMS s'assigna una sola vegada per evitar doble recompte."
  },
  's-costPerKm': {
    title: 'Via nova',
    text: "Cost base de prefactibilitat, en milions d'euros per km, per a una nova plataforma ferroviària en superfície. Els túnels, viaductes i estacions es valoren amb paràmetres separats; no és un pressupost constructiu."
  },
  's-tunnelCost': {
    title: 'Túnel',
    text: "Cost estimat, en milions d'euros per km, dels trams que el motor topogràfic classifica com a túnel. S'aplica quan no es troba una alternativa superficial raonable dins del corredor de cerca o quan el perfil vertical ho requereix."
  },
  's-viaductCost': {
    title: 'Viaducte',
    text: "Cost estimat, en milions d'euros per km, dels trams que necessiten mantenir la rasante ferroviària significativament per sobre del terreny. És una aproximació de prefactibilitat, no un càlcul estructural."
  },
  's-stationCost': {
    title: 'Estació nova',
    text: "Cost estimat, en milions d'euros, per cada parada proposta que requereix construir una estació nova. El cost és zero quan Ferrocat detecta que es pot reutilitzar una estació ferroviària activa compatible."
  },
  's-stationReuseRadius': {
    title: 'Radi reutilització estació',
    text: "Distància màxima ordinària, en km, per considerar que una parada proposada pot reutilitzar una estació activa de Renfe o FGC. El matching també pot considerar coincidències de nom properes per evitar duplicar estacions reals."
  },
  's-maxGradient': {
    title: 'Pendent excepcional',
    text: "Pendent màxima admissible que el motor de prefactibilitat permet al perfil ferroviari, expressada en ‰ (per mil), no en %. Si una solució superficial la supera, Ferrocat ha d'intentar una alternativa per vall o proposar obres singulars com túnels."
  },
  's-emissioPerKm': {
    title: 'Emissions cotxe',
    text: "Factor d'emissió del cotxe, en kg de CO₂ per vehicle-km, utilitzat per convertir els vehicle-km evitats en estalvi anual de CO₂. És un paràmetre de model i es pot ajustar segons l'escenari de flota."
  }
});

(function installFerrocatFieldHelp() {
  const doc = parentElement.ownerDocument;

  if (!parentElement.querySelector('#ferrocat-field-help-style')) {
    const style = doc.createElement('style');
    style.id = 'ferrocat-field-help-style';
    style.textContent = `
      .field-help-head{display:flex;align-items:center;gap:5px;min-height:18px}
      .fila-slider .field-help-label{display:inline!important;justify-content:initial!important;font-size:11.5px;line-height:1.25;cursor:pointer}
      .field-help-head .valor{margin-left:auto;white-space:nowrap}
      button.field-help-toggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;min-width:16px;padding:0;margin:0;border:1px solid #8c94a3;border-radius:50%;background:#fffdf8;color:#626b7c;font:700 10px/1 'IBM Plex Mono',monospace;cursor:pointer;box-shadow:none;opacity:1}
      button.field-help-toggle:hover,button.field-help-toggle:focus-visible,button.field-help-toggle[aria-expanded="true"]{opacity:1;background:#eef1f5;color:#1c2333;border-color:#5b6478;outline:none}
      button.field-help-toggle:focus-visible{box-shadow:0 0 0 2px rgba(255,107,53,.28)}
      .field-help-text{margin:4px 0 5px;padding:6px 7px;border:1px solid #d9d2c0;border-left:3px solid #8e98aa;border-radius:2px;background:#f7f4ea;color:#4d5668;font:10px/1.45 Inter,sans-serif}
      .field-help-text[hidden]{display:none!important}
    `;
    parentElement.prepend(style);
  }

  const closeAll = exceptId => {
    parentElement.querySelectorAll('.field-help-text').forEach(panel => {
      if (panel.id === exceptId) return;
      panel.hidden = true;
      const button = parentElement.querySelector(`[aria-controls="${panel.id}"]`);
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  };

  for (const [inputId, spec] of Object.entries(FERROCAT_FIELD_HELP)) {
    const input = byId(inputId);
    const row = input?.closest('.fila-slider');
    if (!input || !row || row.dataset.helpReady === '1') continue;

    const oldLabel = row.querySelector('label');
    const value = oldLabel?.querySelector('.valor');
    if (!oldLabel || !value) continue;

    const head = doc.createElement('div');
    head.className = 'field-help-head';

    const parent = oldLabel.parentNode;
    parent.insertBefore(head, oldLabel);

    oldLabel.removeChild(value);
    oldLabel.textContent = spec.title;
    oldLabel.className = 'field-help-label';
    oldLabel.setAttribute('for', inputId);

    const panelId = `help-${inputId}`;
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'field-help-toggle';
    toggle.textContent = '?';
    toggle.setAttribute('aria-label', `Què és «${spec.title}»?`);
    toggle.setAttribute('aria-controls', panelId);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = `Què és «${spec.title}»?`;

    const panel = doc.createElement('div');
    panel.id = panelId;
    panel.className = 'field-help-text';
    panel.hidden = true;
    panel.textContent = spec.text;

    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = panel.hidden;
      closeAll(willOpen ? panelId : null);
      panel.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
    });

    head.append(oldLabel, toggle, value);
    head.insertAdjacentElement('afterend', panel);
    row.dataset.helpReady = '1';
  }

  parentElement.addEventListener('click', event => {
    if (event.target.closest('.field-help-toggle') || event.target.closest('.field-help-text')) return;
    closeAll(null);
  });

  parentElement.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeAll(null);
    const focused = parentElement.querySelector('.field-help-toggle:focus');
    if (focused) focused.blur();
  });
})();

/* -------------------------------------------------------------------------
 * Correcció del motor de traçat topogràfic.
 *
 * El motor original del navegador feia un A* només per cel·la i després
 * dibuixava directament els centres del DEM de 500 m. Això permetia ziga-zagues
 * de 45/90 graus, podia saltar-se estacions intermèdies i, des de 1.4, tenia un
 * corredor de cerca de ±25 km. Aquest bloc substitueix únicament el routing
 * interactiu mantenint el mateix model de túnels, viaductes i perfil vertical.
 * ------------------------------------------------------------------------- */
(function installStableTerrainRouting() {
  const ROUTE_CORRIDOR_M = Math.min(Number(SEARCH_CORRIDOR_M) || 10000, 10000);
  const MAX_ITERS_PER_LEG = 180000;
  const DIRS = [
    [1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]
  ];

  function sourceCoords(line) {
    if (line?.alignment?.length > 1) {
      return line.alignment
        .filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
        .map(p => [+p[0], +p[1]]);
    }
    return (line?.stations || [])
      .map(id => muniById[id])
      .filter(Boolean)
      .map(m => [+m.lon, +m.lat]);
  }

  function stateKey(x, y, dir, width) {
    return `${y * width + x}:${dir}`;
  }

  function stateCell(key, width) {
    const idx = Number(String(key).split(':', 1)[0]);
    return [idx % width, Math.floor(idx / width)];
  }

  function turnSteps(a, b) {
    if (a < 0 || b < 0) return 0;
    const d = Math.abs(a - b);
    return Math.min(d, 8 - d);
  }

  function headingPenalty(prevDir, nextDir, resolution) {
    const turn = turnSteps(prevDir, nextDir);
    if (turn === 0) return 0;
    if (turn === 4) return Infinity;
    if (turn === 1) return 0.60 * resolution;
    if (turn === 2) return 2.00 * resolution;
    return 5.00 * resolution;
  }

  function routeLeg(start, goal, guide, allowTunnel) {
    if (!start || !goal) return null;
    if (start[0] === goal[0] && start[1] === goal[1]) return [[...start]];

    const res = +TERRAIN_COARSE.resolution_m;
    const width = +TERRAIN_COARSE.width;
    const height = +TERRAIN_COARSE.height;
    const corridor = Math.max(4, Math.round(ROUTE_CORRIDOR_M / res));
    const heap = new Heap();
    const best = new Map();
    const parent = new Map();
    const startKey = stateKey(start[0], start[1], -1, width);

    best.set(startKey, 0);
    heap.push([Math.hypot(goal[0]-start[0], goal[1]-start[1]) * res, 0, start[0], start[1], -1]);

    let foundKey = null;
    let iterations = 0;

    while (heap.length && iterations++ < MAX_ITERS_PER_LEG) {
      const current = heap.pop();
      const g = current[1];
      const x = current[2];
      const y = current[3];
      const prevDir = current[4];
      const key = stateKey(x, y, prevDir, width);
      if (g !== best.get(key)) continue;

      if (x === goal[0] && y === goal[1]) {
        foundKey = key;
        break;
      }

      const z = elev([x, y]);
      if (z === null) continue;

      for (let dir = 0; dir < DIRS.length; dir++) {
        const [dx, dy] = DIRS[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (distToTrace([nx, ny], guide) > corridor) continue;

        const turnCost = headingPenalty(prevDir, dir, res);
        if (!Number.isFinite(turnCost)) continue;

        const nz = elev([nx, ny]);
        if (nz === null) continue;

        const step = Math.hypot(dx, dy) * res;
        const grade = Math.abs(nz - z) / Math.max(step, 1) * 1000;
        if (grade > params.maxGradient && !allowTunnel) continue;

        let cost = step;
        cost += distToTrace([nx, ny], guide) * res * 0.08;
        if (grade > 25) cost += (grade - 25) * 12;
        if (grade > params.maxGradient) {
          cost += step * 3.2 + (grade - params.maxGradient) * 250;
        }
        cost += turnCost;

        const nextKey = stateKey(nx, ny, dir, width);
        const nextG = g + cost;
        if (nextG >= (best.get(nextKey) ?? Infinity)) continue;

        best.set(nextKey, nextG);
        parent.set(nextKey, key);
        const heuristic = Math.hypot(goal[0] - nx, goal[1] - ny) * res;
        heap.push([nextG + heuristic, nextG, nx, ny, dir]);
      }
    }

    if (!foundKey) return null;

    const path = [];
    let key = foundKey;
    while (key) {
      path.push(stateCell(key, width));
      if (key === startKey) break;
      key = parent.get(key);
      if (!key) return null;
    }
    path.reverse();
    return path;
  }

  function routeLine(line, allowTunnel = false) {
    if (!terrainReady()) return null;

    const ll = sourceCoords(line);
    if (ll.length < 2) return null;

    const waypoints = ll.map(terrainCell);
    if (waypoints.some(p => !p)) return null;

    const path = [];
    const breaks = [];

    for (let i = 1; i < waypoints.length; i++) {
      const start = waypoints[i - 1];
      const goal = waypoints[i];
      const leg = routeLeg(start, goal, [start, goal], allowTunnel);
      if (!leg?.length) return null;

      if (!path.length) {
        path.push(...leg);
        breaks.push(0);
      } else {
        path.push(...leg.slice(1));
      }
      breaks.push(path.length - 1);
    }

    path.waypointBreaks = breaks;
    path.waypointLL = ll;
    return path;
  }

  function cellToUtm(cell) {
    const res = +TERRAIN_COARSE.resolution_m;
    const b = TERRAIN_COARSE.bbox;
    return [
      b[0] + (cell[0] + 0.5) * res,
      b[3] - (cell[1] + 0.5) * res
    ];
  }

  function compressStraightRuns(points) {
    if (points.length <= 2) return points.map(p => [...p]);
    const out = [[...points[0]]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1];
      const b = points[i];
      const c = points[i + 1];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const bcx = c[0] - b[0];
      const bcy = c[1] - b[1];
      const cross = Math.abs(abx * bcy - aby * bcx);
      const dot = abx * bcx + aby * bcy;
      const norm = Math.max(1, Math.hypot(abx, aby) * Math.hypot(bcx, bcy));
      if (dot > 0 && cross / norm < 0.025) continue;
      out.push([...b]);
    }
    out.push([...points.at(-1)]);
    return out;
  }

  function chaikin(points, iterations = 2) {
    let current = points.map(p => [...p]);
    for (let pass = 0; pass < iterations && current.length > 2; pass++) {
      const next = [[...current[0]]];
      for (let i = 0; i < current.length - 1; i++) {
        const a = current[i];
        const b = current[i + 1];
        next.push([
          0.75 * a[0] + 0.25 * b[0],
          0.75 * a[1] + 0.25 * b[1]
        ]);
        next.push([
          0.25 * a[0] + 0.75 * b[0],
          0.25 * a[1] + 0.75 * b[1]
        ]);
      }
      next.push([...current.at(-1)]);
      current = next;
    }
    return current;
  }

  function smoothRoute(path) {
    if (!path?.length) return [];

    const breaks = Array.isArray(path.waypointBreaks) && path.waypointBreaks.length >= 2
      ? path.waypointBreaks
      : [0, path.length - 1];
    const waypointLL = Array.isArray(path.waypointLL) ? path.waypointLL : [];
    const out = [];

    for (let leg = 0; leg < breaks.length - 1; leg++) {
      const a = breaks[leg];
      const b = breaks[leg + 1];
      let pts = path.slice(a, b + 1).map(cellToUtm);

      const exactStart = waypointLL[leg] ? llToUtm31(...waypointLL[leg]) : null;
      const exactEnd = waypointLL[leg + 1] ? llToUtm31(...waypointLL[leg + 1]) : null;

      if (!pts.length) pts = [];
      if (exactStart && exactEnd && a === b) {
        pts = [exactStart, exactEnd];
      } else {
        if (exactStart && pts.length) pts[0] = exactStart;
        if (exactEnd && pts.length) pts[pts.length - 1] = exactEnd;
      }

      pts = compressStraightRuns(pts);
      pts = chaikin(pts, 2);
      if (exactStart && pts.length) pts[0] = exactStart;
      if (exactEnd && pts.length) pts[pts.length - 1] = exactEnd;

      const llPts = pts.map(p => utm31ToLL(p[0], p[1]));
      if (out.length && llPts.length) llPts.shift();
      out.push(...llPts);
    }

    return out;
  }

  function analyzeLine(line) {
    if (!terrainReady()) {
      return {warning:'No hi ha DEM runtime. Executa python -m pipelines.PREPARAR_FERROCAT --only terrain'};
    }

    let cells = routeLine(line, false);
    const surface = !!cells;
    let usedTunnel = false;

    if (!cells) {
      cells = routeLine(line, true);
      usedTunnel = true;
    }

    if (!cells) {
      return {
        warning:`No s’ha pogut trobar un camí ferroviari continu dins d’un corredor de ±${Math.round(ROUTE_CORRIDOR_M/1000)} km. Revisa el traçat o afegeix un punt de pas.`
      };
    }

    const res = +TERRAIN_COARSE.resolution_m;
    const terrain = cells.map(elev);
    const dist = [0];
    for (let i = 1; i < cells.length; i++) {
      dist.push(
        dist.at(-1) + Math.hypot(
          cells[i][0] - cells[i-1][0],
          cells[i][1] - cells[i-1][1]
        ) * res
      );
    }

    const rail = [...terrain];
    const maxGrade = params.maxGradient / 1000;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < rail.length; i++) {
        const ds = dist[i] - dist[i-1];
        rail[i] = clamp(
          rail[i],
          rail[i-1] - maxGrade * ds,
          rail[i-1] + maxGrade * ds
        );
      }
      for (let i = rail.length - 2; i >= 0; i--) {
        const ds = dist[i+1] - dist[i];
        rail[i] = clamp(
          rail[i],
          rail[i+1] - maxGrade * ds,
          rail[i+1] + maxGrade * ds
        );
      }
      rail[0] = terrain[0];
      rail[rail.length - 1] = terrain.at(-1);
    }

    const kind = terrain.map((z, i) =>
      z - rail[i] > 25 ? 'tunnel' : rail[i] - z > 18 ? 'viaduct' : 'surface'
    );
    const structures = [];
    let start = 0;
    for (let i = 1; i <= kind.length; i++) {
      if (i === kind.length || kind[i] !== kind[start]) {
        const end = i - 1;
        const lengthKm = Math.max(0, dist[end] - dist[start]) / 1000;
        if (kind[start] !== 'surface' && lengthKm >= 0.25) {
          structures.push({
            kind: kind[start],
            startKm: dist[start] / 1000,
            endKm: dist[end] / 1000,
            lengthKm
          });
        }
        start = i;
      }
    }

    if (usedTunnel && !structures.some(s => s.kind === 'tunnel')) {
      let peak = 0;
      let maxCover = -Infinity;
      terrain.forEach((z, i) => {
        const cover = z - rail[i];
        if (cover > maxCover) {
          maxCover = cover;
          peak = i;
        }
      });
      const a = Math.max(0, peak - 2);
      const b = Math.min(cells.length - 1, peak + 2);
      structures.push({
        kind:'tunnel',
        startKm:dist[a]/1000,
        endKm:dist[b]/1000,
        lengthKm:Math.max(0, dist[b]-dist[a])/1000
      });
    }

    let maxGradient = 0;
    for (let i = 1; i < rail.length; i++) {
      const ds = dist[i] - dist[i-1];
      if (ds > 0) {
        maxGradient = Math.max(
          maxGradient,
          Math.abs(rail[i] - rail[i-1]) / ds * 1000
        );
      }
    }

    const optimizedCoords = smoothRoute(cells);
    return {
      surfaceFeasible:surface,
      usedTunnel,
      optimizedCoords,
      terrain,
      rail,
      distKm:dist.map(x => x/1000),
      structures,
      maxGradient,
      routingVersion:'stable-v2',
      warning:usedTunnel
        ? 'No s’ha trobat una alternativa superficial ferroviàriament raonable dins del corredor: es proposen obres subterrànies.'
        : null
    };
  }

  // Substituïm les funcions que les accions existents ja consulten per binding.
  terrainRoute = routeLine;
  analyzeTerrain = analyzeLine;

  // En mode estacions, acabar l'edició ha de fer realment l'anàlisi topogràfica.
  // Abans només es desactivava l'edició i la línia quedava com una polilínia recta.
  const stopButton = byId('btn-stop');
  if (stopButton) {
    stopButton.onclick = () => {
      const line = activeLine();
      if (line && terrainReady() && lineCoords(line).length > 1) {
        line.analysis = analyzeTerrain(line);
      }
      state.activeId = null;
      save();
      render();
    };
  }
})();
