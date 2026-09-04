/**
 * travel-time.js
 * -----------------------------------------------------------------------
 * Funcions PURES per calcular el temps generalitzat del tren.
 * Cap d'aquestes funcions toca el DOM ni el renderer (secció 13/35 de
 * l'especificació): "Una funció de dominio no debe manipular DOM".
 *
 * El temps generalitzat del tren es descompon en quatre components
 * independents perquè cadascun respon a una causa diferent i s'ha de
 * poder testejar per separat:
 *
 *   in_vehicle_time    -> distancia_km / velocitat_comercial_kmh * 60
 *   dwell_time         -> parades_intermedies * temps_per_parada_min
 *   access_time        -> temps fix d'accés a banda i banda de l'estació
 *   schedule_penalty   -> penalització per l'espera mitjana segons freqüència
 * -----------------------------------------------------------------------
 */

/**
 * Temps de circulació pur (sense parades ni accessos).
 * @param {Object} params
 * @param {number} params.distanciaKm - distància ferroviària del tram (km)
 * @param {number} params.velocitatComercialKmh - velocitat comercial del tren (km/h)
 * @returns {number} minuts de circulació
 */
export function tempsCirculacio({ distanciaKm, velocitatComercialKmh }) {
  if (velocitatComercialKmh <= 0) return 0;
  return (distanciaKm / velocitatComercialKmh) * 60;
}

/**
 * Temps perdut a les parades intermèdies (no compta origen ni destí).
 * @param {Object} params
 * @param {number} params.paradesIntermedies - nombre d'estacions intermèdies del trajecte
 * @param {number} params.tempsPerParadaMin - minuts aturats per parada
 * @returns {number} minuts totals de parada
 */
export function tempsParades({ paradesIntermedies, tempsPerParadaMin }) {
  return Math.max(0, paradesIntermedies) * tempsPerParadaMin;
}

/**
 * Temps d'accés/egrés a l'estació, aplicat a banda i banda del viatge.
 * @param {Object} params
 * @param {number} params.tempsAccesMin - minuts d'accés a UNA banda
 * @returns {number} minuts d'accés total (origen + destí)
 */
export function tempsAccesTotal({ tempsAccesMin }) {
  return 2 * tempsAccesMin;
}

/**
 * Penalització per l'espera mitjana associada a la freqüència de pas.
 * Un headway (interval entre trens) més gran implica més espera esperada.
 * @param {Object} params
 * @param {number} params.frequenciaPerHora - trens per hora
 * @param {number} params.factorHorari - fracció del headway que es penalitza (0-1)
 * @param {number} [params.maxPenaltyMin=30] - topall de la penalització
 * @returns {number} minuts de penalització
 */
export function penalitzacioHorari({ frequenciaPerHora, factorHorari, maxPenaltyMin = 30 }) {
  const headwayMin = 60 / Math.max(frequenciaPerHora, 0.1);
  return Math.min(maxPenaltyMin, headwayMin * factorHorari);
}

/**
 * Temps generalitzat complet del tren entre dues estacions d'una línia,
 * combinant els quatre components anteriors.
 * @param {Object} params
 * @param {number} params.distanciaKm
 * @param {number} params.velocitatComercialKmh
 * @param {number} params.paradesIntermedies
 * @param {number} params.tempsPerParadaMin
 * @param {number} params.tempsAccesMin
 * @param {number} params.frequenciaPerHora
 * @param {number} params.factorHorari
 * @returns {{inVehicleTime:number, dwellTime:number, accessTime:number, schedulePenalty:number, total:number}}
 */
export function tempsGeneralitzatTren(params) {
  const inVehicleTime = tempsCirculacio(params);
  const dwellTime = tempsParades(params);
  const accessTime = tempsAccesTotal(params);
  const schedulePenalty = penalitzacioHorari(params);
  return {
    inVehicleTime,
    dwellTime,
    accessTime,
    schedulePenalty,
    total: inVehicleTime + dwellTime + accessTime + schedulePenalty,
  };
}
