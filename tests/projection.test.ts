import { describe, expect, it } from 'vitest';
import {
  advanceOdometer,
  INITIAL_MOTION,
  projectOnRoute,
  speedBetweenKmh,
  updateMotion,
} from '../src/model/projection';
import { buildRoute } from '../src/model/route';
import type { MotionState } from '../src/state/types';

const KM_LAT = 1 / 111.19493; // Grad Breite pro km
const M_LON_50 = 1 / (111194.93 * Math.cos((50 * Math.PI) / 180)); // Grad Länge pro m bei 50° N

/** Gerade Strecke nach Norden ab 50° N, 10° E. */
function straight(km: number) {
  return buildRoute([
    { lat: 50, lon: 10, ele: 0 },
    { lat: 50 + km * KM_LAT, lon: 10, ele: 0 },
  ]);
}

/** Wendepunkt-Strecke: `km` nach Norden und auf derselben Straße zurück. */
function outAndBack(km: number) {
  return buildRoute([
    { lat: 50, lon: 10, ele: 0 },
    { lat: 50 + km * KM_LAT, lon: 10, ele: 0 },
    { lat: 50, lon: 10, ele: 0 },
  ]);
}

const at = (kmNorth: number, mEast = 0) => ({ lat: 50 + kmNorth * KM_LAT, lon: 10 + mEast * M_LON_50 });

describe('projectOnRoute', () => {
  it('findet den Streckenkilometer und den Abstand', () => {
    const p = projectOnRoute(straight(20), at(1.234, 100), null);
    expect(p.onRoute).toBe(true);
    expect(p.km).toBeCloseTo(1.234, 2);
    expect(p.distM).toBeCloseTo(100, 0);
  });

  it('liefert km 0 am Start und die volle Länge am Ziel', () => {
    const r = straight(20);
    expect(projectOnRoute(r, at(0), null).km).toBeCloseTo(0, 3);
    expect(projectOnRoute(r, at(20), 19.5).km).toBeCloseTo(20, 2);
    // hinter dem Ziel: bleibt am Streckenende
    expect(projectOnRoute(r, at(20.2), 19.9).km).toBeCloseTo(20, 2);
  });

  it('meldet "neben der Strecke" über 500 m und hält den letzten km', () => {
    const r = straight(20);
    const off = projectOnRoute(r, at(5, 620), 4.8);
    expect(off.onRoute).toBe(false);
    expect(off.km).toBe(4.8);
    expect(Math.abs(off.distM - 620)).toBeLessThan(2);
    const near = projectOnRoute(r, at(5, 480), 4.8);
    expect(near.onRoute).toBe(true);
    expect(near.km).toBeCloseTo(5, 2);
  });

  it('gibt ohne letzten km und neben der Strecke null zurück', () => {
    const p = projectOnRoute(straight(20), at(5, 2000), null);
    expect(p.onRoute).toBe(false);
    expect(p.km).toBeNull();
  });

  it('springt nie rückwärts', () => {
    const p = projectOnRoute(straight(20), at(3), 5);
    expect(p.onRoute).toBe(true);
    expect(p.km).toBe(5);
  });

  it('sucht nur im Fenster ±15 km', () => {
    // Fahrer steht bei km 30, letzter bekannter km 5 → außerhalb des Fensters, also "neben der Strecke"
    const p = projectOnRoute(straight(40), at(30), 5);
    expect(p.onRoute).toBe(false);
    expect(p.km).toBe(5);
  });

  describe('Schleife (Hin- und Rückweg auf derselben Straße)', () => {
    const r = outAndBack(10); // km 0–10 hin, km 10–20 zurück

    it('nimmt ohne Vorwissen den Hinweg', () => {
      expect(projectOnRoute(r, at(4), null).km).toBeCloseTo(4, 1);
    });

    it('bleibt auf dem Hinweg, wenn der letzte km dort lag', () => {
      expect(projectOnRoute(r, at(4), 3.8).km).toBeCloseTo(4, 1);
    });

    it('wählt den Rückweg, wenn der letzte km dort lag', () => {
      expect(projectOnRoute(r, at(4), 15.7).km).toBeCloseTo(16, 1);
    });

    it('kommt über den Wendepunkt', () => {
      // letzter km kurz vor der Wende, Fahrer ist schon 300 m auf dem Rückweg
      expect(projectOnRoute(r, at(9.7), 9.9).km).toBeCloseTo(10.3, 1);
      expect(projectOnRoute(r, at(9.5), 10.3).km).toBeCloseTo(10.5, 1);
    });

    it('springt bei GPS-Rauschen im Stand nicht auf den Rückweg', () => {
      const p = projectOnRoute(r, at(4.15, 20), 4.2);
      expect(p.km).toBe(4.2);
    });

    it('durchfährt die ganze Schleife monoton', () => {
      let km: number | null = null;
      const seen: number[] = [];
      for (let s = 0; s <= 20; s += 0.2) {
        const north = s <= 10 ? s : 20 - s;
        km = projectOnRoute(r, at(north, 15), km).km;
        seen.push(km!);
      }
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[seen.length - 1]).toBeCloseTo(20, 1);
    });
  });

  it('unterscheidet weit auseinanderliegende Überlappungen über das Fenster', () => {
    const r = outAndBack(20); // km 4 und km 36 liegen an derselben Stelle
    expect(projectOnRoute(r, at(4), 3.9).km).toBeCloseTo(4, 1);
    expect(projectOnRoute(r, at(4), 35.5).km).toBeCloseTo(36, 1);
  });
});

describe('speedBetweenKmh', () => {
  it('rechnet Distanz pro Zeit', () => {
    const v = speedBetweenKmh({ ...at(0), tMs: 0 }, { ...at(0.25), tMs: 36_000 });
    expect(v).toBeCloseTo(25, 1);
  });

  it('ist 0 ohne Zeitdifferenz', () => {
    expect(speedBetweenKmh({ ...at(0), tMs: 5 }, { ...at(1), tMs: 5 })).toBe(0);
  });
});

describe('advanceOdometer', () => {
  it('setzt beim ersten Punkt nur den Anker', () => {
    const r = advanceOdometer(null, at(1));
    expect(r.addedKm).toBe(0);
    expect(r.anchor).toEqual(at(1));
  });

  it('zählt die Distanz und rückt den Anker nach', () => {
    const r = advanceOdometer(at(1), at(1.2));
    expect(r.addedKm).toBeCloseTo(0.2, 3);
    expect(r.anchor).toEqual(at(1.2));
  });

  it('ignoriert GPS-Rauschen im Stand', () => {
    let anchor: { lat: number; lon: number } | null = at(1);
    let km = 0;
    for (const m of [10, -15, 20, -5, 25, 0]) {
      const r = advanceOdometer(anchor, at(1, m));
      anchor = r.anchor;
      km += r.addedKm;
    }
    expect(km).toBe(0);
    expect(anchor).toEqual(at(1));
  });

  it('verliert langsames Rollen nicht', () => {
    // 10 m pro Messung: jede dritte Messung überschreitet die 30-m-Schwelle
    let anchor: { lat: number; lon: number } | null = null;
    let km = 0;
    for (let i = 0; i <= 30; i++) {
      const r = advanceOdometer(anchor, at(i * 0.01));
      anchor = r.anchor;
      km += r.addedKm;
    }
    expect(km).toBeCloseTo(0.3, 2);
  });

  it('summiert eine Fahrt auf', () => {
    let anchor: { lat: number; lon: number } | null = null;
    let km = 0;
    for (let i = 0; i <= 250; i++) {
      const r = advanceOdometer(anchor, at(i * 0.2));
      anchor = r.anchor;
      km += r.addedKm;
    }
    expect(km).toBeCloseTo(50, 1);
  });
});

describe('updateMotion', () => {
  const run = (samples: [number, number][]) => {
    let state: MotionState = INITIAL_MOTION;
    const events: string[] = [];
    let prev = 0;
    for (const [t, v] of samples) {
      const r = updateMotion(state, { tMs: t * 1000, fromMs: prev * 1000, speedKmh: v });
      state = r.state;
      if (r.pauseStartedMs !== undefined) events.push(`start@${r.pauseStartedMs / 1000}`);
      if (r.pauseEnded) events.push(`ende ${r.pauseEnded.startMs / 1000}-${r.pauseEnded.endMs / 1000}`);
      prev = t;
    }
    return { state, events };
  };

  it('erkennt eine Pause nach 90 s unter 3 km/h, rückwirkend ab Stillstand', () => {
    const { events } = run([
      [30, 25],
      [60, 1],
      [90, 0],
      [120, 0],
    ]);
    // langsam seit t=30 (Beginn des ersten langsamen Intervalls), 90 s später erkannt
    expect(events).toEqual(['start@30']);
  });

  it('erkennt keine Pause bei kurzem Halt', () => {
    const { events, state } = run([
      [30, 25],
      [60, 0],
      [90, 0],
      [120, 20],
      [150, 0],
      [180, 22],
    ]);
    expect(events).toEqual([]);
    expect(state.slowSinceMs).toBeNull();
  });

  it('beendet die Pause, sobald wieder gefahren wird', () => {
    const { events, state } = run([
      [30, 0],
      [60, 0],
      [90, 0],
      [120, 0],
      [600, 2.9],
      [630, 24],
    ]);
    expect(events).toEqual(['start@0', 'ende 0-600']);
    expect(state).toEqual({ slowSinceMs: null, pauseStartMs: null });
  });

  it('meldet eine Pause nur einmal', () => {
    const { events } = run([
      [30, 0],
      [60, 0],
      [90, 0],
      [120, 0],
      [150, 0],
      [180, 0],
    ]);
    expect(events).toEqual(['start@0']);
  });

  it('erkennt eine Pause aus einer einzelnen langen Messlücke', () => {
    // App war 20 Minuten im Hintergrund, Position unverändert
    const r = updateMotion(INITIAL_MOTION, { tMs: 1_500_000, fromMs: 300_000, speedKmh: 0.2 });
    expect(r.pauseStartedMs).toBe(300_000);
  });

  it('3 km/h gilt als Fahren', () => {
    const { events } = run([
      [30, 3],
      [60, 3],
      [90, 3],
      [120, 3],
      [150, 3],
    ]);
    expect(events).toEqual([]);
  });
});
