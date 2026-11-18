# Copilota Rally

Navigatore per il telefono che chiama le curve come un copilota di rally.
Scegli partenza e arrivo, l'app calcola il percorso e trasforma la forma della strada in note: 6…1, tornante, 90 secca, piena, lunga, stringe/apre, distanze, "e".

## Come si usa
1. Apri l'app da Safari sull'iPhone e aggiungila alla schermata Home (Condividi → Aggiungi alla schermata Home).
2. Impostazioni → **Carica voci (.zip)** e scegli `voci_rally.zip` (lo zip resta solo sul telefono, non è in questo repository).
3. Scrivi la destinazione e la partenza ("La mia posizione" va bene), poi **Simula** per ascoltare le note da casa, oppure **Parti**.
4. Impostazioni → **La tua auto**: scegli tra le auto disegnate (Freccia, Rally2, Gruppo B, Classica '70) e le livree, oppure carica le tue foto con **Carica foto auto (.zip)** (file `Nome__top.png` dall'alto col muso in su, `Nome__rear.png` da dietro; restano sul telefono). In guida la vista è 3D da dietro l'auto, oppure 2D dall'alto con la direzione in su.
5. Impostazioni → **Comandi vocali**: l'elenco di tutto quello che il copilota può dire; per ogni comando puoi ascoltarlo, sostituirlo con un file o registrarlo col microfono.
6. Tocca la mappa per segnare ostacoli (buca, dosso, acqua, ponte, lavori, autovelox, pericolo): il copilota li chiama quando ci arrivi.

Il telefono deve restare con lo schermo acceso sul supporto. Se non senti la voce, controlla l'interruttore silenzioso.

## Da dove vengono i dati
- Mappe: © OpenStreetMap, OpenTopoMap, Esri (satellite), disegnate con MapLibre GL
- Percorso: OSRM (server dimostrativo pubblico)
- Ricerca: Photon (Komoot), Nominatim
- Autovelox: OpenStreetMap via Overpass

Le note sono calcolate dalla geometria di OpenStreetMap: sono un aiuto, non un road book. Tienile un po' più larghe di quello che dicono.

## Struttura
- `js/pacenotes.js`: generatore delle note (curvatura → gravità, modificatori, distanze)
- `js/app.js`: interfaccia, ricerca, percorso, voce, guida GPS e simulazione
- `js/cars.js`: auto disegnate in SVG (vista dall'alto e da dietro)
- `vendor/`: MapLibre GL e JSZip
