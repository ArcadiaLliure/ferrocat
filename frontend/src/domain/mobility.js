/**
 * mobility.js
 * -----------------------------------------------------------------------
 * Distància geogràfica, captació territorial i lectura de la matriu OD
 * observada del MITMS (seccions 11 i 12). Cap funció d'aquest fitxer
 * coneix el DOM, SVG ni res de renderitzat.
 * -----------------------------------------------------------------------
 */

const RADI_TERRA_KM = 6371.0088;

/**
 * Distància ortodròmica (haversine) entre dos punts {lat, lon}.
 * distanciaKm(a,b) === distanciaKm(b,a) sempre (test de simetria, secció 31).
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @returns {number} distància en km
 */
export function distanciaKm(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADI_TERRA_KM * Math.asin(Math.sqrt(aa));
}

/**
 * Assigna cada municipi a l'estació més propera dins del radi de captació.
 * Un mateix municipi mai queda assignat a més d'una estació.
 * @param {Array<Object>} municipis - llista de {id,lat,lon,pob,zone,...}
 * @param {Array<Object>} estacions - llista de municipis-estació de la línia
 * @param {number} radiCaptacioKm
 * @returns {Array<{m:Object, stationIdx:number, d:number}>}
 */
export function construirCaptacions(municipis, estacions, radiCaptacioKm) {
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

/**
 * Quan una mateixa zona MITMS toca diverses estacions (agregació territorial),
 * s'assigna la zona sencera a UNA sola estació (la de més població dins la
 * captació) per evitar doble recompte de l'OD observat.
 * @param {Array<{m:Object, stationIdx:number}>} captacions
 * @returns {{result: Map<string, number>, shared: number}} zona -> índex d'estació, i nombre de zones compartides
 */
export function assignacioZones(captacions) {
  const own = new Map();
  captacions.forEach((r) => {
    const z = String(r.m.zone || '');
    if (!z) return;
    if (!own.has(z)) own.set(z, new Map());
    const x = own.get(z);
    x.set(r.stationIdx, (x.get(r.stationIdx) || 0) + Number(r.m.pob || 0));
  });
  const result = new Map();
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

/**
 * Recupera l'OD observat MITMS entre parelles d'estacions (per índex),
 * ignorant origen==destí i sumant totes les zones assignades a cada estació.
 * @param {Map<string, number>} zoneMap - zona MITMS -> índex d'estació
 * @param {Array<[string,string,number]>} odPairs - [zonaA, zonaB, viatges_dia]
 * @returns {Map<string, number>} "i|j" (i<j) -> viatges/dia
 */
export function odEntreEstacions(zoneMap, odPairs) {
  const pairs = new Map();
  odPairs.forEach(([za, zb, trips]) => {
    const i = zoneMap.get(String(za));
    const j = zoneMap.get(String(zb));
    if (i === undefined || j === undefined || i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const k = `${a}|${b}`;
    pairs.set(k, (pairs.get(k) || 0) + Number(trips || 0));
  });
  return pairs;
}
