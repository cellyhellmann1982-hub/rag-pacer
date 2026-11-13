# RAG Pacer

Zeitbudget-Rechner für das Race Across Germany (Flensburg → Garmisch-Partenkirchen, ca. 1.100 km, Zeitlimit 57 h).
Die App beantwortet im Rennen eine Frage: **Reicht es noch, und wie viel Schlaf kann ich mir leisten?**

Sie ist kein Navi und steuert keine Leistung. Sie läuft als installierbare Web-App (PWA) komplett auf dem Handy:
kein Konto, kein Server, nach dem ersten Laden offline.

## Setup

Voraussetzung: Node.js 20 oder neuer.

```
npm install
npm run dev      # Entwicklungsserver, http://localhost:5173
npm test         # Vitest: gesamte Rechenlogik in src/model
```

Im Entwicklungsserver ist der Service Worker abgeschaltet. Offline-Verhalten prüft man mit dem Build.

## Build

```
npm run build    # Typprüfung + Build nach dist/
npm run preview  # dist/ lokal ausliefern, http://localhost:4173
```

`dist/` ist eine rein statische Seite und kann auf jedem Webspace liegen (GitHub Pages, Netlify, eigener Server),
auch in einem Unterordner. Wichtig: **Die Adresse muss mit https:// beginnen**, sonst erlaubt das Handy weder
GPS noch die Offline-Installation.

Die Icons in `public/` lassen sich mit `npm run icons` neu erzeugen.

## Aufs Handy installieren

**iPhone (Safari):** Adresse in Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“ → „Hinzufügen“.
Die App danach einmal vom Home-Bildschirm starten und den Standortzugriff erlauben („Beim Verwenden der App“).

**Android (Chrome):** Adresse in Chrome öffnen → Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
Beim ersten Start den Standortzugriff erlauben.

Danach vor dem Rennen einmal testen: Flugmodus an, App starten. Sie muss mit Strecke und Einstellungen erscheinen.

Hinweise zum Betrieb:

- Die App misst nur, solange sie offen und das Display an ist. Im Setup gibt es dafür „Display anlassen“ (kostet Akku).
  Ist das Handy gesperrt, ruht die Messung; beim nächsten Öffnen werden Zeit und Position sofort nachgezogen.
  Eine Standpause, die komplett in so eine Lücke fällt, wird beim Öffnen rückwirkend als Pause erkannt.
- Strecken, Einstellungen und Log liegen nur auf diesem Gerät im Browser-Speicher. Wer die App-Daten oder
  Website-Daten löscht, löscht auch das Log. Nach jeder Testfahrt exportieren.

## Bedienung

1. **Setup → Neue Strecke laden:** GPX wählen, Zeitstationen als „Name, km“ eintragen (eine pro Zeile), importieren.
   Für Testfahrten nicht benötigte Zeilen löschen. Es lassen sich mehrere Strecken speichern; eine ist aktiv.
2. **Setup → Aktive Strecke:** Startzeit, Zeitlimit, Zielzeit, Basis-Schnitt, Abschnittsfaktoren, Pausenbudget
   und Schlafblöcke einstellen. Über dem Formular steht die Plan-Ankunft mit Reserve.
3. **Rennen:** drei große Zahlen (Vorsprung/Rückstand, möglicher Schlaf, nötiger Schnitt), darunter km,
   nächste Zeitstation, ETA, Zeit seit Start, GPS-Status. Knöpfe „Schlafen“ und „Pause“.
4. **Log:** alle Pausen, Schlafblöcke und Stations-Passagen, Export als CSV und JSON.
5. **Test:** simuliert Position und Uhrzeit per Schieberegler. Im Test-Modus wird nichts gespeichert.

## So rechnet das Modell

Alle Formeln stehen in `src/model/budget.ts` und sind in `tests/budget.test.ts` belegt.

- **Fahrzeit:** je Abschnitt (zwischen zwei Zeitstationen) Länge ÷ (Basis-Schnitt × Abschnittsfaktor).
- **Pausen im Plan:** die Stationspause fällt an der jeweiligen Zeitstation an. Pipi, Einkaufen und Technik-Puffer
  werden proportional zur Fahrzeit verteilt. Pipi zählt je Stunde **Fahrzeit** (z. B. alle 3,5 h Fahrzeit 4 min).
- **Schlaf im Plan:** jeder Block beginnt nach einer festen Rennstunde. Liegt ein Block später als die
  Plan-Ankunft, zählt er nicht mit.
- **Vorsprung/Rückstand:** tatsächliche Zeit minus Planzeit am aktuellen km.
- **Schlaf noch möglich:** Zeit bis Zielzeit bzw. Zeitlimit minus Rest-Fahrzeit im Plan-Schnitt minus die Pausen,
  die der Plan ab hier noch vorsieht.
- **Nötiger Schnitt:** Rest-km ÷ (Restzeit − Rest-Pausen − Restschlaf). Das ist der echte Durchschnitt über den
  Rest, direkt vergleichbar mit dem Schnitt am Garmin. Als Restschlaf gilt der noch nicht geschlafene Plan-Schlaf.
- **Was wäre wenn (3 h / 4 h):** rechnet mit „ab jetzt noch so viel Schlaf“. Schnitt und ETA ändern sich,
  die Schlaf-Zeile zeigt die Reserve, die danach bleibt.
- **Farben:** grün = im Plan oder davor, gelb = Rückstand, rot = die Ankunft mit dem Restschlaf läge hinter dem
  Zeitlimit, oder die rote Linie ist überschritten (nötiger Schnitt ohne Schlaf über Basis-Schnitt × 1,15).

Position (`src/model/projection.ts`): GPS wird höchstens alle 30 s ausgewertet. Positionen mit einer Genauigkeit
schlechter als 150 m werden verworfen. Gesucht wird im Fenster ±15 km um den letzten km, der km springt nie
rückwärts. Über 500 m Abstand heißt „neben der Strecke“, der km bleibt stehen; der Knopf „Position neu suchen“
sucht dann die ganze Strecke ab. Fehlt GPS länger als 5 Minuten, erscheint der Notbetrieb mit km-Schieberegler.
Unter 3 km/h über 90 s gilt als Pause.

## Abschnittsfaktoren nach einer Testfahrt kalibrieren

Ziel: Der Basis-Schnitt soll der eigene Schnitt in flachem, normalem Gelände sein. Die Faktoren beschreiben,
wie viel langsamer (oder schneller) ein Abschnitt im Verhältnis dazu ist.

1. Testfahrt mit eigener GPX fahren. Als „Zeitstationen“ die Grenzen der Abschnitte eintragen, die man
   vergleichen will (z. B. „Ende Flachstück, 60“ und „Passhöhe, 85“). Startzeit im Setup auf die echte
   Abfahrtszeit stellen, sonst werden keine Passagen und Pausen protokolliert.
2. Nach der Fahrt **Log → Export CSV** und in Excel/LibreOffice öffnen.
3. Für jeden Abschnitt die Fahrzeit bestimmen:
   - Beginn und Ende: Spalte `min_seit_start` der beiden Zeitstations-Zeilen (der erste Abschnitt beginnt bei 0,
     der letzte endet in der Zeile „Ziel“).
   - Davon alle Zeilen `Pause` und `Schlaf` abziehen, die in diesem Zeitraum liegen (Spalte `dauer_min`).
   - Fahrzeit = Ende − Beginn − Pausen − Schlaf.
4. Schnitt des Abschnitts = Abschnittslänge in km ÷ Fahrzeit in Stunden.
5. Basis-Schnitt festlegen: der Schnitt des flachen Referenz-Abschnitts.
6. Faktor = Schnitt des Abschnitts ÷ Basis-Schnitt. Beispiel: flach 26,0 km/h, bergig 22,1 km/h → Faktor 0,85.
7. Im Setup der Rennstrecke eintragen: Basis-Schnitt und die Faktoren für die Abschnitte mit vergleichbarem
   Profil. Die Zusammenfassung über dem Formular zeigt sofort, wie sich Plan-Ankunft und Reserve verschieben.

Lange Fahrten zählen mehr als kurze: Ein Schnitt aus einer 3-Stunden-Runde ist für Stunde 40 zu optimistisch.

## Projektstruktur

```
src/model/   reine Rechenlogik ohne DOM: gpx.ts, route.ts, projection.ts, budget.ts
src/state/   Typen, Standardwerte, Persistenz (IndexedDB über idb-keyval), Log-Export
src/ui/      Screens (Rennen, Setup, Log), GPS, Formatierung
src/sw.ts    Service Worker (cacht die komplette App beim Installieren)
tests/       Vitest, eine Testdatei pro Modell-Datei
public/      manifest.json, Icons
```
