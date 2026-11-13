/** Zeitstation auf der Strecke. */
export interface Station {
  name: string;
  km: number;
}

/** Geplanter Schlafblock: beginnt nach `afterH` Stunden Rennzeit und dauert `min` Minuten. */
export interface SleepBlock {
  afterH: number;
  min: number;
}

/** Ermüdung: ab `afterRideH` Stunden reiner Fahrzeit gilt `factor` auf den Plan-Schnitt. */
export interface FatigueStep {
  afterRideH: number;
  factor: number;
}

export interface RaceConfig {
  /** Startzeit als Unix-Millisekunden. */
  startMs: number;
  limitH: number;
  targetH: number;
  baseSpeedKmh: number;
  /** Ein Faktor pro Abschnitt (Start→Station 1, …, letzte Station→Ziel). Fehlende Werte gelten als 1. */
  sectionFactors: number[];
  /** Pause pro Zeitstation in Minuten. */
  stationPauseMin: number;
  /** Pipi: alle `peeIntervalH` Stunden Fahrzeit `peeMin` Minuten. */
  peeIntervalH: number;
  peeMin: number;
  shopCount: number;
  shopMin: number;
  techBufferMin: number;
  sleepBlocks: SleepBlock[];
  /** Leer = keine Ermüdung im Plan. */
  fatigue: FatigueStep[];
}

/** Alles, was das Rennmodell braucht. Stationen aufsteigend sortiert, 0 < km < totalKm. */
export interface Plan {
  totalKm: number;
  stations: Station[];
  cfg: RaceConfig;
}

/** Auf feste Abstände resampelte Strecke. Punkt i liegt bei min(i * stepM, totalM). */
export interface Route {
  stepM: number;
  totalM: number;
  ascentM: number;
  lat: number[];
  lon: number[];
  ele: number[];
}

export type LogType = 'pause' | 'sleep' | 'station';

export interface LogEntry {
  type: LogType;
  startMs: number;
  /** null = läuft noch. Bei Stations-Passagen gleich startMs. */
  endMs: number | null;
  km: number;
  name?: string;
  /** true = automatisch erkannte Pause. */
  auto?: boolean;
}

export interface MotionState {
  slowSinceMs: number | null;
  pauseStartMs: number | null;
}

export interface RaceState {
  lastKm: number | null;
  log: LogEntry[];
  motion: MotionState;
  lastFix: { lat: number; lon: number; tMs: number } | null;
  /** Vorgeschlagene Weckzeit des laufenden Schlafblocks. */
  sleepWakeMs: number | null;
}

export interface RouteMeta {
  id: string;
  name: string;
  totalKm: number;
  ascentM: number;
  importedMs: number;
  stations: Station[];
  cfg: RaceConfig;
}

export interface Settings {
  wakeLock: boolean;
  /** Wecker in der App: klingelt zur Weckzeit und hält beim Schlafen das Display an. */
  alarm: boolean;
}
