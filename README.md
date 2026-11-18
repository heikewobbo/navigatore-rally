# Copilota Rally

Navigatore per il telefono che chiama le curve come un copilota di rally.
Scegli partenza e arrivo, l'app calcola il percorso e trasforma la forma della strada in note: 6…1, tornante, 90 secca, piena, lunga, stringe/apre, distanze, "e".

## Come si usa
1. Apri l'app da Safari sull'iPhone e aggiungila alla schermata Home (Condividi → Aggiungi alla schermata Home).
2. Impostazioni → **Carica voci (.zip)** e scegli `voci_rally.zip` (lo zip resta solo sul telefono, non è in questo repository).
3. Scrivi la destinazione e la partenza ("La mia posizione" va bene), poi **Simula** per ascoltare le note da casa, oppure **Parti**.
4. Tocca la mappa per segnare ostacoli (buca, dosso, acqua, ponte, lavori, autovelox, pericolo): il copilota li chiama quando ci arrivi.

Il telefono deve restare con lo schermo acceso sul supporto. Se non senti la voce, controlla l'interruttore silenzioso.

## Da dove vengono i dati
- Mappe: © OpenStreetMap, sfondo CARTO
- Percorso: OSRM (server dimostrativo pubblico)
- Ricerca: Photon (Komoot), Nominatim
- Autovelox: OpenStreetMap via Overpass

Le note sono calcolate dalla geometria di OpenStreetMap: sono un aiuto, non un road book. Tienile un po' più larghe di quello che dicono.

## Struttura
- `js/pacenotes.js`: generatore delle note (curvatura → gravità, modificatori, distanze)
- `js/app.js`: interfaccia, ricerca, percorso, voce, guida GPS e simulazione
- `vendor/`: Leaflet e JSZip
