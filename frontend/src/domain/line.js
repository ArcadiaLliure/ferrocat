/**
 * line.js
 * -----------------------------------------------------------------------
 * Model de línia i tram (secció 18/19). Substitueix el camp pla
 * `existingKm` per una llista de trams:
 *
 *   Segment { fromStationId, toStationId, infrastructureType }
 *
 * amb infrastructureType 'new' | 'existing'. La geometria de cada tram
 * es manté separada de la llista d'estacions (secció 19): avui la
 * geometria és sempre la polilínia entre estacions consecutives, però
 * el domini ja no assumeix això com a única possibilitat futura.
 * -----------------------------------------------------------------------
 */

/**
 * Reconstrueix la llista de trams a partir de la llista d'estacions,
 * conservant el tipus d'infraestructura dels trams que ja existien
 * (per id d'origen/destí) i marcant com a 'new' qualsevol tram nou.
 * Es crida cada vegada que s'afegeix/elimina una estació d'una línia,
 * de manera que eliminar una estació regenera els trams correctament
 * (cas de test explícit a la secció 31).
 * @param {string[]} stationIds - ids de municipi en ordre de la línia
 * @param {Array<{fromStationId:string,toStationId:string,infrastructureType:string}>} [previousSegments]
 * @returns {Array<{fromStationId:string,toStationId:string,infrastructureType:string}>}
 */
export function segmentsFromStations(stationIds, previousSegments = []) {
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
      infrastructureType: previousByKey.get(key) || 'new',
    });
  }
  return segments;
}

/**
 * Canvia el tipus d'infraestructura d'un tram concret (nou <-> existent).
 * @param {Array<Object>} segments
 * @param {string} fromStationId
 * @param {string} toStationId
 * @param {string} infrastructureType - 'new' | 'existing' | 'upgrade'
 * @returns {Array<Object>} nova llista de trams (no muta l'original)
 */
export function setInfrastructureType(segments, fromStationId, toStationId, infrastructureType) {
  return segments.map((s) =>
    s.fromStationId === fromStationId && s.toStationId === toStationId
      ? { ...s, infrastructureType }
      : s
  );
}

/**
 * Migració conservadora d'una línia antiga (amb `existingKm` pla) al
 * model de trams. Com que no es pot saber QUINS trams concrets eren
 * existents a partir d'un sol número agregat, es marca tot com a 'new'
 * i es documenta explícitament — mai s'inventa quins trams ho eren
 * (requisit explícit de la secció 18).
 * @param {{estacions:string[], segments?:Array, existingKm?:number}} lineaAntiga
 * @returns {Array<Object>} trams migrats
 */
export function migrarLineaASegments(lineaAntiga) {
  if (Array.isArray(lineaAntiga.segments) && lineaAntiga.segments.length) {
    return lineaAntiga.segments;
  }
  // No hi ha prou informació per saber quins trams concrets eren
  // existents: es migra tot com a 'new' de forma conservadora.
  return segmentsFromStations(lineaAntiga.estacions || []);
}
