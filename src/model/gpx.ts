export interface RawPoint {
  lat: number;
  lon: number;
  ele: number | null;
}

export interface ParsedGpx {
  name: string | null;
  points: RawPoint[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function attr(attrs: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs);
  return m ? Number(m[1]) : NaN;
}

function collect(xml: string, tag: 'trkpt' | 'rtept'): RawPoint[] {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const out: RawPoint[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const em = m[2] ? /<ele>\s*([^<]+?)\s*<\/ele>/.exec(m[2]) : null;
    const ele = em ? Number(em[1]) : NaN;
    out.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return out;
}

/**
 * Liest die Punkte einer GPX-Datei. Trackpunkte haben Vorrang, sonst Routenpunkte.
 * Wirft einen Fehler, wenn weniger als zwei Punkte enthalten sind.
 */
export function parseGpx(xml: string): ParsedGpx {
  let points = collect(xml, 'trkpt');
  if (points.length < 2) points = collect(xml, 'rtept');
  if (points.length < 2) {
    throw new Error('Die Datei enthält keine Strecke (weder Track noch Route).');
  }
  const scope = /<(trk|rte)\b[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(xml);
  const any = scope ?? /<(metadata)\b[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(xml);
  const name = any ? decodeEntities(any[2]) : null;
  return { name: name || null, points };
}
