import type { ParsedGpx } from '../model/gpx';
import { INITIAL_MOTION, projectOnRoute, speedBetweenKmh, updateMotion } from '../model/projection';
import { buildRoute, routeTotalKm } from '../model/route';
import { defaultConfig, emptyRace } from '../state/defaults';
import * as store from '../state/store';
import type { LogEntry, Plan, RaceState, Route, RouteMeta, Settings, Station } from '../state/types';
import { armAlarm } from './alarm';
import { h } from './dom';
import { gpsSupported, startGps, type GpsFix } from './gps';
import { createLogScreen } from './log-screen';
import { createMainScreen } from './main-screen';
import { createSetupScreen } from './setup-screen';

export type ScreenName = 'main' | 'setup' | 'log';

/** Ansicht des Renn-Screens: Rennen, Pause, Schlafdauer wählen, Schlafen oder keine Strecke. */
export type MainMode = 'empty' | 'race' | 'pause' | 'chooser' | 'sleep';

export interface Screen {
  el: HTMLElement;
  /** Wird höchstens einmal pro Sekunde aufgerufen. */
  update?(): void;
}

/** GPS wird höchstens alle 30 s ausgewertet. */
const GPS_EVAL_MS = 30_000;
/** Ungenauere Positionen (z. B. reine Funkzellen-Ortung) werden verworfen. */
const MAX_ACCURACY_M = 150;
/** Ohne brauchbare Position seit dieser Zeit: Notbetrieb mit Schieberegler. */
export const GPS_LOST_MS = 5 * 60_000;
/** Im Zielbereich (letzte 100 m) gilt die Strecke als beendet. */
const FINISH_TOLERANCE_KM = 0.1;

export interface GpsInfo {
  supported: boolean;
  error: string | null;
  /** Letzte brauchbare Position (Empfangszeit). */
  lastFixMs: number | null;
  /** Beginn der Wartezeit, solange noch keine Position da war. */
  sinceMs: number;
  onRoute: boolean;
  distM: number | null;
}

export class App {
  routes: RouteMeta[] = [];
  meta: RouteMeta | null = null;
  route: Route | null = null;
  race: RaceState = emptyRace();
  settings: Settings = { wakeLock: false, alarm: true };
  test = { on: false, km: 0, nowMs: 0, race: emptyRace() };
  /** "Was wäre wenn": Restschlaf in Minuten oder null für den Plan. */
  whatIf: number | null = null;
  /** true, solange die Auswahl der Schlafdauer offen ist. */
  sleepChooser = false;
  gps: GpsInfo = {
    supported: gpsSupported(),
    error: null,
    lastFixMs: null,
    sinceMs: Date.now(),
    onRoute: true,
    distM: null,
  };

  private screenName: ScreenName = 'main';
  private screen: Screen | null = null;
  private renderedMode: MainMode = 'empty';
  private lastEvalMs: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private readonly host: HTMLElement;
  private readonly nav: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.host = h('main', { class: 'host' });
    this.nav = h('nav', { class: 'nav' });
    this.root.append(this.host, this.nav);
  }

  async init(): Promise<void> {
    this.settings = await store.loadSettings();
    this.routes = await store.loadRoutes();
    const activeId = await store.loadActiveId();
    await this.activate(this.routes.find((r) => r.id === activeId)?.id ?? null, false);

    startGps(
      (f) => this.handleFix(f),
      (msg) => {
        this.gps.error = msg;
      },
    );
    document.addEventListener('visibilitychange', () => {
      void this.syncWakeLock();
      this.tick();
    });
    void this.syncWakeLock();
    window.setInterval(() => this.tick(), 1000);
    this.show(this.meta ? 'main' : 'setup');
  }

  // ---------- Zustand lesen ----------

  now(): number {
    return this.test.on ? this.test.nowMs : Date.now();
  }

  activeRace(): RaceState {
    return this.test.on ? this.test.race : this.race;
  }

  km(): number {
    return this.test.on ? this.test.km : (this.race.lastKm ?? 0);
  }

  plan(): Plan | null {
    if (!this.meta) return null;
    return { totalKm: this.meta.totalKm, stations: this.meta.stations, cfg: this.meta.cfg };
  }

  openEntry(type: 'pause' | 'sleep'): LogEntry | null {
    return this.activeRace().log.find((e) => e.type === type && e.endMs === null) ?? null;
  }

  /** true, wenn seit über 5 Minuten keine brauchbare Position kam. */
  gpsLost(): boolean {
    return Date.now() - (this.gps.lastFixMs ?? this.gps.sinceMs) > GPS_LOST_MS;
  }

  /** Welche Ansicht der Renn-Screen gerade zeigen muss. */
  mainMode(): MainMode {
    if (!this.meta) return 'empty';
    if (this.openEntry('sleep')) return 'sleep';
    if (this.sleepChooser) return 'chooser';
    if (this.openEntry('pause')) return 'pause';
    return 'race';
  }

  // ---------- Navigation ----------

  show(name: ScreenName): void {
    this.screenName = name;
    if (name !== 'main') this.sleepChooser = false;
    this.renderedMode = this.mainMode();
    this.screen =
      name === 'main'
        ? createMainScreen(this)
        : name === 'setup'
          ? createSetupScreen(this)
          : createLogScreen(this);
    this.host.replaceChildren(this.screen.el);
    this.renderNav();
    this.screen.update?.();
    window.scrollTo(0, 0);
  }

  refresh(): void {
    this.show(this.screenName);
  }

  private renderNav(): void {
    const item = (label: string, active: boolean, onClick: () => void) =>
      h('button', { type: 'button', class: active ? 'nav-item active' : 'nav-item', onclick: onClick }, label);
    this.nav.replaceChildren(
      item('Rennen', this.screenName === 'main', () => this.show('main')),
      item('Setup', this.screenName === 'setup', () => this.show('setup')),
      item('Log', this.screenName === 'log', () => this.show('log')),
      item(this.test.on ? 'Test aus' : 'Test', this.test.on, () => this.toggleTest()),
    );
    this.nav.hidden = this.screenName === 'main' && this.renderedMode === 'sleep';
  }

  private tick(): void {
    if (document.visibilityState !== 'visible') return;
    // Automatisch erkannte Pausen beginnen und enden ohne Knopfdruck: Ansicht dann wechseln.
    if (this.screenName === 'main' && this.mainMode() !== this.renderedMode) {
      this.show('main');
      return;
    }
    this.screen?.update?.();
  }

  // ---------- Test-Modus ----------

  toggleTest(): void {
    if (!this.meta) {
      this.show('setup');
      return;
    }
    this.test.on = !this.test.on;
    if (this.test.on) {
      this.test.km = 0;
      this.test.nowMs = this.meta.cfg.startMs;
      this.test.race = emptyRace();
    }
    this.whatIf = null;
    this.sleepChooser = false;
    void this.syncWakeLock();
    this.show('main');
  }

  setTestKm(km: number): void {
    const prev = this.test.km;
    this.test.km = km;
    if (this.meta && km > prev) this.logPassages(this.test.race, prev, km, this.test.nowMs);
  }

  // ---------- Strecken ----------

  private async activate(id: string | null, persist = true): Promise<void> {
    this.meta = this.routes.find((r) => r.id === id) ?? null;
    this.route = this.meta ? await store.loadRoute(this.meta.id) : null;
    this.race = this.meta ? await store.loadRace(this.meta.id) : emptyRace();
    if (this.meta && !this.route) this.meta = null;
    this.test.on = false;
    this.whatIf = null;
    this.sleepChooser = false;
    this.lastEvalMs = null;
    if (persist) await store.saveActiveId(this.meta?.id ?? null);
  }

  async selectRoute(id: string): Promise<void> {
    await this.activate(id);
    this.refresh();
  }

  async importRoute(gpx: ParsedGpx, name: string, stations: Station[]): Promise<void> {
    const route = buildRoute(gpx.points);
    const meta: RouteMeta = {
      id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      totalKm: routeTotalKm(route),
      ascentM: route.ascentM,
      importedMs: Date.now(),
      stations,
      cfg: defaultConfig(stations.length),
    };
    await store.saveRoute(meta.id, route);
    this.routes = [...this.routes, meta];
    await store.saveRoutes(this.routes);
    await this.activate(meta.id);
    this.refresh();
  }

  async deleteRoute(id: string): Promise<void> {
    this.routes = this.routes.filter((r) => r.id !== id);
    await store.saveRoutes(this.routes);
    await store.deleteRouteData(id);
    if (this.meta?.id === id) await this.activate(this.routes[0]?.id ?? null);
    this.refresh();
  }

  /** Speichert geänderte Stationen/Konfiguration der aktiven Strecke. */
  async saveMeta(patch: Pick<RouteMeta, 'name' | 'stations' | 'cfg'>): Promise<void> {
    if (!this.meta) return;
    const updated: RouteMeta = { ...this.meta, ...patch };
    this.routes = this.routes.map((r) => (r.id === updated.id ? updated : r));
    this.meta = updated;
    await store.saveRoutes(this.routes);
    this.refresh();
  }

  async resetRace(): Promise<void> {
    if (!this.meta) return;
    this.race = emptyRace();
    this.lastEvalMs = null;
    await store.saveRace(this.meta.id, this.race);
    this.refresh();
  }

  async setWakeLock(on: boolean): Promise<void> {
    this.settings = { ...this.settings, wakeLock: on };
    await store.saveSettings(this.settings);
    await this.syncWakeLock();
  }

  async setAlarm(on: boolean): Promise<void> {
    this.settings = { ...this.settings, alarm: on };
    await store.saveSettings(this.settings);
    await this.syncWakeLock();
  }

  private async syncWakeLock(): Promise<void> {
    // Beim Schlafen mit App-Wecker bleibt das Display an, sonst kann der Wecker nicht klingeln.
    const sleeping = this.settings.alarm && this.openEntry('sleep') !== null;
    const want = (this.settings.wakeLock || sleeping) && document.visibilityState === 'visible';
    if (!want) {
      await this.wakeLock?.release().catch(() => {});
      this.wakeLock = null;
      return;
    }
    if (!('wakeLock' in navigator) || (this.wakeLock && !this.wakeLock.released)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      this.wakeLock = null;
    }
  }

  private persistRace(): void {
    if (this.test.on || !this.meta) return;
    void store.saveRace(this.meta.id, this.race);
  }

  // ---------- Position ----------

  /** Protokolliert Zeitstationen (und das Ziel), die zwischen prevKm und km liegen. */
  private logPassages(race: RaceState, prevKm: number, km: number, nowMs: number): void {
    const meta = this.meta;
    if (!meta || nowMs < meta.cfg.startMs) return;
    const has = (name: string) => race.log.some((e) => e.type === 'station' && e.name === name);
    for (const s of meta.stations) {
      if (s.km > prevKm && s.km <= km && !has(s.name)) {
        race.log.push({ type: 'station', name: s.name, startMs: nowMs, endMs: nowMs, km: s.km });
      }
    }
    if (km >= meta.totalKm - FINISH_TOLERANCE_KM && !has('Ziel')) {
      race.log.push({ type: 'station', name: 'Ziel', startMs: nowMs, endMs: nowMs, km: meta.totalKm });
    }
  }

  /** Notbetrieb: km von Hand setzen (darf auch rückwärts korrigieren). */
  setManualKm(km: number): void {
    const prev = this.race.lastKm ?? 0;
    this.race.lastKm = km;
    this.logPassages(this.race, prev, km, Date.now());
    this.persistRace();
  }

  /** Sucht die Position auf der ganzen Strecke neu (falls das ±15-km-Fenster verlassen wurde). */
  relocate(): void {
    const fix = this.race.lastFix;
    if (!this.route || !fix) return;
    const p = projectOnRoute(this.route, fix, null);
    this.gps.onRoute = p.onRoute;
    this.gps.distM = p.distM;
    if (p.onRoute && p.km !== null) {
      const prev = this.race.lastKm ?? 0;
      this.race.lastKm = Math.max(prev, p.km);
      this.logPassages(this.race, prev, this.race.lastKm, Date.now());
      this.persistRace();
    }
  }

  private handleFix(f: GpsFix): void {
    const now = Date.now();
    if (!(f.accuracyM <= MAX_ACCURACY_M)) return;
    this.gps.error = null;
    this.gps.lastFixMs = now;
    if (this.lastEvalMs !== null && now - this.lastEvalMs < GPS_EVAL_MS) return;
    this.lastEvalMs = now;
    if (!this.route || !this.meta) return;

    const race = this.race;
    const proj = projectOnRoute(this.route, f, race.lastKm);
    this.gps.onRoute = proj.onRoute;
    this.gps.distM = proj.distM;
    if (proj.onRoute && proj.km !== null) {
      const prev = race.lastKm ?? 0;
      race.lastKm = proj.km;
      this.logPassages(race, prev, proj.km, now);
    }

    const cur = { lat: f.lat, lon: f.lon, tMs: now };
    const sleeping = race.log.some((e) => e.type === 'sleep' && e.endMs === null);
    const racing = now >= this.meta.cfg.startMs;
    if (race.lastFix && racing && !sleeping) {
      const dt = now - race.lastFix.tMs;
      // Bei kurzen Abständen die Geräte-Geschwindigkeit, bei Lücken der Schnitt über die Lücke.
      const speedKmh =
        dt <= 2 * GPS_EVAL_MS && f.speedMs !== null && Number.isFinite(f.speedMs)
          ? f.speedMs * 3.6
          : speedBetweenKmh(race.lastFix, cur);
      const r = updateMotion(race.motion, { tMs: now, fromMs: race.lastFix.tMs, speedKmh });
      race.motion = r.state;
      if (r.pauseStartedMs !== undefined) {
        race.log.push({
          type: 'pause',
          startMs: r.pauseStartedMs,
          endMs: null,
          km: race.lastKm ?? 0,
          auto: true,
        });
      }
      if (r.pauseEnded) this.closeOpen(race, 'pause', r.pauseEnded.endMs);
    }
    race.lastFix = cur;
    this.persistRace();
  }

  // ---------- Pause / Schlaf ----------

  private closeOpen(race: RaceState, type: 'pause' | 'sleep', endMs: number): void {
    for (const e of race.log) {
      if (e.type === type && e.endMs === null) e.endMs = Math.max(e.startMs, endMs);
    }
  }

  /** Manuelle Pause starten bzw. laufende Pause (auch automatisch erkannte) beenden. */
  togglePause(): void {
    const race = this.activeRace();
    const now = this.now();
    if (this.openEntry('pause')) {
      this.closeOpen(race, 'pause', now);
      race.motion = { ...INITIAL_MOTION };
    } else {
      race.log.push({ type: 'pause', startMs: now, endMs: null, km: this.km(), auto: false });
      // Die Bewegungserkennung beendet die Pause, sobald wieder gefahren wird.
      race.motion = { slowSinceMs: now, pauseStartMs: now };
    }
    this.persistRace();
    this.refresh();
  }

  /** Öffnet die Auswahl der Schlafdauer. */
  openSleepChooser(): void {
    if (!this.meta || this.openEntry('sleep')) return;
    this.sleepChooser = true;
    this.refresh();
  }

  cancelSleepChooser(): void {
    this.sleepChooser = false;
    this.refresh();
  }

  /** Startet einen Schlafblock mit Weckzeit in `minutes` Minuten. Muss aus einem Tippen heraus aufgerufen werden. */
  startSleep(minutes: number): void {
    if (!this.meta || this.openEntry('sleep')) return;
    const race = this.activeRace();
    const now = this.now();
    this.sleepChooser = false;
    this.closeOpen(race, 'pause', now);
    race.motion = { ...INITIAL_MOTION };
    race.sleepWakeMs = now + Math.round(minutes) * 60_000;
    race.log.push({ type: 'sleep', startMs: now, endMs: null, km: this.km() });
    if (this.settings.alarm) armAlarm();
    this.persistRace();
    void this.syncWakeLock();
    this.refresh();
  }

  stopSleep(): void {
    const race = this.activeRace();
    this.closeOpen(race, 'sleep', this.now());
    race.sleepWakeMs = null;
    race.motion = { ...INITIAL_MOTION };
    race.lastFix = this.test.on ? race.lastFix : null;
    this.persistRace();
    void this.syncWakeLock();
    this.refresh();
  }
}
