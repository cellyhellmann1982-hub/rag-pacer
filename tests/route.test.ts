import { describe, expect, it } from 'vitest';
import { buildRoute, cumulativeM, haversineM, pointKm, routeTotalKm } from '../src/model/route';

describe('haversineM', () => {
  it('ein Breitengrad sind rund 111,2 km', () => {
    expect(haversineM(50, 10, 51, 10)).toBeGreaterThan(111_100);
    expect(haversineM(50, 10, 51, 10)).toBeLessThan(111_300);
  });

  it('ist null für identische Punkte und symmetrisch', () => {
    expect(haversineM(48.5, 11, 48.5, 11)).toBe(0);
    expect(haversineM(54.78, 9.43, 47.49, 11.09)).toBeCloseTo(haversineM(47.49, 11.09, 54.78, 9.43), 6);
  });

  it('Flensburg–Garmisch Luftlinie rund 820 km', () => {
    const d = haversineM(54.78, 9.43, 47.49, 11.09) / 1000;
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThan(840);
  });
});

describe('cumulativeM', () => {
  it('summiert die Abschnitte', () => {
    const c = cumulativeM([
      { lat: 50, lon: 10, ele: null },
      { lat: 50.01, lon: 10, ele: null },
      { lat: 50.02, lon: 10, ele: null },
    ]);
    expect(c[0]).toBe(0);
    expect(c[2]).toBeCloseTo(2 * c[1], 6);
  });
});

describe('buildRoute', () => {
  const line = [
    { lat: 50, lon: 10, ele: 100 },
    { lat: 50.01, lon: 10, ele: 200 },
  ];

  it('resampelt auf 100 m und endet exakt am Streckenende', () => {
    const r = buildRoute(line);
    // 0,01° Breite ≈ 1.111,95 m → Punkte bei 0, 100, …, 1.100 und am Ende
    expect(r.totalM).toBeGreaterThan(1111);
    expect(r.totalM).toBeLessThan(1113);
    expect(r.lat).toHaveLength(13);
    expect(r.lat[0]).toBe(50);
    expect(r.lat[12]).toBeCloseTo(50.01, 9);
    expect(pointKm(r, 5)).toBeCloseTo(0.5, 9);
    expect(pointKm(r, 12)).toBeCloseTo(r.totalM / 1000, 9);
    expect(routeTotalKm(r)).toBeCloseTo(r.totalM / 1000, 9);
  });

  it('hält den Punktabstand ein', () => {
    const r = buildRoute(line);
    for (let i = 1; i < 12; i++) {
      expect(haversineM(r.lat[i - 1], r.lon[i - 1], r.lat[i], r.lon[i])).toBeCloseTo(100, 1);
    }
  });

  it('interpoliert die Höhe und summiert den Anstieg', () => {
    const r = buildRoute(line);
    expect(r.ele[0]).toBe(100);
    expect(r.ele[12]).toBeCloseTo(200, 6);
    expect(r.ascentM).toBeCloseTo(100, 6);
  });

  it('zählt nur Anstiege, keine Abfahrten', () => {
    const r = buildRoute([
      { lat: 50, lon: 10, ele: 100 },
      { lat: 50.01, lon: 10, ele: 300 },
      { lat: 50.02, lon: 10, ele: 150 },
      { lat: 50.03, lon: 10, ele: 250 },
    ]);
    expect(r.ascentM).toBeGreaterThan(280);
    expect(r.ascentM).toBeLessThanOrEqual(300.0001);
  });

  it('kommt mit fehlenden Höhen zurecht', () => {
    const r = buildRoute([
      { lat: 50, lon: 10, ele: null },
      { lat: 50.01, lon: 10, ele: null },
    ]);
    expect(r.ascentM).toBe(0);
    expect(r.ele.every((e) => e === 0)).toBe(true);
  });

  it('übersteht doppelte Punkte', () => {
    const r = buildRoute([
      { lat: 50, lon: 10, ele: 0 },
      { lat: 50, lon: 10, ele: 0 },
      { lat: 50.005, lon: 10, ele: 0 },
    ]);
    expect(r.lat.every(Number.isFinite)).toBe(true);
    expect(r.totalM).toBeGreaterThan(550);
  });

  it('eine Strecke mit Schleife zählt die volle Länge', () => {
    const r = buildRoute([
      { lat: 50, lon: 10, ele: 0 },
      { lat: 50.05, lon: 10, ele: 0 },
      { lat: 50, lon: 10, ele: 0 },
    ]);
    expect(r.totalM / 1000).toBeCloseTo(11.12, 1);
  });

  it('lehnt zu kurze Eingaben ab', () => {
    expect(() => buildRoute([{ lat: 50, lon: 10, ele: 0 }])).toThrow();
    expect(() =>
      buildRoute([
        { lat: 50, lon: 10, ele: 0 },
        { lat: 50, lon: 10, ele: 0 },
      ]),
    ).toThrow();
  });
});
