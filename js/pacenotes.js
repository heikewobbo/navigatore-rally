/* Generatore di note rally dalla geometria di un percorso.
   Input: coordinate [[lon,lat],...] (GeoJSON). Output: lista di note con posizione lungo il percorso.
   Funziona sia nel browser (window.Pacenotes) sia in Node (module.exports) per i test. */
(function (root) {
  'use strict';

  const DEFAULTS = {
    step: 5,            // m tra i punti ricampionati
    smoothPasses: 1,    // passate di media mobile
    window: 20,         // m su cui si misura la curvatura
    enterR: 500,        // sotto questo raggio inizia una curva
    exitR: 650,         // isteresi di uscita
    mergeGap: 15,       // m: due pezzi di curva nella stessa direzione più vicini di così si uniscono
    minAngle: 12,       // gradi: sotto, non è una curva
    scale: 1,           // moltiplica le soglie dei raggi (>1 = numeri più bassi/prudenti)
    // soglie raggio (m) per ogni grado: raggio >= soglia => quel grado
    grades: [
      { g: 'piena', r: 300 },
      { g: 6, r: 150 },
      { g: 5, r: 90 },
      { g: 4, r: 60 },
      { g: 3, r: 40 },
      { g: 2, r: 25 },
      { g: 1, r: 0 }
    ],
    callFlat: true,      // chiamare le "piena"
    flatMinAngle: 25,    // una piena si chiama solo se gira almeno così
    longAngle: 100,      // gradi oltre cui è "lunga"
    veryLongAngle: 165,
    longLengthOpen: 220, // m: curve aperte (5, 6, piena) più lunghe di così sono "lunghe"
    hairpinAngle: 135,
    hairpinR: 22,
    squareR: 20,
    squareMin: 65, squareMax: 120,
    tightenRatio: 1.6,  // rapporto di curvatura tra fine e inizio per "stringe"/"apre"
    intoGap: 25,         // m: sotto questa distanza la nota successiva si lega con "e"
    distances: [30, 40, 50, 60, 70, 80, 100, 120, 140, 150, 160, 180, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000]
  };

  const WORD = { 6: 'sei', 5: 'cinque', 4: 'quattro', 3: 'tre', 2: 'due', 1: 'uno', piena: 'piena', tornante: 'tornante' };
  const RANK = { piena: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2, 1: 1, 90: 0.5, tornante: 0 };

  // ---------- geometria ----------
  function project(coords) {
    let lat0 = 0;
    for (const c of coords) lat0 += c[1];
    lat0 /= coords.length;
    const ky = 110574, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const lon0 = coords[0][0], la0 = coords[0][1];
    return {
      fwd: (lon, lat) => [(lon - lon0) * kx, (lat - la0) * ky],
      inv: (x, y) => [lon0 + x / kx, la0 + y / ky],
      pts: coords.map(c => [(c[0] - lon0) * kx, (c[1] - la0) * ky])
    };
  }

  function resample(pts, step) {
    const out = [[pts[0][0], pts[0][1]]];
    let carry = 0; // distanza già percorsa dall'ultimo punto emesso
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-6) continue;
      let d = step - carry;
      while (d <= L) {
        const t = d / L;
        out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        d += step;
      }
      carry = L - (d - step);
    }
    const last = pts[pts.length - 1];
    const pl = out[out.length - 1];
    if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) out.push([last[0], last[1]]);
    return out;
  }

  function smooth(pts, passes) {
    let p = pts;
    for (let k = 0; k < passes; k++) {
      const q = p.map(a => [a[0], a[1]]);
      for (let i = 2; i < p.length - 2; i++) {
        q[i][0] = (p[i - 2][0] + p[i - 1][0] + p[i][0] + p[i + 1][0] + p[i + 2][0]) / 5;
        q[i][1] = (p[i - 2][1] + p[i - 1][1] + p[i][1] + p[i + 1][1] + p[i + 2][1]) / 5;
      }
      p = q;
    }
    return p;
  }

  // direzione (rad, "srotolata") per ogni punto e curvatura con segno (+ = sinistra)
  function headingCurvature(p, step, win) {
    const n = p.length;
    const h = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) h[i] = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
    h[n - 1] = h[n - 2] || 0;
    for (let i = 1; i < n; i++) {
      let d = h[i] - h[i - 1];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      h[i] = h[i - 1] + d;
    }
    const w = Math.max(1, Math.round(win / 2 / step));
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
      k[i] = b > a ? (h[b] - h[a]) / ((b - a) * step) : 0;
    }
    return { h, k, w };
  }

  // ---------- classificazione ----------
  function gradeFromRadius(R, cfg) {
    for (const t of cfg.grades) if (R >= t.r * cfg.scale) return t.g;
    return 1;
  }
  // un'angolata piccola non può essere una curva strettissima (spesso è solo un vertice di OSM)
  function capByAngle(g, angle) {
    const r = RANK[g];
    if (angle < 22 && r < 5) return 5;
    if (angle < 35 && r < 4) return 4;
    if (angle < 50 && r < 3) return 3;
    return g;
  }

  function nearestDistance(d, list) {
    let best = list[0];
    for (const v of list) if (Math.abs(v - d) < Math.abs(best - d)) best = v;
    return best;
  }

  function detectCorners(k, step, cfg) {
    const n = k.length, enter = 1 / (cfg.enterR), exit = 1 / (cfg.exitR);
    const runs = [];
    let i = 0;
    while (i < n) {
      if (Math.abs(k[i]) >= enter) {
        const sign = Math.sign(k[i]);
        let a = i, b = i;
        while (a > 0 && Math.sign(k[a - 1]) === sign && Math.abs(k[a - 1]) >= exit) a--;
        while (b < n - 1 && Math.sign(k[b + 1]) === sign && Math.abs(k[b + 1]) >= exit) b++;
        runs.push({ a, b, sign });
        i = b + 1;
      } else i++;
    }
    // unisci pezzi vicini nella stessa direzione
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last.sign === r.sign && (r.a - last.b) * step <= cfg.mergeGap) last.b = r.b;
      else merged.push({ ...r });
    }
    return merged;
  }

  function generate(coords, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    if (!coords || coords.length < 2) return { notes: [], route: null };
    const proj = project(coords);
    const raw = resample(proj.pts, cfg.step);
    const p = smooth(raw, cfg.smoothPasses);
    const { h, k, w } = headingCurvature(p, cfg.step, cfg.window);
    const n = p.length;
    const s = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);

    const runs = detectCorners(k, cfg.step, cfg);
    const notes = [];
    for (const r of runs) {
      // angolo totale: integrale della curvatura sul tratto
      const ang = Math.abs(sumK(k, r.a, r.b)) * cfg.step * 180 / Math.PI;
      if (ang < cfg.minAngle) continue;
      let kmax = 0, kmaxAt = r.a;
      const ks = [];
      for (let j = r.a; j <= r.b; j++) { ks.push(Math.abs(k[j])); if (Math.abs(k[j]) > kmax) { kmax = Math.abs(k[j]); kmaxAt = j; } }
      // raggio "robusto": 85° percentile della curvatura, così un vertice rumoroso non stringe la curva
      ks.sort((x, y) => x - y);
      const R = 1 / ks[Math.min(ks.length - 1, Math.floor(ks.length * 0.85))];
      const inner = Math.max(0, Math.round((w - 1) * 0.6));
      let a = r.a + inner, b = r.b - inner;
      if (b <= a) { a = r.a + Math.floor((r.b - r.a) / 3); b = r.b - Math.floor((r.b - r.a) / 3); if (b < a) b = a; }
      const length = (b - a) * cfg.step;
      const dir = r.sign > 0 ? 'sinistra' : 'destra';

      let grade, sharp = false;
      if (R < cfg.hairpinR * cfg.scale && ang >= cfg.hairpinAngle) grade = 'tornante';
      else if (R < cfg.squareR * cfg.scale && ang >= cfg.squareMin && ang <= cfg.squareMax) { grade = 2; sharp = true; }
      else grade = capByAngle(gradeFromRadius(R, cfg), ang);

      if (grade === 'piena' && (!cfg.callFlat || ang < cfg.flatMinAngle)) continue;

      const mods = [];
      if (grade !== 'tornante' && !sharp) {
        if (ang >= cfg.veryLongAngle) mods.push('molto_lunga');
        else if (ang >= cfg.longAngle) mods.push('lunga');
        else if (RANK[grade] >= 5 && length >= cfg.longLengthOpen) mods.push('lunga');
      }
      if (sharp) mods.push('secca');
      // stringe / apre: confronta la curvatura nel primo e nell'ultimo terzo
      if (grade !== 'tornante' && !sharp && r.b - r.a >= 6) {
        const third = Math.floor((r.b - r.a + 1) / 3);
        const k1 = maxAbs(k, r.a, r.a + third), k3 = maxAbs(k, r.b - third, r.b);
        if (k3 > k1 * cfg.tightenRatio && gradeFromRadius(1 / k3, cfg) !== gradeFromRadius(1 / k1, cfg)) mods.push('stringe');
        else if (k1 > k3 * cfg.tightenRatio && gradeFromRadius(1 / k1, cfg) !== gradeFromRadius(1 / k3, cfg)) mods.push('apre');
      }

      notes.push({
        kind: 'corner', dir, grade, mods, angle: Math.round(ang), radius: Math.round(R),
        startS: s[a], endS: s[b], apexS: s[kmaxAt], i0: a, i1: b
      });
    }

    linkDistances(notes, s[n - 1], cfg);
    const latlon = p.map(q => { const ll = proj.inv(q[0], q[1]); return [ll[1], ll[0]]; });
    return { notes, route: { pts: p, s: Array.from(s), latlon, proj, length: s[n - 1] }, cfg };
  }

  function sumK(k, a, b) { let t = 0; for (let j = a; j <= b; j++) t += k[j]; return t; }
  function maxAbs(k, a, b) { let m = 0; for (let j = a; j <= b; j++) m = Math.max(m, Math.abs(k[j])); return m; }

  // distanze tra le note e legami "e"
  function linkDistances(notes, total, cfg) {
    notes.sort((x, y) => x.startS - y.startS);
    for (let i = 0; i < notes.length; i++) {
      const cur = notes[i], nx = notes[i + 1];
      cur.into = false; cur.dist = null;
      if (!nx) continue;
      const gap = nx.startS - (cur.endS || cur.startS);
      if (cur.kind === 'corner' && nx.kind === 'corner' && gap < cfg.intoGap) cur.into = true;
      else if (cur.kind === 'corner' && gap >= 28) cur.dist = nearestDistance(Math.min(gap, 1000), cfg.distances);
    }
  }

  // raggruppa le note legate da "e" in un'unica chiamata
  function buildCalls(notes) {
    const calls = [];
    let cur = null;
    for (const nt of notes) {
      if (!cur) cur = { notes: [], startS: nt.startS };
      cur.notes.push(nt);
      if (!(nt.into && cur.notes.length < 3)) { calls.push(cur); cur = null; }
    }
    if (cur) calls.push(cur);
    calls.forEach((c, i) => { c.id = i; c.tokens = callTokens(c); c.text = tokensText(c.tokens); });
    return calls;
  }

  // nomi dei file audio (senza numero di variante e senza estensione)
  function noteTokens(nt) {
    if (nt.kind === 'corner') {
      const t = [];
      if (nt.junction) t.push('incrocio');
      t.push(nt.dir + '_' + WORD[nt.grade]);
      for (const m of nt.mods) t.push(m);
      return t;
    }
    return nt.tokens ? nt.tokens.slice() : [];
  }
  function callTokens(call) {
    const t = [];
    call.notes.forEach((nt, i) => {
      if (i > 0) t.push('e');
      t.push(...noteTokens(nt));
    });
    const last = call.notes[call.notes.length - 1];
    if (last.dist) t.push(String(last.dist));
    return t;
  }

  const SPOKEN = {
    secca: 'secca', lunga: 'lunga', molto_lunga: 'molto lunga', poco_lunga: 'poco lunga', stringe: 'stringe', apre: 'apre',
    e: 'e', incrocio: 'incrocio', fine: 'fine', attento: 'attento', buca: 'buca', dosso: 'dosso', ponte: 'ponte',
    scivola: 'scivola', stretta: 'stretta', 'tts:autovelox': 'autovelox', 'tts:lavori': 'lavori'
  };
  function tokenText(t) {
    if (t.startsWith('tts:')) return t.slice(4).replace(/_/g, ' ');
    if (SPOKEN[t]) return SPOKEN[t];
    const m = t.match(/^(destra|sinistra)_(\w+)$/);
    if (m) return m[1] + ' ' + m[2];
    return t.replace(/_/g, ' ');
  }
  function tokensText(tokens) { return tokens.map(tokenText).join(' '); }

  // breve etichetta per mappa/schermo: es. "3 DX", "T SX", "90 DX"
  function shortLabel(nt) {
    if (nt.kind !== 'corner') return nt.label || '!';
    const d = nt.dir === 'destra' ? 'DX' : 'SX';
    if (nt.grade === 'tornante') return 'T ' + d;
    if (nt.grade === 'piena') return 'P ' + d;
    if (nt.mods.includes('secca')) return '90 ' + d;
    return nt.grade + ' ' + d;
  }

  const api = { DEFAULTS, generate, buildCalls, linkDistances, noteTokens, tokensText, tokenText, shortLabel, project, RANK, WORD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pacenotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
