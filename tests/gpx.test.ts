import { describe, expect, it } from 'vitest';
import { parseGpx } from '../src/model/gpx';

describe('parseGpx', () => {
  it('liest Trackpunkte mit Höhe und Namen', () => {
    const xml = `<?xml version="1.0"?>
      <gpx><metadata><name>Meta</name></metadata>
      <trk><name>RAG &amp; Test</name><trkseg>
        <trkpt lat="54.78" lon="9.43"><ele>12.5</ele><time>2027-07-09T06:00:00Z</time></trkpt>
        <trkpt lat="54.77" lon="9.44"><ele>14</ele></trkpt>
        <trkpt lat="54.76" lon="9.45"/>
      </trkseg></trk></gpx>`;
    const g = parseGpx(xml);
    expect(g.name).toBe('RAG & Test');
    expect(g.points).toEqual([
      { lat: 54.78, lon: 9.43, ele: 12.5 },
      { lat: 54.77, lon: 9.44, ele: 14 },
      { lat: 54.76, lon: 9.45, ele: null },
    ]);
  });

  it('nimmt Routenpunkte, wenn kein Track vorhanden ist', () => {
    const xml = `<gpx><rte><name>Route</name>
      <rtept lon='9.0' lat='50.0'></rtept>
      <rtept lon='9.1' lat='50.1'><ele>300</ele></rtept>
    </rte></gpx>`;
    const g = parseGpx(xml);
    expect(g.name).toBe('Route');
    expect(g.points).toHaveLength(2);
    expect(g.points[0]).toEqual({ lat: 50, lon: 9, ele: null });
    expect(g.points[1].ele).toBe(300);
  });

  it('bevorzugt den Track vor der Route', () => {
    const xml = `<gpx>
      <rte><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>
      <trk><trkseg><trkpt lat="50" lon="9"/><trkpt lat="51" lon="9"/><trkpt lat="52" lon="9"/></trkseg></trk>
    </gpx>`;
    expect(parseGpx(xml).points).toHaveLength(3);
  });

  it('fügt mehrere Track-Segmente aneinander', () => {
    const xml = `<gpx><trk>
      <trkseg><trkpt lat="50" lon="9"/><trkpt lat="50.1" lon="9"/></trkseg>
      <trkseg><trkpt lat="50.2" lon="9"/></trkseg>
    </trk></gpx>`;
    expect(parseGpx(xml).points.map((p) => p.lat)).toEqual([50, 50.1, 50.2]);
  });

  it('überspringt ungültige Koordinaten und liefert null ohne Namen', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lat="abc" lon="9"/><trkpt lat="50" lon="9"/><trkpt lat="95" lon="9"/><trkpt lat="51" lon="9"/>
    </trkseg></trk></gpx>`;
    const g = parseGpx(xml);
    expect(g.name).toBeNull();
    expect(g.points).toHaveLength(2);
  });

  it('wirft einen Fehler ohne Strecke', () => {
    expect(() => parseGpx('<gpx><wpt lat="50" lon="9"/></gpx>')).toThrow();
    expect(() => parseGpx('kein xml')).toThrow();
    expect(() => parseGpx('<gpx><trk><trkseg><trkpt lat="50" lon="9"/></trkseg></trk></gpx>')).toThrow();
  });
});
