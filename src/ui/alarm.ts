// Wecker in der App: Tonfolge über Web Audio plus Vibration.
// Funktioniert nur, solange die App im Vordergrund und das Display an ist.

let ctx: AudioContext | null = null;

/** Muss aus einem Tippen heraus aufgerufen werden, sonst erlaubt der Browser keinen Ton. */
export function armAlarm(): void {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Spielt drei kurze Töne und vibriert. */
export function ringAlarm(): void {
  try {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  } catch {
    // Vibration nicht verfügbar
  }
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.6;
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + i * 0.4);
    osc.stop(t0 + i * 0.4 + 0.25);
  }
}
