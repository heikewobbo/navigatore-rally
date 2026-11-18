/* Copilota Rally — navigatore con note da copilota */
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
  const TILES = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  };
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · OSRM · Photon';

  // ---------- memoria locale ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cr.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('cr.' + k, JSON.stringify(v)); } catch { /* niente */ } }
  };
  const settings = Object.assign({ lead: 4.5, scale: 1, flat: true, dist: true, nav: true, cams: true, light: false, sim: 80 }, store.get('settings', {}));
  let obstacles = store.get('obstacles', []);
  let recents = store.get('recents', []);

  // ---------- colori e cartelli ----------
  const GCOL = { piena: '#2bb3ff', 6: '#3ddc84', 5: '#b5e61d', 4: '#ffd400', 3: '#ff9f1a', 2: '#ff6a2b', 1: '#ff3b3b', tornante: '#ff3b3b', 90: '#ff3b3b' };
  const TURN = { piena: 14, 6: 24, 5: 38, 4: 52, 3: 66, 2: 82, 1: 105, 90: 90, tornante: 180 };
  const gkey = nt => nt.kind !== 'corner' ? null : (nt.mods.includes('secca') ? 90 : nt.grade);
  const colorOf = nt => nt.kind === 'corner' ? GCOL[gkey(nt)] : (nt.kind === 'nav' ? '#ffffff' : '#ff3b3b');

  // disegna il cartello della nota (SVG originale: freccia che gira tanto quanto la curva)
  function signSVG(nt) {
    const col = colorOf(nt);
    const frame = `<rect x="4" y="4" width="92" height="92" rx="16" fill="#0b0c0f" stroke="${col}" stroke-width="6"/>`;
    if (nt.kind !== 'corner') {
      const ch = nt.kind === 'finish' ? '⚑' : nt.kind === 'nav' ? (nt.icon || '↑') : '!';
      return `<svg class="sign" viewBox="0 0 100 100">${frame}<text x="50" y="68" text-anchor="middle" font-family="Barlow Condensed,sans-serif" font-weight="800" font-size="52" fill="${col}">${ch}</text></svg>`;
    }
    const g = gkey(nt), th = TURN[g] * Math.PI / 180;
    const right = nt.dir === 'destra';
    let pts = [], x = g === 'tornante' ? 34 : 50 - Math.min(TURN[g], 90) / 90 * 16, y = 88, phi = -Math.PI / 2;
    const rr = g === 'tornante' ? 17 : g === 90 ? 3 : 30 - Math.min(TURN[g], 110) / 110 * 12;
    const straight = g === 'tornante' ? 34 : 30;
    pts.push([x, y]); y -= straight; pts.push([x, y]);
    const cx = x + rr * Math.cos(phi + Math.PI / 2), cy = y + rr * Math.sin(phi + Math.PI / 2);
    const a0 = phi - Math.PI / 2;
    for (let i = 1; i <= 24; i++) { const a = a0 + th * i / 24; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    phi += th; const tail = g === 'tornante' ? 14 : 16;
    let ex = pts[pts.length - 1][0] + tail * Math.cos(phi), ey = pts[pts.length - 1][1] + tail * Math.sin(phi);
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

  // ---------- mappa ----------
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(store.get('view', [45.0, 7.68]), store.get('zoom', 12));
  let tiles = L.tileLayer(settings.light ? TILES.light : TILES.dark, { maxZoom: 19, attribution: ATTR, subdomains: 'abcd' }).addTo(map);
  map.on('moveend', () => { store.set('view', [map.getCenter().lat, map.getCenter().lng]); store.set('zoom', map.getZoom()); });
  const layers = { alts: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), labels: L.layerGroup(), obs: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map) };
  let meMarker = null;
  map.on('zoomend', updateLabelVisibility);
  function updateLabelVisibility() {
    if (map.getZoom() >= 14) { if (!map.hasLayer(layers.labels)) layers.labels.addTo(map); }
    else if (map.hasLayer(layers.labels)) map.removeLayer(layers.labels);
  }

  // ---------- messaggi ----------
  let toastT;
  function toast(msg, ms = 3000, spin = false) {
    const t = $('toast'); t.innerHTML = (spin ? '<span class="spin"></span>' : '') + esc(msg); t.hidden = false;
    clearTimeout(toastT); if (ms) toastT = setTimeout(() => t.hidden = true, ms);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
      if (e.key === 'Enter') { e.preventDefault(); if (suggItems[0] && suggItems[0].place) pick(suggItems[0]); else nominatimSearch(inp.value); }
      if (e.key === 'Escape') hideSuggestions();
    });
  }
  document.addEventListener('pointerdown', e => { if (!$('plan').contains(e.target)) hideSuggestions(); });

  function hideSuggestions() { $('sugg').hidden = true; }
  function renderSuggestions(items) {
    suggItems = items;
    const ul = $('sugg');
    ul.innerHTML = items.length ? items.map((it, i) => `<li data-i="${i}" class="${it.place || it.me ? '' : 'empty'}">${it.icon || ''}<div><div class="t">${esc(it.title)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ''}</div></li>`).join('') : '';
    ul.hidden = !items.length;
  }
  $('sugg').addEventListener('click', e => { const li = e.target.closest('li'); if (li) pick(suggItems[+li.dataset.i]); });

  async function showSuggestions(q) {
    q = q.trim();
    const base = [{ me: true, icon: ICON_ME, title: 'La mia posizione' }];
    if (q.length < 3) {
      renderSuggestions(base.concat(recents.slice(0, 6).map(p => ({ place: p, icon: ICON_CLOCK, title: p.name, sub: p.sub }))));
      return;
    }
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
      renderSuggestions(j.map(x => {
        const parts = x.display_name.split(', ');
        return { place: { lat: +x.lat, lon: +x.lon, name: parts[0], sub: parts.slice(1, 4).join(', ') }, icon: ICON_PIN, title: parts[0], sub: parts.slice(1, 4).join(', ') };
      }));
    } catch { toast('Ricerca non raggiungibile: controlla la connessione'); }
  }

  async function pick(it) {
    if (!it || (!it.place && !it.me)) return;
    const key = activeInput || 'to';
    let place = it.place;
    if (it.me) {
      toast('Cerco la tua posizione…', 0, true);
      try { const pos = await getPosition(); place = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'La mia posizione', sub: '', me: true }; t_hide(); }
      catch { toast('Posizione non disponibile: consenti la localizzazione a Safari'); return; }
    } else addRecent(place);
    setPlace(key, place);
    hideSuggestions();
    (key === 'from' ? $('inFrom') : $('inTo')).blur();
    if (key === 'from' && !places.to) $('inTo').focus();
    else if (key === 'to' && !places.from) { activeInput = 'from'; useMyPositionAsStart(); }
    computeRoute();
  }
  const t_hide = () => { $('toast').hidden = true; };
  function addRecent(p) {
    recents = [p].concat(recents.filter(r => Math.abs(r.lat - p.lat) > 1e-4 || Math.abs(r.lon - p.lon) > 1e-4)).slice(0, 8);
    store.set('recents', recents);
  }
  function setPlace(key, place) {
    places[key] = place;
    (key === 'from' ? $('inFrom') : $('inTo')).value = place ? place.name : '';
    drawPins();
  }
  async function useMyPositionAsStart() {
    try { const pos = await getPosition(); setPlace('from', { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'La mia posizione', me: true }); computeRoute(); }
    catch { $('inFrom').focus(); }
  }
  function drawPins() {
    layers.pins.clearLayers();
    for (const [k, col] of [['from', '#f3f2ee'], ['to', '#ffd400']]) {
      const p = places[k]; if (!p) continue;
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pin', html: `<span style="background:${col}"></span>`, iconSize: [0, 0] }), interactive: false }).addTo(layers.pins);
    }
  }
  $('btnSwap').addEventListener('click', () => { const a = places.from, b = places.to; setPlace('from', b); setPlace('to', a); computeRoute(); });

  function getPosition() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('no geo'));
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
    });
  }
  $('btnLocate').addEventListener('click', async () => {
    if (drive.on && drive.fix) { drive.follow = true; map.setView(drive.fix.ll, Math.max(map.getZoom(), 16)); return; }
    try { const p = await getPosition(); const ll = [p.coords.latitude, p.coords.longitude]; showMe(ll); map.setView(ll, 15); }
    catch { toast('Posizione non disponibile'); }
  });
  function showMe(ll) {
    if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: 'me', html: '<span></span>', iconSize: [0, 0] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    else meMarker.setLatLng(ll);
  }

  // ---------- tocco sulla mappa: partenza, arrivo, ostacolo ----------
  const OBS = {
    autovelox: { label: 'Autovelox', ch: 'V', tokens: ['attento', 'tts:autovelox'] },
    buca: { label: 'Buca', ch: 'B', tokens: ['buca'] },
    acqua: { label: 'Acqua / scivola', ch: 'A', tokens: ['scivola'] },
    dosso: { label: 'Dosso', ch: 'D', tokens: ['dosso'] },
    ponte: { label: 'Ponte stretto', ch: 'P', tokens: ['ponte'] },
    lavori: { label: 'Lavori', ch: 'L', tokens: ['attento', 'tts:lavori'] },
    pericolo: { label: 'Pericolo', ch: '!', tokens: ['attento_attento'] }
  };
  map.on('click', e => {
    if (drive.on) return;
    hideSuggestions();
    const ll = e.latlng;
    const html = `<div class="pop"><h4>${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</h4>
      <button class="pb" data-a="from">Parti da qui</button><button class="pb" data-a="to">Arriva qui</button>
      <h4 style="margin-top:12px">Segna un ostacolo</h4><div class="grid">${Object.entries(OBS).map(([k, o]) => `<button class="pb" data-o="${k}">${o.label}</button>`).join('')}</div></div>`;
    const pop = L.popup({ closeButton: false, autoPanPadding: [20, 140] }).setLatLng(ll).setContent(html).openOn(map);
    const el = pop.getElement();
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      map.closePopup();
      if (b.dataset.o) { obstacles.push({ lat: ll.lat, lon: ll.lng, type: b.dataset.o }); saveObstacles(); toast(OBS[b.dataset.o].label + ' segnato'); refreshNotes(); return; }
      const key = b.dataset.a;
      const place = { lat: ll.lat, lon: ll.lng, name: 'Punto sulla mappa', sub: '' };
      setPlace(key, place); computeRoute();
      try {
        const r = await fetch(`${PHOTON_REV}?lat=${ll.lat}&lon=${ll.lng}`); const j = await r.json(); const p = j.features && j.features[0] && j.features[0].properties;
        if (p) { place.name = p.name || (p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : place.name); (key === 'from' ? $('inFrom') : $('inTo')).value = place.name; }
      } catch { /* resta il nome generico */ }
    });
  });
  function saveObstacles() { store.set('obstacles', obstacles); drawObstacles(); $('obsCount').textContent = obstacles.length; }
  function drawObstacles() {
    layers.obs.clearLayers();
    obstacles.forEach((o, i) => {
      const m = L.marker([o.lat, o.lon], { icon: L.divIcon({ className: 'obsicon', html: `<span>${OBS[o.type].ch}</span>`, iconSize: [0, 0] }) }).addTo(layers.obs);
      m.on('click', ev => {
        L.DomEvent.stopPropagation(ev);
        const pop = L.popup({ closeButton: false }).setLatLng([o.lat, o.lon]).setContent(`<div class="pop"><h4>${OBS[o.type].label}</h4><button class="pb" data-del="1">Rimuovi</button></div>`).openOn(map);
        pop.getElement().addEventListener('click', e => { if (e.target.closest('[data-del]')) { obstacles.splice(i, 1); saveObstacles(); map.closePopup(); refreshNotes(); } });
      });
    });
  }

  // ---------- percorso ----------
  let routes = [], routeIdx = 0, cur = null; // cur = { gen, notes, calls, osrm }
  let cams = [];
  let routeReq = 0;

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
      return Promise.reject(e);
    }
  }

  function selectRoute(i, fit) {
    routeIdx = i;
    const osrm = routes[i];
    const coords = osrm.geometry.coordinates;
    const gen = P.generate(coords, genOptions());
    cur = { gen, osrm, coords };
    buildNotes();
    drawRoute(fit);
    renderSheet();
  }
  function genOptions() { return { scale: settings.scale, callFlat: settings.flat }; }

  // regenera le note (cambio impostazioni o ostacoli)
  function refreshNotes() {
    if (!cur) return;
    if (!drive.on) cur.gen = P.generate(cur.coords, genOptions());
    buildNotes();
    drawRoute(false);
    renderSheet();
    if (drive.on) drive.resync();
  }

  // posizione lungo il percorso del punto più vicino
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

  function buildNotes() {
    const { gen, osrm } = cur, route = gen.route;
    let notes = gen.notes.map(n => Object.assign({}, n, { mods: n.mods.slice(), junction: false }));
    const extra = [];
    // incroci e rotonde dalle manovre di OSRM
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
          const ex = m.exit || 1;
          extra.push({ kind: 'nav', icon: '⟳', label: 'ROT ' + ex, startS: Math.max(0, s0 - 15), endS: s1, tokens: ['tts:rotonda, ' + ['prima', 'seconda', 'terza', 'quarta', 'quinta', 'sesta'][Math.min(ex, 6) - 1] + ' uscita'] });
          return;
        }
        if (type === 'exit roundabout' || type === 'exit rotary') return;
        const isTurn = /left|right/.test(mod) && !/uturn/.test(mod);
        if (!isTurn) return;
        const left = /left/.test(mod);
        const near = notes.find(n => n.kind === 'corner' && n.startS - 30 <= s0 && n.endS + 30 >= s0 && (n.dir === 'sinistra') === left);
        if (near) { near.junction = true; return; }
        // nessuna curva vera (bivio, svincolo, tenere la destra): "stai destra/sinistra"
        if (type === 'fork' || type === 'off ramp' || type === 'on ramp' || type === 'merge' || /slight/.test(mod) || type === 'turn' || type === 'end of road') {
          extra.push({ kind: 'nav', icon: left ? '↖' : '↗', label: left ? 'STAI SX' : 'STAI DX', startS: Math.max(0, s0 - 10), endS: s0, tokens: [left ? 'stai_sinistra' : 'stai_destra'] });
        }
      });
    }
    // ostacoli segnati e autovelox
    const obsList = obstacles.map(o => ({ ...o, user: true })).concat(settings.cams ? cams.map(c => ({ ...c, type: 'autovelox' })) : []);
    let hint = 0;
    for (const o of obsList) {
      const pr = projectOnRoute(o.lat, o.lon, route);
      if (pr.d > 25) continue;
      hint++;
      extra.push({ kind: 'obs', obsType: o.type, label: OBS[o.type].label, startS: Math.max(0, pr.s - 10), endS: pr.s, tokens: OBS[o.type].tokens.slice() });
    }
    extra.push({ kind: 'finish', label: 'Arrivo', startS: Math.max(0, route.length - 40), endS: route.length, tokens: ['fine'] });
    notes = notes.concat(extra).sort((x, y) => x.startS - y.startS);
    P.linkDistances(notes, route.length, gen.cfg);
    cur.notes = notes;
    cur.calls = P.buildCalls(notes);
    cur.calls.forEach(c => { c.speechText = c.tokens.map(P.tokenText).join(', ').replace(/, (\d+)$/, ', $1'); });
  }

  function drawRoute(fit) {
    layers.alts.clearLayers(); layers.route.clearLayers(); layers.labels.clearLayers();
    routes.forEach((r, i) => {
      if (i === routeIdx) return;
      const pl = L.polyline(r.geometry.coordinates.map(c => [c[1], c[0]]), { color: '#6b7280', weight: 6, opacity: .7 }).addTo(layers.alts);
      pl.on('click', ev => { L.DomEvent.stopPropagation(ev); selectRoute(i, false); });
    });
    const route = cur.gen.route;
    L.polyline(route.latlon, { color: '#000', weight: 10, opacity: .5 }).addTo(layers.route);
    L.polyline(route.latlon, { color: '#e8e8e8', weight: 6 }).addTo(layers.route);
    for (const nt of cur.notes) {
      if (nt.kind === 'corner') {
        L.polyline(route.latlon.slice(nt.i0, nt.i1 + 1), { color: colorOf(nt), weight: 7, lineCap: 'round' }).addTo(layers.route);
      }
      const at = pointAtS(route, nt.startS).ll;
      const txt = nt.kind === 'corner' ? P.shortLabel(nt) + (nt.mods.includes('lunga') || nt.mods.includes('molto_lunga') ? ' L' : '') : nt.kind === 'obs' ? OBS[nt.obsType].ch : nt.kind === 'finish' ? 'FINE' : nt.label;
      L.marker(at, { icon: L.divIcon({ className: 'nlabel', html: `<span style="background:${colorOf(nt)}">${esc(txt)}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(layers.labels);
    }
    updateLabelVisibility();
    if (fit) map.fitBounds(L.latLngBounds(route.latlon), { paddingTopLeft: [20, 140], paddingBottomRight: [20, Math.min(innerHeight * 0.5, 380)] });
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
    const c = cur.calls[+li.dataset.c];
    map.setView(pointAtS(cur.gen.route, c.startS + 20).ll, 16);
    voice.unlock(); voice.say(callTokensFiltered(c), callTextFiltered(c));
  });
  $('sheet').querySelector('.grab').addEventListener('click', () => $('sheet').classList.toggle('min'));

  function callTitle(c) { return c.notes.map(n => n.kind === 'corner' ? P.tokensText(P.noteTokens(n)) : n.kind === 'obs' ? n.label : n.kind === 'finish' ? 'Fine' : P.tokensText(n.tokens)).join(' e ') + (c.notes[c.notes.length - 1].dist && settings.dist ? ' · ' + c.notes[c.notes.length - 1].dist : ''); }
  // versione corta per i riquadri piccoli: "3 DX L · 100"
  function callShort(c) {
    const parts = c.notes.map(n => n.kind === 'corner' ? P.shortLabel(n) + (n.mods.some(m => /lunga/.test(m)) ? ' L' : '') + (n.mods.includes('stringe') ? ' ↘' : '') : n.kind === 'finish' ? 'FINE' : n.label);
    const last = c.notes[c.notes.length - 1];
    return parts.join(' + ') + (last.dist && settings.dist ? ' · ' + last.dist : '');
  }
  function callTokensFiltered(c) { return settings.dist ? c.tokens : c.tokens.filter(t => !/^\d+$/.test(t)); }
  function callTextFiltered(c) { return callTokensFiltered(c).map(P.tokenText).join(' '); }

  // ---------- autovelox da OpenStreetMap ----------
  async function loadCameras() {
    if (!cur || cur.gen.route.length > 400000) return;
    const b = L.latLngBounds(cur.gen.route.latlon).pad(0.02);
    const q = `[out:json][timeout:20];node["highway"="speed_camera"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});out;`;
    try {
      const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const j = await r.json();
      cams = (j.elements || []).map(e => ({ lat: e.lat, lon: e.lon }));
      if (cams.length) { buildNotes(); drawRoute(false); renderSheet(); if (drive.on) drive.resync(); }
    } catch { /* autovelox non disponibili: si va avanti */ }
  }

  // ---------- voce ----------
  const voice = (() => {
    let ctx = null, clips = new Map(), buffers = new Map(), decoding = null, speaking = false, itVoice = null;
    const db = idb();
    function idb() {
      let p = null;
      const open = () => p || (p = new Promise((res, rej) => {
        const r = indexedDB.open('copilota', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('clips');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }));
      return {
        async putAll(map) {
          const d = await open();
          await new Promise((res, rej) => { const tx = d.transaction('clips', 'readwrite'); const st = tx.objectStore('clips'); st.clear(); for (const [k, v] of map) st.put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        },
        async getAll() {
          const d = await open();
          return new Promise((res, rej) => {
            const out = new Map(); const tx = d.transaction('clips'); const req = tx.objectStore('clips').openCursor();
            req.onsuccess = () => { const c = req.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
            req.onerror = () => rej(req.error);
          });
        }
      };
    }
    function pickVoice() {
      const vs = speechSynthesis.getVoices().filter(v => /^it/i.test(v.lang));
      itVoice = vs.find(v => /Alice|Luca|Federica|Paola/i.test(v.name)) || vs[0] || null;
    }
    if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

    async function load() {
      try { clips = await db.getAll(); } catch { clips = new Map(); }
      updateStatus();
    }
    function updateStatus() {
      $('voiceStatus').textContent = clips.size ? `${clips.size} clip caricate: chiamate con la voce del copilota.` : 'Nessuna voce caricata: uso la sintesi vocale del telefono.';
    }
    async function importFiles(files) {
      const found = new Map();
      const add = (name, buf) => { const base = name.split('/').pop().replace(/\.[^.]+$/, '').replace(/~/g, '').toLowerCase(); if (base) found.set(base, buf); };
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          const zip = await JSZip.loadAsync(f);
          const entries = Object.values(zip.files).filter(e => !e.dir && /\.(mp3|m4a|aac|ogg|wav)$/i.test(e.name) && !/__MACOSX/.test(e.name));
          for (const e of entries) add(e.name, await e.async('arraybuffer'));
        } else if (/\.(mp3|m4a|aac|ogg|wav)$/i.test(f.name)) add(f.name, await f.arrayBuffer());
      }
      if (!found.size) throw new Error('Nessun file audio trovato');
      await db.putAll(found);
      clips = found; buffers = new Map(); decoding = null;
      updateStatus();
      return found.size;
    }
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
    // decodifica e toglie il silenzio iniziale/finale di ogni clip
    async function decodeAll() {
      const names = [...clips.keys()];
      for (let i = 0; i < names.length; i += 8) {
        await Promise.all(names.slice(i, i + 8).map(async n => {
          try { buffers.set(n, trim(await ctx.decodeAudioData(clips.get(n).slice(0)))); } catch { /* formato non supportato: userà la sintesi */ }
        }));
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
      if (tok.startsWith('tts:')) return null;
      const t = tok.toLowerCase();
      const cands = [t, t + '1', t + '2', t + '_1', t + '_2'].filter(c => buffers.has(c));
      return cands.length ? buffers.get(cands[Math.floor(Math.random() * cands.length)]) : null;
    }
    function playBuffer(buf) {
      return new Promise(res => { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.onended = res; s.start(); setTimeout(res, buf.duration * 1000 + 400); });
    }
    function tts(text) {
      return new Promise(res => {
        if (!('speechSynthesis' in window)) return res();
        const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT'; if (itVoice) u.voice = itVoice; u.rate = 1.15;
        u.onend = res; u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 600 + text.length * 120);
      });
    }
    async function say(tokens, fallbackText) {
      if (speaking) { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
      speaking = true;
      try {
        if (decoding) await decoding;
        const useClips = ctx && buffers.size;
        if (!useClips) { await tts(fallbackText || P.tokensText(tokens)); return; }
        // le parti senza clip vengono raggruppate e lette dalla sintesi
        let pend = [];
        const flush = async () => { if (pend.length) { await tts(pend.join(' ')); pend = []; } };
        for (const t of tokens) {
          const b = resolve(t);
          if (b) { await flush(); await playBuffer(b); }
          else pend.push(P.tokenText(t));
        }
        await flush();
      } finally { speaking = false; }
    }
    return { load, importFiles, unlock, say, get speaking() { return speaking; }, get count() { return clips.size; }, get decoded() { return buffers.size; } };
  })();

  // ---------- guida (GPS o simulazione) ----------
  const drive = {
    on: false, sim: false, fix: null, idx: 0, watch: null, timer: null, simTimer: null, follow: true, off: 0, said: -1, lock: null, rerouting: false, lastS: 0,
    start(sim) {
      if (!cur) return;
      voice.unlock();
      this.on = true; this.sim = sim; this.idx = 0; this.fix = null; this.off = 0; this.said = -1; this.follow = true; this.lastS = 0;
      document.body.classList.add('driving');
      $('drive').hidden = false; $('dbar').hidden = false;
      $('dMode').textContent = sim ? 'SIMULAZIONE' : 'GPS';
      map.closePopup();
      this.wake();
      if (sim) this.startSim();
      else if (navigator.geolocation) {
        this.watch = navigator.geolocation.watchPosition(p => this.onFix(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.accuracy, Date.now()),
          () => toast('GPS non disponibile: consenti la posizione a Safari', 5000), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      }
      this.timer = setInterval(() => this.tick(), 200);
      map.setZoom(16);
      this.render();
    },
    stop() {
      this.on = false;
      if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
      clearInterval(this.timer); clearInterval(this.simTimer); this.watch = null;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
      document.body.classList.remove('driving');
      $('drive').hidden = true; $('dbar').hidden = true;
      if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
      if (cur && cur.rerouted) { cur.rerouted = false; }
      if (cur) map.fitBounds(L.latLngBounds(cur.gen.route.latlon), { paddingTopLeft: [20, 140], paddingBottomRight: [20, 300] });
    },
    async wake() {
      try { if ('wakeLock' in navigator) this.lock = await navigator.wakeLock.request('screen'); } catch { /* non supportato */ }
    },
    startSim() {
      const route = cur.gen.route;
      let s = 0, v = settings.sim / 3.6, last = Date.now();
      // velocità realistica: rallenta per le curve strette
      const vmax = { piena: 130, 6: 115, 5: 100, 4: 85, 3: 70, 2: 55, 1: 42, 90: 30, tornante: 25 };
      this.simTimer = setInterval(() => {
        const now = Date.now(), dt = (now - last) / 1000; last = now;
        const route2 = cur.gen.route; if (route2 !== route) { s = Math.min(s, route2.length); }
        let target = settings.sim / 3.6;
        for (const n of cur.notes) {
          if (n.kind !== 'corner') continue;
          if (n.startS - 60 <= s && n.endS >= s) target = Math.min(target, vmax[gkey(n)] / 3.6);
          if (n.startS > s + 80) break;
        }
        v += Math.max(-6 * dt, Math.min(3 * dt, target - v));
        s += v * dt;
        if (s >= cur.gen.route.length) { s = cur.gen.route.length; clearInterval(this.simTimer); }
        const p = pointAtS(cur.gen.route, s).ll;
        this.onFix(p[0], p[1], v, 5, now);
      }, 1000);
    },
    onFix(lat, lon, speed, acc, t) {
      const route = cur.gen.route;
      const prev = this.fix;
      let pr = projectOnRoute(lat, lon, route, (prev ? prev.i : 0) - 40, (prev ? prev.i : 0) + 600);
      if (pr.d > 50) pr = projectOnRoute(lat, lon, route);
      let v = speed != null && speed >= 0 ? speed : (prev ? Math.max(0, (pr.s - prev.s) / Math.max(0.5, (t - prev.t) / 1000)) : 0);
      this.fix = { s: pr.s, i: pr.i, t, v, d: pr.d, ll: [lat, lon] };
      showMe([lat, lon]);
      if (this.follow) map.panTo([lat, lon], { animate: true, duration: 0.5 });
      // fuori percorso → ricalcolo
      if (!this.sim && pr.d > 60 && (acc || 99) < 60) this.off++; else this.off = 0;
      if (this.off >= 4 && !this.rerouting) this.reroute(lat, lon);
    },
    async reroute(lat, lon) {
      this.rerouting = true; this.off = 0;
      voice.say(['tts:ricalcolo'], 'ricalcolo');
      try {
        await computeRoute({ lat, lon, name: 'Posizione' });
        this.resync();
      } catch { /* riprova al prossimo fuori percorso */ }
      setTimeout(() => this.rerouting = false, 8000);
    },
    resync() {
      // dopo una rigenerazione: riparti dalla prossima chiamata davanti a te
      if (!this.fix) { this.idx = 0; return; }
      const pr = projectOnRoute(this.fix.ll[0], this.fix.ll[1], cur.gen.route);
      this.fix.s = pr.s; this.fix.i = pr.i;
      this.idx = cur.calls.findIndex(c => c.startS > pr.s - 5); if (this.idx < 0) this.idx = cur.calls.length;
    },
    estS() {
      if (!this.fix) return 0;
      return this.fix.s + this.fix.v * Math.min(2.5, (Date.now() - this.fix.t) / 1000);
    },
    tick() {
      if (!this.on || !this.fix) return;
      const s = this.estS(), v = this.fix.v, calls = cur.calls;
      // salta le chiamate già superate senza averle dette
      while (this.idx < calls.length && calls[this.idx].startS < s - 15) this.idx++;
      if (!voice.speaking && this.idx < calls.length) {
        const c = calls[this.idx];
        const lead = Math.max(55, v * settings.lead);
        if (c.startS - s <= lead) {
          this.said = this.idx; this.idx++;
          voice.say(callTokensFiltered(c), callTextFiltered(c));
          $('callCard').classList.add('pulse'); setTimeout(() => $('callCard').classList.remove('pulse'), 180);
        }
      }
      this.lastS = s;
      this.render();
    },
    render() {
      if (!cur) return;
      const s = this.estS(), calls = cur.calls;
      // in alto: l'ultima detta se non ancora superata, altrimenti la prossima
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
    }
  };
  map.on('dragstart', () => { if (drive.on) drive.follow = false; });
  document.addEventListener('visibilitychange', () => { if (drive.on && document.visibilityState === 'visible') drive.wake(); });

  $('btnGo').addEventListener('click', () => drive.start(false));
  $('btnSim').addEventListener('click', () => drive.start(true));
  $('btnStop').addEventListener('click', () => drive.stop());
  $('btnRepeat').addEventListener('click', () => {
    voice.unlock();
    const c = cur && cur.calls[drive.said >= 0 ? drive.said : drive.idx];
    if (c) voice.say(callTokensFiltered(c), callTextFiltered(c));
  });

  // ---------- impostazioni ----------
  function bindSettings() {
    const upd = () => {
      $('oLead').textContent = String(settings.lead).replace('.', ',') + ' s';
      $('oScale').textContent = settings.scale < 0.95 ? 'aggressiva' : settings.scale > 1.05 ? 'prudente' : 'normale';
      $('oSim').textContent = settings.sim + ' km/h';
      store.set('settings', settings);
    };
    const bindRange = (id, key, regen) => { const el = $(id); el.value = settings[key]; el.addEventListener('input', () => { settings[key] = +el.value; upd(); }); if (regen) el.addEventListener('change', refreshNotes); };
    const bindCheck = (id, key, fn) => { const el = $(id); el.checked = settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; upd(); fn && fn(); }); };
    bindRange('sLead', 'lead'); bindRange('sScale', 'scale', true); bindRange('sSim', 'sim');
    bindCheck('tFlat', 'flat', refreshNotes); bindCheck('tDist', 'dist', () => cur && renderSheet()); bindCheck('tNav', 'nav', refreshNotes);
    bindCheck('tCams', 'cams', () => { if (settings.cams && !cams.length) loadCameras(); else refreshNotes(); });
    bindCheck('tLight', 'light', () => { map.removeLayer(tiles); tiles = L.tileLayer(settings.light ? TILES.light : TILES.dark, { maxZoom: 19, attribution: ATTR, subdomains: 'abcd' }).addTo(map); });
    upd();
  }
  $('btnSettings').addEventListener('click', () => { $('settings').hidden = false; });
  $('btnCloseSet').addEventListener('click', () => { $('settings').hidden = true; });
  $('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').hidden = true; });
  $('inVoices').addEventListener('change', async e => {
    const files = [...e.target.files]; if (!files.length) return;
    $('voiceStatus').textContent = 'Carico le voci…';
    try { const n = await voice.importFiles(files); toast(n + ' clip caricate'); voice.unlock(); }
    catch (err) { toast('Non sono riuscito a leggere le voci: ' + err.message, 5000); voice.load(); }
    e.target.value = '';
  });
  $('btnTestVoice').addEventListener('click', () => { voice.unlock(); voice.say(['destra_tre', 'lunga', 'e', 'sinistra_quattro', 'stringe', '150'], 'destra tre lunga e sinistra quattro stringe, 150'); });
  $('btnClearObs').addEventListener('click', () => { obstacles = []; saveObstacles(); refreshNotes(); toast('Ostacoli cancellati'); });
  $('legend').innerHTML = ['piena', 6, 5, 4, 3, 2, 1, 90, 'tornante'].map(g => {
    const nt = { kind: 'corner', dir: 'destra', grade: g === 90 ? 2 : g, mods: g === 90 ? ['secca'] : [] };
    return `<div>${iconHTML(nt)}${g === 'piena' ? 'Piena' : g === 'tornante' ? 'Tornante' : g === 90 ? '90 secca' : g}</div>`;
  }).join('');

  // ---------- avvio ----------
  bindSettings();
  drawObstacles(); $('obsCount').textContent = obstacles.length;
  voice.load();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // test/diagnostica dalla console
  window.__copilota = { get cur() { return cur; }, drive, voice, places, setPlace, computeRoute, selectRouteFromOSRM(j) { routes = j.routes; selectRoute(0, true); } };
})();
