import { RED_LINE_FACTOR, snapshot } from '../model/budget';
import type { App, Screen } from './app';
import { h } from './dom';
import { fmt1, fmtClock, fmtDayClock, fmtDur, fmtInt } from './format';

const WHAT_IF_MIN = [180, 240];

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setTone(el: HTMLElement, tone: 'gruen' | 'gelb' | 'rot' | ''): void {
  if (el.dataset.tone !== tone) el.dataset.tone = tone;
}

export function createMainScreen(app: App): Screen {
  if (!app.meta) {
    return {
      el: h(
        'div',
        { class: 'screen empty' },
        h('p', null, 'Noch keine Strecke geladen.'),
        h('button', { type: 'button', class: 'btn btn-big', onclick: () => app.show('setup') }, 'Zum Setup'),
      ),
    };
  }
  return app.openEntry('sleep') ? sleepView(app) : raceView(app);
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

  const update = () => {
    const entry = app.openEntry('sleep');
    if (!entry) return;
    const now = app.now();
    const wakeMs = app.activeRace().sleepWakeMs ?? entry.startMs;
    const planned = Math.round((wakeMs - entry.startMs) / 60_000);
    const left = Math.ceil((wakeMs - now) / 60_000);
    setText(wake, fmtClock(wakeMs));
    if (planned <= 0) {
      setText(restLabel, 'Kein Schlaf mehr im Plan · schläft seit (min)');
      setText(rest, fmtInt((now - entry.startMs) / 60_000));
      setTone(rest, 'rot');
    } else if (left >= 0) {
      setText(restLabel, 'Noch Minuten');
      setText(rest, fmtInt(left));
      setTone(rest, '');
    } else {
      setText(restLabel, 'Überzogen um Minuten');
      setText(rest, fmtInt(-left));
      setTone(rest, 'rot');
    }
    setText(
      hint,
      `Wecker im Handy auf ${fmtClock(wakeMs)} stellen · Vorschlag ${fmtInt(planned)} min · eingeschlafen ${fmtClock(entry.startMs)}`,
    );
  };
  return { el, update };
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

  const pair = (a: HTMLElement, b: HTMLElement) =>
    h(
      'div',
      { class: 'pair' },
      h('div', null, a, h('div', { class: 'sub' }, `Ziel ${fmtInput1(meta.cfg.targetH)} h`)),
      h('div', null, b, h('div', { class: 'sub' }, `Limit ${fmtInput1(meta.cfg.limitH)} h`)),
    );

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

  const pauseBtn = h('button', { type: 'button', class: 'btn btn-big', onclick: () => app.togglePause() });
  const sleepBtn = h(
    'button',
    { type: 'button', class: 'btn btn-big btn-sleep', onclick: () => app.startSleep() },
    'Schlafen',
  );

  const el = h(
    'div',
    { class: 'screen race' },
    app.test.on ? testPanel(app) : null,
    h('section', { class: 'block' }, deltaLabel, deltaValue),
    h('section', { class: 'block' }, sleepLabel, pair(sleepTarget, sleepLimit)),
    h('section', { class: 'block' }, speedLabel, pair(speedTarget, speedLimit)),
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
      h('dt', null, 'GPS'),
      dGps,
    ),
    relocate,
    manualPanel,
    h('div', { class: 'actions' }, sleepBtn, pauseBtn),
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
    const sleepVals: [HTMLElement, number][] = [
      [sleepTarget, s.sleepAffordableTargetMin - (wi ?? 0)],
      [sleepLimit, s.sleepAffordableLimitMin - (wi ?? 0)],
    ];
    setText(
      sleepLabel,
      wi === null ? 'Schlaf noch möglich (min)' : `Reserve nach ${wi / 60} h Schlaf (min)`,
    );
    for (const [node, v] of sleepVals) {
      const r = Math.floor(v);
      setText(node, r < 0 ? `−${fmtInt(-r)}` : fmtInt(r));
      setTone(node, r <= 0 ? 'rot' : '');
    }

    // 3. Nötiger Fahrschnitt
    setText(speedLabel, `Nötiger Schnitt (km/h) bei noch ${fmtInt(s.sleepRestMin)} min Schlaf`);
    const base = plan.cfg.baseSpeedKmh;
    for (const [node, v] of [
      [speedTarget, s.requiredSpeedTargetKmh],
      [speedLimit, s.requiredSpeedLimitKmh],
    ] as [HTMLElement, number][]) {
      const impossible = !Number.isFinite(v) || v > 99;
      setText(node, impossible ? '–' : fmt1(v));
      setTone(node, impossible || v > base * RED_LINE_FACTOR ? 'rot' : v > base ? 'gelb' : '');
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

    // GPS-Status und Notbetrieb
    const lost = !app.test.on && app.gpsLost();
    let gpsText: string;
    let gpsTone: 'gruen' | 'gelb' | 'rot' = 'gruen';
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
      gpsText = `ok · vor ${fmtInt((Date.now() - app.gps.lastFixMs) / 1000)} s`;
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

    // Knöpfe
    const pause = app.openEntry('pause');
    setText(
      pauseBtn,
      pause ? `Pause beenden · ${fmtInt(Math.max(0, (realNow - pause.startMs) / 60_000))} min` : 'Pause',
    );
    pauseBtn.classList.toggle('active', pause !== null);
  }

  return { el, update };
}

function fmtInput1(x: number): string {
  return String(x).replace('.', ',');
}
