import {
  plannedArrivalAt,
  plannedSleepTotalMin,
  rideMin,
  totalPauseBudgetMin,
} from '../model/budget';
import { parseGpx, type ParsedGpx } from '../model/gpx';
import { buildRoute, routeTotalKm } from '../model/route';
import { defaultStationsText } from '../state/defaults';
import type { FatigueStep, RaceConfig, SleepBlock, Station } from '../state/types';
import type { App, Screen } from './app';
import { h, twoTapButton } from './dom';
import {
  fmt1,
  fmtDayClock,
  fmtDur,
  fmtInput,
  fmtInt,
  fromLocalInput,
  parseDe,
  parseStations,
  stationsToText,
  toLocalInput,
} from './format';

export function createSetupScreen(app: App): Screen {
  const notice = app.notice;
  app.notice = null;
  return {
    el: h(
      'div',
      { class: 'screen setup' },
      notice ? h('div', { class: 'notice', role: 'status' }, notice) : null,
      routesSection(app),
      app.meta ? planSection(app) : null,
      deviceSection(app),
    ),
  };
}

function errorBox(): { el: HTMLElement; show(messages: string[]): void } {
  const el = h('div', { class: 'errors', hidden: true, role: 'alert' });
  return {
    el,
    show(messages) {
      el.hidden = messages.length === 0;
      el.replaceChildren(...messages.map((m) => h('div', null, m)));
      if (messages.length) el.scrollIntoView({ block: 'center' });
    },
  };
}

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

function numInput(value: number): HTMLInputElement {
  return h('input', { type: 'text', inputmode: 'decimal', value: fmtInput(value), autocomplete: 'off' });
}

// ---------- Strecken: Liste und GPX-Import ----------

function routesSection(app: App): HTMLElement {
  const list = h('div', { class: 'route-list' });
  for (const r of app.routes) {
    const active = app.meta?.id === r.id;
    list.append(
      h(
        'div',
        { class: active ? 'route active' : 'route' },
        h(
          'div',
          { class: 'route-info' },
          h('strong', null, r.name),
          h(
            'span',
            null,
            r.free
              ? `ohne Strecke · ${fmt1(r.totalKm)} km · ${r.stations.length} Zeitstationen`
              : `${fmt1(r.totalKm)} km · ${fmtInt(r.ascentM)} hm · ${r.stations.length} Zeitstationen`,
          ),
        ),
        active
          ? h('span', { class: 'badge' }, 'aktiv')
          : h('button', { type: 'button', class: 'btn btn-small', onclick: () => void app.selectRoute(r.id) }, 'Wählen'),
        twoTapButton('Löschen', 'Wirklich?', () => void app.deleteRoute(r.id)),
      ),
    );
  }
  if (!app.routes.length) list.append(h('p', { class: 'muted' }, 'Noch keine Strecke gespeichert.'));

  // Import
  const errors = errorBox();
  const file = h('input', { type: 'file', accept: '.gpx,application/gpx+xml,application/xml,text/xml' });
  const info = h('p', { class: 'muted' }, 'GPX-Datei wählen (Track oder Route).');
  const name = h('input', { type: 'text', autocomplete: 'off' });
  const stations = h('textarea', { rows: 7, spellcheck: false, value: defaultStationsText() });
  const importBtn = h('button', { type: 'button', class: 'btn', disabled: true }, 'Strecke importieren');
  let pending: { gpx: ParsedGpx; totalKm: number } | null = null;

  file.addEventListener('change', async () => {
    pending = null;
    importBtn.disabled = true;
    errors.show([]);
    const f = file.files?.[0];
    if (!f) return;
    try {
      const gpx = parseGpx(await f.text());
      const route = buildRoute(gpx.points);
      pending = { gpx, totalKm: routeTotalKm(route) };
      name.value = gpx.name ?? f.name.replace(/\.gpx$/i, '');
      info.textContent = `${fmt1(pending.totalKm)} km · ${fmtInt(route.ascentM)} hm · ${fmtInt(gpx.points.length)} Punkte`;
      importBtn.disabled = false;
    } catch (e) {
      info.textContent = 'GPX-Datei wählen (Track oder Route).';
      errors.show([e instanceof Error ? e.message : 'Die Datei konnte nicht gelesen werden.']);
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!pending) return;
    const parsed = parseStations(stations.value, pending.totalKm);
    const msgs = [...parsed.errors];
    if (!name.value.trim()) msgs.push('Name der Strecke fehlt.');
    errors.show(msgs);
    if (msgs.length) return;
    importBtn.disabled = true;
    await app.importRoute(pending.gpx, name.value.trim(), parsed.stations);
  });

  // Fahrt ohne Strecke
  const freeErrors = errorBox();
  const freeName = h('input', { type: 'text', autocomplete: 'off', value: 'Freie Fahrt' });
  const freeKm = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' });
  const freeBtn = h('button', { type: 'button', class: 'btn' }, 'Fahrt ohne Strecke anlegen');
  freeBtn.addEventListener('click', async () => {
    const km = parseDe(freeKm.value);
    const msgs: string[] = [];
    if (!freeName.value.trim()) msgs.push('Name fehlt.');
    if (!Number.isFinite(km) || km <= 0) msgs.push('Geplante Distanz: bitte eine Zahl größer als 0 eingeben.');
    freeErrors.show(msgs);
    if (msgs.length) return;
    freeBtn.disabled = true;
    await app.createFreeRide(freeName.value.trim(), km);
  });

  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Strecken'),
    list,
    h('h3', null, 'Neue Strecke laden'),
    field('GPX-Datei', file),
    info,
    field('Name', name),
    field(
      'Zeitstationen (eine pro Zeile: Name, km)',
      stations,
      'Nicht benötigte Zeilen löschen, z. B. bei Testfahrten. Die km lassen sich später ändern.',
    ),
    errors.el,
    importBtn,
    h('h3', null, 'Ohne Strecke fahren'),
    h(
      'p',
      { class: 'muted' },
      'Nur die geplante Distanz eingeben. Die App zählt die gefahrenen km per GPS mit, solange sie offen ist. Das ist ungenauer als mit GPX: Kurven werden abgeschnitten, Lücken zählen nur als Luftlinie.',
    ),
    h('div', { class: 'grid' }, field('Name', freeName), field('Geplante Distanz (km)', freeKm)),
    freeErrors.el,
    freeBtn,
  );
}

// ---------- Aktive Strecke: Plan bearbeiten ----------

function planSection(app: App): HTMLElement {
  const meta = app.meta!;
  const c = meta.cfg;
  const errors = errorBox();

  const name = h('input', { type: 'text', value: meta.name, autocomplete: 'off' });
  const stations = h('textarea', { rows: Math.max(3, meta.stations.length + 1), spellcheck: false, value: stationsToText(meta.stations) });
  const distance = meta.free ? numInput(meta.totalKm) : null;
  /** Streckenlänge: bei Fahrten ohne Strecke aus dem Eingabefeld, sonst aus der GPX. */
  const totalKm = (): number => {
    const v = distance ? parseDe(distance.value) : meta.totalKm;
    return Number.isFinite(v) && v > 0 ? v : meta.totalKm;
  };
  const start = h('input', { type: 'datetime-local', value: toLocalInput(c.startMs) });
  const limit = numInput(c.limitH);
  const target = numInput(c.targetH);
  const base = numInput(c.baseSpeedKmh);
  const stationPause = numInput(c.stationPauseMin);
  const peeInterval = numInput(c.peeIntervalH);
  const peeMin = numInput(c.peeMin);
  const shopCount = numInput(c.shopCount);
  const shopMin = numInput(c.shopMin);
  const tech = numInput(c.techBufferMin);

  // Abschnittsfaktoren: ein Feld pro Abschnitt, folgt der Stationsliste.
  const factorBox = h('div', { class: 'grid' });
  let factorInputs: HTMLInputElement[] = [];
  const renderFactors = () => {
    const parsed = parseStations(stations.value, totalKm()).stations;
    const names = ['Start', ...parsed.map((s) => s.name), 'Ziel'];
    const old = factorInputs.map((i) => i.value);
    factorInputs = [];
    factorBox.replaceChildren();
    for (let i = 0; i < names.length - 1; i++) {
      const input = h('input', {
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        value: old[i] ?? fmtInput(c.sectionFactors[i] ?? 1),
      });
      factorInputs.push(input);
      factorBox.append(field(`${names[i]} → ${names[i + 1]}`, input));
    }
  };
  renderFactors();
  stations.addEventListener('change', renderFactors);

  // Schlafblöcke
  const blockBox = h('div', { class: 'blocks' });
  const blockRows: { after: HTMLInputElement; min: HTMLInputElement; row: HTMLElement }[] = [];
  const sleepSum = h('p', { class: 'muted' });
  const updateSum = () => {
    const sum = blockRows.reduce((a, b) => a + (Number.isFinite(parseDe(b.min.value)) ? parseDe(b.min.value) : 0), 0);
    sleepSum.textContent = `Geplanter Gesamtschlaf: ${fmtInt(sum)} min`;
  };
  const addBlock = (b: SleepBlock) => {
    const after = numInput(b.afterH);
    const min = numInput(b.min);
    min.addEventListener('input', updateSum);
    const entry = { after, min, row: h('div', { class: 'block-row' }) };
    entry.row.append(
      field('nach Rennstunde', after),
      field('Minuten', min),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          'aria-label': 'Block entfernen',
          onclick: () => {
            blockRows.splice(blockRows.indexOf(entry), 1);
            entry.row.remove();
            updateSum();
          },
        },
        'Entfernen',
      ),
    );
    blockRows.push(entry);
    blockBox.append(entry.row);
    updateSum();
  };
  [...c.sleepBlocks].sort((a, b) => a.afterH - b.afterH).forEach(addBlock);
  updateSum();

  // Ermüdung: Stufen nach Fahrstunden
  const fatigueBox = h('div', { class: 'blocks' });
  const fatigueRows: { after: HTMLInputElement; factor: HTMLInputElement; row: HTMLElement }[] = [];
  const addFatigue = (st: FatigueStep) => {
    const entry = { after: numInput(st.afterRideH), factor: numInput(st.factor), row: h('div', { class: 'block-row' }) };
    entry.row.append(
      field('ab Fahrstunde', entry.after),
      field('Faktor', entry.factor),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          'aria-label': 'Stufe entfernen',
          onclick: () => {
            fatigueRows.splice(fatigueRows.indexOf(entry), 1);
            entry.row.remove();
          },
        },
        'Entfernen',
      ),
    );
    fatigueRows.push(entry);
    fatigueBox.append(entry.row);
  };
  [...c.fatigue].sort((a, b) => a.afterRideH - b.afterRideH).forEach(addFatigue);

  const save = h('button', { type: 'button', class: 'btn btn-big' }, 'Speichern');
  save.addEventListener('click', async () => {
    const msgs: string[] = [];
    const num = (label: string, input: HTMLInputElement, min: number, exclusive = false): number => {
      const v = parseDe(input.value);
      if (!Number.isFinite(v) || v < min || (exclusive && v === min)) {
        msgs.push(`${label}: bitte eine Zahl ${exclusive ? 'größer als' : 'ab'} ${fmtInput(min)} eingeben.`);
        return NaN;
      }
      return v;
    };

    const parsed = parseStations(stations.value, totalKm());
    msgs.push(...parsed.errors);
    const st: Station[] = parsed.stations;
    if (distance) {
      const d = parseDe(distance.value);
      if (!Number.isFinite(d) || d <= 0) msgs.push('Geplante Distanz: bitte eine Zahl größer als 0 eingeben.');
    }
    if (!name.value.trim()) msgs.push('Name der Strecke fehlt.');
    const startMs = fromLocalInput(start.value);
    if (!Number.isFinite(startMs)) msgs.push('Startzeit fehlt.');

    renderFactors();
    const cfg: RaceConfig = {
      startMs,
      limitH: num('Zeitlimit', limit, 0, true),
      targetH: num('Zielzeit', target, 0, true),
      baseSpeedKmh: num('Basis-Schnitt', base, 0, true),
      sectionFactors: factorInputs.map((inp, i) => num(`Abschnittsfaktor ${i + 1}`, inp, 0, true)),
      stationPauseMin: num('Pause je Zeitstation', stationPause, 0),
      peeIntervalH: num('Pipi-Intervall', peeInterval, 0),
      peeMin: num('Pipi-Dauer', peeMin, 0),
      shopCount: num('Einkaufen Anzahl', shopCount, 0),
      shopMin: num('Einkaufen Dauer', shopMin, 0),
      techBufferMin: num('Technik-Puffer', tech, 0),
      sleepBlocks: blockRows.map((b, i) => ({
        afterH: num(`Schlafblock ${i + 1} (Rennstunde)`, b.after, 0),
        min: num(`Schlafblock ${i + 1} (Minuten)`, b.min, 0),
      })),
      fatigue: fatigueRows.map((r, i) => ({
        afterRideH: num(`Ermüdung ${i + 1} (Fahrstunde)`, r.after, 0),
        factor: num(`Ermüdung ${i + 1} (Faktor)`, r.factor, 0, true),
      })),
    };
    if (cfg.targetH > cfg.limitH) msgs.push('Die Zielzeit darf nicht über dem Zeitlimit liegen.');
    errors.show(msgs);
    if (msgs.length) return;
    await app.saveMeta({ name: name.value.trim(), stations: st, cfg, ...(distance ? { totalKm: totalKm() } : {}) });
  });

  // Zusammenfassung des gespeicherten Plans
  const plan = app.plan()!;
  const arrival = plannedArrivalAt(plan, plan.totalKm);
  const totalMin = (arrival - c.startMs) / 60_000;
  const summary = h(
    'div',
    { class: 'summary' },
    h('div', null, `Plan-Ankunft: ${fmtDayClock(arrival)} · ${fmtDur(totalMin)} h nach dem Start`),
    h(
      'div',
      null,
      `Fahrzeit ${fmtDur(rideMin(plan, plan.totalKm))} h · Pausen ${fmtInt(totalPauseBudgetMin(plan))} min · Schlaf ${fmtInt(plannedSleepTotalMin(plan))} min`,
    ),
    h(
      'div',
      null,
      `Reserve: ${fmtInt(c.targetH * 60 - totalMin)} min bis zur Zielzeit, ${fmtInt(c.limitH * 60 - totalMin)} min bis zum Zeitlimit`,
    ),
  );

  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Aktive Strecke'),
    h(
      'p',
      { class: 'muted' },
      meta.free
        ? `Ohne Strecke · ${fmt1(meta.totalKm)} km · km werden per GPS gezählt`
        : `${fmt1(meta.totalKm)} km · ${fmtInt(meta.ascentM)} hm`,
    ),
    summary,
    field('Name', name),
    distance ? field('Geplante Distanz (km)', distance) : null,
    field('Zeitstationen (eine pro Zeile: Name, km)', stations),
    h('h3', null, 'Zeiten'),
    field('Startzeit', start),
    h('div', { class: 'grid' }, field('Zeitlimit (h)', limit), field('Zielzeit mit Puffer (h)', target)),
    h('h3', null, 'Fahrschnitt'),
    field('Basis-Schnitt (km/h)', base),
    h('p', { class: 'muted' }, 'Faktor je Abschnitt (1,0 = Basis-Schnitt, 0,85 = 15 % langsamer):'),
    factorBox,
    h('h3', null, 'Pausenbudget'),
    h(
      'div',
      { class: 'grid' },
      field('Je Zeitstation (min)', stationPause),
      field('Technik-Puffer (min)', tech),
      field('Pipi alle (h Fahrzeit)', peeInterval),
      field('Pipi Dauer (min)', peeMin),
      field('Einkaufen (Anzahl)', shopCount),
      field('Einkaufen Dauer (min)', shopMin),
    ),
    h('h3', null, 'Schlafplan'),
    blockBox,
    sleepSum,
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => addBlock({ afterH: 0, min: 0 }) }, 'Block hinzufügen'),
    h('h3', null, 'Ermüdung'),
    h(
      'p',
      { class: 'muted' },
      'Ab einer Zahl von Fahrstunden (reine Fahrzeit, ohne Pausen und Schlaf) gilt ein Faktor auf den Plan-Schnitt, z. B. ab Fahrstunde 20 Faktor 0,95. Ohne Stufen rechnet der Plan ohne Ermüdung.',
    ),
    fatigueBox,
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => addFatigue({ afterRideH: 0, factor: 1 }) }, 'Stufe hinzufügen'),
    errors.el,
    save,
  );
}

// ---------- Gerät und Rennen ----------

function deviceSection(app: App): HTMLElement {
  const wake = h('input', { type: 'checkbox', checked: app.settings.wakeLock });
  wake.addEventListener('change', () => void app.setWakeLock(wake.checked));
  const alarm = h('input', { type: 'checkbox', checked: app.settings.alarm });
  alarm.addEventListener('change', () => void app.setAlarm(alarm.checked));
  const supported = 'wakeLock' in navigator;
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Gerät'),
    h(
      'label',
      { class: 'check' },
      wake,
      h('span', null, 'Display anlassen, solange die App offen ist (kostet Akku)'),
    ),
    supported ? null : h('p', { class: 'muted' }, 'Dieses Gerät kann das Display nicht anlassen.'),
    h(
      'label',
      { class: 'check' },
      alarm,
      h('span', null, 'Wecker in der App: klingelt und vibriert zur Weckzeit, hält beim Schlafen das Display an'),
    ),
    h(
      'p',
      { class: 'muted' },
      'Der App-Wecker klingelt nur, solange die App offen und im Vordergrund ist. Den Handy-Wecker immer zusätzlich stellen.',
    ),
    app.meta
      ? h(
          'div',
          { class: 'reset' },
          h('h3', null, 'Rennen zurücksetzen'),
          h('p', { class: 'muted' }, 'Löscht Position und Log der aktiven Strecke. Vorher im Log exportieren.'),
          twoTapButton('Zurücksetzen', 'Wirklich alles löschen?', () => void app.resetRace(), 'btn btn-danger'),
        )
      : null,
  );
}
