import type { Station } from '../state/types';

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Ganze Zahl mit Tausenderpunkt. */
export function fmtInt(x: number): string {
  const r = Math.round(x);
  return nf0.format(r === 0 ? 0 : r);
}

/** Eine Nachkommastelle mit Komma. */
export function fmt1(x: number): string {
  return nf1.format(x);
}

/** Uhrzeit HH:MM. */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Wochentag + Uhrzeit, z. B. "Sa 14:20". */
export function fmtDayClock(ms: number): string {
  return `${DAYS[new Date(ms).getDay()]} ${fmtClock(ms)}`;
}

/** Dauer in Minuten als HH:MM (Stunden können über 24 gehen). */
export function fmtDur(min: number): string {
  const sign = min < 0 ? '−' : '';
  const m = Math.floor(Math.abs(min));
  return `${sign}${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Zahl aus deutscher Eingabe ("3,5"). NaN bei ungültiger Eingabe. */
export function parseDe(s: string): number {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return NaN;
  return Number(t);
}

/** Zahl für ein Eingabefeld (Dezimalkomma, keine Tausenderpunkte). */
export function fmtInput(x: number): string {
  return String(Math.round(x * 1000) / 1000).replace('.', ',');
}

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(s: string): number {
  return s ? new Date(s).getTime() : NaN;
}

export function stationsToText(stations: Station[]): string {
  return stations.map((s) => `${s.name}, ${fmtInput(s.km)}`).join('\n');
}

/**
 * Liest die Liste "Name, km" (eine Station pro Zeile). Der Name endet am ersten Komma,
 * der Rest ist der km-Wert (Dezimalkomma erlaubt).
 */
export function parseStations(text: string, totalKm: number): { stations: Station[]; errors: string[] } {
  const stations: Station[] = [];
  const errors: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(',');
    const name = (i < 0 ? line : line.slice(0, i)).trim();
    const km = i < 0 ? NaN : parseDe(line.slice(i + 1));
    if (!name) errors.push(`Zeile "${line}": Name fehlt.`);
    else if (!Number.isFinite(km)) errors.push(`${name}: km fehlt oder ist keine Zahl.`);
    else if (km <= 0 || km >= totalKm)
      errors.push(`${name}: km ${fmtInput(km)} liegt nicht auf der Strecke (0 bis ${fmt1(totalKm)}).`);
    else stations.push({ name, km });
  }
  stations.sort((a, b) => a.km - b.km);
  for (let j = 1; j < stations.length; j++) {
    if (stations[j].km === stations[j - 1].km)
      errors.push(`${stations[j].name} und ${stations[j - 1].name} haben denselben km-Wert.`);
  }
  return { stations, errors };
}
