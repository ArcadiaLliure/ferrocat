/**
 * metrics.js
 * -----------------------------------------------------------------------
 * Composa els mòduls purs (travel-time, car-time, modal-choice, mobility,
 * line, cost) per calcular les mètriques d'UNA línia. Aquesta funció NO
 * toca el DOM: retorna dades que la capa de UI/renderer pintarà.
 * -----------------------------------------------------------------------
 */
import { distanciaKm, construirCaptacions, assignacioZones, odEntreEstacions } from './mobility.js';
import { tempsGeneralitzatTren } from './travel-time.js';
import { tempsGeneralitzatCotxe } from './car-time.js';
import { probabilitatCanviModal } from './modal-choice.js';
import { segmentsFromStations } from './line.js';
import { costEstimatLinia } from './cost.js';

const OCUPACIO_COTXE = 1.25;

/**
 * Calcula totes les mètriques d'una línia: longitud, temps, població,
 * OD observat, captació, vehicles evitats, CO2 i cost per trams.
 * @param {Object} linia - {id, nom, color, estacions:string[], segments?}
 * @param {Array<Object>} municipis - dataset complet de municipis
 * @param {Array<[string,string,number]>} odPairs - matriu OD MITMS
 * @param {Object} parametres - paràmetres operatius (velocitats, freqüència, etc.)
 * @returns {Object} mètriques completes de la línia
 */
export function calcularMetriquesLinia(linia, municipis, odPairs, parametres) {
  const muniPerId = Object.fromEntries(municipis.map((m) => [String(m.id), m]));
  const estacions = linia.estacions.map((id) => muniPerId[String(id)]).filter(Boolean);
  const n = estacions.length;

  const segmentsBase = segmentsFromStations(linia.estacions, linia.segments);
  const segDist = [];
  for (let i = 0; i < n - 1; i++) {
    segDist.push(distanciaKm(estacions[i], estacions[i + 1]) * parametres.intensitatMobilitat);
  }
  const prefix = [0];
  segDist.forEach((d) => prefix.push(prefix[prefix.length - 1] + d));
  const longitudKm = segDist.reduce((a, b) => a + b, 0);

  const segments = segmentsBase.map((s, i) => ({ ...s, longitudKm: segDist[i] || 0 }));
  const { costEstimat, kmNous, kmExistents } = costEstimatLinia(segments, {
    costNouPerKm: parametres.costPerKm,
    costAdaptacioPerKm: 2, // cost d'adaptació de via existent, M€/km (ADAPTATION_COST_MKM)
  });

  const tempsTotalViatge =
    n >= 2
      ? tempsGeneralitzatTren({
          distanciaKm: longitudKm,
          velocitatComercialKmh: parametres.velocitatTren,
          paradesIntermedies: Math.max(0, n - 2),
          tempsPerParadaMin: parametres.tempsParada,
          tempsAccesMin: 0,
          frequenciaPerHora: parametres.frequencia,
          factorHorari: 0,
        }).inVehicleTime +
        Math.max(0, n - 2) * parametres.tempsParada
      : 0;

  const captacions = construirCaptacions(municipis, estacions, parametres.radiCaptacio);
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
        velocitatComercialKmh: parametres.velocitatTren,
        paradesIntermedies: Math.max(0, j - i - 1),
        tempsPerParadaMin: parametres.tempsParada,
        tempsAccesMin: parametres.tempsAcces,
        frequenciaPerHora: parametres.frequencia,
        factorHorari: 0.3, // TIMETABLE_FACTOR
      });

      const { roadDistanceKm, carTimeMin } = tempsGeneralitzatCotxe({
        distanciaRectaKm: distanciaKm(estacions[i], estacions[j]),
        factorCarretera: parametres.sensibilitatDistancia,
        velocitatCotxeKmh: parametres.velocitatCotxe,
        penalitzacioFixaMin: 4, // CAR_FIXED_MIN
      });

      const carPerson = obs * parametres.fraccioCotxeActual;
      const p = probabilitatCanviModal({
        railGeneralizedTimeMin: rail.total,
        carGeneralizedTimeMin: carTimeMin,
        sensibilitat: parametres.sensibilitat,
        biaix: parametres.biaix,
        maxDiversion: 0.65, // MAX_DIVERSION
      });

      const cap = carPerson * p;
      const veh = cap / OCUPACIO_COTXE;
      observed += obs;
      captured += cap;
      vehicles += veh;
      vkm += veh * roadDistanceKm;
      fluxos.push({ origen: estacions[i], desti: estacions[j], desplaçamentsCapturats: cap, probabilitatTren: p });
    }
  }

  const co2TonesAny = (vkm * parametres.emissioPerKm * parametres.diesPerAny) / 1000;
  const costPerVehicle = vehicles > 0.5 ? (costEstimat * 1e6) / vehicles : null;

  return {
    estacions,
    n,
    longitudKm,
    tempsTotalViatge,
    poblacioDirecta,
    poblacioCaptacio,
    totalOD: observed,
    totalDesplaçamentsCapturats: captured,
    totalCotxesEliminats: vehicles,
    co2TonesAny,
    costEstimat,
    costPerVehicle,
    kmNous,
    kmExistents,
    segments,
    fluxos,
    sharedZones: zones.shared,
  };
}
