/**
 * network.js
 * -----------------------------------------------------------------------
 * Agregació a nivell de XARXA (secció 17). Avui NO existeix encara una
 * assignació de xarxa completa (transbordaments, millor ruta entre
 * línies), així que sumar directament les mètriques de cada línia pot
 * duplicar OD quan dues línies competeixen pel mateix trajecte.
 *
 * Per això aquest mòdul implementa explícitament l'OPCIÓ B "temporal"
 * de la secció 17: no anomena mai el resultat "xarxa total", sinó
 * "suma de línies (pot contenir solapaments)", i marca `isNetworkAssignment: false`
 * perquè la UI no ho presenti mai com una xifra de xarxa fiable.
 *
 * `network.js` és el lloc on, en el futur, s'implementaria l'OPCIÓ A
 * (assignar cada OD al millor servei disponible i evitar el doble
 * comptatge real). Es deixa aquí la funció `resumXarxa` com a únic punt
 * d'entrada perquè el dia que hi hagi assignació real de xarxa, només
 * calgui canviar aquesta funció sense tocar la UI ni el domini de línia.
 * -----------------------------------------------------------------------
 */

/**
 * Suma les mètriques de totes les línies dibuixades. NO és encara una
 * mètrica de xarxa vàlida si dues línies comparteixen OD.
 * @param {Array<Object>} metriquesPerLinia - sortida de calcularMetriquesLinia per cada línia
 * @param {Array<Object>} linies - línies originals (per comptar estacions úniques)
 * @returns {Object} resum amb isNetworkAssignment:false explícit
 */
export function resumXarxa(metriquesPerLinia, linies) {
  const sum = (key) => metriquesPerLinia.reduce((s, m) => s + Number(m[key] || 0), 0);

  const estacionsUniques = new Set();
  linies.forEach((l) => l.estacions.forEach((id) => estacionsUniques.add(id)));

  return {
    isNetworkAssignment: false,
    etiqueta: "Suma de línies (pot contenir solapaments)",
    numLinies: linies.length,
    kmXarxa: sum('longitudKm'),
    estacionsUniques: estacionsUniques.size,
    totalOD: sum('totalOD'),
    totalCaptats: sum('totalDesplaçamentsCapturats'),
    totalVehiclesEvitats: sum('totalCotxesEliminats'),
    totalCo2TonesAny: sum('co2TonesAny'),
    totalCostEstimat: sum('costEstimat'),
  };
}
