import type { FatigueStep, LogEntry, LogType, Plan, Station } from '../state/types';

const MIN_MS = 60_000;

export type Deadline = 'limit' | 'target';

/** Ab required_speed(0) > Basis-Schnitt × RED_LINE_FACTOR gilt das Zeitlimit als nicht mehr erreichbar. */
export const RED_LINE_FACTOR = 1.15;

function clampKm(plan: Plan, km: number): number {
  return Math.min(plan.totalKm, Math.max(0, km));
}

/** Abschnittsgrenzen in km: [0, Station 1, …, Station n, Ziel]. */
export function sectionBounds(plan: Plan): number[] {
  return [0, ...plan.stations.map((s) => s.km), plan.totalKm];
}

/** Geplanter Schnitt im Abschnitt i (Basis-Schnitt × Abschnittsfaktor). */
export function sectionSpeedKmh(plan: Plan, i: number): number {
  return plan.cfg.baseSpeedKmh * (plan.cfg.sectionFactors[i] ?? 1);
}

/**
 * Geplante reine Fahrzeit in Minuten von km 0 bis `km`.
 * Schnitt = Basis-Schnitt × Abschnittsfaktor × Ermüdungsfaktor (nach Fahrstunden).
 */
export function rideMin(plan: Plan, km: number): number {
  const k = clampKm(plan, km);
  const b = sectionBounds(plan);
  const steps = [...(plan.cfg.fatigue ?? [])].sort((x, y) => x.afterRideH - y.afterRideH);
  let h = 0; // bisherige Fahrzeit in Stunden
  for (let i = 0; i < b.length - 1; i++) {
    let len = Math.min(k, b[i + 1]) - b[i];
    if (len <= 0) break;
    // Innerhalb des Abschnitts an jeder Ermüdungsstufe neu ansetzen.
    while (len > 0) {
      const v = sectionSpeedKmh(plan, i) * fatigueFactorAt(steps, h);
      const next = steps.find((s) => s.afterRideH > h + 1e-9);
      const need = len / v;
      if (!next || h + need <= next.afterRideH) {
        h += need;
        len = 0;
      } else {
        len -= (next.afterRideH - h) * v;
        h = next.afterRideH;
      }
    }
  }
  return h * 60;
}

/** Ermüdungsfaktor nach `rideH` Stunden Fahrzeit (Stufen aufsteigend sortiert). */
function fatigueFactorAt(steps: FatigueStep[], rideH: number): number {
  let f = 1;
  for (const s of steps) {
    if (s.afterRideH <= rideH + 1e-9) f = s.factor;
  }
  return f;
}

/**
 * Pipi, Einkaufen und Technik-Puffer bis `km`, verteilt proportional zur geplanten Fahrzeit.
 * Pipi: `peeMin` je `peeIntervalH` Stunden Fahrzeit.
 */
export function flexPauseMin(plan: Plan, km: number): number {
  const c = plan.cfg;
  const total = rideMin(plan, plan.totalKm);
  if (total <= 0) return 0;
  const r = rideMin(plan, km);
  const lump = c.shopCount * c.shopMin + c.techBufferMin;
  const pee = c.peeIntervalH > 0 ? (r / 60 / c.peeIntervalH) * c.peeMin : 0;
  return (r / total) * lump + pee;
}

/** Laut Plan bis `km` verbrauchte Pausen. Eine Stationspause zählt, sobald die Station hinter dem Fahrer liegt. */
export function plannedPauseMin(plan: Plan, km: number): number {
  const k = clampKm(plan, km);
  const passed = plan.stations.filter((s) => s.km < k).length;
  return passed * plan.cfg.stationPauseMin + flexPauseMin(plan, k);
}

/** Gesamtes Pausenbudget des Plans (ohne Schlaf). */
export function totalPauseBudgetMin(plan: Plan): number {
  return plannedPauseMin(plan, plan.totalKm);
}

/** Geplanter Schlaf, der bei `elapsedNoSleepMin` (Fahrzeit + Pausen) bereits hinter dem Fahrer liegt. */
export function plannedSleepBeforeMin(plan: Plan, elapsedNoSleepMin: number): number {
  const blocks = [...plan.cfg.sleepBlocks].sort((a, b) => a.afterH - b.afterH);
  let sleep = 0;
  for (const b of blocks) {
    if (b.min > 0 && elapsedNoSleepMin + sleep > b.afterH * 60) sleep += b.min;
  }
  return sleep;
}

/** Geplante Rennzeit in Minuten bis `km`: Fahrzeit + anteilige Pausen + bis dahin geplanter Schlaf. */
export function plannedElapsedMin(plan: Plan, km: number): number {
  const e0 = rideMin(plan, km) + plannedPauseMin(plan, km);
  return e0 + plannedSleepBeforeMin(plan, e0);
}

/** planned_arrival_at(km): wann der Plan den Fahrer bei `km` erwartet (Unix-ms). */
export function plannedArrivalAt(plan: Plan, km: number): number {
  return plan.cfg.startMs + plannedElapsedMin(plan, km) * MIN_MS;
}

/** Schlaf, den der Plan bis ins Ziel insgesamt enthält. */
export function plannedSleepTotalMin(plan: Plan): number {
  const e0 = rideMin(plan, plan.totalKm) + plannedPauseMin(plan, plan.totalKm);
  return plannedSleepBeforeMin(plan, e0);
}

/** Summe der protokollierten Minuten eines Typs bis `nowMs` (laufende Einträge zählen bis jetzt). */
export function loggedMin(log: LogEntry[], type: LogType, nowMs: number): number {
  let ms = 0;
  for (const e of log) {
    if (e.type !== type) continue;
    const end = Math.min(e.endMs ?? nowMs, nowMs);
    if (end > e.startMs) ms += end - e.startMs;
  }
  return ms / MIN_MS;
}

/** delta_min: tatsächliche minus geplante Zeit bei `km`. Positiv = Rückstand. */
export function deltaMin(plan: Plan, km: number, nowMs: number): number {
  return (nowMs - plannedArrivalAt(plan, km)) / MIN_MS;
}

export function remainingKm(plan: Plan, km: number): number {
  return plan.totalKm - clampKm(plan, km);
}

export function deadlineMs(plan: Plan, which: Deadline): number {
  const h = which === 'limit' ? plan.cfg.limitH : plan.cfg.targetH;
  return plan.cfg.startMs + h * 60 * MIN_MS;
}

/** Verbleibende Minuten bis Zeitlimit bzw. Zielzeit (negativ = überschritten). */
export function remainingTimeMin(plan: Plan, nowMs: number, which: Deadline): number {
  return (deadlineMs(plan, which) - nowMs) / MIN_MS;
}

/** budget_remaining: Pausenbudget des Plans minus bereits protokollierte Pausen (negativ = überzogen). */
export function budgetRemainingMin(plan: Plan, log: LogEntry[], nowMs: number): number {
  return totalPauseBudgetMin(plan) - loggedMin(log, 'pause', nowMs);
}

/** Fahrzeit für den Rest ab `km` mit Basis-Schnitt × Abschnittsfaktoren. */
export function restRideMin(plan: Plan, km: number): number {
  return rideMin(plan, plan.totalKm) - rideMin(plan, km);
}

/** Pausen, die der Plan ab `km` noch vorsieht. */
export function restPauseMin(plan: Plan, km: number): number {
  return totalPauseBudgetMin(plan) - plannedPauseMin(plan, km);
}

/**
 * sleep_affordable: Minuten Schlaf, die noch möglich sind, wenn der Rest im Plan-Schnitt
 * gefahren und die restlichen Pausen eingehalten werden. Nie negativ.
 */
export function sleepAffordableMin(plan: Plan, km: number, nowMs: number, which: Deadline): number {
  const free = remainingTimeMin(plan, nowMs, which) - restRideMin(plan, km) - restPauseMin(plan, km);
  return Math.max(0, free);
}

/**
 * required_speed: nötiger Fahrschnitt (km/h) für den Rest, wenn noch `sleepMin` geschlafen wird
 * und die restlichen Pausen eingehalten werden. Infinity = nicht mehr erreichbar, 0 = im Ziel.
 */
export function requiredSpeedKmh(
  plan: Plan,
  km: number,
  nowMs: number,
  sleepMin: number,
  which: Deadline,
): number {
  const rem = remainingKm(plan, km);
  if (rem <= 0) return 0;
  const rideAvail = remainingTimeMin(plan, nowMs, which) - restPauseMin(plan, km) - sleepMin;
  if (rideAvail <= 0) return Infinity;
  return rem / (rideAvail / 60);
}

/** eta_finish: Ankunft im Ziel (Unix-ms), wenn noch `sleepMin` geschlafen wird. */
export function etaFinishMs(plan: Plan, km: number, nowMs: number, sleepMin: number): number {
  if (remainingKm(plan, km) <= 0) return nowMs;
  return nowMs + (restRideMin(plan, km) + restPauseMin(plan, km) + sleepMin) * MIN_MS;
}

export interface NextStation {
  name: string;
  km: number;
  distKm: number;
  /** Spätester Zeitpunkt laut Plan (Unix-ms). */
  plannedMs: number;
}

/** Nächste Zeitstation vor dem Fahrer, oder null nach der letzten. */
export function nextStation(plan: Plan, km: number): NextStation | null {
  const k = clampKm(plan, km);
  const s: Station | undefined = plan.stations.find((st) => st.km > k);
  if (!s) return null;
  return { name: s.name, km: s.km, distKm: s.km - k, plannedMs: plannedArrivalAt(plan, s.km) };
}

export interface RedLine {
  /** Rückstand in Minuten, ab dem das Zeitlimit selbst ohne Schlaf nicht mehr erreichbar ist. */
  deltaMin: number;
  /** true, wenn der aktuelle Rückstand darüber liegt. */
  exceeded: boolean;
}

/** red_line: required_speed(0) fürs Zeitlimit > Basis-Schnitt × 1,15. */
export function redLine(plan: Plan, km: number, nowMs: number): RedLine {
  const rem = remainingKm(plan, km);
  const fastestRideMin = (rem / (plan.cfg.baseSpeedKmh * RED_LINE_FACTOR)) * 60;
  const latestElapsedMin = plan.cfg.limitH * 60 - restPauseMin(plan, km) - fastestRideMin;
  const line = latestElapsedMin - plannedElapsedMin(plan, km);
  const exceeded =
    rem > 0 &&
    requiredSpeedKmh(plan, km, nowMs, 0, 'limit') > plan.cfg.baseSpeedKmh * RED_LINE_FACTOR;
  return { deltaMin: line, exceeded };
}

/** Geplanter Schlaf, der noch nicht geschlafen wurde. */
export function remainingPlannedSleepMin(plan: Plan, log: LogEntry[], nowMs: number): number {
  return Math.max(0, plannedSleepTotalMin(plan) - loggedMin(log, 'sleep', nowMs));
}

/**
 * Wecker-Vorschlag: Rest des nächsten noch nicht geschlafenen Blocks,
 * begrenzt auf das, was fürs Zeitlimit noch möglich ist.
 */
export function suggestSleepMin(plan: Plan, km: number, nowMs: number, log: LogEntry[]): number {
  let used = loggedMin(log, 'sleep', nowMs);
  let next = 0;
  for (const b of [...plan.cfg.sleepBlocks].sort((a, c) => a.afterH - c.afterH)) {
    if (b.min <= 0) continue;
    if (used >= b.min) {
      used -= b.min;
      continue;
    }
    next = b.min - used;
    break;
  }
  return Math.max(0, Math.min(next, sleepAffordableMin(plan, km, nowMs, 'limit')));
}

export interface NapPreview {
  wakeMs: number;
  /** Reserve nach dem Schlaf (kann negativ sein). */
  reserveTargetMin: number;
  reserveLimitMin: number;
  /** Nötiger Schnitt nach dem Schlaf, wenn danach nicht mehr geschlafen wird. */
  speedTargetKmh: number;
  speedLimitKmh: number;
}

/** Was es kostet, jetzt `napMin` Minuten zu schlafen. */
export function napPreview(plan: Plan, km: number, nowMs: number, napMin: number): NapPreview {
  const free = (which: Deadline) =>
    remainingTimeMin(plan, nowMs, which) - restRideMin(plan, km) - restPauseMin(plan, km) - napMin;
  return {
    wakeMs: nowMs + napMin * MIN_MS,
    reserveTargetMin: free('target'),
    reserveLimitMin: free('limit'),
    speedTargetKmh: requiredSpeedKmh(plan, km, nowMs, napMin, 'target'),
    speedLimitKmh: requiredSpeedKmh(plan, km, nowMs, napMin, 'limit'),
  };
}

/** Unter dieser Distanz ist das bisherige Tempo noch nicht aussagekräftig. */
export const MIN_PACE_KM = 20;

export interface Pace {
  /** Tatsächlicher Fahrschnitt bisher (ohne protokollierte Pausen und Schlaf). */
  actualKmh: number;
  /** Verhältnis zum Plan: 1 = wie geplant, 0,9 = 10 % langsamer. */
  factor: number;
  /** Schlaf noch möglich, wenn der Rest im bisherigen Verhältnis zum Plan gefahren wird. */
  sleepTargetMin: number;
  sleepLimitMin: number;
}

/**
 * Prognose mit dem echten Tempo: Plan-Fahrzeit bis hierher geteilt durch die tatsächliche Fahrzeit
 * (Rennzeit minus protokollierte Pausen und Schlaf). Null, solange zu wenig gefahren wurde.
 */
export function pace(plan: Plan, km: number, nowMs: number, log: LogEntry[]): Pace | null {
  const k = clampKm(plan, km);
  const movingMin =
    (nowMs - plan.cfg.startMs) / MIN_MS - loggedMin(log, 'pause', nowMs) - loggedMin(log, 'sleep', nowMs);
  if (k < MIN_PACE_KM || movingMin <= 0) return null;
  const factor = rideMin(plan, k) / movingMin;
  const free = (which: Deadline) =>
    Math.max(
      0,
      remainingTimeMin(plan, nowMs, which) - restRideMin(plan, k) / factor - restPauseMin(plan, k),
    );
  return {
    actualKmh: k / (movingMin / 60),
    factor,
    sleepTargetMin: free('target'),
    sleepLimitMin: free('limit'),
  };
}

export type Status = 'gruen' | 'gelb' | 'rot';

export interface Snapshot {
  elapsedMin: number;
  deltaMin: number;
  remainingKm: number;
  toLimitMin: number;
  toTargetMin: number;
  budgetRemainingMin: number;
  /** Restschlaf, mit dem Fahrschnitt und ETA gerechnet sind. */
  sleepRestMin: number;
  sleepAffordableTargetMin: number;
  sleepAffordableLimitMin: number;
  requiredSpeedTargetKmh: number;
  requiredSpeedLimitKmh: number;
  etaMs: number;
  next: NextStation | null;
  redLine: RedLine;
  /** Prognose mit dem bisherigen Tempo, null bei zu wenig Daten. */
  pace: Pace | null;
  status: Status;
}

/**
 * Alle Zahlen für den Hauptscreen. `whatIfSleepMin` ersetzt den restlichen Plan-Schlaf
 * ("Was wäre wenn": noch so viele Minuten Schlaf ab jetzt).
 */
export function snapshot(
  plan: Plan,
  km: number,
  nowMs: number,
  log: LogEntry[],
  whatIfSleepMin: number | null = null,
): Snapshot {
  const sleepRestMin = whatIfSleepMin ?? remainingPlannedSleepMin(plan, log, nowMs);
  const delta = deltaMin(plan, km, nowMs);
  const eta = etaFinishMs(plan, km, nowMs, sleepRestMin);
  const red = redLine(plan, km, nowMs);
  let status: Status = 'gruen';
  if (delta > 0) status = 'gelb';
  if (red.exceeded || eta > deadlineMs(plan, 'limit')) status = 'rot';
  return {
    elapsedMin: (nowMs - plan.cfg.startMs) / MIN_MS,
    deltaMin: delta,
    remainingKm: remainingKm(plan, km),
    toLimitMin: remainingTimeMin(plan, nowMs, 'limit'),
    toTargetMin: remainingTimeMin(plan, nowMs, 'target'),
    budgetRemainingMin: budgetRemainingMin(plan, log, nowMs),
    sleepRestMin,
    sleepAffordableTargetMin: sleepAffordableMin(plan, km, nowMs, 'target'),
    sleepAffordableLimitMin: sleepAffordableMin(plan, km, nowMs, 'limit'),
    requiredSpeedTargetKmh: requiredSpeedKmh(plan, km, nowMs, sleepRestMin, 'target'),
    requiredSpeedLimitKmh: requiredSpeedKmh(plan, km, nowMs, sleepRestMin, 'limit'),
    etaMs: eta,
    next: nextStation(plan, km),
    redLine: red,
    pace: pace(plan, km, nowMs, log),
    status,
  };
}
