import { del, get, set } from 'idb-keyval';
import { DEFAULT_SETTINGS, emptyRace } from './defaults';
import type { RaceState, Route, RouteMeta, Settings } from './types';

const K_ROUTES = 'routes';
const K_ACTIVE = 'activeRouteId';
const K_SETTINGS = 'settings';
const routeKey = (id: string) => `route:${id}`;
const raceKey = (id: string) => `race:${id}`;

export async function loadRoutes(): Promise<RouteMeta[]> {
  const routes = (await get<RouteMeta[]>(K_ROUTES)) ?? [];
  // Ältere gespeicherte Konfigurationen kennen noch keine Ermüdung.
  return routes.map((r) => ({ ...r, cfg: { ...r.cfg, fatigue: r.cfg.fatigue ?? [] } }));
}

export async function saveRoutes(routes: RouteMeta[]): Promise<void> {
  await set(K_ROUTES, routes);
}

export async function loadActiveId(): Promise<string | null> {
  return (await get<string>(K_ACTIVE)) ?? null;
}

export async function saveActiveId(id: string | null): Promise<void> {
  if (id === null) await del(K_ACTIVE);
  else await set(K_ACTIVE, id);
}

export async function loadRoute(id: string): Promise<Route | null> {
  return (await get<Route>(routeKey(id))) ?? null;
}

export async function saveRoute(id: string, route: Route): Promise<void> {
  await set(routeKey(id), route);
}

export async function loadRace(id: string): Promise<RaceState> {
  return { ...emptyRace(), ...((await get<RaceState>(raceKey(id))) ?? {}) };
}

export async function saveRace(id: string, race: RaceState): Promise<void> {
  await set(raceKey(id), race);
}

export async function deleteRouteData(id: string): Promise<void> {
  await del(routeKey(id));
  await del(raceKey(id));
}

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get<Settings>(K_SETTINGS)) ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await set(K_SETTINGS, s);
}
