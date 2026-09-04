/**
 * car-time.js
 * -----------------------------------------------------------------------
 * Aproximació encapsulada del temps en cotxe (secció 14 de l'espec).
 * Ara mateix fem servir distancia_recta x factor_carretera perquè no
 * tenim routing real, però tota la lògica viu aquí darrere de dues
 * funcions pures: si en el futur es vol connectar un motor de routing
 * real, només cal substituir `distanciaPerCarretera`, sense tocar el
 * model de demanda ni el renderer.
 * -----------------------------------------------------------------------
 */

/**
 * Distància per carretera aproximada a partir de la distància en línia recta.
 * @param {Object} params
 * @param {number} params.distanciaRectaKm - distància geodèsica (haversine) en km
 * @param {number} params.factorCarretera - factor de sinuositat (>=1)
 * @returns {number} distància per carretera estimada (km)
 */
export function distanciaPerCarretera({ distanciaRectaKm, factorCarretera }) {
  return distanciaRectaKm * factorCarretera;
}

/**
 * Temps en cotxe estimat entre dos punts.
 * @param {Object} params
 * @param {number} params.distanciaRectaKm
 * @param {number} params.factorCarretera
 * @param {number} params.velocitatCotxeKmh
 * @param {number} params.penalitzacioFixaMin - temps fix (aparcar, arrencar, etc.)
 * @returns {{roadDistanceKm:number, carTimeMin:number}}
 */
export function tempsGeneralitzatCotxe({
  distanciaRectaKm,
  factorCarretera,
  velocitatCotxeKmh,
  penalitzacioFixaMin,
}) {
  const roadDistanceKm = distanciaPerCarretera({ distanciaRectaKm, factorCarretera });
  const carTimeMin =
    (velocitatCotxeKmh > 0 ? roadDistanceKm / velocitatCotxeKmh : 0) * 60 + penalitzacioFixaMin;
  return { roadDistanceKm, carTimeMin };
}
