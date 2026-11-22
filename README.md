# Annas Licht

Eine Erinnerungsseite: Wo ist das Licht von Annas Leben gerade unterwegs - und welcher Stern sieht in diesem Augenblick welchen Tag?

Die Seite ist ein persönliches Geschenk für Familie und Freunde. Persönliche Erinnerungen und Fotos liegen in diesem
Repository ausschließlich verschlüsselt (`data/private.enc`, `media/*.bin`) und sind nur mit einem Zugang lesbar.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css`, `js/` | die Seite (reines HTML/CSS/JavaScript, kein Build-Schritt) |
| `js/space.js`, `js/sky.js` | 3D-Karte und Nachthimmel über Neumünster |
| `js/store.js` | Daten, Verschlüsselung (AES-GCM, PBKDF2), Speichern über die GitHub-API |
| `data/stars.json`, `data/sky.json` | Sternkatalog, erzeugt mit `tools/build_catalog.py` |
| `data/public.json` | öffentliche Eckdaten und Momente |
| `data/users.json` | je Zugang eine versiegelte Box (öffnet sich nur mit Name + Passwort) |

Vor jeder Änderung an der Seite `sh tools/bump.sh` ausführen: Das gibt allen Dateien eine gemeinsame Versionsnummer und erneuert den Fingerabdruck der Import-Map in der Content-Security-Policy von `index.html`.
Bildschirmfotos in vier Gerätegrößen: `sh tools/shots.sh <Ordner> <Name> '#demo'`.

Lokal ansehen: `python3 -m http.server` und <http://localhost:8000> öffnen.
Datenschicht testen: `node tools/test_store.mjs`. Umriss der Lichtkugel in der 3D-Karte prüfen: `node tools/test_outline.mjs`.
Den Namen bei „Hinzugefügt von“ für alle Momente einer Person ändern: `node tools/set_author.mjs <alter Name> <neuer Name>` (fragt nach Name und Passwort eines Zugangs, danach `data/` committen).
Der Name entscheidet auch, wer einen Moment ändern darf: Zugänge „Mitgestalten“ nur ihre eigenen.

## Adresszusätze

Hinter die Adresse gehängt, z. B. <https://www.annas-licht.de/#flug>. Mehrere werden mit `&` verbunden: `#himmel&sternschnuppe`.
Sie wirken beim Laden der Seite. Wird danach etwas ausgewählt, ersetzt die Seite den Zusatz in der Adresszeile durch einen Link auf das Ausgewählte;
bis zum nächsten Neuladen wirkt er trotzdem weiter.

| Zusatz | Wirkung |
| --- | --- |
| `#flug` | zeigt den Eröffnungsflug (sonst nur, wenn man die Seite in einem neuen Tab betritt, nicht beim Neuladen) |
| `#willkommen` | zeigt die Begrüßung (sonst nur beim allerersten Besuch) und danach den Flug |
| `#sternschnuppe` | alle 2 bis 6 Sekunden eine Sternschnuppe (sonst alle 1 bis 3 Minuten); wirkt auch ohne Neuladen |
| `#himmel` | öffnet den Nachthimmel statt der 3D-Karte |
| `#p=moments` | öffnet eine Tafel: `moments` (Momente), `soon` (Heute), `time` (Zeitreise), `about` (Über diese Seite), `login` (Anmelden) |
| `#m=<id>` | öffnet einen Moment; so sehen die Links aus, die die Seite beim Auswählen in die Adresszeile schreibt |
| `#sel=Wega` | wählt einen Stern, Planeten oder Moment (nach seinem Titel) aus |
| `#go=Wega` | fliegt zu einem Stern, Planeten oder Moment (nach seinem Titel) |
| `#z=solar` | Ausschnitt wie die Namen am Maßstab rechts: `life`, `near`, `last`, `solar`, `moon` |
| `#jahr=1998` | wählt ein Jahr ihres Lebens aus |
| `#reise`, `#reise=4` | öffnet „Ihr Leben erleben“ angehalten, auf Wunsch bei einer späteren Station (gezählt ab 0: `4` ist die fünfte) |
| `#messen` | zeigt im Titel des Browser-Tabs, wie viele Millisekunden ein Bild der Karte braucht |
| `#demo` | nur auf dem eigenen Rechner (localhost): erfundene Beispiel-Momente statt der echten |

## Ersteinrichtung

1. Auf GitHub einen *fine-grained personal access token* anlegen: nur dieses Repository, Berechtigung **Contents: Read and write**.
2. Auf der Seite „Anmelden“ öffnen, Name, Passwort und Token eintragen.
3. Danach unter „Anmelden“ die Grunddaten eintragen und weitere Zugänge anlegen.

Wie der Token genau angelegt wird, steht im nächsten Abschnitt.

## Der GitHub-Token

Die Seite speichert neue Momente und Fotos, indem sie sie mit einem GitHub-Token in dieses Repository schreibt.
Der Token steckt verschlüsselt in den Zugängen; im Code oder im Klartext steht er nirgends.

### Woran man merkt, dass er abgelaufen ist

- Beim Speichern erscheint die Meldung, dass der GitHub-Zugang abgelaufen oder ungültig ist.
- Ansehen funktioniert weiter, auch die privaten Erinnerungen und Fotos. Es geht nichts verloren.
- GitHub schickt in der Regel einige Tage vor dem Ablauf eine E-Mail an das Konto, dem der Token gehört.

Das Ablaufdatum steht auf GitHub unter *Settings > Developer settings > Personal access tokens > Fine-grained tokens*.

### Einen neuen Token anlegen

1. Auf GitHub: *Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token*.
2. *Repository access*: **Only select repositories**, dort nur `Annas-Licht` auswählen.
3. *Permissions > Repository permissions*: **Contents: Read and write**. Sonst nichts.
4. Ein Ablaufdatum wählen und am besten gleich im Kalender eintragen.
5. Den Token kopieren. GitHub zeigt ihn nur dieses eine Mal.

Statt einen neuen anzulegen, lässt sich ein bestehender Token auf derselben GitHub-Seite auch mit *Regenerate token* erneuern.
Dabei entsteht ebenfalls ein neuer Wert, der wie unten eingetragen werden muss.

### Den Token auf der Seite eintragen

1. Die Seite öffnen und mit einem Zugang der Rolle „Verwaltung“ anmelden. Das geht auch, wenn der alte Token schon abgelaufen ist.
2. Unten auf den eigenen Namen tippen (dort stand vor der Anmeldung „Anmelden“).
3. Im Abschnitt **GitHub-Zugang erneuern** den neuen Token einfügen und „Token speichern“ wählen.

Der neue Token gilt sofort für alle Zugänge, die speichern dürfen. Niemand muss sich neu anmelden, und es müssen keine Zugänge neu angelegt werden.
Schlägt das Speichern des Tokens fehl, stimmt meist die Berechtigung oder das ausgewählte Repository nicht (Schritte 2 und 3 oben).

### Wenn der Token in falsche Hände geraten sein könnte

Auf GitHub den alten Token löschen (*Delete* oder *Revoke*), einen neuen anlegen und wie oben eintragen.
Mit dem Token kann man nur in dieses eine Repository schreiben; die privaten Erinnerungen lesen kann man damit nicht.

### Gut zu wissen

- Nur Zugänge der Rolle „Verwaltung“ können den Token erneuern. Es ist sinnvoll, dass mindestens zwei Personen einen solchen Zugang haben.
- Der Token gehört zu einem GitHub-Konto. Wird dieses Konto gelöscht oder verliert es den Zugriff auf das Repository, braucht die Seite einen Token von einem anderen Konto mit Schreibrecht.
- Wurde das Repository umbenannt oder verschoben, muss zusätzlich `REPO` in `js/store.js` angepasst werden.

## Quellen

Sterndaten: [HYG-Datenbank](https://github.com/astronexus/HYG-Database) (Hipparcos, Yale Bright Star, Gliese; CC BY-SA 4.0) und
[NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/). Sternbildlinien: [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3).

## Sicherheit in Kürze

- Private Erinnerungen und Fotos liegen nur verschlüsselt im Repository; den Schlüssel bekommt nur, wer Name und Passwort eines Zugangs kennt. Die Passwörter sollten lang sein, denn die verschlüsselten Dateien sind öffentlich abrufbar.
- Der GitHub-Token zum Speichern steckt verschlüsselt in den Zugängen. Er läuft irgendwann ab; was dann zu tun ist, steht oben unter „Der GitHub-Token“.
- Die Seite lädt nichts von fremden Servern außer den Wetterdaten (Open-Meteo) und spricht sonst nur mit GitHub; eine Content-Security-Policy erzwingt das.
- Die Rollen (Verwaltung, Mitgestalten, Nur ansehen) sind eine Hilfe der Oberfläche, keine harte Grenze.
