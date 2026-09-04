/**
 * cost.js
 * -----------------------------------------------------------------------
 * Càlcul del cost estimat d'una línia a nivell de TRAM (secció 18),
 * diferenciant cost de via nova i cost d'adaptació de via existent.
 * -----------------------------------------------------------------------
 */

/**
 * Cost total d'una línia sumant el cost de cada tram segons el seu tipus
 * d'infraestructura.
 * @param {Array<{fromStationId:string,toStationId:string,infrastructureType:string,longitudKm:number}>} segments
 *        cada tram ha de portar ja calculada la seva pròpia longitudKm
 * @param {Object} params
 * @param {number} params.costNouPerKm - M€/km de via nova
 * @param {number} params.costAdaptacioPerKm - M€/km d'adaptació de via existent
 * @returns {{costEstimat:number, kmNous:number, kmExistents:number}}
 */
export function costEstimatLinia(segments, { costNouPerKm, costAdaptacioPerKm }) {
  let kmNous = 0;
  let kmExistents = 0;
  let costEstimat = 0;
  segments.forEach((s) => {
    const km = Number(s.longitudKm || 0);
    if (s.infrastructureType === 'existing') {
      kmExistents += km;
      costEstimat += km * costAdaptacioPerKm;
    } else {
      // 'new' i, de moment, 'upgrade' es tracten com a via nova a efectes
      // de cost fins que es defineixi un cost propi per a 'upgrade'.
      kmNous += km;
      costEstimat += km * costNouPerKm;
    }
  });
  return { costEstimat, kmNous, kmExistents };
}
