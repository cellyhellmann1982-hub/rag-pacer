import type { Route } from '../state/types';
import type { RawPoint } from './gpx';

const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

/** Großkreis-Distanz in Metern. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Kumulierte Distanz in Metern für jeden Punkt. */
export function cumulativeM(points: RawPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cum.push(cum[i - 1] + haversineM(a.lat, a.lon, b.lat, b.lon));
  }
  return cum;
}

/**
 * Baut aus Rohpunkten eine Strecke mit Punkten im festen Abstand `stepM`
 * (Standard 100 m). Der letzte Punkt liegt exakt am Streckenende.
 */
export function buildRoute(points: RawPoint[], stepM = 100): Route {
  if (points.length < 2) throw new Error('Eine Strecke braucht mindestens zwei Punkte.');
  const cum = cumulativeM(points);
  const totalM = cum[cum.length - 1];
  if (!(totalM > 0)) throw new Error('Die Strecke hat keine Länge.');

  // Fehlende Höhen mit dem letzten bekannten Wert füllen.
  const eleRaw: number[] = [];
  let lastEle = points.find((p) => p.ele !== null)?.ele ?? 0;
  for (const p of points) {
    if (p.ele !== null) lastEle = p.ele;
    eleRaw.push(lastEle);
  }

  const targets: number[] = [];
  for (let d = 0; d < totalM - 1e-6; d += stepM) targets.push(d);
  targets.push(totalM);

  const lat: number[] = [];
  const lon: number[] = [];
  const ele: number[] = [];
  let seg = 0;
  for (const d of targets) {
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[seg]) / span)) : 0;
    const a = points[seg];
    const b = points[seg + 1];
    lat.push(a.lat + (b.lat - a.lat) * t);
    lon.push(a.lon + (b.lon - a.lon) * t);
    ele.push(eleRaw[seg] + (eleRaw[seg + 1] - eleRaw[seg]) * t);
  }

  let ascentM = 0;
  for (let i = 1; i < ele.length; i++) {
    const d = ele[i] - ele[i - 1];
    if (d > 0) ascentM += d;
  }

  return { stepM, totalM, ascentM, lat, lon, ele };
}

/** Streckenkilometer des Punkts mit Index i. */
export function pointKm(route: Route, i: number): number {
  return Math.min(i * route.stepM, route.totalM) / 1000;
}

export function routeTotalKm(route: Route): number {
  return route.totalM / 1000;
}
