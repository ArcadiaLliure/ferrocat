/**
 * modal-choice.js
 * -----------------------------------------------------------------------
 * Model logit de canvi modal (secció 15). Entrada: temps generalitzats
 * de tren i cotxe. Sortida: probabilitat de canvi cap al tren, limitada
 * per `maxDiversion` perquè mai té sentit assumir una captació del 100%.
 * -----------------------------------------------------------------------
 */

/**
 * Probabilitat de canvi modal cap al tren.
 * @param {Object} params
 * @param {number} params.railGeneralizedTimeMin - temps generalitzat del tren (min)
 * @param {number} params.carGeneralizedTimeMin - temps generalitzat del cotxe (min)
 * @param {number} params.sensibilitat - pendent del logit (beta)
 * @param {number} params.biaix - preferència de base pel cotxe (intercept)
 * @param {number} params.maxDiversion - captació màxima admissible (0-1)
 * @returns {number} probabilitat de canvi modal, entre 0 i maxDiversion
 */
export function probabilitatCanviModal({
  railGeneralizedTimeMin,
  carGeneralizedTimeMin,
  sensibilitat,
  biaix,
  maxDiversion,
}) {
  const delta = railGeneralizedTimeMin - carGeneralizedTimeMin;
  const z = Math.max(-30, Math.min(30, biaix + sensibilitat * delta));
  return maxDiversion / (1 + Math.exp(z));
}
