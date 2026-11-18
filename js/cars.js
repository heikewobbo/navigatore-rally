/* Auto da rally disegnate in SVG: vista dall'alto (mappa 2D) e vista da dietro (guida 3D).
   Modelli generici e livree inventate, nessun marchio reale. */
(function (root) {
  'use strict';

  const LIVERIES = [
    { id: 'bianca', name: 'Bianca e rossa', main: '#f2f2ee', acc: '#e3262f', acc2: '#1d1f24' },
    { id: 'rossa', name: 'Rossa', main: '#d3222b', acc: '#ffffff', acc2: '#1d1f24' },
    { id: 'blu', name: 'Blu e arancio', main: '#1e4fb8', acc: '#ff8a1a', acc2: '#11131a' },
    { id: 'nera', name: 'Nera e gialla', main: '#202227', acc: '#ffd400', acc2: '#ffd400' },
    { id: 'verde', name: 'Verde', main: '#1f7a4a', acc: '#f2f2ee', acc2: '#11131a' },
    { id: 'arancio', name: 'Arancio', main: '#ff7a1a', acc: '#1d1f24', acc2: '#1d1f24' }
  ];
  const MODELS = [
    { id: 'freccia', name: 'Freccia' },
    { id: 'rally2', name: 'Rally2' },
    { id: 'gruppob', name: 'Gruppo B' },
    { id: 'classica', name: "Classica '70" }
  ];
  const liv = id => LIVERIES.find(l => l.id === id) || LIVERIES[0];
  let uid = 0;

  // ---------- vista dall'alto (muso verso l'alto), viewBox 64x110 ----------
  function top(model, livery) {
    const L = liv(livery), g = 'c' + (++uid);
    if (model === 'freccia') {
      return `<svg viewBox="0 0 64 110" class="car"><defs><linearGradient id="${g}" x1="0" x2="1"><stop offset="0" stop-color="${L.main}"/><stop offset=".5" stop-color="${L.main}"/><stop offset=".5" stop-color="${shade(L.main, -.25)}"/><stop offset="1" stop-color="${shade(L.main, -.25)}"/></linearGradient></defs>
        <ellipse cx="32" cy="66" rx="24" ry="30" fill="rgba(0,0,0,.35)"/>
        <path d="M32 14 L56 88 L32 74 L8 88 Z" fill="url(#${g})" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>`;
    }
    const W = model === 'gruppob' ? 42 : model === 'classica' ? 37 : 40;
    const x0 = 32 - W / 2, y0 = model === 'classica' ? 8 : 11, H = model === 'classica' ? 92 : 86;
    const wheel = (x, y) => `<rect x="${x}" y="${y}" width="7" height="15" rx="2.5" fill="#0d0e10"/>`;
    const wx1 = x0 - 3, wx2 = x0 + W - 4;
    const fy = y0 + 10, ry = y0 + H - 27;
    let s = `<svg viewBox="0 0 64 110" class="car"><defs><linearGradient id="${g}" x1="0" x2="1"><stop offset="0" stop-color="${shade(L.main, -.18)}"/><stop offset=".3" stop-color="${L.main}"/><stop offset=".7" stop-color="${L.main}"/><stop offset="1" stop-color="${shade(L.main, -.22)}"/></linearGradient></defs>
      <ellipse cx="32" cy="${y0 + H / 2 + 4}" rx="${W / 2 + 6}" ry="${H / 2 + 6}" fill="rgba(0,0,0,.38)"/>
      ${wheel(wx1, fy)}${wheel(wx2, fy)}${wheel(wx1 - (model === 'gruppob' ? 1 : 0), ry)}${wheel(wx2 + (model === 'gruppob' ? 1 : 0), ry)}`;
    // carrozzeria
    if (model === 'gruppob') {
      s += `<path d="M${x0 + 6} ${y0} H${x0 + W - 6} Q${x0 + W} ${y0} ${x0 + W} ${y0 + 8} V${y0 + 54} Q${x0 + W + 3} ${y0 + 60} ${x0 + W + 3} ${y0 + 70} V${y0 + H - 6} Q${x0 + W + 3} ${y0 + H} ${x0 + W - 4} ${y0 + H} H${x0 + 4} Q${x0 - 3} ${y0 + H} ${x0 - 3} ${y0 + H - 6} V${y0 + 70} Q${x0 - 3} ${y0 + 60} ${x0} ${y0 + 54} V${y0 + 8} Q${x0} ${y0} ${x0 + 6} ${y0} Z" fill="url(#${g})" stroke="rgba(0,0,0,.55)" stroke-width="1"/>`;
    } else {
      const rx = model === 'classica' ? 14 : 10;
      s += `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="${rx}" fill="url(#${g})" stroke="rgba(0,0,0,.55)" stroke-width="1"/>`;
    }
    // strisce livrea
    s += `<rect x="${32 - 4}" y="${y0 + 1}" width="8" height="${H - 2}" fill="${L.acc}" opacity=".95"/>`;
    if (model !== 'classica') s += `<rect x="${32 - 7}" y="${y0 + 1}" width="2" height="${H - 2}" fill="${L.acc2}" opacity=".7"/><rect x="${32 + 5}" y="${y0 + 1}" width="2" height="${H - 2}" fill="${L.acc2}" opacity=".7"/>`;
    // vetri e tetto
    const wsY = y0 + (model === 'classica' ? 34 : model === 'gruppob' ? 26 : 28), roofH = model === 'gruppob' ? 22 : 24;
    s += `<path d="M${x0 + 5} ${wsY + 10} Q32 ${wsY - 3} ${x0 + W - 5} ${wsY + 10} L${x0 + W - 7} ${wsY + 12} H${x0 + 7} Z" fill="#1a2430"/>
      <path d="M${x0 + 10} ${wsY + 6} Q32 ${wsY + 1} ${x0 + W - 12} ${wsY + 5}" stroke="rgba(255,255,255,.35)" stroke-width="1.5" fill="none"/>
      <rect x="${x0 + 6}" y="${wsY + 12}" width="${W - 12}" height="${roofH}" rx="3" fill="${shade(L.main, .06)}"/>
      <rect x="${32 - 4}" y="${wsY + 12}" width="8" height="${roofH}" fill="${L.acc}"/>
      <path d="M${x0 + 7} ${wsY + 12 + roofH} H${x0 + W - 7} L${x0 + W - 9} ${wsY + 20 + roofH} H${x0 + 9} Z" fill="#1a2430"/>
      <rect x="${x0 - 2}" y="${wsY + 8}" width="4" height="3" rx="1" fill="${L.acc2}"/><rect x="${x0 + W - 2}" y="${wsY + 8}" width="4" height="3" rx="1" fill="${L.acc2}"/>`;
    // presa d'aria sul tetto (rally moderne)
    if (model !== 'classica') s += `<rect x="${32 - 3}" y="${wsY + 14}" width="6" height="5" rx="1" fill="#111"/>`;
    // numero di gara
    s += `<circle cx="32" cy="${wsY + 12 + roofH / 2 + 3}" r="5.5" fill="#fff"/><text x="32" y="${wsY + 12 + roofH / 2 + 5.8}" text-anchor="middle" font-family="Barlow Condensed,sans-serif" font-weight="800" font-size="8" fill="#111">1</text>`;
    // fari
    s += `<rect x="${x0 + 3}" y="${y0 + 1}" width="8" height="3" rx="1.5" fill="#fffbe0"/><rect x="${x0 + W - 11}" y="${y0 + 1}" width="8" height="3" rx="1.5" fill="#fffbe0"/>`;
    if (model === 'classica' || model === 'gruppob') {
      const py = y0 + 3;
      s += `<rect x="${x0 + 4}" y="${py}" width="${W - 8}" height="6" rx="3" fill="#111"/>` + [0, 1, 2, 3].map(i => `<circle cx="${x0 + 8 + i * (W - 16) / 3}" cy="${py + 3}" r="2.6" fill="#fffde8"/>`).join('');
    }
    // alettone
    if (model === 'rally2') s += `<rect x="${x0 - 3}" y="${y0 + H - 9}" width="${W + 6}" height="6" rx="2" fill="${L.acc2}"/><rect x="${x0 - 3}" y="${y0 + H - 11}" width="3" height="10" fill="${L.acc2}"/><rect x="${x0 + W}" y="${y0 + H - 11}" width="3" height="10" fill="${L.acc2}"/>`;
    if (model === 'gruppob') s += `<rect x="${x0 - 4}" y="${y0 + H - 10}" width="${W + 8}" height="7" rx="2" fill="${L.acc2}"/>` + [0, 1, 2, 3].map(i => `<rect x="${x0 + 9}" y="${y0 + 58 + i * 4}" width="${W - 18}" height="1.6" fill="rgba(0,0,0,.45)"/>`).join('');
    if (model === 'classica') s += `<rect x="${x0 + 3}" y="${y0 + H - 4}" width="${W - 6}" height="3" rx="1.5" fill="#cfd3d8"/>`;
    // fanali posteriori
    s += `<rect x="${x0 + 2}" y="${y0 + H - 3}" width="7" height="2.4" rx="1" fill="#e0141e"/><rect x="${x0 + W - 9}" y="${y0 + H - 3}" width="7" height="2.4" rx="1" fill="#e0141e"/>`;
    return s + '</svg>';
  }

  // ---------- vista da dietro (camera alle spalle, un po' dall'alto), viewBox 140x104 ----------
  function rear(model, livery) {
    const L = liv(livery), g = 'r' + (++uid), gw = 'w' + uid;
    if (model === 'freccia') {
      return `<svg viewBox="0 0 140 104" class="car"><ellipse cx="70" cy="90" rx="44" ry="10" fill="rgba(0,0,0,.4)"/>
        <path d="M70 16 L118 86 L70 70 L22 86 Z" fill="${L.main}" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
        <path d="M70 16 L70 70 L22 86 Z" fill="${shade(L.main, .15)}"/></svg>`;
    }
    const wide = model === 'gruppob' ? 8 : 0, cl = model === 'classica';
    let s = `<svg viewBox="0 0 140 104" class="car"><defs>
      <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.main, .12)}"/><stop offset=".55" stop-color="${L.main}"/><stop offset="1" stop-color="${shade(L.main, -.28)}"/></linearGradient>
      <linearGradient id="${gw}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4a5c"/><stop offset=".45" stop-color="#16202b"/><stop offset="1" stop-color="#0b1016"/></linearGradient></defs>
      <ellipse cx="70" cy="95" rx="${62 + wide}" ry="7" fill="rgba(0,0,0,.45)"/>`;
    // gomme
    s += `<rect x="${14 - wide}" y="68" width="22" height="28" rx="5" fill="#0d0e10"/><rect x="${104 + wide}" y="68" width="22" height="28" rx="5" fill="#0d0e10"/>
      <path d="M${17 - wide} 74h16M${17 - wide} 80h16M${17 - wide} 86h16M${107 + wide} 74h16M${107 + wide} 80h16M${107 + wide} 86h16" stroke="#26282d" stroke-width="2"/>`;
    // paraspruzzi
    if (!cl) s += `<rect x="${15 - wide}" y="84" width="20" height="16" rx="2" fill="${L.acc}"/><rect x="${105 + wide}" y="84" width="20" height="16" rx="2" fill="${L.acc}"/>
      <rect x="${18 - wide}" y="90" width="14" height="3" fill="${L.acc2}" opacity=".7"/><rect x="${108 + wide}" y="90" width="14" height="3" fill="${L.acc2}" opacity=".7"/>`;
    // parte bassa (paraurti) e portellone
    s += `<path d="M${18 - wide} 54 H${122 + wide} Q${128 + wide} 56 ${127 + wide} 66 L${125 + wide} 84 Q${124 + wide} 88 ${118 + wide} 88 H${22 - wide} Q${16 - wide} 88 ${15 - wide} 84 L${13 - wide} 66 Q${12 - wide} 56 ${18 - wide} 54 Z" fill="url(#${g})" stroke="rgba(0,0,0,.6)" stroke-width="1"/>`;
    s += cl
      ? `<path d="M30 26 H110 Q120 28 122 56 H18 Q20 28 30 26 Z" fill="url(#${g})" stroke="rgba(0,0,0,.6)" stroke-width="1"/>`
      : `<path d="M30 28 H110 L${120 + wide / 2} 56 H${20 - wide / 2} Z" fill="url(#${g})" stroke="rgba(0,0,0,.6)" stroke-width="1"/>`;
    // tetto visto un po' dall'alto
    s += `<path d="M42 16 H98 Q103 16 105 22 L108 29 H32 L35 22 Q37 16 42 16 Z" fill="${shade(L.main, .18)}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
    // lunotto
    s += `<path d="M38 30 H102 L108 48 H32 Z" fill="url(#${gw})"/><path d="M44 33 L58 33 L50 46 L38 46 Z" fill="rgba(255,255,255,.12)"/>`;
    if (model === 'gruppob') s += [0, 1, 2, 3, 4].map(i => `<rect x="34" y="${32 + i * 3.3}" width="72" height="1.4" fill="${shade(L.main, -.4)}"/>`).join('');
    // striscia centrale
    s += `<rect x="64" y="16" width="12" height="14" fill="${L.acc}"/><rect x="64" y="48" width="12" height="38" fill="${L.acc}"/>`;
    if (!cl) s += `<rect x="61" y="48" width="2" height="38" fill="${L.acc2}" opacity=".8"/><rect x="77" y="48" width="2" height="38" fill="${L.acc2}" opacity=".8"/>`;
    // fanali
    s += cl
      ? `<circle cx="30" cy="62" r="6" fill="#e0141e"/><circle cx="110" cy="62" r="6" fill="#e0141e"/><circle cx="30" cy="62" r="2.5" fill="#ff8a8a"/><circle cx="110" cy="62" r="2.5" fill="#ff8a8a"/>`
      : `<path d="M${20 - wide / 2} 56 H42 L40 64 H${19 - wide / 2} Z" fill="#e0141e"/><path d="M${120 + wide / 2} 56 H98 L100 64 H${121 + wide / 2} Z" fill="#e0141e"/>
         <rect x="${22 - wide / 2}" y="58" width="16" height="2" fill="#ff8a8a"/><rect x="${102 + wide / 2}" y="58" width="16" height="2" fill="#ff8a8a"/>`;
    // targa, estrattore, scarico
    s += `<rect x="56" y="64" width="28" height="9" rx="1.5" fill="#f4f4f0" stroke="#111" stroke-width=".8"/><rect x="60" y="67.5" width="20" height="2" fill="#333"/>`;
    s += cl ? `<rect x="16" y="76" width="108" height="5" rx="2.5" fill="#cfd3d8"/><circle cx="96" cy="86" r="3.5" fill="#55585e"/>`
      : `<path d="M38 80 H102 L98 88 H42 Z" fill="#17181b"/><path d="M48 80v8M58 80v8M68 80v8M78 80v8M88 80v8" stroke="#2a2c31" stroke-width="2"/><circle cx="92" cy="84" r="4.5" fill="#3b3e44"/><circle cx="92" cy="84" r="2.5" fill="#0d0e10"/>`;
    // alettone
    if (model === 'rally2') s += `<rect x="46" y="14" width="4" height="16" fill="#111"/><rect x="90" y="14" width="4" height="16" fill="#111"/>
      <path d="M14 8 H126 L124 16 H16 Z" fill="${L.acc2}" stroke="rgba(0,0,0,.6)"/><rect x="12" y="4" width="6" height="18" rx="1" fill="${L.acc2}"/><rect x="122" y="4" width="6" height="18" rx="1" fill="${L.acc2}"/>`;
    if (model === 'gruppob') s += `<rect x="44" y="18" width="4" height="14" fill="#111"/><rect x="92" y="18" width="4" height="14" fill="#111"/>
      <path d="M6 10 H134 L131 20 H9 Z" fill="${L.acc2}" stroke="rgba(0,0,0,.6)"/>`;
    if (cl) s += `<path d="M26 26 H114 L116 30 H24 Z" fill="${L.acc2}"/>`;
    return s + '</svg>';
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  root.Cars = { MODELS, LIVERIES, top, rear };
})(window);
