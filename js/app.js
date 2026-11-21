/* Copilota Rally — navigatore con note da copilota (mappa MapLibre, vista 3D da dietro) */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.Pacenotes;

  // ---------- servizi esterni (gratuiti, senza chiave) ----------
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const PHOTON = 'https://photon.komoot.io/api/';
  const PHOTON_REV = 'https://photon.komoot.io/reverse';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · OSRM · Photon';
  // "scura" = OpenStreetMap con la luminosità invertita
  const TILES = {
    dark: { urls: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], max: 19, attr: OSM_ATTR, invert: true },
    light: { urls: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], max: 19, attr: OSM_ATTR },
    topo: { urls: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), max: 17, attr: OSM_ATTR + ' · &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
    sat: { urls: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], max: 19, attr: 'Immagini &copy; Esri, Maxar, Earthstar Geographics · OSRM · Photon' }
  };

  // ---------- tutti i comandi vocali che l'app usa ----------
  const COMMANDS = [
    ['Curve a destra', ['destra_piena', 'destra_sei', 'destra_cinque', 'destra_quattro', 'destra_tre', 'destra_due', 'destra_uno', 'destra_tornante']],
    ['Curve a sinistra', ['sinistra_piena', 'sinistra_sei', 'sinistra_cinque', 'sinistra_quattro', 'sinistra_tre', 'sinistra_due', 'sinistra_uno', 'sinistra_tornante']],
    ['Dettagli curva', ['lunga', 'molto_lunga', 'stringe', 'apre', 'secca', 'e', 'incrocio']],
    ['Distanze', ['30', '40', '50', '60', '70', '80', '100', '120', '140', '150', '160', '180', '200', '250', '300', '350', '400', '450', '500', '600', '700', '800', '900', '1000']],
    ['Indicazioni', ['stai_destra', 'stai_sinistra', 'rotonda', 'prima_uscita', 'seconda_uscita', 'terza_uscita', 'quarta_uscita', 'quinta_uscita', 'sesta_uscita', 'ricalcolo', 'fine']],
    ['Ostacoli', ['attento', 'attento_attento', 'autovelox', 'tutor', 'buca', 'dosso', 'scivola', 'ponte', 'lavori']]
  ];
  const EXITS = ['prima_uscita', 'seconda_uscita', 'terza_uscita', 'quarta_uscita', 'quinta_uscita', 'sesta_uscita'];
  // comandi che il pacchetto non ha: si usano parole già registrate dalla stessa voce
  // (se un giorno carichi la registrazione vera del comando, vale quella)
  const ALIASES = {
    autovelox: ['occhio'], tutor: ['occhio'], lavori: ['attento', 'stretta'], ricalcolo: ['aspetta'], rotonda: ['gira'],
    prima_uscita: ['_uno'], seconda_uscita: ['_due'], terza_uscita: ['_tre'], quarta_uscita: ['_quattro'], quinta_uscita: ['_cinque'], sesta_uscita: ['_sei']
  };

  // ---------- memoria locale ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cr.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('cr.' + k, JSON.stringify(v)); } catch { /* niente */ } }
  };
  const settings = Object.assign({ lead: 4.5, scale: 1, flat: true, dist: true, nav: true, cams: true, mapStyle: 'dark', sim: 80, car: 'rally2', livery: 'bianca', view: '3d', car3d: 'flat', learn: true, audioMode: 'continuo', compass: false, noMotorway: true }, store.get('settings', {}));
  if (!TILES[settings.mapStyle]) settings.mapStyle = settings.light ? 'light' : 'dark';
  let obstacles = store.get('obstacles', []);
  let recents = store.get('recents', []);

  // database sul telefono: voci e auto personali
  const db = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('copilota', 3);
      r.onupgradeneeded = () => { for (const st of ['clips', 'cars', 'stages', 'calib']) if (!r.result.objectStoreNames.contains(st)) r.result.createObjectStore(st); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (st, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(st, mode); const out = fn(t.objectStore(st)); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
    return {
      replaceAll: (st, m) => tx(st, 'readwrite', s => { s.clear(); for (const [k, v] of m) s.put(v, k); }),
      put: (st, k, v) => tx(st, 'readwrite', s => s.put(v, k)),
      async get(st, k) { const d = await open(); return new Promise((res, rej) => { const req = d.transaction(st).objectStore(st).get(k); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); },
      del: (st, keys) => tx(st, 'readwrite', s => keys.forEach(k => s.delete(k))),
      async getAll(st) { const d = await open(); return new Promise((res, rej) => { const out = new Map(); const req = d.transaction(st).objectStore(st).openCursor(); req.onsuccess = () => { const c = req.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); }; req.onerror = () => rej(req.error); }); }
    };
  })();

  // ---------- colori e cartelli ----------
  const GCOL = { piena: '#2bb3ff', 6: '#3ddc84', 5: '#b5e61d', 4: '#ffd400', 3: '#ff9f1a', 2: '#ff6a2b', 1: '#ff3b3b', tornante: '#ff3b3b', 90: '#ff3b3b' };
  const TURN = { piena: 14, 6: 24, 5: 38, 4: 52, 3: 66, 2: 82, 1: 105, 90: 90, tornante: 180 };
  const gkey = nt => nt.kind !== 'corner' ? null : (nt.mods.includes('secca') ? 90 : nt.grade);
  const colorOf = nt => nt.kind === 'corner' ? GCOL[gkey(nt)] : (nt.kind === 'nav' ? '#ffffff' : '#ff3b3b');

  // cartello della nota (SVG originale: la freccia gira tanto quanto la curva)
  function signSVG(nt) {
    const col = colorOf(nt);
    const frame = `<rect x="4" y="4" width="92" height="92" rx="16" fill="#0b0c0f" stroke="${col}" stroke-width="6"/>`;
    if (nt.kind !== 'corner') {
      const ch = nt.kind === 'finish' ? '⚑' : nt.kind === 'nav' ? (nt.icon || '↑') : '!';
      return `<svg class="sign" viewBox="0 0 100 100">${frame}<text x="50" y="68" text-anchor="middle" font-family="Barlow Condensed,sans-serif" font-weight="800" font-size="52" fill="${col}">${ch}</text></svg>`;
    }
    const g = gkey(nt), th = TURN[g] * Math.PI / 180;
    const right = nt.dir === 'destra';
    const pts = []; let x = g === 'tornante' ? 34 : 50 - Math.min(TURN[g], 90) / 90 * 16, y = 88, phi = -Math.PI / 2;
    const rr = g === 'tornante' ? 17 : g === 90 ? 3 : 30 - Math.min(TURN[g], 110) / 110 * 12;
    pts.push([x, y]); y -= g === 'tornante' ? 34 : 30; pts.push([x, y]);
    const cx = x + rr * Math.cos(phi + Math.PI / 2), cy = y + rr * Math.sin(phi + Math.PI / 2), a0 = phi - Math.PI / 2;
    for (let i = 1; i <= 24; i++) { const a = a0 + th * i / 24; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    phi += th; const tail = g === 'tornante' ? 14 : 16;
    const ex = pts[pts.length - 1][0] + tail * Math.cos(phi), ey = pts[pts.length - 1][1] + tail * Math.sin(phi);
    pts.push([ex, ey]);
    const hx = ex + 10 * Math.cos(phi), hy = ey + 10 * Math.sin(phi);
    const lx = ex + 9 * Math.cos(phi + 2.2), ly = ey + 9 * Math.sin(phi + 2.2), rx = ex + 9 * Math.cos(phi - 2.2), ry = ey + 9 * Math.sin(phi - 2.2);
    const mx = v => right ? v : 100 - v;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + mx(p[0]).toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const head = `M${mx(hx).toFixed(1)} ${hy.toFixed(1)}L${mx(lx).toFixed(1)} ${ly.toFixed(1)}L${mx(rx).toFixed(1)} ${ry.toFixed(1)}Z`;
    const lab = g === 'tornante' ? '' : g === 90 ? '!' : g === 'piena' ? 'P' : String(g);
    const long = nt.mods.includes('lunga') || nt.mods.includes('molto_lunga');
    return `<svg class="sign" viewBox="0 0 100 100">${frame}<path d="${d}" fill="none" stroke="#fff" stroke-width="${long ? 11 : 8}" stroke-linecap="round" stroke-linejoin="round"/><path d="${head}" fill="#fff"/>` +
      (lab ? `<text x="${right ? 14 : 86}" y="88" text-anchor="${right ? 'start' : 'end'}" font-family="Barlow Condensed,sans-serif" font-weight="800" font-size="26" fill="${col}">${lab}</text>` : '') + `</svg>`;
  }
  const iconHTML = nt => `<div class="ni">${signSVG(nt)}</div>`;

  // ---------- utilità geografiche ----------
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  function bearingLL(a, b) {
    const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0])), x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function distLL(a, b) { const R = 6371000, dLa = toRad(b[0] - a[0]), dLo = toRad(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
  function boundsOf(latlon) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const [la, lo] of latlon) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
    return [[w, s], [e, n]];
  }

  // ---------- mappa ----------
  const view0 = store.get('view', [45.0, 7.68]);
  const map = new maplibregl.Map({
    container: 'map',
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#15171b' } }] },
    center: [view0[1], view0[0]], zoom: store.get('zoom', 12) - 1, maxPitch: 70,
    dragRotate: false, pitchWithRotate: false, attributionControl: false, fadeDuration: 0
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  let mapReady = false; const readyQ = [];
  const whenReady = fn => mapReady ? fn() : readyQ.push(fn);
  const fc = feats => ({ type: 'FeatureCollection', features: feats });
  const line = (latlon, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: latlon.map(p => [p[1], p[0]]) } });
  map.on('load', () => {
    setTiles();
    for (const id of ['alts', 'route', 'corners']) map.addSource(id, { type: 'geojson', data: fc([]) });
    const lay = { 'line-cap': 'round', 'line-join': 'round' };
    map.addLayer({ id: 'alts', type: 'line', source: 'alts', layout: lay, paint: { 'line-color': '#6b7280', 'line-width': 6, 'line-opacity': .75 } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: lay, paint: { 'line-color': '#000', 'line-width': 11, 'line-opacity': .55 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: lay, paint: { 'line-color': '#e8e8e8', 'line-width': 6 } });
    map.addLayer({ id: 'corners', type: 'line', source: 'corners', layout: lay, paint: { 'line-color': ['get', 'c'], 'line-width': 7 } });
    mapReady = true; readyQ.splice(0).forEach(f => f());
  });
  function setTiles() {
    const t = TILES[settings.mapStyle] || TILES.dark;
    if (map.getLayer('base')) map.removeLayer('base');
    if (map.getSource('base')) map.removeSource('base');
    map.addSource('base', { type: 'raster', tiles: t.urls, tileSize: 256, maxzoom: t.max, attribution: t.attr });
    const paint = t.invert ? { 'raster-brightness-min': 0.9, 'raster-brightness-max': 0.06, 'raster-hue-rotate': 180, 'raster-saturation': -0.45, 'raster-contrast': 0.05 } : {};
    map.addLayer({ id: 'base', type: 'raster', source: 'base', paint }, map.getLayer('alts') ? 'alts' : undefined);
  }
  map.on('moveend', () => { if (drive.on) return; const c = map.getCenter(); store.set('view', [c.lat, c.lng]); store.set('zoom', map.getZoom() + 1); });
  map.on('zoom', updateLabelVisibility);
  map.on('dragstart', () => { if (drive.on) { drive.follow = false; $('btnLocate').classList.add('attn'); } });
  function updateLabelVisibility() { $('map').classList.toggle('show-labels', map.getZoom() >= 13.5); }

  function marker(html, cls, lnglat, opts = {}) {
    const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
    return new maplibregl.Marker(Object.assign({ element: el, anchor: 'center' }, opts)).setLngLat(lnglat).addTo(map);
  }
  let popup = null, skipClick = false;
  function openPopup(lnglat, html) {
    if (popup) popup.remove();
    $('sheet').classList.add('min'); // il foglio note si abbassa per non coprire il menu
    const pt = map.project(lnglat), H = map.getContainer().clientHeight;
    if (pt.y > H * 0.45) map.easeTo({ center: map.unproject([map.getContainer().clientWidth / 2, H / 2 + (pt.y - H * 0.35)]), duration: 300 });
    popup = new maplibregl.Popup({ closeButton: false, maxWidth: '280px', offset: 12 }).setLngLat(lnglat).setHTML(html).addTo(map);
    return popup.getElement();
  }
  const closePopup = () => { if (popup) { popup.remove(); popup = null; } };

  // ---------- messaggi ----------
  let toastT;
  function toast(msg, ms = 3000, spin = false) {
    const t = $('toast'); t.innerHTML = (spin ? '<span class="spin"></span>' : '') + esc(msg); t.hidden = false;
    clearTimeout(toastT); if (ms) toastT = setTimeout(() => t.hidden = true, ms);
  }
  const t_hide = () => { $('toast').hidden = true; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- auto: disegnate o foto personali ----------
  const customCars = new Map(); // id → { name, top, rear } (URL delle immagini)
  async function loadCustomCars() {
    try {
      const all = await db.getAll('cars');
      customCars.forEach(c => { c.top && URL.revokeObjectURL(c.top); c.rear && URL.revokeObjectURL(c.rear); });
      customCars.clear();
      for (const [id, c] of all) customCars.set(id, { name: c.name, top: c.top && URL.createObjectURL(new Blob([c.top.buf], { type: c.top.type })), rear: c.rear && URL.createObjectURL(new Blob([c.rear.buf], { type: c.rear.type })) });
    } catch { /* niente auto personali */ }
    if (settings.car.startsWith('x:') && !customCars.has(settings.car)) settings.car = 'rally2';
  }
  async function importCars(files) {
    const found = new Map();
    const add = async (name, buf) => {
      const m = name.split('/').pop().match(/^(.+?)__(top|rear|alto|dietro)\.(png|webp|jpe?g)$/i); if (!m) return;
      const id = 'x:' + m[1].toLowerCase(), view = /top|alto/i.test(m[2]) ? 'top' : 'rear';
      const type = /png/i.test(m[3]) ? 'image/png' : /webp/i.test(m[3]) ? 'image/webp' : 'image/jpeg';
      const c = found.get(id) || { name: m[1].replace(/_/g, ' ') };
      c[view] = { buf, type }; found.set(id, c);
    };
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) { const zip = await JSZip.loadAsync(f); for (const e of Object.values(zip.files)) if (!e.dir && !/__MACOSX/.test(e.name)) await add(e.name, await e.async('arraybuffer')); }
      else await add(f.name, await f.arrayBuffer());
    }
    if (!found.size) throw new Error('nessuna immagine con nome "Auto__top.png" o "Auto__rear.png"');
    const old = await db.getAll('cars');
    for (const [id, c] of found) { const o = old.get(id) || {}; await db.put('cars', id, Object.assign(o, c)); }
    await loadCustomCars();
    return found.size;
  }
  const carInfo = () => customCars.get(settings.car) || null;
  // vista disponibile per l'auto scelta: 'rear' (da dietro), 'flat' (foto dall'alto appoggiata sulla strada), 'top'
  // in 3D: 'flat' = vista dall'alto appoggiata sulla strada (ruota con l'auto), 'rear' = da dietro
  function carView(want) {
    if (want !== 'rear') return 'top';
    const c = carInfo();
    const hasTop = !c || !!c.top, hasRear = !c || !!c.rear;
    if (settings.car3d === 'flat') return hasTop ? 'flat' : 'rear';
    return hasRear ? 'rear' : 'flat';
  }
  function carHTML(view) {
    const c = carInfo();
    if (c) {
      if (view === 'rear' && c.rear) return `<img class="car" src="${c.rear}" alt="">`;
      if (c.top) return `<img class="car" src="${c.top}" alt="">`;
      return view === 'rear' ? Cars.rear('rally2', settings.livery) : Cars.top('rally2', settings.livery);
    }
    return view === 'rear' ? Cars.rear(settings.car, settings.livery) : Cars.top(settings.car, settings.livery);
  }

  // ---------- posizione e direzione del veicolo (sempre visibili) ----------
  const gps = { fix: null, heading: null, compass: null, watch: null };
  function startGeo() {
    if (!navigator.geolocation || gps.watch != null) return;
    gps.watch = navigator.geolocation.watchPosition(onGeo, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  function onGeo(p) {
    const c = p.coords, t = Date.now(), ll = [c.latitude, c.longitude];
    const sp = c.speed != null && c.speed >= 0 ? c.speed : null;
    let hd = c.heading != null && !isNaN(c.heading) && (sp || 0) > 1.2 ? c.heading : null;
    if (hd == null && gps.fix && distLL(gps.fix.ll, ll) > 6 && (sp == null || sp > 1.2)) hd = bearingLL(gps.fix.ll, ll);
    if (hd != null) gps.heading = hd;
    gps.fix = { ll, speed: sp, acc: c.accuracy, t };
    if (drive.on && !drive.sim) drive.onFix(ll[0], ll[1], sp, c.accuracy, t, hd);
    if (!drive.on) car.update();
  }
  async function startCompass() {
    if (!settings.compass || startCompass.asked) return;
    startCompass.asked = true;
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
      }
    } catch { return; }
    if (startCompass.on) return; startCompass.on = true;
    const h = e => {
      let v = null;
      if (e.webkitCompassHeading != null) v = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) v = 360 - e.alpha;
      if (v == null) return;
      v = (v + (screen.orientation ? screen.orientation.angle || 0 : 0)) % 360;
      gps.compass = gps.compass == null ? v : (gps.compass + angDiff(v, gps.compass) * 0.3 + 360) % 360;
      if (!drive.on) car.update();
    };
    window.addEventListener('deviceorientationabsolute', h);
    window.addEventListener('deviceorientation', h);
  }

  // l'auto sulla mappa: dall'alto in 2D, da dietro in guida 3D
  const car = {
    m: null, mode: null, raf: 0,
    ensure(mode) {
      if (!this.m) {
        const el = document.createElement('div'); el.className = 'carmk';
        this.m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([0, 0]);
      }
      if (this.mode !== mode) {
        this.mode = mode;
        const el = this.m.getElement();
        el.className = 'carmk ' + mode + (carInfo() ? ' photo' : '');
        el.innerHTML = carHTML(mode === 'rear' ? 'rear' : 'top');
        this.m.setRotationAlignment(mode === 'rear' ? 'viewport' : 'map');
        this.m.setPitchAlignment(mode === 'rear' ? 'viewport' : 'map');
      }
      return this.m;
    },
    redraw() { const md = this.mode; this.mode = null; if (md) this.ensure(md === 'top' ? 'top' : carView('rear')); },
    update() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        if (drive.on || !gps.fix) return;
        const m = this.ensure('top');
        const moving = (gps.fix.speed || 0) > 1.5;
        const h = moving && gps.heading != null ? gps.heading : (gps.compass != null ? gps.compass : (gps.heading || 0));
        m.setLngLat([gps.fix.ll[1], gps.fix.ll[0]]).setRotation(h);
        if (!m._map) m.addTo(map);
      });
    }
  };

  // ---------- ricerca luoghi ----------
  const places = { from: null, to: null };
  let activeInput = null, suggItems = [], suggT, suggAbort;
  const ICON_PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const ICON_ME = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  const ICON_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  for (const key of ['from', 'to']) {
    const inp = key === 'from' ? $('inFrom') : $('inTo');
    inp.addEventListener('focus', () => { activeInput = key; inp.select(); showSuggestions(inp.value); });
    inp.addEventListener('input', () => { places[key] = null; clearTimeout(suggT); suggT = setTimeout(() => showSuggestions(inp.value), 280); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const f = suggItems.find(i => i.place); if (f) pick(f); else nominatimSearch(inp.value); }
      if (e.key === 'Escape') hideSuggestions();
    });
  }
  document.addEventListener('pointerdown', e => { if (!$('plan').contains(e.target)) hideSuggestions(); });
  function hideSuggestions() { $('sugg').hidden = true; }
  function renderSuggestions(items) {
    suggItems = items;
    $('sugg').innerHTML = items.map((it, i) => `<li data-i="${i}" class="${it.place || it.me ? '' : 'empty'}">${it.icon || ''}<div><div class="t">${esc(it.title)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ''}</div></li>`).join('');
    $('sugg').hidden = !items.length;
  }
  $('sugg').addEventListener('click', e => { const li = e.target.closest('li'); if (li) pick(suggItems[+li.dataset.i]); });
  async function showSuggestions(q) {
    q = q.trim();
    const base = [{ me: true, icon: ICON_ME, title: 'La mia posizione' }];
    if (q.length < 3) { renderSuggestions(base.concat(recents.slice(0, 6).map(p => ({ place: p, icon: ICON_CLOCK, title: p.name, sub: p.sub })))); return; }
    if (suggAbort) suggAbort.abort();
    suggAbort = new AbortController();
    const c = map.getCenter();
    try {
      const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=7&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`, { signal: suggAbort.signal });
      const j = await r.json();
      const items = (j.features || []).map(f => {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        const street = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '';
        const name = p.name || street || p.city || 'Luogo';
        const sub = [p.name && street ? street : '', p.city || p.town || p.village || p.district, p.county || p.state, p.country !== 'Italia' && p.country !== 'Italy' ? p.country : ''].filter(Boolean).join(', ');
        return { place: { lat, lon, name, sub }, icon: ICON_PIN, title: name, sub };
      });
      renderSuggestions(base.concat(items.length ? items : [{ title: 'Nessun risultato', sub: 'Premi Invio per una ricerca più ampia' }]));
    } catch (e) {
      if (e.name !== 'AbortError') renderSuggestions(base.concat([{ title: 'Ricerca non raggiungibile', sub: 'Premi Invio per riprovare' }]));
    }
  }
  async function nominatimSearch(q) {
    if (!q.trim()) return;
    try {
      const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=6&accept-language=it&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      renderSuggestions(j.map(x => { const parts = x.display_name.split(', '); return { place: { lat: +x.lat, lon: +x.lon, name: parts[0], sub: parts.slice(1, 4).join(', ') }, icon: ICON_PIN, title: parts[0], sub: parts.slice(1, 4).join(', ') }; }));
    } catch { toast('Ricerca non raggiungibile: controlla la connessione'); }
  }
  async function myPosition() {
    if (gps.fix && Date.now() - gps.fix.t < 20000) return gps.fix.ll;
    const p = await new Promise((res, rej) => { if (!navigator.geolocation) return rej(); navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }); });
    return [p.coords.latitude, p.coords.longitude];
  }
  async function pick(it) {
    if (!it || (!it.place && !it.me)) return;
    const key = activeInput || 'to';
    let place = it.place;
    if (it.me) {
      toast('Cerco la tua posizione…', 0, true);
      try { const ll = await myPosition(); place = { lat: ll[0], lon: ll[1], name: 'La mia posizione', sub: '', me: true }; t_hide(); }
      catch { toast('Posizione non disponibile: consenti la localizzazione a Safari'); return; }
    } else addRecent(place);
    setPlace(key, place);
    hideSuggestions();
    (key === 'from' ? $('inFrom') : $('inTo')).blur();
    if (key === 'from' && !places.to) $('inTo').focus();
    else if (key === 'to' && !places.from) { activeInput = 'from'; useMyPositionAsStart(); }
    computeRoute().catch(() => {});
  }
  function addRecent(p) { recents = [p].concat(recents.filter(r => Math.abs(r.lat - p.lat) > 1e-4 || Math.abs(r.lon - p.lon) > 1e-4)).slice(0, 8); store.set('recents', recents); }
  function setPlace(key, place) { places[key] = place; (key === 'from' ? $('inFrom') : $('inTo')).value = place ? place.name : ''; drawPins(); }
  async function useMyPositionAsStart() {
    try { const ll = await myPosition(); setPlace('from', { lat: ll[0], lon: ll[1], name: 'La mia posizione', me: true }); computeRoute().catch(() => {}); }
    catch { $('inFrom').focus(); }
  }
  const pins = {};
  function drawPins() {
    if (!mapReady) return;
    for (const [k, col] of [['from', '#f3f2ee'], ['to', '#ffd400']]) {
      if (pins[k]) { pins[k].remove(); pins[k] = null; }
      const p = places[k]; if (!p || p.me) continue;
      pins[k] = marker(`<span style="background:${col}"></span>`, 'pin', [p.lon, p.lat]);
    }
  }
  $('btnSwap').addEventListener('click', () => { const a = places.from, b = places.to; setPlace('from', b); setPlace('to', a); computeRoute().catch(() => {}); });
  $('btnLocate').addEventListener('click', async () => {
    startCompass();
    $('btnLocate').classList.remove('attn');
    if (drive.on) { drive.follow = true; return; }
    try { const ll = await myPosition(); map.easeTo({ center: [ll[1], ll[0]], zoom: Math.max(map.getZoom(), 15), duration: 600 }); car.update(); }
    catch { toast('Posizione non disponibile'); }
  });

  // ---------- tocco sulla mappa: partenza, arrivo, ostacolo ----------
  const OBS = {
    autovelox: { label: 'Autovelox', ch: 'V', tokens: ['autovelox'] },
    tutor: { label: 'Tutor', ch: 'TU', tokens: ['tutor'] },
    buca: { label: 'Buca', ch: 'B', tokens: ['buca'] },
    acqua: { label: 'Acqua / scivola', ch: 'A', tokens: ['scivola'] },
    dosso: { label: 'Dosso', ch: 'D', tokens: ['dosso'] },
    ponte: { label: 'Ponte stretto', ch: 'P', tokens: ['ponte'] },
    lavori: { label: 'Lavori', ch: 'L', tokens: ['lavori'] },
    pericolo: { label: 'Pericolo', ch: '!', tokens: ['attento_attento'] }
  };
  map.on('click', e => {
    if (drive.on || skipClick) { skipClick = false; return; }
    hideSuggestions();
    if (mapReady) {
      const f = map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['alts'] });
      if (f.length) { selectRoute(f[0].properties.idx, false); return; }
    }
    const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    const onRoute = cur && projectOnRoute(ll.lat, ll.lng, cur.gen.route);
    const el = openPopup(e.lngLat, `<div class="pop"><h4>${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</h4>
      ${onRoute && onRoute.d < 40 ? '<button class="pb hl" data-add="1">Aggiungi una curva qui</button>' : ''}
      <button class="pb" data-a="from">Parti da qui</button><button class="pb" data-a="to">Arriva qui</button>
      <h4 style="margin-top:12px">Segna un ostacolo</h4><div class="grid">${Object.entries(OBS).map(([k, o]) => `<button class="pb" data-o="${k}">${o.label}</button>`).join('')}</div></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      closePopup();
      if (b.dataset.add) { editor.addAt(onRoute.s); return; }
      if (b.dataset.o) { obstacles.push({ lat: ll.lat, lon: ll.lng, type: b.dataset.o }); saveObstacles(); toast(OBS[b.dataset.o].label + ' segnato'); refreshNotes(); return; }
      const key = b.dataset.a;
      const place = { lat: ll.lat, lon: ll.lng, name: 'Punto sulla mappa', sub: '' };
      setPlace(key, place); computeRoute().catch(() => {});
      try {
        const r = await fetch(`${PHOTON_REV}?lat=${ll.lat}&lon=${ll.lng}`); const j = await r.json(); const p = j.features && j.features[0] && j.features[0].properties;
        if (p) { place.name = p.name || (p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : place.name); (key === 'from' ? $('inFrom') : $('inTo')).value = place.name; }
      } catch { /* resta il nome generico */ }
    });
  });
  let obsMarkers = [];
  function saveObstacles() { store.set('obstacles', obstacles); drawObstacles(); $('obsCount').textContent = obstacles.length; }
  function drawObstacles() {
    if (!mapReady) return;
    obsMarkers.forEach(m => m.remove()); obsMarkers = [];
    obstacles.forEach((o, i) => {
      const m = marker(`<span>${OBS[o.type].ch}</span>`, 'obsicon', [o.lon, o.lat]);
      m.getElement().addEventListener('click', ev => {
        ev.stopPropagation(); skipClick = true; setTimeout(() => skipClick = false, 300);
        const el = openPopup([o.lon, o.lat], `<div class="pop"><h4>${OBS[o.type].label}</h4><button class="pb" data-del="1">Rimuovi</button></div>`);
        el.addEventListener('click', e => { if (e.target.closest('[data-del]')) { obstacles.splice(i, 1); saveObstacles(); closePopup(); refreshNotes(); } });
      });
      obsMarkers.push(m);
    });
  }

  // ---------- percorso ----------
  let routes = [], routeIdx = 0, cur = null;
  let cams = [], routeReq = 0;
  let osrmNoExclude = false;
  // heading: direzione di marcia (gradi), così il percorso nuovo non parte "all'indietro"
  async function computeRoute(fromOverride, opts = {}) {
    const a = fromOverride || places.from, b = places.to;
    if (!a || !b) return;
    const my = ++routeReq;
    if (!drive.on) toast('Calcolo il percorso…', 0, true);
    let heading = opts.heading;
    if (heading == null && !fromOverride && a.me && gps.fix && (gps.fix.speed || 0) > 3 && gps.heading != null) heading = gps.heading;
    const base = `${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true&alternatives=${drive.on ? 'false' : 'true'}`;
    const ask = async (useBearing, useExclude) => {
      let u = base;
      if (useBearing && heading != null) u += `&bearings=${Math.round((heading % 360 + 360) % 360)},60;`;
      if (useExclude) u += '&exclude=motorway';
      try { const r = await fetch(u + '&annotations=maxspeed'); if (r.ok) { const j = await r.json(); if (j.code === 'Ok') return j; } } catch { /* riprova senza */ }
      return (await fetch(u)).json();
    };
    try {
      const wantEx = settings.noMotorway && !osrmNoExclude;
      let j = await ask(true, wantEx);
      // il server non conosce "exclude": si riprova senza e non lo si chiede più
      if (wantEx && j.code !== 'Ok' && /exclude|invalid/i.test(`${j.code} ${j.message}`)) { osrmNoExclude = true; j = await ask(true, false); }
      // partenza agganciata a una strada lontana (sei in autostrada ma sono escluse): senza esclusione
      else if (wantEx && j.code === 'Ok' && j.waypoints && j.waypoints[0].distance > 40) j = await ask(true, false);
      // direzione impossibile (GPS impreciso): senza direzione
      if (j.code !== 'Ok' && heading != null) j = await ask(false, settings.noMotorway && !osrmNoExclude);
      if (my !== routeReq) return;
      if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.message || 'nessun percorso');
      routes = j.routes; routeIdx = 0;
      t_hide();
      selectRoute(0, !drive.on);
      if (settings.cams) loadCameras();
    } catch (e) {
      toast(drive.on ? 'Ricalcolo non riuscito, riprovo…' : !navigator.onLine ? 'Senza connessione: apri una prova salvata' : 'Percorso non trovato o servizio non raggiungibile', 4000);
      throw e;
    }
  }
  function selectRoute(i, fit) {
    routeIdx = i;
    const osrm = routes[i], coords = osrm.geometry.coordinates;
    cur = { gen: P.generate(coords, genOptions()), osrm, coords, stage: null, stageName: '', edited: false };
    cur.base = computeBase();
    cur.man = buildManeuvers(osrm, cur.gen.route);
    cur.limits = buildLimits(osrm);
    buildNotes(); drawRoute(fit); renderSheet();
  }
  function genOptions() { return { scale: settings.scale, callFlat: settings.flat }; }
  function refreshNotes(fromSettings) {
    if (!cur) return;
    if (!drive.on && !cur.edited) { cur.gen = P.generate(cur.coords, genOptions()); cur.base = computeBase(); }
    else if (fromSettings && cur.edited) toast('Questo percorso ha note corrette a mano: la modifica vale per i percorsi nuovi', 4000);
    buildNotes(); drawRoute(false); renderSheet();
    if (drive.on) drive.resync();
  }
  // heading (facoltativo): scarta i tratti percorsi nel verso opposto, così nei tornanti
  // il GPS non si aggancia all'altro lato della curva
  function projectOnRoute(lat, lon, route, i0 = 0, i1 = route.pts.length - 1, heading = null) {
    const [x, y] = route.proj.fwd(lon, lat);
    let best = { d: Infinity, s: 0, i: 0 };
    const a = Math.max(0, i0), b = Math.min(route.pts.length - 1, i1);
    for (let i = a; i < b; i++) {
      const p = route.pts[i], q = route.pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy || 1e-9;
      if (heading != null && Math.abs(angDiff(toDeg(Math.atan2(dx, dy)), heading)) > 75) continue;
      let t = ((x - p[0]) * dx + (y - p[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const px = p[0] + dx * t, py = p[1] + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { d, s: route.s[i] + (route.s[i + 1] - route.s[i]) * t, i };
    }
    if (heading != null && best.d === Infinity) return projectOnRoute(lat, lon, route, i0, i1, null);
    return best;
  }
  function pointAtS(route, s) {
    const S = route.s; let lo = 0, hi = S.length - 1;
    if (s <= 0) return { ll: route.latlon[0], i: 0 };
    if (s >= S[hi]) return { ll: route.latlon[hi], i: hi };
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1), A = route.latlon[lo], B = route.latlon[hi];
    return { ll: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], i: lo };
  }
  function routeBearing(route, s) { return bearingLL(pointAtS(route, s - 4).ll, pointAtS(route, Math.min(route.length, s + 22)).ll); }

  let noteSeq = 1;
  // note del percorso (curve, incroci, rotonde, arrivo): sono quelle che si correggono e si salvano
  function computeBase() {
    const { gen, osrm } = cur, route = gen.route;
    let notes = gen.notes.map(n => Object.assign({}, n, { mods: n.mods.slice(), junction: false }));
    const extra = [];
    if (settings.nav && osrm.legs) {
      const steps = osrm.legs.flatMap(l => l.steps);
      let lastI = 0;
      steps.forEach(st => {
        const m = st.maneuver, type = m.type, mod = m.modifier || '';
        if (type === 'depart' || type === 'arrive') return;
        const pr = projectOnRoute(m.location[1], m.location[0], route, lastI - 5, lastI + 4000);
        if (pr.d > 40) return;
        lastI = pr.i;
        const s0 = pr.s;
        if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
          const s1 = s0 + (st.distance || 30);
          notes = notes.filter(n => n.endS < s0 - 10 || n.startS > s1 + 10);
          const ex = Math.max(1, Math.min(6, m.exit || 1));
          extra.push({ kind: 'nav', icon: '⟳', label: 'ROT ' + ex, startS: Math.max(0, s0 - 15), endS: s1, tokens: ['rotonda', EXITS[ex - 1]] });
          return;
        }
        if (type === 'exit roundabout' || type === 'exit rotary') return;
        if (!/left|right/.test(mod) || /uturn/.test(mod)) return;
        const left = /left/.test(mod);
        const near = notes.find(n => n.kind === 'corner' && n.startS - 30 <= s0 && n.endS + 30 >= s0 && (n.dir === 'sinistra') === left);
        if (near) { near.junction = true; return; }
        if (type === 'fork' || type === 'off ramp' || type === 'on ramp' || type === 'merge' || /slight/.test(mod) || type === 'turn' || type === 'end of road') {
          extra.push({ kind: 'nav', icon: left ? '↖' : '↗', label: left ? 'STAI SX' : 'STAI DX', startS: Math.max(0, s0 - 10), endS: s0, tokens: [left ? 'stai_sinistra' : 'stai_destra'] });
        }
      });
    }
    extra.push({ kind: 'finish', label: 'Arrivo', startS: Math.max(0, route.length - 40), endS: route.length, tokens: ['fine'] });
    notes = notes.concat(extra).sort((x, y) => x.startS - y.startS);
    notes.forEach(n => { n.id = noteSeq++; delete n.into; delete n.dist; });
    return notes;
  }
  // note finali = note base + ostacoli segnati + autovelox
  function buildNotes() {
    const route = cur.gen.route;
    const notes = cur.base.map(n => Object.assign({}, n, n.mods ? { mods: n.mods.slice() } : {}, n.tokens ? { tokens: n.tokens.slice() } : {}));
    const obsList = obstacles.map(o => ({ ...o })).concat(settings.cams ? cams.map(c => ({ ...c, type: c.type || 'autovelox' })) : []);
    for (const o of obsList) {
      const pr = projectOnRoute(o.lat, o.lon, route);
      if (pr.d > 25) continue;
      notes.push({ kind: 'obs', obsType: o.type, label: OBS[o.type].label + (o.max ? ' ' + o.max : ''), startS: Math.max(0, pr.s - 10), endS: pr.s, tokens: OBS[o.type].tokens.slice() });
    }
    notes.sort((x, y) => x.startS - y.startS);
    P.linkDistances(notes, route.length, cur.gen.cfg);
    cur.notes = notes;
    cur.calls = P.buildCalls(notes);
  }

  let labelMarkers = [];
  function drawRoute(fit) {
    whenReady(() => {
      const route = cur.gen.route;
      map.getSource('alts').setData(fc(routes.map((r, i) => i === routeIdx ? null : line(r.geometry.coordinates.map(c => [c[1], c[0]]), { idx: i })).filter(Boolean)));
      map.getSource('route').setData(line(route.latlon));
      map.getSource('corners').setData(fc(cur.notes.filter(n => n.kind === 'corner').map(n => line(route.latlon.slice(n.i0, n.i1 + 1), { c: colorOf(n) }))));
      labelMarkers.forEach(m => m.remove()); labelMarkers = [];
      for (const nt of cur.notes) {
        const at = pointAtS(route, nt.startS).ll;
        const txt = nt.kind === 'corner' ? P.shortLabel(nt) + (nt.mods.some(m => /lunga/.test(m)) ? ' L' : '') : nt.kind === 'obs' ? OBS[nt.obsType].ch : nt.kind === 'finish' ? 'FINE' : nt.label;
        const m = marker(`<span style="background:${colorOf(nt)}">${esc(txt)}</span>`, 'nlabel', [at[1], at[0]]);
        m._s = nt.startS;
        labelMarkers.push(m);
      }
      updateLabelVisibility();
      if (fit) fitRoute();
    });
  }
  function fitRoute() {
    if (!cur) return;
    map.fitBounds(boundsOf(cur.gen.route.latlon), { padding: { top: 150, bottom: Math.min(innerHeight * 0.5, 380), left: 30, right: 30 }, bearing: 0, pitch: 0, duration: 700 });
  }
  function fmtKm(m) { return m >= 10000 ? Math.round(m / 1000) + ' km' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
  function fmtMin(s) { const m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function renderSheet() {
    $('sheet').hidden = false;
    $('sumKm').textContent = fmtKm(cur.osrm.distance);
    $('sumTime').textContent = fmtMin(cur.osrm.duration);
    $('sumNotes').textContent = cur.notes.filter(n => n.kind === 'corner').length;
    $('alts').innerHTML = routes.length > 1 ? routes.map((r, i) => `<button data-i="${i}" class="${i === routeIdx ? 'on' : ''}">${fmtKm(r.distance)} · ${fmtMin(r.duration)}</button>`).join('') : '';
    $('noteList').innerHTML = cur.calls.map(c => `<li data-c="${c.id}">${iconHTML(c.notes[0])}<div class="nt">${esc(callTitle(c))}</div><div class="nm">${fmtKm(c.startS)}</div>${c.notes.some(n => n.id) ? `<button class="edit" data-e="${c.id}" aria-label="Modifica nota"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>` : '<span></span>'}</li>`).join('');
    $('stageName').textContent = cur.stage ? cur.stageName : cur.edited ? 'Note corrette, non salvate' : 'Note calcolate';
    $('stageBar').classList.toggle('saved', !!cur.stage);
    $('btnSaveStage').textContent = cur.stage ? 'Rinomina' : 'Salva prova';
  }
  $('alts').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectRoute(+b.dataset.i, false); });
  $('noteList').addEventListener('click', e => {
    const ed = e.target.closest('.edit');
    if (ed) { const c = cur.calls[+ed.dataset.e]; const n = c.notes.find(x => x.id && x.kind === 'corner') || c.notes.find(x => x.id); if (n) editor.open(n.id, c); return; }
    const li = e.target.closest('li'); if (!li) return;
    const c = cur.calls[+li.dataset.c], at = pointAtS(cur.gen.route, c.startS + 20).ll;
    map.easeTo({ center: [at[1], at[0]], zoom: 16, duration: 500 });
    voice.unlock(); voice.say(callTokensFiltered(c));
  });
  $('sheet').querySelector('.grab').addEventListener('click', () => $('sheet').classList.toggle('min'));
  function callTitle(c) { return c.notes.map(n => n.kind === 'corner' ? P.tokensText(P.noteTokens(n)) : n.kind === 'obs' ? n.label : n.kind === 'finish' ? 'Fine' : P.tokensText(n.tokens)).join(' e ') + (c.notes[c.notes.length - 1].dist && settings.dist ? ' · ' + c.notes[c.notes.length - 1].dist : ''); }
  function callShort(c) {
    const parts = c.notes.map(n => n.kind === 'corner' ? P.shortLabel(n) + (n.mods.some(m => /lunga/.test(m)) ? ' L' : '') + (n.mods.includes('stringe') ? ' ↘' : '') : n.kind === 'finish' ? 'FINE' : n.label);
    const last = c.notes[c.notes.length - 1];
    return parts.join(' + ') + (last.dist && settings.dist ? ' · ' + last.dist : '');
  }
  function callTokensFiltered(c) { return settings.dist ? c.tokens : c.tokens.filter(t => !/^\d+$/.test(t)); }

  // ---------- autovelox da OpenStreetMap ----------
  // autovelox e tutor: tutto il Piemonte in una volta (tenuto 7 giorni, funziona anche senza campo);
  // fuori dal Piemonte si aggiungono quelli intorno al percorso
  const PIEMONTE = { s: 44.06, n: 46.47, w: 6.62, e: 9.22 };
  function parseEnforcement(j) {
    const nodes = {}, list = [], seen = new Set();
    for (const e of j.elements || []) if (e.type === 'node') nodes[e.id] = e;
    for (const e of j.elements || []) if (e.type === 'node' && e.tags && e.tags.highway === 'speed_camera') { seen.add(e.id); list.push({ lat: e.lat, lon: e.lon, type: 'autovelox', max: parseInt(e.tags.maxspeed) || null }); }
    for (const e of j.elements || []) {
      if (e.type !== 'relation' || !e.tags) continue;
      const avg = e.tags.enforcement === 'average_speed';
      if (!avg && e.tags.enforcement !== 'maxspeed') continue;
      for (const m of e.members || []) {
        const nd = nodes[m.ref];
        if (m.type !== 'node' || !nd || seen.has(m.ref)) continue;
        if (m.role === 'device' || (avg && m.role === 'from')) { seen.add(m.ref); list.push({ lat: nd.lat, lon: nd.lon, type: avg ? 'tutor' : 'autovelox', max: parseInt(e.tags.maxspeed) || null }); }
      }
    }
    return list;
  }
  async function overpass(q) {
    const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return parseEnforcement(await r.json());
  }
  let camsRegion = store.get('camsPiemonte', null);
  async function loadCameras() {
    if (!cur) return;
    let list = camsRegion ? camsRegion.list.slice() : [];
    if (!camsRegion || Date.now() - camsRegion.t > 7 * 864e5) {
      try {
        const reg = await overpass('[out:json][timeout:90];area["ISO3166-2"="IT-21"]->.a;node["highway"="speed_camera"](area.a)->.c;rel["type"="enforcement"](area.a)->.e;node(r.e)->.m;(.c;.e;.m;);out body;');
        if (reg.length) { camsRegion = { t: Date.now(), list: reg }; store.set('camsPiemonte', camsRegion); list = reg.slice(); }
      } catch { /* si usa quello che c'è */ }
    }
    const [[w, s], [e, n]] = boundsOf(cur.gen.route.latlon), pad = 0.01;
    const outside = s < PIEMONTE.s || n > PIEMONTE.n || w < PIEMONTE.w || e > PIEMONTE.e;
    if (outside && cur.gen.route.length < 400000) {
      try {
        const bb = `${s - pad},${w - pad},${n + pad},${e + pad}`;
        list = list.concat(await overpass(`[out:json][timeout:25];(node["highway"="speed_camera"](${bb});rel["type"="enforcement"](${bb});)->.x;node(r.x)->.m;(.x;.m;);out body;`));
      } catch { /* niente */ }
    }
    const key = c => c.lat.toFixed(5) + ',' + c.lon.toFixed(5);
    const uniq = new Map(); for (const c of list) if (!uniq.has(key(c))) uniq.set(key(c), c);
    cams = [...uniq.values()];
    if (cams.length) { buildNotes(); drawRoute(false); renderSheet(); if (drive.on) drive.resync(); }
  }

  // ---------- indicazioni stradali e limiti (come un navigatore) ----------
  const DIRW = { left: 'a sinistra', right: 'a destra', 'slight left': 'leggermente a sinistra', 'slight right': 'leggermente a destra', 'sharp left': 'tutto a sinistra', 'sharp right': 'tutto a destra', straight: 'dritto' };
  const ORD = ['', 'prima', 'seconda', 'terza', 'quarta', 'quinta', 'sesta', 'settima', 'ottava'];
  const sideW = m => (m || '').includes('left') ? 'sinistra' : 'destra';
  function instrText(m, final) {
    const mod = m.modifier || 'straight', d = DIRW[mod] || '';
    switch (m.type) {
      case 'arrive': return final ? 'arrivo a destinazione' : 'arrivo alla tappa';
      case 'merge': return 'immettiti a ' + sideW(mod);
      case 'on ramp': return 'prendi la rampa' + (mod !== 'straight' && d ? ' ' + d : '');
      case 'off ramp': return "prendi l'uscita a " + sideW(mod);
      case 'fork': return 'al bivio tieni la ' + sideW(mod);
      case 'roundabout': case 'rotary': return m.exit ? `alla rotonda prendi la ${ORD[m.exit] || m.exit + 'ª'} uscita` : 'entra nella rotonda';
      case 'roundabout turn': return 'alla rotonda svolta ' + d;
      case 'end of road': return mod === 'uturn' ? 'fai inversione a U' : 'alla fine della strada svolta a ' + sideW(mod);
      default:
        if (mod === 'uturn') return 'fai inversione a U';
        if (mod === 'straight') return 'prosegui dritto';
        if ((m.type === 'continue' || m.type === 'new name') && mod.startsWith('slight')) return 'tieni la ' + sideW(mod);
        return 'svolta ' + d;
    }
  }
  function buildManeuvers(osrm, route) {
    const out = []; if (!osrm.legs) return out;
    let lastI = 0;
    osrm.legs.forEach((leg, li) => (leg.steps || []).forEach(st => {
      const m = st.maneuver, t = m.type, mod = m.modifier || 'straight';
      if (t === 'depart' || t === 'exit roundabout' || t === 'exit rotary') return;
      if (['new name', 'continue', 'notification', 'use lane'].includes(t) && (!m.modifier || mod === 'straight')) return;
      const pr = projectOnRoute(m.location[1], m.location[0], route, lastI - 5, lastI + 4000);
      if (pr.d > 60) return;
      lastI = pr.i;
      out.push({ s: pr.s, type: t, mod, exit: m.exit || 0, text: instrText(m, li === osrm.legs.length - 1), name: t === 'arrive' ? '' : (st.name || st.ref || '') });
    }));
    return out;
  }
  // limiti di velocità di OpenStreetMap lungo il percorso (se il server li fornisce)
  function buildLimits(osrm) {
    const ms = []; let ok = true;
    (osrm.legs || []).forEach(l => { const a = l.annotation && l.annotation.maxspeed; if (a) ms.push(...a); else ok = false; });
    if (!ok || !ms.length) return null;
    const c = osrm.geometry.coordinates, cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + distLL([c[i - 1][1], c[i - 1][0]], [c[i][1], c[i][0]]));
    const v = ms.map(x => !x || x.unknown || x.none || !x.speed ? 0 : (x.unit === 'mph' ? Math.round(x.speed * 1.609) : x.speed));
    return { cum, v };
  }
  function limitAtS(s) {
    const L = cur && cur.limits; if (!L || !L.v.length) return null;
    const t = s * (L.cum[L.cum.length - 1] / (cur.gen.route.length || 1));
    let lo = 0, hi = L.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.cum[m] <= t) lo = m; else hi = m; }
    return L.v[Math.min(lo, L.v.length - 1)] || null;
  }
  // freccia della manovra (bianca, stile navigatore)
  function manIcon(m) {
    if (m.type === 'arrive') return '<svg viewBox="0 0 48 48"><path d="M14 42V8M14 8h20l-4 7 4 7H14" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    if (m.type === 'roundabout' || m.type === 'rotary') return `<svg viewBox="0 0 48 48"><circle cx="24" cy="20" r="9" fill="none" stroke="#fff" stroke-width="4"/><path d="M24 44V29" stroke="#fff" stroke-width="4" stroke-linecap="round"/><text x="24" y="25" text-anchor="middle" font-family="Barlow Condensed,sans-serif" font-weight="800" font-size="12" fill="#fff">${m.exit || ''}</text></svg>`;
    const ang = { straight: 0, 'slight right': 40, right: 90, 'sharp right': 130, 'slight left': -40, left: -90, 'sharp left': -130, uturn: -180 }[m.mod] || 0;
    const a = ang * Math.PI / 180, x1 = 24, y1 = 22, L = ang === -180 ? 0 : 14;
    const ex = x1 + Math.sin(a) * L, ey = y1 - Math.cos(a) * L;
    const path = ang === -180 ? 'M28 44V18a8 8 0 0 0-16 0v12' : `M24 44V${y1}L${ex.toFixed(1)} ${ey.toFixed(1)}`;
    const hx = ang === -180 ? 12 : ex, hy = ang === -180 ? 30 : ey, ha = ang === -180 ? Math.PI : a;
    const p1 = [hx + Math.sin(ha) * 7, hy - Math.cos(ha) * 7], p2 = [hx + Math.sin(ha + 2.3) * 7, hy - Math.cos(ha + 2.3) * 7], p3 = [hx + Math.sin(ha - 2.3) * 7, hy - Math.cos(ha - 2.3) * 7];
    return `<svg viewBox="0 0 48 48"><path d="${path}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><path d="M${p1.map(v => v.toFixed(1)).join(' ')}L${p2.map(v => v.toFixed(1)).join(' ')}L${p3.map(v => v.toFixed(1)).join(' ')}Z" fill="#fff"/></svg>`;
  }

  // ---------- voce ----------
  const voice = (() => {
    let clips = new Map(), buffers = new Map(), decoding = null, speaking = false, itVoice = null;
    function pickVoice() { const vs = speechSynthesis.getVoices().filter(v => /^it/i.test(v.lang)); itVoice = vs.find(v => /Alice|Luca|Federica|Paola/i.test(v.name)) || vs[0] || null; }
    if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
    async function load() { try { clips = await db.getAll('clips'); } catch { clips = new Map(); } updateStatus(); }
    function updateStatus() {
      $('voiceStatus').textContent = clips.size ? `${clips.size} clip caricate: chiamate con la voce del copilota.` : 'Nessuna voce caricata: uso la sintesi vocale del telefono.';
      renderCommands();
    }
    const keyOf = name => name.split('/').pop().replace(/\.[^.]+$/, '').replace(/~/g, '').toLowerCase();
    // .zip = sostituisce tutto il pacchetto; file audio singoli = aggiungono o sostituiscono quei comandi
    async function importFiles(files) {
      const found = new Map(); let zip = false;
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          zip = true;
          const z = await JSZip.loadAsync(f);
          for (const e of Object.values(z.files).filter(e => !e.dir && /\.(mp3|m4a|aac|ogg|wav|mp4|caf)$/i.test(e.name) && !/__MACOSX/.test(e.name))) found.set(keyOf(e.name), await e.async('arraybuffer'));
        } else if (/\.(mp3|m4a|aac|ogg|wav|mp4|caf)$/i.test(f.name)) found.set(keyOf(f.name), await f.arrayBuffer());
      }
      if (!found.size) throw new Error('Nessun file audio trovato');
      if (zip) { await db.replaceAll('clips', found); clips = found; buffers = new Map(); decoding = null; }
      else for (const [k, v] of found) await setClip(k, v, false);
      updateStatus();
      return found.size;
    }
    // un comando sostituito dall'utente: via le varianti del pacchetto, resta solo il suo
    async function setClip(token, buf, refresh = true) {
      const variants = [token + '1', token + '2', token + '_1', token + '_2'];
      await db.del('clips', variants); await db.put('clips', token, buf);
      variants.forEach(v => { clips.delete(v); buffers.delete(v); });
      clips.set(token, buf);
      try { buffers.set(token, trim(await decodeData(buf))); } catch { buffers.delete(token); }
      if (refresh) updateStatus();
    }
    function has(token) { return [token, token + '1', token + '2', token + '_1', token + '_2'].some(c => clips.has(c)); }
    // clip sostitutive della stessa voce per i comandi che mancano
    function aliasOf(token) { const a = ALIASES[token]; return !has(token) && a && a.every(has) ? a : null; }
    const expand = tokens => tokens.flatMap(t => aliasOf(t) || [t]);
    // Le clip si decodificano senza aprire l'audio (OfflineAudioContext); ogni chiamata diventa un piccolo WAV
    // riprodotto da un normale elemento <audio>, che iOS e CarPlay gestiscono come un vocale.
    // (Web Audio su CarPlay viene ricampionato e va a scatti.)
    const RATE = 44100;
    let dec = null, player = null, curUrl = null, unlocked = false;
    function decoder() { if (!dec) { const O = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (O) dec = new O(1, 1, RATE); } return dec; }
    function decodeData(buf) {
      return new Promise((res, rej) => { const d = decoder(); if (!d) return rej(new Error('no audio')); const p = d.decodeAudioData(buf.slice(0), res, rej); if (p && p.then) p.then(res, rej); });
    }
    function setSession() {
      try { if (navigator.audioSession) navigator.audioSession.type = settings.audioMode === 'navigatore' ? 'transient' : 'playback'; } catch { /* vecchio iOS */ }
    }
    function wavURL(f32) {
      const n = f32.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
      const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
      return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    }
    // va chiamata da un tocco: sblocca l'elemento audio (poi iOS lo lascia suonare da solo)
    function unlock() {
      setSession();
      if (!player) { player = new Audio(); player.setAttribute('playsinline', ''); player.preload = 'auto'; }
      if (!unlocked) {
        player.src = wavURL(new Float32Array(Math.round(RATE * 0.05)));
        const p = player.play(); if (p && p.then) p.then(() => { unlocked = true; }, () => {}); else unlocked = true;
      }
      if ('speechSynthesis' in window && !unlock.tts) { unlock.tts = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
      if (clips.size && !decoding) decoding = decodeAll();
    }
    async function decodeAll() {
      const names = [...clips.keys()];
      for (let i = 0; i < names.length; i += 8) {
        await Promise.all(names.slice(i, i + 8).map(async n => { try { buffers.set(n, trim(await decodeData(clips.get(n)))); } catch { /* userà la sintesi */ } }));
      }
    }
    // toglie il silenzio iniziale/finale; restituisce i campioni (mono, 44,1 kHz)
    function trim(buf) {
      const d = buf.getChannelData(0), th = 0.02, pad = Math.floor(RATE * 0.015);
      let a = 0, b = d.length - 1;
      while (a < b && Math.abs(d[a]) < th) a++;
      while (b > a && Math.abs(d[b]) < th) b--;
      a = Math.max(0, a - pad); b = Math.min(d.length - 1, b + pad);
      return b - a < 100 ? d.slice() : d.slice(a, b + 1);
    }
    function resolve(tok) {
      const t = tok.toLowerCase();
      const cands = [t, t + '1', t + '2', t + '_1', t + '_2'].filter(c => buffers.has(c));
      return cands.length ? buffers.get(cands[Math.floor(Math.random() * cands.length)]) : null;
    }
    // unisce le clip di una chiamata in un unico suono
    function join(list) {
      const gap = Math.round(RATE * 0.03), out = new Float32Array(list.reduce((a, b) => a + b.length, 0) + gap * (list.length - 1));
      let o = 0; for (const b of list) { out.set(b, o); o += b.length + gap; }
      return out;
    }
    function playPCM(f32) {
      return new Promise(res => {
        let done = false; const fin = () => { if (!done) { done = true; res(); } };
        if (curUrl) URL.revokeObjectURL(curUrl);
        curUrl = wavURL(f32);
        player.onended = fin; player.onerror = fin;
        player.src = curUrl;
        const p = player.play(); if (p && p.catch) p.catch(fin);
        setTimeout(fin, f32.length / RATE * 1000 + 1500);
      });
    }
    function tts(text) {
      return new Promise(res => {
        if (!('speechSynthesis' in window)) return res();
        const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT'; if (itVoice) u.voice = itVoice; u.rate = 1.15;
        u.onend = res; u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 600 + text.length * 120);
      });
    }
    // i comandi senza clip vengono letti dalla sintesi vocale
    async function say(tokens) {
      if (speaking && 'speechSynthesis' in window) speechSynthesis.cancel();
      speaking = true;
      try {
        if (decoding) await decoding;
        if (!(player && buffers.size)) { await tts(tokens.map(P.tokenText).join(' ')); return; }
        setSession();
        tokens = expand(tokens);
        let pend = [], run = [];
        const flushTts = async () => { if (pend.length) { await tts(pend.join(' ')); pend = []; } };
        const flushRun = async () => { if (run.length) { await playPCM(join(run)); run = []; } };
        for (const t of tokens) { const b = resolve(t); if (b) { await flushTts(); run.push(b); } else { await flushRun(); pend.push(P.tokenText(t)); } }
        await flushRun(); await flushTts();
      } finally { speaking = false; }
    }
    const keepAlive = () => {}; // non più usato: l'audio continuo peggiorava CarPlay
    return { load, importFiles, setClip, has, aliasOf, unlock, say, keepAlive, setSession, get speaking() { return speaking; }, get count() { return clips.size; }, get decoded() { return buffers.size; } };
  })();

  // ---------- comandi vocali: elenco, prova, sostituisci, registra ----------
  function renderCommands() {
    const box = $('cmdList'); if (!box) return;
    let miss = 0;
    box.innerHTML = COMMANDS.map(([group, toks]) => `<div class="cmdgroup"><h4>${group}</h4>${toks.map(t => {
      const ok = voice.has(t), al = !ok && voice.aliasOf(t); if (!ok && !al) miss++;
      const st = ok ? 'voce' : al ? 'dice: ' + al.map(a => P.tokenText(a).trim()).join(' ') : 'sintesi';
      return `<div class="cmd ${ok ? 'ok' : al ? 'alias' : 'miss'}" data-t="${t}"><span class="cn">${esc(P.tokenText(t))}</span><span class="cs">${esc(st)}</span>
        <button class="cb" data-act="play" aria-label="Prova ${esc(P.tokenText(t))}">▶</button>
        <label class="cb" aria-label="Sostituisci con un file">File<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" data-act="file"></label>
        <button class="cb rec" data-act="rec">Registra</button></div>`;
    }).join('')}</div>`).join('');
    $('cmdMissing').textContent = miss ? `${miss} comandi senza voce: li legge la sintesi del telefono.` : 'Tutti i comandi usano la voce del copilota.';
  }
  let rec = null;
  $('cmdList').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const t = b.closest('.cmd').dataset.t;
    if (b.dataset.act === 'play') { voice.unlock(); voice.say([t]); return; }
    if (b.dataset.act === 'rec') {
      if (rec && rec.token === t) { rec.r.stop(); return; }
      if (rec) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const r = new MediaRecorder(stream), chunks = [];
        rec = { r, token: t };
        b.textContent = 'Stop'; b.classList.add('on');
        r.ondataavailable = ev => chunks.push(ev.data);
        r.onstop = async () => {
          stream.getTracks().forEach(x => x.stop());
          const buf = await new Blob(chunks, { type: r.mimeType }).arrayBuffer();
          rec = null; voice.unlock();
          await voice.setClip(t, buf); toast('Registrato: ' + P.tokenText(t)); voice.say([t]);
        };
        r.start();
      } catch { rec = null; toast('Microfono non disponibile'); }
    }
  });
  $('cmdList').addEventListener('change', async e => {
    const inp = e.target; if (inp.dataset.act !== 'file' || !inp.files[0]) return;
    const t = inp.closest('.cmd').dataset.t;
    try { voice.unlock(); await voice.setClip(t, await inp.files[0].arrayBuffer()); toast('Sostituito: ' + P.tokenText(t)); voice.say([t]); }
    catch { toast('File audio non valido'); }
  });

  // ---------- guida (GPS o simulazione) ----------
  const drive = {
    on: false, sim: false, fix: null, idx: 0, timer: null, simTimer: null, follow: true, off: 0, said: -1, lock: null, rerouting: false,
    cam: { bearing: 0, zoom: 17, t: 0 }, lastHeading: 0,
    start(sim) {
      if (!cur) return;
      voice.unlock();
      this.on = true; this.sim = sim; this.idx = 0; this.fix = null; this.off = 0; this.said = -1; this.follow = true;
      document.body.classList.add('driving');
      $('drive').hidden = false; $('dbar').hidden = false; $('btnLocate').classList.remove('attn');
      $('dMode').textContent = sim ? ' · sim' : '';
      closePopup();
      this.wake();
      voice.keepAlive(true);
      const r = cur.gen.route;
      this.cam.bearing = routeBearing(r, 0); this.cam.zoom = 17; this.cam.t = performance.now();
      if (sim) this.startSim();
      else if (gps.fix) this.onFix(gps.fix.ll[0], gps.fix.ll[1], gps.fix.speed, gps.fix.acc, Date.now(), gps.heading);
      else this.onFix(r.latlon[0][0], r.latlon[0][1], 0, 99, Date.now(), null);
      car.ensure(settings.view === '3d' ? carView('rear') : 'top').addTo(map);
      this.timer = setInterval(() => this.tick(), 200);
      requestAnimationFrame(t => this.frame(t));
      this.render();
    },
    stop() {
      this.on = false;
      clearInterval(this.timer); clearInterval(this.simTimer);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
      nosleep.off(); voice.keepAlive(false); this.cc = null;
      document.body.classList.remove('driving');
      $('drive').hidden = true; $('dbar').hidden = true;
      labelMarkers.forEach(m => m.getElement().classList.remove('near'));
      car.ensure('top'); if (!gps.fix && car.m) car.m.remove(); else car.update();
      map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 400 });
      setTimeout(fitRoute, 450);
    },
    async wake() {
      try { if ('wakeLock' in navigator) this.lock = await navigator.wakeLock.request('screen'); } catch { /* non supportato */ }
      nosleep.on();
    },
    startSim() {
      let s = 0, v = 0, last = Date.now();
      const vmax = { piena: 130, 6: 115, 5: 100, 4: 85, 3: 70, 2: 55, 1: 42, 90: 30, tornante: 25 };
      const step = () => {
        const now = Date.now(), dt = Math.min(3, (now - last) / 1000); last = now;
        const route = cur.gen.route;
        let target = settings.sim / 3.6;
        for (const n of cur.notes) {
          if (n.kind !== 'corner') continue;
          if (n.startS - 60 <= s && n.endS >= s) target = Math.min(target, vmax[gkey(n)] / 3.6);
          if (n.startS > s + 80) break;
        }
        v += Math.max(-6 * dt, Math.min(3 * dt, target - v));
        s = Math.min(route.length, s + v * dt);
        const p = pointAtS(route, s).ll;
        this.onFix(p[0], p[1], s >= route.length ? 0 : v, 5, now, null);
        if (s >= route.length) clearInterval(this.simTimer);
      };
      this.simTimer = setInterval(step, 1000);
      step();
    },
    onFix(lat, lon, speed, acc, t, heading) {
      const route = cur.gen.route, prev = this.fix, n = route.pts.length;
      if (heading != null) this.lastHeading = heading;
      else if (prev && distLL(prev.ll, [lat, lon]) > 5) this.lastHeading = bearingLL(prev.ll, [lat, lon]);
      // la direzione serve solo se ci si muove davvero
      const hd = (speed == null || speed > 3) && (heading != null || (prev && distLL(prev.ll, [lat, lon]) > 5)) ? this.lastHeading : null;
      // si cerca vicino all'ultima posizione (un po' indietro, fino a ~4 km avanti), mai su tutto il percorso:
      // in montagna il percorso ripassa vicino a sé stesso e si rischierebbe di saltare all'altro tratto
      let pr;
      if (!prev) pr = projectOnRoute(lat, lon, route, 0, n - 1, hd);
      else {
        pr = projectOnRoute(lat, lon, route, prev.i - 40, prev.i + 800, hd);
        if (pr.d > 60) { const w = projectOnRoute(lat, lon, route, prev.i - 200, prev.i + 1600, hd); if (w.d < pr.d) pr = w; }
        // GPS impreciso (galleria, valle stretta): non si salta, si resta dov'eri
        if (pr.d > 60 && (acc || 99) > 40) pr = { d: pr.d, s: prev.s, i: prev.i };
      }
      const v = speed != null && speed >= 0 ? speed : (prev ? Math.max(0, (pr.s - prev.s) / Math.max(0.5, (t - prev.t) / 1000)) : 0);
      this.fix = { s: pr.s, i: pr.i, t, v, d: pr.d, ll: [lat, lon] };
      // fuori percorso solo se il GPS è buono, ti muovi e sei lontano per 5 posizioni di fila
      if (!this.sim && pr.d > 50 && (acc || 99) <= 40 && v > 2) this.off++;
      else if (pr.d < 30) { this.off = 0; this.offWarned = false; }
      if (this.off >= 5 && !this.rerouting && Date.now() > (this.nextReroute || 0)) {
        // su una prova salvata non si ricalcola: si avvisa e si aspetta che torni sul percorso
        if (cur.stage) { if (!this.offWarned) { this.offWarned = true; toast('Sei fuori dal percorso della prova', 4000); voice.say(['attento']); } }
        else this.reroute(lat, lon, hd);
      }
      if (!this.sim && settings.learn) this.learn(pr.s, v, pr.d);
    },
    // taratura: velocità minima in ogni curva fatta davvero (solo GPS)
    learn(s, v, d) {
      if (d > 25) { this.cc = null; return; }
      if (this.cc && s > this.cc.note.endS + 10) {
        const n = this.cc.note;
        if (this.cc.vmin > 4 && n.radius && !n.manual) calib.add({ R: n.radius, g: String(gkey(n)), a: n.angle, v: this.cc.vmin });
        this.cc = null;
      }
      if (!this.cc) { const n = cur.notes.find(x => x.kind === 'corner' && s >= x.startS - 10 && s <= x.endS + 10); if (n) this.cc = { note: n, vmin: v }; }
      else this.cc.vmin = Math.min(this.cc.vmin, v);
    },
    async reroute(lat, lon, hd) {
      this.rerouting = true; this.off = 0;
      // "ricalcolo" al massimo una volta al minuto
      if (Date.now() - (this.lastRecalcVoice || 0) > 60000) { this.lastRecalcVoice = Date.now(); voice.say(['ricalcolo']); }
      try { await computeRoute({ lat, lon, name: 'Posizione' }, { heading: hd }); this.resync(); } catch { /* riprova più tardi */ }
      this.rerouting = false;
      this.nextReroute = Date.now() + 25000; // almeno 25 secondi tra un ricalcolo e l'altro
    },
    resync() {
      if (!this.fix) { this.idx = 0; return; }
      const pr = projectOnRoute(this.fix.ll[0], this.fix.ll[1], cur.gen.route, 0, cur.gen.route.pts.length - 1, this.fix.v > 3 ? this.lastHeading : null);
      this.fix.s = pr.s; this.fix.i = pr.i; this.fix.d = pr.d;
      this.idx = cur.calls.findIndex(c => c.startS > pr.s - 5); if (this.idx < 0) this.idx = cur.calls.length;
    },
    estS() { if (!this.fix) return 0; return Math.min(cur.gen.route.length, this.fix.s + this.fix.v * Math.min(2.5, (Date.now() - this.fix.t) / 1000)); },
    // posizione e direzione da disegnare: agganciata alla strada se ci sei sopra
    pose() {
      const route = cur.gen.route;
      if (this.fix && this.fix.d < 35) { const s = this.estS(); return { ll: pointAtS(route, s).ll, bearing: routeBearing(route, s) }; }
      return { ll: this.fix ? this.fix.ll : route.latlon[0], bearing: this.lastHeading };
    },
    frame(now) {
      if (!this.on) return;
      requestAnimationFrame(t => this.frame(t));
      const dt = Math.min(0.2, (now - this.cam.t) / 1000); this.cam.t = now;
      const p = this.pose(), v = this.fix ? this.fix.v * 3.6 : 0;
      this.cam.bearing = (this.cam.bearing + angDiff(p.bearing, this.cam.bearing) * Math.min(1, dt * 4) + 360) % 360;
      const zt = 17.7 - Math.max(0, Math.min(1, (v - 30) / 90)) * 1.5;
      this.cam.zoom += (zt - this.cam.zoom) * Math.min(1, dt * 1.5);
      const is3d = settings.view === '3d', mode = is3d ? carView('rear') : 'top';
      const m = car.ensure(mode);
      m.setLngLat([p.ll[1], p.ll[0]]);
      if (this.follow) {
        const H = map.getContainer().clientHeight;
        map.jumpTo({ center: [p.ll[1], p.ll[0]], bearing: this.cam.bearing, pitch: is3d ? 62 : 0, zoom: this.cam.zoom, padding: { top: H * (is3d ? 0.5 : 0.36), bottom: 70, left: 0, right: 0 } });
      }
      // vista da dietro: l'auto è dritta sullo schermo e ruota solo di quanto la mappa non la segue
      m.setRotation(mode === 'rear' ? angDiff(p.bearing, map.getBearing()) : p.bearing);
    },
    tick() {
      if (!this.on || !this.fix) return;
      const s = this.estS(), v = this.fix.v, calls = cur.calls;
      while (this.idx < calls.length && calls[this.idx].startS < s - 15) this.idx++;
      if (!voice.speaking && this.idx < calls.length) {
        const c = calls[this.idx];
        if (c.startS - s <= Math.max(55, v * settings.lead)) {
          this.said = this.idx; this.idx++;
          voice.say(callTokensFiltered(c));
          $('callCard').classList.add('pulse'); setTimeout(() => $('callCard').classList.remove('pulse'), 180);
        }
      }
      this.render();
    },
    render() {
      if (!cur) return;
      const s = this.estS(), calls = cur.calls;
      let k = calls.findIndex(c => c.notes[c.notes.length - 1].endS > s - 5);
      if (k < 0) k = calls.length - 1;
      const c = calls[k];
      if (c) {
        $('dIcon').innerHTML = signSVG(c.notes[0]);
        $('dText').textContent = callTitle(c);
        const d = c.startS - s;
        $('dDist').textContent = d > 5 ? 'tra ' + (d >= 1000 ? fmtKm(d) : Math.round(d / 10) * 10 + ' m') : 'ora';
        $('callCard').classList.toggle('said', k <= this.said);
      }
      $('dNext').innerHTML = calls.slice(k + 1, k + 3).map(n => `<div>${iconHTML(n.notes[0])}<span>${esc(callShort(n))}</span><small>${Math.round((n.startS - s) / 10) * 10} m</small></div>`).join('');
      const kmh = this.fix ? Math.round(this.fix.v * 3.6) : 0;
      $('dSpd').textContent = kmh;
      const rem = Math.max(0, cur.gen.route.length - s);
      $('dRem').textContent = fmtKm(rem);
      const eta = new Date(Date.now() + (cur.osrm.duration || 0) * rem / (cur.gen.route.length || 1) * 1000);
      $('dEta').textContent = 'arrivo ' + eta.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      // limite di velocità del tratto
      const lim = limitAtS(s);
      $('dLimit').hidden = !lim; if (lim) $('dLimitV').textContent = lim;
      $('dSpdBox').classList.toggle('over', !!lim && kmh > lim + 3);
      // prossima indicazione
      const nm = cur.man && cur.man.find(m => m.s > s - 5);
      $('navBar').hidden = !nm;
      if (nm) {
        const d = nm.s - s;
        $('nvIcon').innerHTML = manIcon(nm);
        $('nvDist').textContent = d < 1000 ? Math.max(0, Math.round(d / 10) * 10) + ' m' : fmtKm(d);
        $('nvText').innerHTML = esc(nm.text.charAt(0).toUpperCase() + nm.text.slice(1)) + (nm.name ? ` <em>${/rotonda|uscita/.test(nm.text) ? 'verso' : 'in'} ${esc(nm.name)}</em>` : '');
      }
      for (const m of labelMarkers) m.getElement().classList.toggle('near', m._s > s - 10 && m._s < s + 450);
    }
  };
  document.addEventListener('visibilitychange', () => { if (drive.on && document.visibilityState === 'visible') drive.wake(); });
  $('btnGo').addEventListener('click', () => drive.start(false));
  $('btnSim').addEventListener('click', () => drive.start(true));
  $('btnStop').addEventListener('click', () => drive.stop());
  $('btnRepeat').addEventListener('click', () => {
    voice.unlock();
    const c = cur && cur.calls[drive.said >= 0 ? drive.said : drive.idx];
    if (c) voice.say(callTokensFiltered(c));
  });

  // ---------- ricognizione: correggere le note ----------
  const GRADES = ['piena', 6, 5, 4, 3, 2, 1, 90, 'tornante'];
  const MODS = [['lunga', 'Lunga'], ['molto_lunga', 'Molto lunga'], ['stringe', 'Stringe'], ['apre', 'Apre'], ['junction', 'Incrocio']];
  const editor = {
    id: null, draft: null, isNew: false, call: null,
    open(id, call, isNew = false) {
      const n = cur.base.find(x => x.id === id); if (!n) return;
      this.id = id; this.isNew = isNew; this.call = call || null;
      this.draft = JSON.parse(JSON.stringify(n));
      this.render(); $('noteEd').hidden = false;
    },
    addAt(s) {
      const route = cur.gen.route;
      const turn = angDiff(routeBearing(route, s + 25), routeBearing(route, s - 15));
      const a = pointAtS(route, Math.max(0, s - 5)).i, b = pointAtS(route, Math.min(route.length, s + 30)).i;
      const n = { kind: 'corner', dir: turn >= 0 ? 'destra' : 'sinistra', grade: 4, mods: [], junction: false, startS: Math.max(0, s - 5), endS: Math.min(route.length, s + 30), apexS: s, i0: a, i1: Math.max(a + 1, b), radius: 0, angle: Math.round(Math.abs(turn)), manual: true, id: noteSeq++ };
      cur.base.push(n); cur.base.sort((x, y) => x.startS - y.startS);
      this.open(n.id, null, true);
    },
    render() {
      const d = this.draft, corner = d.kind === 'corner';
      const g = corner ? gkey(d) : null;
      const siblings = this.call ? this.call.notes.filter(x => x.id) : [];
      $('edPick').innerHTML = siblings.length > 1 ? siblings.map(x => `<button data-id="${x.id}" class="${x.id === d.id ? 'on' : ''}">${esc(x.kind === 'corner' ? P.shortLabel(x) : x.label)}</button>`).join('') : '';
      $('edPick').hidden = siblings.length < 2;
      $('edCorner').hidden = !corner;
      if (corner) {
        $('edDir').innerHTML = ['sinistra', 'destra'].map(v => `<button data-d="${v}" class="${d.dir === v ? 'on' : ''}">${v === 'sinistra' ? 'Sinistra' : 'Destra'}</button>`).join('');
        $('edGrade').innerHTML = GRADES.map(v => { const nt = { kind: 'corner', dir: d.dir, grade: v === 90 ? 2 : v, mods: v === 90 ? ['secca'] : [] }; return `<button data-g="${v}" class="${String(g) === String(v) ? 'on' : ''}">${iconHTML(nt)}<span>${v === 'piena' ? 'Piena' : v === 'tornante' ? 'Tornante' : v === 90 ? '90' : v}</span></button>`; }).join('');
        $('edMods').innerHTML = MODS.map(([k, l]) => `<button data-m="${k}" class="${(k === 'junction' ? d.junction : d.mods.includes(k)) ? 'on' : ''}">${l}</button>`).join('');
      }
      $('edPrev').innerHTML = `${iconHTML(d)}<b>${esc(corner ? P.tokensText(P.noteTokens(d)) : d.label || '')}</b>`;
      $('edTitle').textContent = this.isNew ? 'Nuova curva' : 'Correggi nota';
    },
    commit() {
      const i = cur.base.findIndex(x => x.id === this.id);
      if (i >= 0) cur.base[i] = this.draft;
      this.close(true); changed();
    },
    remove() {
      cur.base = cur.base.filter(x => x.id !== this.id);
      this.close(true); changed(); toast('Nota eliminata');
    },
    close(keep) {
      if (!keep && this.isNew) cur.base = cur.base.filter(x => x.id !== this.id);
      $('noteEd').hidden = true; this.id = null;
    }
  };
  function changed() {
    cur.edited = true;
    buildNotes(); drawRoute(false); renderSheet();
    if (drive.on) drive.resync();
    if (cur.stage) stages.save(cur.stageName, true);
  }
  $('noteEd').addEventListener('click', e => {
    if (e.target === $('noteEd')) return editor.close();
    const b = e.target.closest('button'); if (!b) return;
    const d = editor.draft;
    if (b.dataset.id) { editor.open(+b.dataset.id, editor.call); return; }
    if (b.dataset.d) d.dir = b.dataset.d;
    if (b.dataset.g) {
      const v = b.dataset.g;
      d.mods = d.mods.filter(m => m !== 'secca');
      if (v === '90') { d.grade = 2; d.mods.push('secca'); }
      else d.grade = /^\d$/.test(v) ? +v : v;
      if (d.grade === 'tornante' || v === '90') d.mods = d.mods.filter(m => !/lunga/.test(m));
    }
    if (b.dataset.m) {
      const k = b.dataset.m;
      if (k === 'junction') d.junction = !d.junction;
      else if (d.mods.includes(k)) d.mods = d.mods.filter(m => m !== k);
      else {
        const excl = { lunga: 'molto_lunga', molto_lunga: 'lunga', stringe: 'apre', apre: 'stringe' };
        d.mods = d.mods.filter(m => m !== excl[k]); d.mods.push(k);
        const order = ['secca', 'lunga', 'molto_lunga', 'stringe', 'apre']; d.mods.sort((x, y) => order.indexOf(x) - order.indexOf(y));
      }
    }
    if (b.id === 'edPlay') { voice.unlock(); voice.say(d.kind === 'corner' ? P.noteTokens(d) : d.tokens || []); return; }
    if (b.id === 'edDel') return editor.remove();
    if (b.id === 'edOk') return editor.commit();
    if (b.id === 'btnEdClose') return editor.close();
    editor.render();
  });

  // ---------- prove salvate ----------
  const stages = {
    async save(name, quiet) {
      if (!cur) return;
      const id = cur.stage || ('s' + Date.now());
      const old = cur.stage ? await db.get('stages', id).catch(() => null) : null;
      const rec = {
        id, name, created: old ? old.created : Date.now(), updated: Date.now(),
        from: places.from, to: places.to,
        osrm: { distance: cur.osrm.distance, duration: cur.osrm.duration, geometry: cur.osrm.geometry },
        man: cur.man || [], limits: cur.limits || null,
        base: cur.base
      };
      try { await db.put('stages', id, rec); } catch { toast('Non sono riuscito a salvare la prova'); return; }
      cur.stage = id; cur.stageName = name; cur.edited = true;
      renderSheet(); keepData();
      if (!quiet) toast('Prova salvata: funziona anche senza connessione');
    },
    async open(id) {
      const st = await db.get('stages', id); if (!st) return;
      if (drive.on) drive.stop();
      routes = [st.osrm]; routeIdx = 0;
      const coords = st.osrm.geometry.coordinates;
      cur = { gen: P.generate(coords, genOptions()), osrm: st.osrm, coords, base: st.base, stage: id, stageName: st.name, edited: true, man: st.man || [], limits: st.limits || null };
      noteSeq = Math.max(noteSeq, ...st.base.map(n => (n.id || 0) + 1));
      places.from = st.from; places.to = st.to;
      $('inFrom').value = st.from ? st.from.name : ''; $('inTo').value = st.to ? st.to.name : '';
      drawPins(); buildNotes(); drawRoute(true); renderSheet();
      $('stagesModal').hidden = true;
      if (settings.cams && navigator.onLine) loadCameras();
    },
    async list() {
      const all = [...(await db.getAll('stages').catch(() => new Map())).values()].sort((a, b) => b.updated - a.updated);
      $('stageList').innerHTML = all.length ? all.map(st => `<li data-id="${st.id}"><div class="si"><b>${esc(st.name)}</b><span>${fmtKm(st.osrm.distance)} · ${st.base.filter(n => n.kind === 'corner').length} note · ${new Date(st.updated).toLocaleDateString('it-IT')}</span></div>
        <button class="btn ghost small" data-open="1">Apri</button><button class="btn ghost small del" data-del="1">Elimina</button></li>`).join('')
        : '<li class="empty">Nessuna prova salvata. Calcola un percorso, correggi le note e premi "Salva prova".</li>';
    }
  };
  $('btnStages').addEventListener('click', () => { stages.list(); $('stagesModal').hidden = false; });
  $('stagesModal').addEventListener('click', async e => {
    if (e.target === $('stagesModal') || e.target.closest('#btnStagesClose')) { $('stagesModal').hidden = true; return; }
    const b = e.target.closest('button'); const li = e.target.closest('li[data-id]'); if (!b || !li) return;
    if (b.dataset.open) stages.open(li.dataset.id);
    if (b.dataset.del) {
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Conferma'; return; }
      await db.del('stages', [li.dataset.id]);
      if (cur && cur.stage === li.dataset.id) { cur.stage = null; renderSheet(); }
      stages.list();
    }
  });
  $('btnSaveStage').addEventListener('click', () => {
    if (!cur) return;
    const def = cur.stageName || [places.from && !places.from.me ? places.from.name : '', places.to ? places.to.name : ''].filter(Boolean).join(' → ') || 'Prova';
    $('inStageName').value = def; $('saveModal').hidden = false; setTimeout(() => $('inStageName').select(), 50);
  });
  $('saveForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('inStageName').value.trim() || 'Prova';
    $('saveModal').hidden = true; stages.save(name);
  });
  $('saveModal').addEventListener('click', e => { if (e.target === $('saveModal') || e.target.closest('#btnSaveCancel')) $('saveModal').hidden = true; });

  // ---------- taratura sul tuo modo di guidare ----------
  const A_REF = 4.0; // accelerazione laterale (m/s²) per cui sono pensate le soglie normali
  const calib = {
    samples: [],
    async load() { try { this.samples = (await db.get('calib', 'samples')) || []; } catch { this.samples = []; } renderCalib(); },
    add(x) {
      x.t = Date.now(); this.samples.push(x);
      if (this.samples.length > 3000) this.samples.splice(0, this.samples.length - 3000);
      db.put('calib', 'samples', this.samples).catch(() => {});
      renderCalib();
    },
    analyze() {
      const ok = this.samples.filter(x => x.R > 0 && x.R <= 150 && x.v >= 4);
      const per = {};
      for (const x of ok) { const k = x.g; (per[k] = per[k] || []).push(x.v * 3.6); }
      if (ok.length < 12) return { n: ok.length, per };
      const acc = ok.map(x => x.v * x.v / x.R).sort((a, b) => a - b);
      const a = acc[Math.floor(acc.length * 0.7)];
      const scale = Math.round(Math.max(0.7, Math.min(1.4, A_REF / a)) * 20) / 20;
      return { n: ok.length, a, scale, per };
    }
  };
  function scaleName(v) { return v < 0.95 ? 'aggressiva' : v > 1.05 ? 'prudente' : 'normale'; }
  function renderCalib() {
    const r = calib.analyze();
    $('calibStatus').textContent = r.scale == null
      ? `Curve registrate: ${r.n}. Ne servono almeno 12, guidando col GPS (la simulazione non conta).`
      : `Su ${r.n} curve registrate la taratura adatta a te è "${scaleName(r.scale)}" (${String(r.scale).replace('.', ',')}). Ora è "${scaleName(settings.scale)}" (${String(settings.scale).replace('.', ',')}).`;
    const order = ['piena', '6', '5', '4', '3', '2', '1', '90', 'tornante'];
    $('calibTable').innerHTML = order.filter(k => r.per[k]).map(k => { const v = r.per[k]; return `<div><span>${k === 'piena' ? 'Piena' : k === 'tornante' ? 'Tornante' : k}</span><b>${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} km/h</b><small>${v.length} curve</small></div>`; }).join('');
    $('btnCalibApply').disabled = r.scale == null || r.scale === settings.scale;
  }
  $('btnCalibApply').addEventListener('click', () => {
    const r = calib.analyze(); if (r.scale == null) return;
    settings.scale = r.scale; $('sScale').value = r.scale; bindSettings.upd(); refreshNotes(true); renderCalib();
    toast('Taratura applicata: ' + scaleName(r.scale));
  });
  $('btnCalibReset').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Conferma azzeramento'; return; }
    b.classList.remove('confirm'); b.textContent = 'Azzera dati';
    calib.samples = []; db.put('calib', 'samples', []).catch(() => {}); renderCalib();
  });

  // ---------- schermo sempre acceso in guida (riserva per iOS: video muto in loop) ----------
  const nosleep = (() => {
    let v = null;
    return {
      on() {
        try {
          if (!v) { v = document.createElement('video'); v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; v.loop = true; v.src = 'nosleep.mp4'; v.title = 'Copilota'; }
          const p = v.play(); if (p && p.catch) p.catch(() => {});
        } catch { /* niente */ }
      },
      off() { try { v && v.pause(); } catch { /* niente */ } }
    };
  })();

  // ---------- impostazioni ----------
  function renderCars() {
    const designed = Cars.MODELS.map(m => `<button class="carbtn ${m.id === settings.car ? 'on' : ''}" data-m="${m.id}"><div class="cv">${Cars.rear(m.id, settings.livery)}</div><span>${m.name}</span></button>`);
    const photos = [...customCars].map(([id, c]) => `<button class="carbtn ${id === settings.car ? 'on' : ''}" data-m="${esc(id)}"><div class="cv"><img src="${c.rear || c.top}" alt=""></div><span>${esc(c.name)}</span></button>`);
    $('carModels').innerHTML = designed.concat(photos).join('');
    $('carLiveries').innerHTML = Cars.LIVERIES.map(l => `<button class="sw ${l.id === settings.livery ? 'on' : ''}" data-l="${l.id}" title="${l.name}" aria-label="${l.name}" style="--a:${l.main};--b:${l.acc}"></button>`).join('');
    $('carLiveries').hidden = !!carInfo();
  }
  function bindSettings() {
    const upd = () => {
      $('oLead').textContent = String(settings.lead).replace('.', ',') + ' s';
      $('oScale').textContent = settings.scale < 0.95 ? 'aggressiva' : settings.scale > 1.05 ? 'prudente' : 'normale';
      $('oSim').textContent = settings.sim + ' km/h';
      store.set('settings', settings);
    };
    bindSettings.upd = upd;
    const bindRange = (id, key, regen) => { const el = $(id); el.value = settings[key]; el.addEventListener('input', () => { settings[key] = +el.value; upd(); }); if (regen) el.addEventListener('change', refreshNotes); };
    const bindCheck = (id, key, fn) => { const el = $(id); el.checked = settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; upd(); fn && fn(); }); };
    bindRange('sLead', 'lead'); bindRange('sScale', 'scale', true); bindRange('sSim', 'sim');
    $('sScale').addEventListener('change', () => renderCalib());
    bindCheck('tLearn', 'learn');
    bindCheck('tFlat', 'flat', refreshNotes); bindCheck('tDist', 'dist', () => cur && renderSheet()); bindCheck('tNav', 'nav', refreshNotes);
    bindCheck('tCams', 'cams', () => { if (settings.cams && !cams.length) loadCameras(); else refreshNotes(); });
    const ms = $('selMap'); ms.value = settings.mapStyle; ms.addEventListener('change', () => { settings.mapStyle = ms.value; upd(); whenReady(setTiles); });
    const sv = $('selView'); sv.value = settings.view; sv.addEventListener('change', () => { settings.view = sv.value; upd(); });
    const am = $('selAudio'); am.value = settings.audioMode; am.addEventListener('change', () => { settings.audioMode = am.value; upd(); voice.setSession(); if (drive.on) { voice.keepAlive(false); voice.keepAlive(true); } });
    bindCheck('tCompass', 'compass', () => { if (settings.compass) startCompass(); });
    bindCheck('tNoMotorway', 'noMotorway', () => { if (cur && !cur.stage && !drive.on && places.from && places.to) computeRoute().catch(() => {}); });
    const s3 = $('selCar3d'); s3.value = settings.car3d; s3.addEventListener('change', () => { settings.car3d = s3.value; upd(); car.redraw(); });
    $('carModels').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; settings.car = b.dataset.m; upd(); renderCars(); car.redraw(); });
    $('carLiveries').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; settings.livery = b.dataset.l; upd(); renderCars(); car.redraw(); });
    upd();
  }
  $('btnSettings').addEventListener('click', () => { $('settings').hidden = false; });
  $('btnCloseSet').addEventListener('click', () => { $('settings').hidden = true; });
  $('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').hidden = true; });
  $('inVoices').addEventListener('change', async e => {
    const files = [...e.target.files]; if (!files.length) return;
    $('voiceStatus').textContent = 'Carico le voci…';
    try { const n = await voice.importFiles(files); toast(n + ' clip caricate'); voice.unlock(); keepData(); }
    catch (err) { toast('Non sono riuscito a leggere le voci: ' + err.message, 5000); voice.load(); }
    e.target.value = '';
  });
  $('inCars').addEventListener('change', async e => {
    const files = [...e.target.files]; if (!files.length) return;
    try { const n = await importCars(files); toast(n + (n === 1 ? ' auto caricata' : ' auto caricate')); renderCars(); keepData(); }
    catch (err) { toast('Non sono riuscito a leggere le auto: ' + err.message, 6000); }
    e.target.value = '';
  });
  $('btnTestVoice').addEventListener('click', () => { voice.unlock(); voice.say(['destra_tre', 'lunga', 'e', 'sinistra_quattro', 'stringe', '150']); });
  $('btnClearObs').addEventListener('click', () => { obstacles = []; saveObstacles(); refreshNotes(); toast('Ostacoli cancellati'); });
  $('legend').innerHTML = ['piena', 6, 5, 4, 3, 2, 1, 90, 'tornante'].map(g => {
    const nt = { kind: 'corner', dir: 'destra', grade: g === 90 ? 2 : g, mods: g === 90 ? ['secca'] : [] };
    return `<div>${iconHTML(nt)}${g === 'piena' ? 'Piena' : g === 'tornante' ? 'Tornante' : g === 90 ? '90 secca' : g}</div>`;
  }).join('');

  // chiede a Safari di non cancellare voci e auto quando serve spazio
  const keepData = () => { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* non supportato */ } };

  // ---------- avvio ----------
  bindSettings();
  keepData();
  renderCars();
  loadCustomCars().then(() => { renderCars(); car.redraw(); });
  whenReady(() => { drawObstacles(); drawPins(); });
  $('obsCount').textContent = obstacles.length;
  voice.load();
  calib.load();
  startGeo();
  const offlineMsg = () => { if (!navigator.onLine) toast('Sei senza connessione: puoi usare le prove salvate', 5000); };
  window.addEventListener('offline', offlineMsg); offlineMsg();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__copilota = { get cur() { return cur; }, drive, voice, places, setPlace, computeRoute, map, gps, car, settings, stages, calib, editor };
})();
