import {
  budgetRemainingMin,
  napPreview,
  RED_LINE_FACTOR,
  snapshot,
  suggestSleepMin,
} from '../model/budget';
import { ringAlarm } from './alarm';
import type { App, Screen } from './app';
import { h } from './dom';
import { fmt1, fmtClock, fmtDayClock, fmtDur, fmtInput, fmtInt } from './format';

const WHAT_IF_MIN = [180, 240];
/** Feste Vorschläge für die Schlafdauer in Minuten. */
const NAP_MIN = [15, 30, 90];
/** Der Wecker klingelt alle 2 s, höchstens 10 Minuten lang. */
const RING_EVERY_MS = 2000;
const RING_MAX_MS = 10 * 60_000;

type Tone = 'gruen' | 'gelb' | 'rot' | '';

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setTone(el: HTMLElement, tone: Tone): void {
  if (el.dataset.tone !== tone) el.dataset.tone = tone;
}

/** Minuten mit echtem Minuszeichen, abgerundet. */
function fmtSigned(min: number): string {
  const r = Math.floor(min);
  return r < 0 ? `−${fmtInt(-r)}` : fmtInt(r);
}

function fmtSpeed(v: number): string {
  return !Number.isFinite(v) || v > 99 ? '–' : fmt1(v);
}

function speedTone(v: number, base: number): Tone {
  if (!Number.isFinite(v) || v > 99 || v > base * RED_LINE_FACTOR) return 'rot';
  return v > base ? 'gelb' : '';
}

export function createMainScreen(app: App): Screen {
  switch (app.mainMode()) {
    case 'empty':
      return {
        el: h(
          'div',
          { class: 'screen empty' },
          h('p', null, 'Noch keine Strecke geladen.'),
          h('button', { type: 'button', class: 'btn btn-big', onclick: () => app.show('setup') }, 'Zum Setup'),
        ),
      };
    case 'sleep':
      return sleepView(app);
    case 'chooser':
      return chooserView(app);
    case 'pause':
      return pauseView(app);
    case 'race':
      return raceView(app);
  }
}

/** Zwei große Werte nebeneinander: Zielzeit und Zeitlimit. */
function pair(app: App, a: HTMLElement, b: HTMLElement): HTMLElement {
  const c = app.meta!.cfg;
  return h(
    'div',
    { class: 'pair' },
    h('div', null, a, h('div', { class: 'sub' }, `Ziel ${fmtInput(c.targetH)} h`)),
    h('div', null, b, h('div', { class: 'sub' }, `Limit ${fmtInput(c.limitH)} h`)),
  );
}

// ---------- Test-Modus: Zeit und Position simulieren ----------

function testPanel(app: App): HTMLElement {
  const meta = app.meta!;
  const spanMin = Math.round((meta.cfg.limitH + 3) * 60);
  const kmOut = h('span', { class: 'test-value' });
  const timeOut = h('span', { class: 'test-value' });
  const show = () => {
    kmOut.textContent = `km ${fmt1(app.test.km)}`;
    timeOut.textContent = `${fmtDayClock(app.test.nowMs)} · ${fmtDur((app.test.nowMs - meta.cfg.startMs) / 60_000)} h`;
  };
  const km = h('input', {
    type: 'range',
    min: '0',
    max: String(Math.ceil(meta.totalKm * 10) / 10),
    step: '0.1',
    value: String(app.test.km),
    'aria-label': 'Simulierter Streckenkilometer',
  });
  km.addEventListener('input', () => {
    app.setTestKm(Math.min(meta.totalKm, Number(km.value)));
    show();
  });
  const time = h('input', {
    type: 'range',
    min: '0',
    max: String(spanMin),
    step: '1',
    value: String(Math.round((app.test.nowMs - meta.cfg.startMs) / 60_000)),
    'aria-label': 'Simulierte Uhrzeit',
  });
  time.addEventListener('input', () => {
    app.test.nowMs = meta.cfg.startMs + Number(time.value) * 60_000;
    show();
  });
  show();
  return h(
    'div',
    { class: 'test-panel' },
    h('div', { class: 'test-title' }, 'TEST-MODUS · simulierte Werte, nichts wird gespeichert'),
    h('label', null, h('span', null, 'Position ', kmOut), km),
    h('label', null, h('span', null, 'Zeit ', timeOut), time),
  );
}

// ---------- Schlafen: nur Weckzeit, Restminuten, Stopp ----------

function sleepView(app: App): Screen {
  const wake = h('div', { class: 'big big-1' });
  const rest = h('div', { class: 'big big-2' });
  const restLabel = h('div', { class: 'label' });
  const hint = h('div', { class: 'hint' });
  const el = h(
    'div',
    { class: 'screen sleep' },
    h('div', { class: 'label' }, 'Weckzeit'),
    wake,
    restLabel,
    rest,
    hint,
    h('button', { type: 'button', class: 'btn btn-big btn-stop', onclick: () => app.stopSleep() }, 'Stopp'),
    app.test.on ? testPanel(app) : null,
  );
  let lastRing = 0;

  const update = () => {
    const entry = app.openEntry('sleep');
    if (!entry) return;
    const now = app.now();
    const wakeMs = app.activeRace().sleepWakeMs ?? entry.startMs;
    const planned = Math.round((wakeMs - entry.startMs) / 60_000);
    const left = Math.ceil((wakeMs - now) / 60_000);
    setText(wake, fmtClock(wakeMs));
    if (planned <= 0) {
      setText(restLabel, 'Ohne Weckzeit · schläft seit (min)');
      setText(rest, fmtInt((now - entry.startMs) / 60_000));
      setTone(rest, 'gelb');
    } else if (left > 0) {
      setText(restLabel, 'Noch Minuten');
      setText(rest, fmtInt(left));
      setTone(rest, '');
    } else {
      setText(restLabel, 'Aufstehen! Überzogen um Minuten');
      setText(rest, fmtInt(-left));
      setTone(rest, 'rot');
    }
    const alarm = app.settings.alarm;
    setText(
      hint,
      alarm
        ? `Handy-Wecker trotzdem auf ${fmtClock(wakeMs)} stellen. Der Wecker hier klingelt nur, solange die App offen ist; das Display bleibt dafür an. Eingeschlafen ${fmtClock(entry.startMs)}.`
        : `Wecker im Handy auf ${fmtClock(wakeMs)} stellen. Eingeschlafen ${fmtClock(entry.startMs)}.`,
    );
    if (alarm && planned > 0 && now >= wakeMs && now - wakeMs < RING_MAX_MS) {
      const real = Date.now();
      if (real - lastRing >= RING_EVERY_MS) {
        lastRing = real;
        ringAlarm();
      }
    }
  };
  return { el, update };
}

// ---------- Schlafdauer wählen, mit Vorschau der Folgen ----------

function chooserView(app: App): Screen {
  const plan = app.plan()!;
  const suggestion = Math.round(
    suggestSleepMin(plan, app.km(), Math.max(app.now(), plan.cfg.startMs), app.activeRace().log),
  );
  const options = NAP_MIN.map((min) => ({ min, fromPlan: false }));
  if (suggestion > 0 && !NAP_MIN.includes(suggestion)) options.push({ min: suggestion, fromPlan: true });
  options.sort((a, b) => a.min - b.min);

  const rows = options.map((o) => {
    const wake = h('div', { class: 'nap-line' });
    const reserve = h('div', { class: 'nap-line' });
    const speed = h('div', { class: 'nap-line' });
    const btn = h(
      'button',
      { type: 'button', class: 'btn nap', onclick: () => app.startSleep(o.min) },
      h(
        'div',
        { class: 'nap-min' },
        fmtInt(o.min),
        h('span', { class: 'nap-unit' }, o.fromPlan || o.min === suggestion ? 'min · Plan' : 'min'),
      ),
      h('div', { class: 'nap-info' }, wake, reserve, speed),
    );
    return { ...o, btn, wake, reserve, speed };
  });

  const el = h(
    'div',
    { class: 'screen chooser' },
    app.test.on ? testPanel(app) : null,
    h('div', { class: 'label' }, 'Wie lange schlafen?'),
    ...rows.map((r) => r.btn),
    h(
      'p',
      { class: 'muted' },
      'Reserve = Zeit, die danach bis Zielzeit bzw. Zeitlimit übrig bleibt. Schnitt = nötig, wenn danach nicht mehr geschlafen wird.',
    ),
    h(
      'button',
      { type: 'button', class: 'btn btn-big', onclick: () => app.cancelSleepChooser() },
      'Abbrechen',
    ),
  );

  const update = () => {
    const now = Math.max(app.now(), plan.cfg.startMs);
    for (const r of rows) {
      const p = napPreview(plan, app.km(), now, r.min);
      setText(r.wake, `Wecken ${fmtClock(p.wakeMs)}`);
      setText(
        r.reserve,
        `Reserve danach: Ziel ${fmtSigned(p.reserveTargetMin)} · Limit ${fmtSigned(p.reserveLimitMin)} min`,
      );
      setTone(r.reserve, p.reserveLimitMin < 0 ? 'rot' : p.reserveTargetMin < 0 ? 'gelb' : '');
      setText(
        r.speed,
        `Schnitt danach: Ziel ${fmtSpeed(p.speedTargetKmh)} · Limit ${fmtSpeed(p.speedLimitKmh)} km/h`,
      );
      setTone(r.speed, speedTone(p.speedLimitKmh, plan.cfg.baseSpeedKmh));
    }
  };
  return { el, update };
}

// ---------- Pause: Dauer und was noch an Reserve bleibt ----------

function pauseView(app: App): Screen {
  const since = h('div', { class: 'big big-1', 'data-tone': 'gelb' });
  const sinceLabel = h('div', { class: 'label' });
  const resTarget = h('div', { class: 'big big-2' });
  const resLimit = h('div', { class: 'big big-2' });
  const dDelta = h('dd');
  const dSpeed = h('dd');
  const dBudget = h('dd');
  const dKm = h('dd');

  const el = h(
    'div',
    { class: 'screen race' },
    app.test.on ? testPanel(app) : null,
    h('section', { class: 'block' }, sinceLabel, since),
    h(
      'section',
      { class: 'block' },
      h('div', { class: 'label' }, 'Reserve noch (min)'),
      pair(app, resTarget, resLimit),
    ),
    h(
      'dl',
      { class: 'details' },
      h('dt', null, 'Stand'),
      dDelta,
      h('dt', null, 'Nötiger Schnitt'),
      dSpeed,
      h('dt', null, 'Pausenbudget übrig'),
      dBudget,
      h('dt', null, 'km'),
      dKm,
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn-big btn-sleep', onclick: () => app.openSleepChooser() },
        'Schlafen',
      ),
      h('button', { type: 'button', class: 'btn btn-big active', onclick: () => app.togglePause() }, 'Weiter'),
    ),
  );

  const update = () => {
    const plan = app.plan();
    const pause = app.openEntry('pause');
    if (!plan || !pause) return;
    const now = Math.max(app.now(), plan.cfg.startMs);
    const km = app.km();
    const log = app.activeRace().log;
    const s = snapshot(plan, km, now, log, null);

    setText(
      sinceLabel,
      `Pause seit (min) · ${pause.auto ? 'automatisch erkannt' : 'von Hand'} ${fmtClock(pause.startMs)}`,
    );
    setText(since, fmtInt(Math.max(0, (now - pause.startMs) / 60_000)));
    setText(resTarget, fmtInt(Math.floor(s.sleepAffordableTargetMin)));
    setTone(resTarget, s.sleepAffordableTargetMin <= 0 ? 'rot' : '');
    setText(resLimit, fmtInt(Math.floor(s.sleepAffordableLimitMin)));
    setTone(resLimit, s.sleepAffordableLimitMin <= 0 ? 'rot' : '');

    const d = Math.round(s.deltaMin);
    setText(dDelta, d > 0 ? `${fmtInt(d)} min Rückstand` : d < 0 ? `${fmtInt(-d)} min Vorsprung` : 'im Plan');
    setTone(dDelta, s.status);
    setText(
      dSpeed,
      `Ziel ${fmtSpeed(s.requiredSpeedTargetKmh)} · Limit ${fmtSpeed(s.requiredSpeedLimitKmh)} km/h`,
    );
    setTone(dSpeed, speedTone(s.requiredSpeedLimitKmh, plan.cfg.baseSpeedKmh));
    const budget = budgetRemainingMin(plan, log, now);
    setText(dBudget, `${fmtSigned(budget)} min`);
    setTone(dBudget, budget < 0 ? 'gelb' : '');
    setText(dKm, `${fmt1(km)} von ${fmt1(plan.totalKm)}`);
  };
  return { el, update };
}

// ---------- Rennen ----------

function raceView(app: App): Screen {
  const meta = app.meta!;

  const deltaLabel = h('div', { class: 'label' });
  const deltaValue = h('div', { class: 'big big-1' });

  const sleepLabel = h('div', { class: 'label' });
  const sleepTarget = h('div', { class: 'big big-2' });
  const sleepLimit = h('div', { class: 'big big-2' });

  const speedLabel = h('div', { class: 'label' });
  const speedTarget = h('div', { class: 'big big-2' });
  const speedLimit = h('div', { class: 'big big-2' });

  const whatIfButtons = WHAT_IF_MIN.map((min) => {
    const btn = h('button', { type: 'button', class: 'btn btn-toggle' }, `${min / 60} h`);
    btn.addEventListener('click', () => {
      app.whatIf = app.whatIf === min ? null : min;
      update();
    });
    return { min, btn };
  });

  const dKm = h('dd');
  const dNext = h('dd');
  const dEta = h('dd');
  const dElapsed = h('dd');
  const dPace = h('dd');
  const dPaceSleep = h('dd');
  const dGps = h('dd');
  const relocate = h(
    'button',
    { type: 'button', class: 'btn btn-small', onclick: () => (app.relocate(), update()) },
    'Position neu suchen',
  );

  // Notbetrieb: nur sichtbar, wenn GPS länger als 5 Minuten fehlt.
  const manualOut = h('span', { class: 'test-value' });
  const manual = h('input', {
    type: 'range',
    min: '0',
    max: String(Math.ceil(meta.totalKm)),
    step: '1',
    'aria-label': 'Streckenkilometer von Hand',
  });
  manual.addEventListener('input', () => {
    app.setManualKm(Math.min(meta.totalKm, Number(manual.value)));
    update();
  });
  const manualPanel = h(
    'div',
    { class: 'manual-panel', hidden: true },
    h('div', { class: 'manual-title' }, 'NOTBETRIEB · kein GPS'),
    h('label', null, h('span', null, 'km von Hand: ', manualOut), manual),
  );

  const el = h(
    'div',
    { class: 'screen race' },
    app.test.on ? testPanel(app) : null,
    h('section', { class: 'block' }, deltaLabel, deltaValue),
    h('section', { class: 'block' }, sleepLabel, pair(app, sleepTarget, sleepLimit)),
    h('section', { class: 'block' }, speedLabel, pair(app, speedTarget, speedLimit)),
    h(
      'div',
      { class: 'whatif' },
      h('span', { class: 'whatif-label' }, 'Was wäre wenn: Schlaf'),
      ...whatIfButtons.map((w) => w.btn),
    ),
    h(
      'dl',
      { class: 'details' },
      h('dt', null, 'km'),
      dKm,
      h('dt', null, 'Nächste Station'),
      dNext,
      h('dt', null, 'ETA Ziel'),
      dEta,
      h('dt', null, 'Seit Start'),
      dElapsed,
      h('dt', null, 'Tempo bisher'),
      dPace,
      h('dt', null, 'Schlaf bei dem Tempo'),
      dPaceSleep,
      h('dt', null, 'GPS'),
      dGps,
    ),
    relocate,
    manualPanel,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn-big btn-sleep', onclick: () => app.openSleepChooser() },
        'Schlafen',
      ),
      h('button', { type: 'button', class: 'btn btn-big', onclick: () => app.togglePause() }, 'Pause'),
    ),
  );

  function update(): void {
    const plan = app.plan();
    if (!plan) return;
    const realNow = app.now();
    const preStart = realNow < plan.cfg.startMs;
    const now = Math.max(realNow, plan.cfg.startMs);
    const km = app.km();
    const race = app.activeRace();
    const s = snapshot(plan, km, now, race.log, app.whatIf);

    // 1. Vorsprung / Rückstand
    if (preStart) {
      setText(deltaLabel, `Start in (h:min) · ${fmtDayClock(plan.cfg.startMs)}`);
      setText(deltaValue, fmtDur((plan.cfg.startMs - realNow) / 60_000));
      setTone(deltaValue, '');
    } else {
      const d = Math.round(s.deltaMin);
      setText(deltaLabel, d > 0 ? 'Rückstand (min)' : d < 0 ? 'Vorsprung (min)' : 'Im Plan (min)');
      setText(deltaValue, fmtInt(Math.abs(d)));
      setTone(deltaValue, s.status);
    }

    // 2. Schlaf noch möglich (bei "Was wäre wenn": Reserve nach diesem Schlaf)
    const wi = app.whatIf;
    setText(
      sleepLabel,
      wi === null ? 'Schlaf noch möglich (min)' : `Reserve nach ${wi / 60} h Schlaf (min)`,
    );
    for (const [node, v] of [
      [sleepTarget, s.sleepAffordableTargetMin - (wi ?? 0)],
      [sleepLimit, s.sleepAffordableLimitMin - (wi ?? 0)],
    ] as [HTMLElement, number][]) {
      setText(node, fmtSigned(v));
      setTone(node, Math.floor(v) <= 0 ? 'rot' : '');
    }

    // 3. Nötiger Fahrschnitt
    setText(speedLabel, `Nötiger Schnitt (km/h) bei noch ${fmtInt(s.sleepRestMin)} min Schlaf`);
    for (const [node, v] of [
      [speedTarget, s.requiredSpeedTargetKmh],
      [speedLimit, s.requiredSpeedLimitKmh],
    ] as [HTMLElement, number][]) {
      setText(node, fmtSpeed(v));
      setTone(node, speedTone(v, plan.cfg.baseSpeedKmh));
    }

    for (const w of whatIfButtons) w.btn.classList.toggle('active', app.whatIf === w.min);

    // Details
    setText(dKm, `${fmt1(km)} von ${fmt1(plan.totalKm)} · Rest ${fmt1(s.remainingKm)}`);
    setText(
      dNext,
      s.next
        ? `${s.next.name} in ${fmt1(s.next.distKm)} km · Soll ${fmtDayClock(s.next.plannedMs)}`
        : s.remainingKm > 0
          ? `Ziel in ${fmt1(s.remainingKm)} km`
          : 'im Ziel',
    );
    setText(dEta, `${fmtDayClock(s.etaMs)} · ${fmtDur((s.etaMs - plan.cfg.startMs) / 60_000)} h`);
    setText(dElapsed, preStart ? 'noch nicht gestartet' : `${fmtDur(s.elapsedMin)} h`);

    // Prognose mit dem echten Tempo
    if (s.pace && !preStart) {
      setText(dPace, `${fmt1(s.pace.actualKmh)} km/h · ${fmtInt(s.pace.factor * 100)} % vom Plan`);
      setTone(dPace, s.pace.factor < 0.95 ? 'gelb' : '');
      setText(
        dPaceSleep,
        `Ziel ${fmtInt(Math.floor(s.pace.sleepTargetMin))} · Limit ${fmtInt(Math.floor(s.pace.sleepLimitMin))} min`,
      );
      setTone(dPaceSleep, s.pace.sleepLimitMin <= 0 ? 'rot' : s.pace.sleepTargetMin <= 0 ? 'gelb' : '');
    } else {
      setText(dPace, 'noch zu wenig Strecke');
      setTone(dPace, '');
      setText(dPaceSleep, '–');
      setTone(dPaceSleep, '');
    }

    // GPS-Status und Notbetrieb
    const lost = !app.test.on && app.gpsLost();
    let gpsText: string;
    let gpsTone: Tone = 'gruen';
    let offRoute = false;
    if (app.test.on) {
      gpsText = 'Test-Modus';
      gpsTone = 'gelb';
    } else if (lost) {
      const since = Math.floor((Date.now() - (app.gps.lastFixMs ?? app.gps.sinceMs)) / 60_000);
      gpsText = `${app.gps.error ?? 'kein Signal'} seit ${fmtInt(since)} min`;
      gpsTone = 'rot';
    } else if (app.gps.lastFixMs === null) {
      gpsText = app.gps.error ?? 'warte auf Position';
      gpsTone = 'gelb';
    } else if (!app.gps.onRoute) {
      offRoute = true;
      gpsText = `neben der Strecke (${fmtInt(app.gps.distM ?? 0)} m)`;
      gpsTone = 'gelb';
    } else {
      gpsText = `ok · vor ${fmtInt((Date.now() - app.gps.lastFixMs) / 1000)} s${meta.free ? ' · km per GPS gezählt' : ''}`;
    }
    setText(dGps, gpsText);
    setTone(dGps, gpsTone);
    relocate.hidden = !offRoute;
    manualPanel.hidden = !lost;
    if (lost) {
      const v = String(Math.round(km));
      if (document.activeElement !== manual && manual.value !== v) manual.value = v;
      setText(manualOut, fmtInt(km));
    }
  }

  return { el, update };
}
