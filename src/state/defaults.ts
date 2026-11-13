import type { RaceConfig, RaceState, Settings } from './types';

/** Die 6 Zeitstationen des Race Across Germany. Die km-Werte trägt der Nutzer im Setup ein. */
export const RAG_STATIONS: { name: string; km: number | null }[] = [
  { name: 'Lauenburg', km: null },
  { name: 'Bilderlahe', km: null },
  { name: 'Berka/Werra', km: null },
  { name: 'Kitzingen', km: null },
  { name: 'Mauren', km: null },
  { name: 'Moorenweis', km: null },
];

export function defaultStationsText(): string {
  return RAG_STATIONS.map((s) => `${s.name}, ${s.km === null ? '' : String(s.km).replace('.', ',')}`).join('\n');
}

export function defaultConfig(stationCount: number): RaceConfig {
  return {
    startMs: new Date(2027, 6, 9, 8, 0, 0).getTime(),
    limitH: 57,
    targetH: 55,
    baseSpeedKmh: 25,
    sectionFactors: Array.from({ length: stationCount + 1 }, () => 1),
    stationPauseMin: 15,
    peeIntervalH: 3.5,
    peeMin: 4,
    shopCount: 3,
    shopMin: 25,
    techBufferMin: 60,
    sleepBlocks: [
      { afterH: 22, min: 90 },
      { afterH: 40, min: 120 },
    ],
    fatigue: [],
  };
}

export function emptyRace(): RaceState {
  return {
    lastKm: null,
    log: [],
    motion: { slowSinceMs: null, pauseStartMs: null },
    lastFix: null,
    sleepWakeMs: null,
  };
}

export const DEFAULT_SETTINGS: Settings = { wakeLock: false, alarm: true };
