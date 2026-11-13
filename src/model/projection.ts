import type { MotionState, Route } from '../state/types';
import { haversineM, pointKm } from './route';

const RAD = Math.PI / 180;
const M_PER_DEG = 111194.93;

export interface ProjectionOptions {
  /** Suchfenster um den letzten bekannten km. */
  windowKm: number;
  /** Ab diesem Abstand gilt die Position als "neben der Strecke". */
  offRouteM: number;
  /** Kandidaten, die höchstens so viel weiter weg sind als der nächste Punkt, gelten als gleich nah. */
  toleranceM: number;
  /** Gewicht für Kandidaten hinter dem letzten km (Rückwärts ist unplausibel). */
  backwardWeight: number;
}

export const DEFAULT_PROJECTION: ProjectionOptions = {
  windowKm: 15,
  offRouteM: 500,
  toleranceM: 50,
  backwardWeight: 5,
};

export interface Projection {
  /** Gültiger Streckenkilometer: springt nie rückwärts; bei "neben der Strecke" der letzte Wert (ggf. null). */
  km: number | null;
  /** Abstand zur Strecke in Metern. */
  distM: number;
  onRoute: boolean;
}

/** Abstand Punkt–Segment in einer lokalen Ebene; liefert Abstand und Lage t (0..1) auf dem Segment. */
function segmentProjection(
  lat: number,
  lon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): { distM: number; t: number } {
  const cos = Math.cos(lat * RAD);
  const px = (lon - aLon) * cos * M_PER_DEG;
  const py = (lat - aLat) * M_PER_DEG;
  const bx = (bLon - aLon) * cos * M_PER_DEG;
  const by = (bLat - aLat) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
  return { distM: Math.hypot(px - bx * t, py - by * t), t };
}

/**
 * Projiziert eine GPS-Position auf die Strecke.
 * - Ohne `lastKm` wird die ganze Strecke durchsucht (bei Gleichstand gewinnt der kleinste km).
 * - Mit `lastKm` nur das Fenster ±windowKm; bei Schleifen/Überlappungen gewinnt der Kandidat,
 *   der dem letzten km am nächsten liegt (vorwärts bevorzugt).
 * - Der km springt nie rückwärts.
 */
export function projectOnRoute(
  route: Route,
  fix: { lat: number; lon: number },
  lastKm: number | null,
  opts: ProjectionOptions = DEFAULT_PROJECTION,
): Projection {
  const n = route.lat.length;
  let from = 0;
  let to = n - 1;
  if (lastKm !== null) {
    from = Math.max(0, Math.floor(((lastKm - opts.windowKm) * 1000) / route.stepM));
    to = Math.min(n - 1, Math.ceil(((lastKm + opts.windowKm) * 1000) / route.stepM));
    if (from > to) from = to;
  }

  const d: number[] = [];
  let minD = Infinity;
  for (let i = from; i <= to; i++) {
    const v = haversineM(fix.lat, fix.lon, route.lat[i], route.lon[i]);
    d.push(v);
    if (v < minD) minD = v;
  }

  // Lokale Minima, die praktisch gleich nah sind wie das globale Minimum.
  let best = -1;
  let bestCost = Infinity;
  for (let k = 0; k < d.length; k++) {
    if (d[k] > minD + opts.toleranceM) continue;
    if (k > 0 && d[k - 1] < d[k]) continue;
    if (k < d.length - 1 && d[k + 1] < d[k]) continue;
    const km = pointKm(route, from + k);
    let cost: number;
    if (lastKm === null) cost = km;
    else cost = km >= lastKm ? km - lastKm : (lastKm - km) * opts.backwardWeight;
    if (cost < bestCost) {
      bestCost = cost;
      best = from + k;
    }
  }

  // Verfeinern auf die beiden Nachbarsegmente.
  let distM = d[best - from];
  let rawKm = pointKm(route, best);
  for (const a of [best - 1, best]) {
    const b = a + 1;
    if (a < 0 || b > n - 1) continue;
    const p = segmentProjection(
      fix.lat,
      fix.lon,
      route.lat[a],
      route.lon[a],
      route.lat[b],
      route.lon[b],
    );
    if (p.distM < distM) {
      distM = p.distM;
      const ka = pointKm(route, a);
      rawKm = ka + (pointKm(route, b) - ka) * p.t;
    }
  }

  const onRoute = distM <= opts.offRouteM;
  if (!onRoute) return { km: lastKm, distM, onRoute };
  return { km: lastKm === null ? rawKm : Math.max(lastKm, rawKm), distM, onRoute };
}

/** Durchschnittsgeschwindigkeit zwischen zwei Positionen in km/h. */
export function speedBetweenKmh(
  a: { lat: number; lon: number; tMs: number },
  b: { lat: number; lon: number; tMs: number },
): number {
  const dt = b.tMs - a.tMs;
  if (dt <= 0) return 0;
  return (haversineM(a.lat, a.lon, b.lat, b.lon) / dt) * 3600;
}

/** Kleinere Bewegungen gelten als GPS-Rauschen und werden nicht gezählt. */
export const ODOMETER_MIN_STEP_M = 30;

export interface OdometerResult {
  /** Neu gezählte Distanz in km (0, solange die Bewegung unter der Schwelle bleibt). */
  addedKm: number;
  /** Position, ab der weitergezählt wird. */
  anchor: { lat: number; lon: number };
}

/**
 * Kilometerzähler für Fahrten ohne Strecke: zählt die Luftlinie vom Ankerpunkt zur neuen Position,
 * sobald sie mindestens `minStepM` beträgt. Darunter bleibt der Anker stehen, damit sich
 * GPS-Rauschen im Stand nicht aufsummiert, langsames Rollen aber nicht verloren geht.
 */
export function advanceOdometer(
  anchor: { lat: number; lon: number } | null,
  fix: { lat: number; lon: number },
  minStepM = ODOMETER_MIN_STEP_M,
): OdometerResult {
  const here = { lat: fix.lat, lon: fix.lon };
  if (!anchor) return { addedKm: 0, anchor: here };
  const d = haversineM(anchor.lat, anchor.lon, fix.lat, fix.lon);
  if (d < minStepM) return { addedKm: 0, anchor };
  return { addedKm: d / 1000, anchor: here };
}

export interface MotionSample {
  /** Zeitpunkt der Messung. */
  tMs: number;
  /** Beginn des Intervalls, für das die Geschwindigkeit gilt (vorherige Messung). */
  fromMs: number;
  speedKmh: number;
}

export interface MotionOptions {
  slowKmh: number;
  minPauseMs: number;
}

export const DEFAULT_MOTION: MotionOptions = { slowKmh: 3, minPauseMs: 90_000 };

export const INITIAL_MOTION: MotionState = { slowSinceMs: null, pauseStartMs: null };

export interface MotionResult {
  state: MotionState;
  /** Gesetzt, wenn mit dieser Messung eine Pause erkannt wurde (Beginn der Pause). */
  pauseStartedMs?: number;
  /** Gesetzt, wenn mit dieser Messung eine Pause endet. */
  pauseEnded?: { startMs: number; endMs: number };
}

/**
 * Stillstands-Erkennung: unter `slowKmh` über mindestens `minPauseMs` = Pause.
 * Die Pause beginnt rückwirkend mit dem ersten langsamen Intervall.
 */
export function updateMotion(
  state: MotionState,
  s: MotionSample,
  opts: MotionOptions = DEFAULT_MOTION,
): MotionResult {
  if (s.speedKmh < opts.slowKmh) {
    const slowSinceMs = state.slowSinceMs ?? s.fromMs;
    if (state.pauseStartMs === null && s.tMs - slowSinceMs >= opts.minPauseMs) {
      return { state: { slowSinceMs, pauseStartMs: slowSinceMs }, pauseStartedMs: slowSinceMs };
    }
    return { state: { slowSinceMs, pauseStartMs: state.pauseStartMs } };
  }
  if (state.pauseStartMs !== null) {
    return {
      state: { slowSinceMs: null, pauseStartMs: null },
      pauseEnded: { startMs: state.pauseStartMs, endMs: Math.max(state.pauseStartMs, s.fromMs) },
    };
  }
  return { state: { slowSinceMs: null, pauseStartMs: null } };
}
