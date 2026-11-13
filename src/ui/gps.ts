export interface GpsFix {
  lat: number;
  lon: number;
  accuracyM: number;
  /** Geschwindigkeit in m/s, falls das Gerät sie liefert. */
  speedMs: number | null;
}

export function gpsSupported(): boolean {
  return 'geolocation' in navigator;
}

/**
 * Startet die Positionsüberwachung. Akkuschonend: keine hohe Genauigkeit angefordert,
 * bis zu 30 s alte Positionen sind in Ordnung. Liefert eine Stopp-Funktion.
 */
export function startGps(onFix: (f: GpsFix) => void, onError: (message: string) => void): () => void {
  if (!gpsSupported()) {
    onError('nicht verfügbar');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        speedMs: pos.coords.speed,
      }),
    (err) => onError(err.code === err.PERMISSION_DENIED ? 'kein Zugriff erlaubt' : 'kein Signal'),
    { enableHighAccuracy: false, maximumAge: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
