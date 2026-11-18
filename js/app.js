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
    ['Ostacoli', ['attento', 'attento_attento', 'autovelox', 'buca', 'dosso', 'scivola', 'ponte', 'lavori']]
  ];
  const EXITS = ['prima_uscita', 'seconda_uscita', 'terza_uscita', 'quarta_uscita', 'quinta_uscita', 'sesta_uscita'];

  // ---------- memoria locale ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cr.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('cr.' + k, JSON.stringify(v)); } catch { /* niente */ } }
  };
  const settings = Object.assign({ lead: 4.5, scale: 1, flat: true, dist: true, nav: true, cams: true, mapStyle: 'dark', sim: 80, car: 'rally2', livery: 'bianca', view: '3d' }, store.get('settings', {}));
  if (!TILES[settings.mapStyle]) settings.mapStyle = settings.light ? 'light' : 'dark';
  let obstacles = store.get('obstacles', []);
  let recents = store.get('recents', []);

  // database sul telefono: voci e auto personali
  const db = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('copilota', 2);
      r.onupgradeneeded = () => { for (const st of ['clips', 'cars']) if (!r.result.objectStoreNames.contains(st)) r.result.createObjectStore(st); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (st, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(st, mode); const out = fn(t.objectStore(st)); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
    return {
      replaceAll: (st, m) => tx(st, 'readwrite', s => { s.clear(); for (const [k, v] of m) s.put(v, k); }),
      put: (st, k, v) => tx(st, 'readwrite', s => s.put(v, k)),
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
  function carView(want) {
    const c = carInfo();
    if (want === 'rear') return c ? (c.rear ? 'rear' : c.top ? 'flat' : 'rear') : 'rear';
    return 'top';
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
    autovelox: { label: 'Autovelox', ch: 'V', tokens: ['attento', 'autovelox'] },
    buca: { label: 'Buca', ch: 'B', tokens: ['buca'] },
    acqua: { label: 'Acqua / scivola', ch: 'A', tokens: ['scivola'] },
    dosso: { label: 'Dosso', ch: 'D', tokens: ['dosso'] },
    ponte: { label: 'Ponte stretto', ch: 'P', tokens: ['ponte'] },
    lavori: { label: 'Lavori', ch: 'L', tokens: ['attento', 'lavori'] },
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
    const el = openPopup(e.lngLat, `<div class="pop"><h4>${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</h4>
      <button class="pb" data-a="from">Parti da qui</button><button class="pb" data-a="to">Arriva qui</button>
      <h4 style="margin-top:12px">Segna un ostacolo</h4><div class="grid">${Object.entries(OBS).map(([k, o]) => `<button class="pb" data-o="${k}">${o.label}</button>`).join('')}</div></div>`);
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      closePopup();
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
  async function computeRoute(fromOverride) {
    const a = fromOverride || places.from, b = places.to;
    if (!a || !b) return;
    const my = ++routeReq;
    if (!drive.on) toast('Calcolo il percorso…', 0, true);
    try {
      const r = await fetch(`${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true&alternatives=${drive.on ? 'false' : 'true'}`);
      const j = await r.json();
      if (my !== routeReq) return;
      if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.message || 'nessun percorso');
      routes = j.routes; routeIdx = 0;
      t_hide();
      selectRoute(0, !drive.on);
      if (settings.cams) loadCameras();
    } catch (e) {
      toast(drive.on ? 'Ricalcolo non riuscito, riprovo…' : 'Percorso non trovato o servizio non raggiungibile', 4000);
      throw e;
    }
  }
  function selectRoute(i, fit) {
    routeIdx = i;
    const osrm = routes[i], coords = osrm.geometry.coordinates;
    cur = { gen: P.generate(coords, genOptions()), osrm, coords };
    buildNotes(); drawRoute(fit); renderSheet();
  }
  function genOptions() { return { scale: settings.scale, callFlat: settings.flat }; }
  function refreshNotes() {
    if (!cur) return;
    if (!drive.on) cur.gen = P.generate(cur.coords, genOptions());
    buildNotes(); drawRoute(false); renderSheet();
    if (drive.on) drive.resync();
  }
  function projectOnRoute(lat, lon, route, i0 = 0, i1 = route.pts.length - 1) {
    const [x, y] = route.proj.fwd(lon, lat);
    let best = { d: Infinity, s: 0, i: 0 };
    const a = Math.max(0, i0), b = Math.min(route.pts.length - 1, i1);
    for (let i = a; i < b; i++) {
      const p = route.pts[i], q = route.pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy || 1e-9;
      let t = ((x - p[0]) * dx + (y - p[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const px = p[0] + dx * t, py = p[1] + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { d, s: route.s[i] + (route.s[i + 1] - route.s[i]) * t, i };
    }
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

  function buildNotes() {
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
    const obsList = obstacles.map(o => ({ ...o })).concat(settings.cams ? cams.map(c => ({ ...c, type: 'autovelox' })) : []);
    for (const o of obsList) {
      const pr = projectOnRoute(o.lat, o.lon, route);
      if (pr.d > 25) continue;
      extra.push({ kind: 'obs', obsType: o.type, label: OBS[o.type].label, startS: Math.max(0, pr.s - 10), endS: pr.s, tokens: OBS[o.type].tokens.slice() });
    }
    extra.push({ kind: 'finish', label: 'Arrivo', startS: Math.max(0, route.length - 40), endS: route.length, tokens: ['fine'] });
    notes = notes.concat(extra).sort((x, y) => x.startS - y.startS);
    P.linkDistances(notes, route.length, gen.cfg);
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
    $('noteList').innerHTML = cur.calls.map(c => `<li data-c="${c.id}">${iconHTML(c.notes[0])}<div class="nt">${esc(callTitle(c))}</div><div class="nm">${fmtKm(c.startS)}</div></li>`).join('');
  }
  $('alts').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectRoute(+b.dataset.i, false); });
  $('noteList').addEventListener('click', e => {
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
  async function loadCameras() {
    if (!cur || cur.gen.route.length > 400000) return;
    const [[w, s], [e, n]] = boundsOf(cur.gen.route.latlon), pad = 0.01;
    const q = `[out:json][timeout:20];node["highway"="speed_camera"](${s - pad},${w - pad},${n + pad},${e + pad});out;`;
    try {
      const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const j = await r.json();
      cams = (j.elements || []).map(e => ({ lat: e.lat, lon: e.lon }));
      if (cams.length) { buildNotes(); drawRoute(false); renderSheet(); if (drive.on) drive.resync(); }
    } catch { /* autovelox non disponibili */ }
  }

  // ---------- voce ----------
  const voice = (() => {
    let ctx = null, clips = new Map(), buffers = new Map(), decoding = null, speaking = false, itVoice = null;
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
      if (ctx) { try { buffers.set(token, trim(await ctx.decodeAudioData(buf.slice(0)))); } catch { buffers.delete(token); } }
      if (refresh) updateStatus();
    }
    function has(token) { return [token, token + '1', token + '2', token + '_1', token + '_2'].some(c => clips.has(c)); }
    function unlock() {
      if (!ctx) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* vecchio iOS */ }
        const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (ctx) { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); }
      if ('speechSynthesis' in window && !unlock.tts) { unlock.tts = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
      if (clips.size && !decoding) decoding = decodeAll();
    }
    async function decodeAll() {
      const names = [...clips.keys()];
      for (let i = 0; i < names.length; i += 8) {
        await Promise.all(names.slice(i, i + 8).map(async n => { try { buffers.set(n, trim(await ctx.decodeAudioData(clips.get(n).slice(0)))); } catch { /* userà la sintesi */ } }));
      }
    }
    function trim(buf) {
      const d = buf.getChannelData(0), th = 0.02, pad = Math.floor(buf.sampleRate * 0.015);
      let a = 0, b = d.length - 1;
      while (a < b && Math.abs(d[a]) < th) a++;
      while (b > a && Math.abs(d[b]) < th) b--;
      a = Math.max(0, a - pad); b = Math.min(d.length - 1, b + pad);
      if (b - a < 100) return buf;
      const out = ctx.createBuffer(buf.numberOfChannels, b - a + 1, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b + 1), c);
      return out;
    }
    function resolve(tok) {
      const t = tok.toLowerCase();
      const cands = [t, t + '1', t + '2', t + '_1', t + '_2'].filter(c => buffers.has(c));
      return cands.length ? buffers.get(cands[Math.floor(Math.random() * cands.length)]) : null;
    }
    function playBuffer(buf) { return new Promise(res => { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.onended = res; s.start(); setTimeout(res, buf.duration * 1000 + 400); }); }
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
        if (!(ctx && buffers.size)) { await tts(tokens.map(P.tokenText).join(' ')); return; }
        let pend = [];
        const flush = async () => { if (pend.length) { await tts(pend.join(' ')); pend = []; } };
        for (const t of tokens) { const b = resolve(t); if (b) { await flush(); await playBuffer(b); } else pend.push(P.tokenText(t)); }
        await flush();
      } finally { speaking = false; }
    }
    return { load, importFiles, setClip, has, unlock, say, get speaking() { return speaking; }, get count() { return clips.size; }, get decoded() { return buffers.size; } };
  })();

  // ---------- comandi vocali: elenco, prova, sostituisci, registra ----------
  function renderCommands() {
    const box = $('cmdList'); if (!box) return;
    let miss = 0;
    box.innerHTML = COMMANDS.map(([group, toks]) => `<div class="cmdgroup"><h4>${group}</h4>${toks.map(t => {
      const ok = voice.has(t); if (!ok) miss++;
      return `<div class="cmd ${ok ? 'ok' : 'miss'}" data-t="${t}"><span class="cn">${esc(P.tokenText(t))}</span><span class="cs">${ok ? 'voce' : 'sintesi'}</span>
        <button class="cb" data-act="play" aria-label="Prova ${esc(P.tokenText(t))}">▶</button>
        <label class="cb" aria-label="Sostituisci con un file">File<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" data-act="file"></label>
        <button class="cb rec" data-act="rec">Registra</button></div>`;
    }).join('')}</div>`).join('');
    $('cmdMissing').textContent = miss ? `${miss} comandi senza voce: li legge la sintesi del telefono.` : 'Tutti i comandi hanno la voce del copilota.';
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
      voice.unlock(); startCompass();
      this.on = true; this.sim = sim; this.idx = 0; this.fix = null; this.off = 0; this.said = -1; this.follow = true;
      document.body.classList.add('driving');
      $('drive').hidden = false; $('dbar').hidden = false; $('btnLocate').classList.remove('attn');
      $('dMode').textContent = sim ? 'SIMULAZIONE' : 'GPS';
      closePopup();
      this.wake();
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
      document.body.classList.remove('driving');
      $('drive').hidden = true; $('dbar').hidden = true;
      labelMarkers.forEach(m => m.getElement().classList.remove('near'));
      car.ensure('top'); if (!gps.fix && car.m) car.m.remove(); else car.update();
      map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 400 });
      setTimeout(fitRoute, 450);
    },
    async wake() { try { if ('wakeLock' in navigator) this.lock = await navigator.wakeLock.request('screen'); } catch { /* non supportato */ } },
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
      const route = cur.gen.route, prev = this.fix;
      let pr = projectOnRoute(lat, lon, route, (prev ? prev.i : 0) - 40, (prev ? prev.i : 0) + 600);
      if (pr.d > 50) pr = projectOnRoute(lat, lon, route);
      const v = speed != null && speed >= 0 ? speed : (prev ? Math.max(0, (pr.s - prev.s) / Math.max(0.5, (t - prev.t) / 1000)) : 0);
      if (heading != null) this.lastHeading = heading;
      else if (prev && distLL(prev.ll, [lat, lon]) > 5) this.lastHeading = bearingLL(prev.ll, [lat, lon]);
      this.fix = { s: pr.s, i: pr.i, t, v, d: pr.d, ll: [lat, lon] };
      if (!this.sim && pr.d > 60 && (acc || 99) < 60) this.off++; else this.off = 0;
      if (this.off >= 4 && !this.rerouting) this.reroute(lat, lon);
    },
    async reroute(lat, lon) {
      this.rerouting = true; this.off = 0;
      voice.say(['ricalcolo']);
      try { await computeRoute({ lat, lon, name: 'Posizione' }); this.resync(); } catch { /* riprova al prossimo fuori percorso */ }
      setTimeout(() => this.rerouting = false, 8000);
    },
    resync() {
      if (!this.fix) { this.idx = 0; return; }
      const pr = projectOnRoute(this.fix.ll[0], this.fix.ll[1], cur.gen.route);
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
      $('dSpd').textContent = this.fix ? Math.round(this.fix.v * 3.6) : 0;
      $('dRem').textContent = fmtKm(Math.max(0, cur.gen.route.length - s));
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
    bindCheck('tFlat', 'flat', refreshNotes); bindCheck('tDist', 'dist', () => cur && renderSheet()); bindCheck('tNav', 'nav', refreshNotes);
    bindCheck('tCams', 'cams', () => { if (settings.cams && !cams.length) loadCameras(); else refreshNotes(); });
    const ms = $('selMap'); ms.value = settings.mapStyle; ms.addEventListener('change', () => { settings.mapStyle = ms.value; upd(); whenReady(setTiles); });
    const sv = $('selView'); sv.value = settings.view; sv.addEventListener('change', () => { settings.view = sv.value; upd(); });
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
  startGeo();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__copilota = { get cur() { return cur; }, drive, voice, places, setPlace, computeRoute, map, gps, car, settings };
})();
