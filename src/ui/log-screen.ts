import { budgetRemainingMin, loggedMin } from '../model/budget';
import { logToCsv, logToJson } from '../state/export';
import type { LogEntry } from '../state/types';
import type { App, Screen } from './app';
import { download, h } from './dom';
import { fmt1, fmtDayClock, fmtInt } from './format';

const LABEL: Record<LogEntry['type'], string> = {
  pause: 'Pause',
  sleep: 'Schlaf',
  station: 'Zeitstation',
};

export function createLogScreen(app: App): Screen {
  const meta = app.meta;
  const plan = app.plan();
  if (!meta || !plan) {
    return { el: h('div', { class: 'screen empty' }, h('p', null, 'Noch keine Strecke geladen.')) };
  }
  const log = [...app.activeRace().log].sort((a, b) => b.startMs - a.startMs);
  const now = app.now();
  const fileBase = `rag-pacer-log-${meta.name.replace(/[^\w-]+/g, '_')}`;

  const rows = log.map((e) => {
    const dur =
      e.type === 'station'
        ? ''
        : e.endMs === null
          ? 'läuft'
          : `${fmtInt((e.endMs - e.startMs) / 60_000)} min`;
    const what = e.type === 'station' ? (e.name ?? '') : e.type === 'pause' ? (e.auto ? 'automatisch' : 'von Hand') : '';
    return h(
      'tr',
      null,
      h('td', null, fmtDayClock(e.startMs)),
      h('td', null, LABEL[e.type]),
      h('td', null, what),
      h('td', { class: 'num' }, dur),
      h('td', { class: 'num' }, fmt1(e.km)),
    );
  });

  return {
    el: h(
      'div',
      { class: 'screen log' },
      h(
        'section',
        { class: 'card' },
        h('h2', null, app.test.on ? 'Log (Test-Modus)' : 'Log'),
        h(
          'div',
          { class: 'summary' },
          h('div', null, `Pausen: ${fmtInt(loggedMin(log, 'pause', now))} min · Schlaf: ${fmtInt(loggedMin(log, 'sleep', now))} min`),
          h('div', null, `Pausenbudget übrig: ${fmtInt(budgetRemainingMin(plan, log, now))} min`),
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => download(`${fileBase}.csv`, 'text/csv;charset=utf-8', logToCsv(log, meta)),
            },
            'Export CSV',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => download(`${fileBase}.json`, 'application/json', logToJson(log, meta)),
            },
            'Export JSON',
          ),
        ),
        log.length
          ? h(
              'table',
              { class: 'log-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, 'Beginn'),
                  h('th', null, 'Art'),
                  h('th', null, ''),
                  h('th', { class: 'num' }, 'Dauer'),
                  h('th', { class: 'num' }, 'km'),
                ),
              ),
              h('tbody', null, ...rows),
            )
          : h('p', { class: 'muted' }, 'Noch keine Einträge.'),
      ),
    ),
  };
}
