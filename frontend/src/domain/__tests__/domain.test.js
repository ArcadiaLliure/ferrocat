import { describe, it, expect } from 'vitest';
import { distanciaKm, construirCaptacions, odEntreEstacions } from '../mobility.js';
import { tempsGeneralitzatTren } from '../travel-time.js';
import { probabilitatCanviModal } from '../modal-choice.js';
import { segmentsFromStations } from '../line.js';
import { costEstimatLinia } from '../cost.js';

describe('distanciaKm', () => {
  it('és simètrica: A->B == B->A', () => {
    const a = { lat: 41.38, lon: 2.17 };
    const b = { lat: 41.61, lon: 0.62 };
    expect(distanciaKm(a, b)).toBeCloseTo(distanciaKm(b, a), 9);
  });
});

describe('construirCaptacions', () => {
  it('un municipi mai pertany a dues estacions', () => {
    const municipis = [
      { id: 'm1', lat: 41.0, lon: 1.0, pob: 100, zone: 'z1' },
    ];
    const estacions = [
      { id: 'e1', lat: 41.001, lon: 1.001 },
      { id: 'e2', lat: 41.002, lon: 1.002 },
    ];
    const captacions = construirCaptacions(municipis, estacions, 8);
    const assignacionsPerMunicipi = captacions.filter((c) => c.m.id === 'm1');
    expect(assignacionsPerMunicipi.length).toBe(1);
  });
});

describe('odEntreEstacions', () => {
  it('no compta origin==destination', () => {
    const zoneMap = new Map([['z1', 0]]);
    const pairs = odEntreEstacions(zoneMap, [['z1', 'z1', 500]]);
    expect(pairs.size).toBe(0);
  });
});

describe('parelles de línia (line pairs)', () => {
  it('4 estacions generen 6 parelles (i<j)', () => {
    const estacions = ['a', 'b', 'c', 'd'];
    let pairs = 0;
    for (let i = 0; i < estacions.length; i++) {
      for (let j = i + 1; j < estacions.length; j++) pairs++;
    }
    expect(pairs).toBe(6);
  });
});

describe('tempsGeneralitzatTren', () => {
  it('més estacions intermèdies => més dwell time', () => {
    const base = { distanciaKm: 100, velocitatComercialKmh: 100, tempsPerParadaMin: 1, tempsAccesMin: 5, frequenciaPerHora: 2, factorHorari: 0.3 };
    const ambPoquesParades = tempsGeneralitzatTren({ ...base, paradesIntermedies: 1 });
    const ambMoltesParades = tempsGeneralitzatTren({ ...base, paradesIntermedies: 5 });
    expect(ambMoltesParades.dwellTime).toBeGreaterThan(ambPoquesParades.dwellTime);
    expect(ambMoltesParades.total).toBeGreaterThan(ambPoquesParades.total);
  });

  it('més freqüència => menor penalització horària', () => {
    const base = { distanciaKm: 50, velocitatComercialKmh: 80, paradesIntermedies: 1, tempsPerParadaMin: 1, tempsAccesMin: 5, factorHorari: 0.3 };
    const freqBaixa = tempsGeneralitzatTren({ ...base, frequenciaPerHora: 1 });
    const freqAlta = tempsGeneralitzatTren({ ...base, frequenciaPerHora: 6 });
    expect(freqAlta.schedulePenalty).toBeLessThan(freqBaixa.schedulePenalty);
  });
});

describe('probabilitatCanviModal', () => {
  it('tren més competitiu (menys temps) => captació major', () => {
    const params = { sensibilitat: 0.08, biaix: 0.8, maxDiversion: 0.65 };
    const trenLent = probabilitatCanviModal({ ...params, railGeneralizedTimeMin: 90, carGeneralizedTimeMin: 60 });
    const trenRapid = probabilitatCanviModal({ ...params, railGeneralizedTimeMin: 40, carGeneralizedTimeMin: 60 });
    expect(trenRapid).toBeGreaterThan(trenLent);
  });

  it('mai supera maxDiversion', () => {
    const p = probabilitatCanviModal({
      railGeneralizedTimeMin: 1, carGeneralizedTimeMin: 1000,
      sensibilitat: 0.5, biaix: -10, maxDiversion: 0.65,
    });
    expect(p).toBeLessThanOrEqual(0.65);
  });
});

describe('segmentsFromStations', () => {
  it('eliminar una estació regenera els trams correctament', () => {
    const inicial = segmentsFromStations(['a', 'b', 'c']);
    expect(inicial.length).toBe(2);
    const desDespresEliminarB = segmentsFromStations(['a', 'c'], inicial);
    expect(desDespresEliminarB.length).toBe(1);
    expect(desDespresEliminarB[0]).toMatchObject({ fromStationId: 'a', toStationId: 'c' });
  });

  it('conserva el tipus existent dels trams que no han canviat', () => {
    const previ = [{ fromStationId: 'a', toStationId: 'b', infrastructureType: 'existing' }];
    const nou = segmentsFromStations(['a', 'b', 'c'], previ);
    expect(nou[0].infrastructureType).toBe('existing');
    expect(nou[1].infrastructureType).toBe('new');
  });
});

describe('costEstimatLinia', () => {
  it('un tram new usa costNouPerKm i un existing usa costAdaptacioPerKm', () => {
    const segments = [
      { infrastructureType: 'new', longitudKm: 10 },
      { infrastructureType: 'existing', longitudKm: 10 },
    ];
    const { costEstimat, kmNous, kmExistents } = costEstimatLinia(segments, {
      costNouPerKm: 12,
      costAdaptacioPerKm: 2,
    });
    expect(kmNous).toBe(10);
    expect(kmExistents).toBe(10);
    expect(costEstimat).toBe(10 * 12 + 10 * 2);
    expect(costEstimat).toBeLessThan(10 * 12 + 10 * 12); // existing sempre més barat
  });
});
