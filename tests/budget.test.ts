import { describe, expect, it } from 'vitest';
import {
  budgetRemainingMin,
  deadlineMs,
  deltaMin,
  etaFinishMs,
  flexPauseMin,
  loggedMin,
  napPreview,
  nextStation,
  pace,
  plannedArrivalAt,
  plannedElapsedMin,
  plannedPauseMin,
  plannedSleepBeforeMin,
  plannedSleepTotalMin,
  redLine,
  remainingKm,
  remainingPlannedSleepMin,
  remainingTimeMin,
  requiredSpeedKmh,
  restPauseMin,
  restRideMin,
  rideMin,
  sectionBounds,
  sleepAffordableMin,
  snapshot,
  suggestSleepMin,
  totalPauseBudgetMin,
} from '../src/model/budget';
import type { LogEntry, Plan, RaceConfig } from '../src/state/types';

const MIN = 60_000;
const H = 60 * MIN;
const START = Date.UTC(2027, 6, 9, 6, 0, 0);

const cfg = (over: Partial<RaceConfig> = {}): RaceConfig => ({
  startMs: START,
  limitH: 57,
  targetH: 55,
  baseSpeedKmh: 25,
  sectionFactors: [],
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
  ...over,
});

/** RAG-ähnlicher Plan: 1.100 km, 6 Stationen, Standardwerte. */
const rag = (over: Partial<RaceConfig> = {}): Plan => ({
  totalKm: 1100,
  stations: [
    { name: 'A', km: 200 },
    { name: 'B', km: 400 },
    { name: 'C', km: 600 },
    { name: 'D', km: 800 },
    { name: 'E', km: 950 },
    { name: 'F', km: 1030 },
  ],
  cfg: cfg(over),
});

/** Minimalplan ohne Pausen und Schlaf: 100 km, 25 km/h → 4 h Fahrzeit, Limit 6 h, Ziel 5 h. */
const simple = (over: Partial<RaceConfig> = {}): Plan => ({
  totalKm: 100,
  stations: [],
  cfg: cfg({
    limitH: 6,
    targetH: 5,
    stationPauseMin: 0,
    peeMin: 0,
    shopCount: 0,
    techBufferMin: 0,
    sleepBlocks: [],
    ...over,
  }),
});

describe('Fahrzeit', () => {
  it('rechnet mit dem Basis-Schnitt', () => {
    expect(rideMin(rag(), 0)).toBe(0);
    expect(rideMin(rag(), 250)).toBeCloseTo(600, 9);
    expect(rideMin(rag(), 1100)).toBeCloseTo(44 * 60, 9);
  });

  it('wendet Abschnittsfaktoren an', () => {
    const p = rag({ sectionFactors: [1, 1, 1, 1, 1, 1, 0.85] });
    expect(sectionBounds(p)).toEqual([0, 200, 400, 600, 800, 950, 1030, 1100]);
    // letzter Abschnitt: 70 km mit 21,25 km/h
    expect(rideMin(p, 1100)).toBeCloseTo((1030 / 25) * 60 + (70 / 21.25) * 60, 9);
    expect(rideMin(p, 1030)).toBeCloseTo((1030 / 25) * 60, 9);
    expect(restRideMin(p, 1030)).toBeCloseTo((70 / 21.25) * 60, 9);
  });

  it('begrenzt km auf die Strecke', () => {
    expect(rideMin(rag(), -5)).toBe(0);
    expect(rideMin(rag(), 5000)).toBeCloseTo(44 * 60, 9);
  });
});

describe('Pausen', () => {
  it('Gesamtbudget: Stationen + Einkaufen + Technik + Pipi nach Fahrzeit', () => {
    // 6×15 + 3×25 + 60 + (44 h / 3,5 h)×4
    expect(totalPauseBudgetMin(rag())).toBeCloseTo(90 + 75 + 60 + (44 / 3.5) * 4, 9);
  });

  it('verteilt Pipi/Einkaufen/Technik proportional zur Fahrzeit', () => {
    const p = rag();
    expect(flexPauseMin(p, 0)).toBe(0);
    expect(flexPauseMin(p, 550)).toBeCloseTo(flexPauseMin(p, 1100) / 2, 9);
    // langsamer Abschnitt bekommt mehr Pause pro km
    const slow = rag({ sectionFactors: [0.5] });
    expect(flexPauseMin(slow, 200) / flexPauseMin(slow, 1100)).toBeGreaterThan(200 / 1100);
  });

  it('zählt eine Stationspause erst hinter der Station', () => {
    const p = rag();
    expect(plannedPauseMin(p, 200) - flexPauseMin(p, 200)).toBeCloseTo(0, 9);
    expect(plannedPauseMin(p, 200.01) - flexPauseMin(p, 200.01)).toBeCloseTo(15, 9);
    expect(plannedPauseMin(p, 1100) - flexPauseMin(p, 1100)).toBeCloseTo(90, 9);
  });

  it('Restpausen = Budget minus bis hierher geplante Pausen', () => {
    const p = rag();
    expect(restPauseMin(p, 0)).toBeCloseTo(totalPauseBudgetMin(p), 9);
    expect(restPauseMin(p, 1100)).toBeCloseTo(0, 9);
    expect(restPauseMin(p, 1040)).toBeCloseTo(flexPauseMin(p, 1100) - flexPauseMin(p, 1040), 9);
  });

  it('Pipi-Intervall 0 schaltet Pipi ab', () => {
    expect(totalPauseBudgetMin(rag({ peeIntervalH: 0 }))).toBeCloseTo(90 + 75 + 60, 9);
  });
});

describe('Schlafplan nach Rennstunde', () => {
  it('zählt einen Block erst nach seinem Beginn', () => {
    const p = simple({ sleepBlocks: [{ afterH: 2, min: 60 }], limitH: 8, targetH: 7 });
    expect(plannedElapsedMin(p, 50)).toBeCloseTo(120, 9); // genau bei 2 h: noch nicht geschlafen
    expect(plannedElapsedMin(p, 51)).toBeCloseTo(122.4 + 60, 9);
    expect(plannedElapsedMin(p, 100)).toBeCloseTo(300, 9);
  });

  it('reiht überlappende Blöcke hintereinander', () => {
    const p = simple({
      sleepBlocks: [
        { afterH: 2.5, min: 30 },
        { afterH: 2, min: 60 },
      ],
    });
    // 51 km → 122,4 min; Block 1 (ab 2 h) +60 → 182,4 > 150 → Block 2 +30
    expect(plannedElapsedMin(p, 51)).toBeCloseTo(122.4 + 90, 9);
  });

  it('ignoriert Blöcke, die nach der Plan-Ankunft lägen', () => {
    const p = simple({ sleepBlocks: [{ afterH: 10, min: 120 }] });
    expect(plannedSleepTotalMin(p)).toBe(0);
    expect(plannedElapsedMin(p, 100)).toBeCloseTo(240, 9);
  });

  it('RAG-Standardplan enthält 210 min Schlaf und bleibt unter der Zielzeit', () => {
    const p = rag();
    expect(plannedSleepTotalMin(p)).toBe(210);
    const total = plannedElapsedMin(p, 1100);
    expect(total).toBeCloseTo(44 * 60 + totalPauseBudgetMin(p) + 210, 9);
    expect(total).toBeLessThan(55 * 60);
  });

  it('plannedSleepBeforeMin ohne Blöcke ist 0', () => {
    expect(plannedSleepBeforeMin(simple(), 9999)).toBe(0);
  });
});

describe('planned_arrival_at und delta', () => {
  it('Start: Ankunft = Startzeit, delta 0', () => {
    const p = rag();
    expect(plannedArrivalAt(p, 0)).toBe(START);
    expect(deltaMin(p, 0, START)).toBe(0);
  });

  it('ist monoton steigend über die Strecke', () => {
    const p = rag({ sectionFactors: [1, 1, 1, 1, 0.95, 0.9, 0.85] });
    let prev = -1;
    for (let km = 0; km <= 1100; km += 2.5) {
      const t = plannedArrivalAt(p, km);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('delta positiv = Rückstand, negativ = Vorsprung', () => {
    const p = rag();
    const plan = plannedArrivalAt(p, 500);
    expect(deltaMin(p, 500, plan + 30 * MIN)).toBeCloseTo(30, 9);
    expect(deltaMin(p, 500, plan - 45 * MIN)).toBeCloseTo(-45, 9);
  });

  it('Ziel: Ankunft = Start + gesamte Planzeit', () => {
    const p = simple();
    expect(plannedArrivalAt(p, 100)).toBe(START + 4 * H);
    expect(remainingKm(p, 100)).toBe(0);
    expect(remainingKm(p, 130)).toBe(0);
    expect(remainingKm(p, 40)).toBe(60);
  });
});

describe('Restzeit', () => {
  it('bis Zeitlimit und Zielzeit', () => {
    const p = rag();
    expect(deadlineMs(p, 'limit')).toBe(START + 57 * H);
    expect(remainingTimeMin(p, START, 'limit')).toBe(57 * 60);
    expect(remainingTimeMin(p, START + 10 * H, 'target')).toBe(45 * 60);
    expect(remainingTimeMin(p, START + 58 * H, 'limit')).toBe(-60);
  });
});

describe('Protokoll', () => {
  const log: LogEntry[] = [
    { type: 'pause', startMs: START + 1 * H, endMs: START + 1 * H + 10 * MIN, km: 25 },
    { type: 'sleep', startMs: START + 22 * H, endMs: START + 23 * H, km: 500 },
    { type: 'station', startMs: START + 8 * H, endMs: START + 8 * H, km: 200, name: 'A' },
    { type: 'pause', startMs: START + 30 * H, endMs: null, km: 700 },
  ];

  it('summiert abgeschlossene und laufende Einträge', () => {
    expect(loggedMin(log, 'pause', START + 30 * H + 5 * MIN)).toBeCloseTo(15, 9);
    expect(loggedMin(log, 'sleep', START + 30 * H)).toBe(60);
    expect(loggedMin(log, 'station', START + 30 * H)).toBe(0);
  });

  it('zählt nichts aus der Zukunft', () => {
    expect(loggedMin(log, 'pause', START)).toBe(0);
    expect(loggedMin(log, 'sleep', START + 22 * H + 20 * MIN)).toBe(20);
  });

  it('budget_remaining = Budget minus protokollierte Pausen, darf negativ werden', () => {
    const p = rag();
    const now = START + 30 * H + 5 * MIN;
    expect(budgetRemainingMin(p, log, now)).toBeCloseTo(totalPauseBudgetMin(p) - 15, 9);
    const viel: LogEntry[] = [{ type: 'pause', startMs: START, endMs: START + 10 * H, km: 0 }];
    expect(budgetRemainingMin(p, viel, now)).toBeLessThan(0);
  });

  it('restlicher Plan-Schlaf', () => {
    const p = rag();
    expect(remainingPlannedSleepMin(p, [], START)).toBe(210);
    expect(remainingPlannedSleepMin(p, log, START + 30 * H)).toBe(150);
    const lang: LogEntry[] = [{ type: 'sleep', startMs: START, endMs: START + 5 * H, km: 0 }];
    expect(remainingPlannedSleepMin(p, lang, START + 30 * H)).toBe(0);
  });
});

describe('sleep_affordable', () => {
  it('am Start: Limit bzw. Zielzeit minus Fahrzeit und Pausen', () => {
    const p = simple();
    expect(sleepAffordableMin(p, 0, START, 'limit')).toBeCloseTo(120, 9);
    expect(sleepAffordableMin(p, 0, START, 'target')).toBeCloseTo(60, 9);
  });

  it('RAG am Start', () => {
    const p = rag();
    const need = 44 * 60 + totalPauseBudgetMin(p);
    expect(sleepAffordableMin(p, 0, START, 'limit')).toBeCloseTo(57 * 60 - need, 9);
    expect(sleepAffordableMin(p, 0, START, 'target')).toBeCloseTo(55 * 60 - need, 9);
  });

  it('ist 0, wenn der Rückstand größer als das Limit ist', () => {
    const p = simple();
    expect(sleepAffordableMin(p, 0, START + 10 * H, 'limit')).toBe(0);
    expect(sleepAffordableMin(p, 50, START + 4.5 * H, 'limit')).toBe(0);
    expect(sleepAffordableMin(p, 50, START + 3.5 * H, 'target')).toBe(0);
  });

  it('im Ziel: die gesamte Restzeit', () => {
    const p = simple();
    expect(sleepAffordableMin(p, 100, START + 4 * H, 'limit')).toBeCloseTo(120, 9);
  });

  it('wächst mit jedem gefahrenen km bei gleicher Uhrzeit', () => {
    const p = rag();
    const now = START + 20 * H;
    expect(sleepAffordableMin(p, 500, now, 'limit')).toBeGreaterThan(
      sleepAffordableMin(p, 450, now, 'limit'),
    );
  });
});

describe('required_speed', () => {
  it('Schlaf 0: Reststrecke durch Restzeit', () => {
    const p = simple();
    expect(requiredSpeedKmh(p, 0, START, 0, 'limit')).toBeCloseTo(100 / 6, 9);
    expect(requiredSpeedKmh(p, 0, START, 0, 'target')).toBeCloseTo(20, 9);
  });

  it('mit dem gerade noch möglichen Schlaf ergibt sich der Basis-Schnitt', () => {
    const p = simple();
    expect(requiredSpeedKmh(p, 0, START, 120, 'limit')).toBeCloseTo(25, 9);
    expect(requiredSpeedKmh(p, 0, START, 60, 'target')).toBeCloseTo(25, 9);
  });

  it('zieht die restlichen Pausen ab', () => {
    const p = rag();
    const now = START + 30 * H;
    const avail = 27 * 60 - restPauseMin(p, 600) - 100;
    expect(requiredSpeedKmh(p, 600, now, 100, 'limit')).toBeCloseTo(500 / (avail / 60), 9);
  });

  it('ist unendlich, wenn keine Fahrzeit bleibt', () => {
    const p = simple();
    expect(requiredSpeedKmh(p, 0, START, 360, 'limit')).toBe(Infinity);
    expect(requiredSpeedKmh(p, 0, START + 7 * H, 0, 'limit')).toBe(Infinity);
  });

  it('ist 0 im Ziel', () => {
    expect(requiredSpeedKmh(simple(), 100, START + 9 * H, 0, 'limit')).toBe(0);
  });
});

describe('eta_finish', () => {
  it('jetzt + Restfahrzeit + Restpausen + Schlaf', () => {
    const p = simple();
    expect(etaFinishMs(p, 0, START, 0)).toBe(START + 4 * H);
    expect(etaFinishMs(p, 50, START + 3 * H, 30)).toBe(START + 5.5 * H);
    expect(etaFinishMs(p, 100, START + 4 * H, 0)).toBe(START + 4 * H);
    // im Ziel zählt kein Restschlaf mehr
    expect(etaFinishMs(p, 100, START + 4 * H, 90)).toBe(START + 4 * H);
  });

  it('entspricht am Start mit Plan-Schlaf der Plan-Ankunft', () => {
    const p = rag();
    expect(etaFinishMs(p, 0, START, 210)).toBeCloseTo(plannedArrivalAt(p, 1100), 3);
  });
});

describe('next_station', () => {
  it('liefert Name, km, Entfernung und Soll-Zeit', () => {
    const p = rag();
    const n = nextStation(p, 150)!;
    expect(n.name).toBe('A');
    expect(n.km).toBe(200);
    expect(n.distKm).toBe(50);
    expect(n.plannedMs).toBe(plannedArrivalAt(p, 200));
  });

  it('springt an der Station zur nächsten', () => {
    expect(nextStation(rag(), 200)!.name).toBe('B');
    expect(nextStation(rag(), 0)!.name).toBe('A');
  });

  it('ist null nach der letzten Station und ohne Stationen', () => {
    expect(nextStation(rag(), 1031)).toBeNull();
    expect(nextStation(simple(), 10)).toBeNull();
  });
});

describe('red_line', () => {
  it('liegt dort, wo required_speed(0) den Basis-Schnitt × 1,15 erreicht', () => {
    const p = simple();
    // 100 km mit 28,75 km/h = 208,7 min → spätestens nach 151,3 min bei km 0 losfahren
    const line = redLine(p, 0, START).deltaMin;
    expect(line).toBeCloseTo(360 - (100 / 28.75) * 60, 9);
    expect(requiredSpeedKmh(p, 0, START + line * MIN, 0, 'limit')).toBeCloseTo(28.75, 6);
  });

  it('wird beim Überschreiten gemeldet', () => {
    const p = simple();
    const line = redLine(p, 0, START).deltaMin;
    expect(redLine(p, 0, START + (line - 1) * MIN).exceeded).toBe(false);
    expect(redLine(p, 0, START + (line + 1) * MIN).exceeded).toBe(true);
  });

  it('stimmt unterwegs mit delta überein', () => {
    const p = rag();
    for (const km of [100, 480, 900]) {
      const line = redLine(p, km, START).deltaMin;
      const at = plannedArrivalAt(p, km) + line * MIN;
      expect(deltaMin(p, km, at)).toBeCloseTo(line, 6);
      expect(redLine(p, km, at - MIN).exceeded).toBe(false);
      expect(redLine(p, km, at + MIN).exceeded).toBe(true);
    }
  });

  it('ist im Ziel nie überschritten', () => {
    expect(redLine(simple(), 100, START + 99 * H).exceeded).toBe(false);
  });
});

describe('Wecker-Vorschlag', () => {
  it('schlägt den nächsten ungeschlafenen Block vor', () => {
    const p = rag();
    expect(suggestSleepMin(p, 500, START + 22 * H, [])).toBe(90);
    const log: LogEntry[] = [{ type: 'sleep', startMs: START + 22 * H, endMs: START + 23 * H, km: 500 }];
    expect(suggestSleepMin(p, 600, START + 28 * H, log)).toBe(30);
    const log2: LogEntry[] = [
      { type: 'sleep', startMs: START + 22 * H, endMs: START + 23.5 * H, km: 500 },
    ];
    expect(suggestSleepMin(p, 900, START + 40 * H, log2)).toBe(120);
  });

  it('begrenzt auf den fürs Limit möglichen Schlaf', () => {
    const p = simple({ sleepBlocks: [{ afterH: 1, min: 90 }] });
    // bei km 50 nach 3,5 h: 150 min bis Limit, 120 min Fahrzeit → 30 min möglich
    expect(suggestSleepMin(p, 50, START + 3.5 * H, [])).toBeCloseTo(30, 9);
    expect(suggestSleepMin(p, 50, START + 5 * H, [])).toBe(0);
  });

  it('ist 0, wenn der Plan-Schlaf aufgebraucht ist', () => {
    const log: LogEntry[] = [{ type: 'sleep', startMs: START, endMs: START + 4 * H, km: 0 }];
    expect(suggestSleepMin(rag(), 300, START + 12 * H, log)).toBe(0);
  });
});

describe('snapshot', () => {
  it('am Start: grün, alles im Plan', () => {
    const p = rag();
    const s = snapshot(p, 0, START, []);
    expect(s.status).toBe('gruen');
    expect(s.deltaMin).toBe(0);
    expect(s.elapsedMin).toBe(0);
    expect(s.remainingKm).toBe(1100);
    expect(s.sleepRestMin).toBe(210);
    expect(s.next!.name).toBe('A');
    expect(s.etaMs).toBeCloseTo(plannedArrivalAt(p, 1100), 3);
    expect(s.requiredSpeedLimitKmh).toBeLessThan(s.requiredSpeedTargetKmh);
    expect(s.requiredSpeedTargetKmh).toBeLessThan(25);
  });

  it('gelb bei Rückstand, solange das Limit mit Plan-Schlaf hält', () => {
    const p = rag();
    const s = snapshot(p, 300, plannedArrivalAt(p, 300) + 60 * MIN, []);
    expect(s.status).toBe('gelb');
    expect(s.deltaMin).toBeCloseTo(60, 9);
  });

  it('rot, wenn die Ankunft mit Plan-Schlaf hinter dem Limit liegt', () => {
    const p = rag();
    const s = snapshot(p, 300, plannedArrivalAt(p, 300) + 6 * H, []);
    expect(s.etaMs).toBeGreaterThan(deadlineMs(p, 'limit'));
    expect(s.status).toBe('rot');
  });

  it('"Was wäre wenn" ersetzt den Restschlaf', () => {
    const p = rag();
    const now = plannedArrivalAt(p, 300);
    const plan = snapshot(p, 300, now, []);
    const w3 = snapshot(p, 300, now, [], 180);
    const w4 = snapshot(p, 300, now, [], 240);
    expect(w3.sleepRestMin).toBe(180);
    expect(w3.etaMs).toBe(plan.etaMs - 30 * MIN);
    expect(w4.etaMs).toBe(plan.etaMs + 30 * MIN);
    expect(w4.requiredSpeedLimitKmh).toBeGreaterThan(w3.requiredSpeedLimitKmh);
    // der mögliche Schlaf hängt nicht vom Was-wäre-wenn ab
    expect(w4.sleepAffordableLimitMin).toBe(plan.sleepAffordableLimitMin);
  });

  it('Rückstand größer als das Limit: kein Schlaf, Schnitt unendlich, rot', () => {
    const p = rag();
    const s = snapshot(p, 400, START + 60 * H, []);
    expect(s.sleepAffordableLimitMin).toBe(0);
    expect(s.sleepAffordableTargetMin).toBe(0);
    expect(s.requiredSpeedLimitKmh).toBe(Infinity);
    expect(s.toLimitMin).toBe(-180);
    expect(s.status).toBe('rot');
  });

  it('im Ziel: kein Rest, Schnitt 0, keine nächste Station', () => {
    const p = rag();
    const s = snapshot(p, 1100, START + 52 * H, []);
    expect(s.remainingKm).toBe(0);
    expect(s.requiredSpeedLimitKmh).toBe(0);
    expect(s.next).toBeNull();
    expect(s.etaMs).toBe(START + 52 * H);
  });
});

describe("Ermüdung nach Fahrstunden", () => {
  it("ohne Stufen ändert sich nichts", () => {
    expect(rideMin(simple({ fatigue: [] }), 100)).toBeCloseTo(240, 9);
  });

  it("bremst ab der Stufe", () => {
    // 2 h mit 25 km/h = 50 km, die restlichen 50 km mit 20 km/h = 2,5 h
    const p = simple({ fatigue: [{ afterRideH: 2, factor: 0.8 }] });
    expect(rideMin(p, 50)).toBeCloseTo(120, 9);
    expect(rideMin(p, 60)).toBeCloseTo(120 + 30, 9);
    expect(rideMin(p, 100)).toBeCloseTo(270, 9);
    expect(restRideMin(p, 50)).toBeCloseTo(150, 9);
  });

  it("verarbeitet mehrere Stufen in beliebiger Reihenfolge", () => {
    const p = simple({
      fatigue: [
        { afterRideH: 3, factor: 0.5 },
        { afterRideH: 1, factor: 0.8 },
      ],
    });
    // 1 h → 25 km, 2 h mit 20 km/h → 40 km, Rest 35 km mit 12,5 km/h → 2,8 h
    expect(rideMin(p, 100)).toBeCloseTo((1 + 2 + 2.8) * 60, 9);
  });

  it("wirkt zusammen mit Abschnittsfaktoren", () => {
    const p: Plan = {
      totalKm: 100,
      stations: [{ name: "S", km: 50 }],
      cfg: simple({ sectionFactors: [1, 0.8], fatigue: [{ afterRideH: 1, factor: 0.9 }] }).cfg,
    };
    // 25 km in 1 h; 25 km mit 22,5; 50 km mit 25×0,8×0,9 = 18
    expect(rideMin(p, 100)).toBeCloseTo((1 + 25 / 22.5 + 50 / 18) * 60, 9);
  });

  it("eine Stufe ab Stunde 0 gilt von Beginn an", () => {
    const p = simple({ fatigue: [{ afterRideH: 0, factor: 0.5 }] });
    expect(rideMin(p, 100)).toBeCloseTo(480, 9);
  });

  it("bleibt monoton und verlängert die Plan-Ankunft", () => {
    const base = rag();
    const tired = rag({ fatigue: [{ afterRideH: 20, factor: 0.9 }] });
    expect(plannedArrivalAt(tired, 1100)).toBeGreaterThan(plannedArrivalAt(base, 1100));
    // vor der Stufe (16 h Fahrzeit bei km 400) bleibt die Fahrzeit gleich
    expect(rideMin(tired, 400)).toBeCloseTo(rideMin(base, 400), 9);
    let prev = -1;
    for (let km = 0; km <= 1100; km += 5) {
      const t = rideMin(tired, km);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});

describe("Schlaf-Vorschau", () => {
  it("zeigt Weckzeit, Reserve und Schnitt nach dem Schlaf", () => {
    const p = simple();
    const n = napPreview(p, 0, START, 15);
    expect(n.wakeMs).toBe(START + 15 * MIN);
    expect(n.reserveLimitMin).toBeCloseTo(105, 9);
    expect(n.reserveTargetMin).toBeCloseTo(45, 9);
    expect(n.speedLimitKmh).toBeCloseTo(100 / (345 / 60), 9);
  });

  it("Reserve wird negativ, wenn der Schlaf zu lang ist", () => {
    const n = napPreview(simple(), 0, START, 90);
    expect(n.reserveTargetMin).toBeCloseTo(-30, 9);
    expect(n.reserveLimitMin).toBeCloseTo(30, 9);
    expect(n.speedTargetKmh).toBeGreaterThan(25);
  });

  it("Schlaf 0 entspricht sleep_affordable", () => {
    const p = rag();
    const now = START + 20 * H;
    const n = napPreview(p, 450, now, 0);
    expect(n.reserveLimitMin).toBeCloseTo(sleepAffordableMin(p, 450, now, "limit"), 9);
  });
});

describe("Prognose mit echtem Tempo", () => {
  it("ist null am Start und bei zu wenig Strecke", () => {
    expect(pace(simple(), 0, START, [])).toBeNull();
    expect(pace(simple(), 10, START + H, [])).toBeNull();
  });

  it("im Plan-Tempo: Faktor 1, gleiche Reserve wie sleep_affordable", () => {
    const p = simple();
    const r = pace(p, 50, START + 2 * H, [])!;
    expect(r.factor).toBeCloseTo(1, 9);
    expect(r.actualKmh).toBeCloseTo(25, 9);
    expect(r.sleepLimitMin).toBeCloseTo(sleepAffordableMin(p, 50, START + 2 * H, "limit"), 9);
  });

  it("langsamer als der Plan: weniger Schlaf möglich", () => {
    const p = simple();
    // 50 km in 2,5 h = 20 km/h → Faktor 0,8; Rest 50 km dauert 2,5 h statt 2 h
    const r = pace(p, 50, START + 2.5 * H, [])!;
    expect(r.factor).toBeCloseTo(0.8, 9);
    expect(r.actualKmh).toBeCloseTo(20, 9);
    expect(r.sleepLimitMin).toBeCloseTo(210 - 150, 9);
    expect(r.sleepTargetMin).toBe(0);
  });

  it("zieht protokollierte Pausen und Schlaf von der Fahrzeit ab", () => {
    const log: LogEntry[] = [
      { type: "pause", startMs: START + H, endMs: START + H + 20 * MIN, km: 25 },
      { type: "sleep", startMs: START + 1.5 * H, endMs: START + 1.5 * H + 10 * MIN, km: 30 },
    ];
    const r = pace(simple(), 50, START + 2.5 * H, log)!;
    expect(r.factor).toBeCloseTo(1, 9);
    expect(r.actualKmh).toBeCloseTo(25, 9);
  });

  it("steht im snapshot", () => {
    const p = rag();
    expect(snapshot(p, 0, START, []).pace).toBeNull();
    expect(snapshot(p, 300, plannedArrivalAt(p, 300), []).pace).not.toBeNull();
  });
});
