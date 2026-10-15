# WAYPOINT

Eigenständiger Handelsplaner für Freelancer Discovery im Repository
[`PhyteHQ/WAYPOINT`](https://github.com/PhyteHQ/WAYPOINT). Das Projekt hat
keine Abhängigkeit von RHW oder DTR.

**Seite öffnen: [WAYPOINT](https://phytehq.github.io/WAYPOINT/).**

## Projektstand

Die Anwendung und der GitHub-Pages-Workflow sind implementiert. Ein Push auf
`main` baut und prüft die Anwendung und startet die Veröffentlichung. Dafür
muss in den Repository-Einstellungen **Pages → Source → GitHub Actions**
ausgewählt sein.

## Bereits enthalten

- 5.000er Transporter mit 350 Cruise, Pilgrim mit 4.300 / 410 und Longhorn
  mit 3.600 / 500; direkt umschaltbar.
- One Way und Touren mit zwei oder drei Handelsabschnitten. Für Rückladungen
  werden auch andere Abholbasen im selben Ankunftssystem und passende Abnehmer
  im Zielsystem geprüft. Das Zielsystem ist frei wählbar und entspricht ohne
  eigene Vorgabe dem Startsystem. Exakte Rückkehr zur Startbasis bleibt wählbar.
- Ein leerer Rückweg muss ausdrücklich zugelassen werden. Lokale Anflüge zur
  Abholung sind möglich und zählen vollständig zur Flugzeit.
- Die Währungsanzeige verwendet überall **$** für dieselben Spielgeldbeträge.
- Stückzahlen aus tatsächlichem Warenvolumen, verfügbarem Frachtraum und
  eigenem Handelskapital.
- POB-Prüfung von Verkaufsreserve, Ankaufgrenze, Geld und freiem Lager.
  Originalvolumen für POB-Lager und Transportvolumen werden getrennt gerechnet.
- Gemeinsame Mengenplanung einer Tour, passende Handelsreihenfolge und
  Fortschreibung von Beständen und Kassen. Wiederholungen verbrauchen Vorräte
  und werden nur bei tatsächlicher Rückkehr zur gleichen Basis ausgewiesen.
- Flugwege über Cruise, Handelsrouten und Sprünge; geschätzte Dauer und
  Gewinn pro Stunde. Die Cruise-Geschwindigkeit beeinflusst den konkreten Weg.
- Details pro Handelsschritt, Zeitmodell, ausschließbare Basen, Datenzeitpunkt,
  lokaler letzter Datenstand und Import/Export.

## Prüfung und offene Punkte

Die Berechnung wird mit 30 automatischen Tests geprüft. Zusätzlich wurden die
Bedienabläufe mit echtem Suchalgorithmus in einer DOM-Umgebung geprüft:
Schiffwechsel, Routentypen, Ergebnistabelle, Details und Zeitmodell.
Eine visuelle Browserprüfung der veröffentlichten Seite steht noch aus.

Der echte Darkstat-Abruf mit dem Anwendungscode wurde in GitHub Actions
erfolgreich geprüft: Beide API-Endpunkte lieferten HTTP 200, gültige Marktdaten
und eine CORS-Freigabe für die veröffentlichte Seite. Der zusätzliche,
nicht blockierende Prüfjob meldet Probleme mit dem öffentlichen Datenabruf.
Ein Abruffehler in der Anwendung zeigt eine deutliche Meldung. Erfundene
Marktdaten werden niemals automatisch als Live-Daten ausgegeben. Das
zuschaltbare Funktionsbeispiel ist ausdrücklich fiktiv.

Die Suche findet die besten geprüften Kandidaten innerhalb einer begrenzten
Suche. Diese Version plant eine Ware je Handelsabschnitt. Lokale Abholflüge
können zusätzliche Stationen hinzufügen. Gemischte Ladungen,
mehr als drei beladene Handelsabschnitte und verlustbringende Zwischenkäufe sind noch
nicht Teil der Suche. Zeitwerte sind Schätzungen ohne Kampf, Hindernisse,
Warteschlangen oder individuelle Ruf-/POB-Zugangsprüfung.

## Lokal öffnen

Voraussetzungen: Python 3.10+ und Node.js 22+. Keine Paketinstallation nötig.

```sh
python3 scripts/build.py
node --test tests/*.test.mjs
python3 -m http.server 8000 --directory dist
```

Danach `http://localhost:8000` im Browser öffnen. Direktes Öffnen der HTML-Datei
per Doppelklick unterstützt Module, Worker und Datenabruf nicht zuverlässig.

## GitHub Pages

Unter **Settings → Pages → Build and deployment** die
Quelle **GitHub Actions** auswählen. Ein Push auf `main` baut die Seite,
prüft die Berechnung und veröffentlicht den Ordner `dist`.

Technische Details, Datenquellen und Grenzen stehen in `README.md`.
