import type { LogEntry, RouteMeta } from './types';

const TYPE_LABEL: Record<LogEntry['type'], string> = {
  pause: 'Pause',
  sleep: 'Schlaf',
  station: 'Zeitstation',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Lokale Zeit als "JJJJ-MM-TT HH:MM:SS". */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function de(x: number, digits: number): string {
  return x.toFixed(digits).replace('.', ',');
}

function cell(s: string): string {
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV mit Semikolon und Dezimalkomma (öffnet direkt in deutschem Excel/LibreOffice). */
export function logToCsv(log: LogEntry[], meta: RouteMeta): string {
  const rows = ['typ;name;beginn;ende;dauer_min;km;min_seit_start;automatisch'];
  for (const e of [...log].sort((a, b) => a.startMs - b.startMs)) {
    rows.push(
      [
        TYPE_LABEL[e.type],
        cell(e.name ?? ''),
        localStamp(e.startMs),
        e.endMs === null ? '' : localStamp(e.endMs),
        e.endMs === null ? '' : de((e.endMs - e.startMs) / 60000, 1),
        de(e.km, 1),
        de((e.startMs - meta.cfg.startMs) / 60000, 1),
        e.type === 'pause' ? (e.auto ? 'ja' : 'nein') : '',
      ].join(';'),
    );
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

export function logToJson(log: LogEntry[], meta: RouteMeta): string {
  return JSON.stringify(
    {
      strecke: meta.name,
      streckeKm: meta.totalKm,
      start: localStamp(meta.cfg.startMs),
      startMs: meta.cfg.startMs,
      stationen: meta.stations,
      konfiguration: meta.cfg,
      log: [...log].sort((a, b) => a.startMs - b.startMs),
    },
    null,
    2,
  );
}
