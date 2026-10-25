/*
 * Tabiji: walking the old post road. A Japanese village street seen from the roadside:
 * timber shopfronts with noren curtains, inns with lit paper screens, storehouses, a
 * teahouse under a red parasol, shrine gates, roadside pines and travellers on the road.
 * Closer than Yūgen: the street fills the frame and the mountains sit far behind it.
 *
 * Four ways of printing it (the "style" option):
 *   shinhanga  Kawase Hasui's new prints: soft graded colour, lamplight on wet roads
 *   hiroshige  ukiyo-e: flat colour, a prussian-blue sky, crisp keylines, slanting rain
 *   sumi       ink only, with red for lanterns, gates and umbrellas
 *   kirie      cut paper: every layer a silhouette, windows cut out and glowing
 */
(function () {
  'use strict';
  const { Engine, CW, TAU, clamp, lerp, sstep, hash2, hash4, RNG, vnoise, fbm, rgba, mixc,
    DL, brush, curve, blob, rect, interpY, Occ, mkCanvas, P } = window.Paperwall;

  const STYLES = {
    shinhanga: {
      mode: 'soft', paper: [240, 234, 220], sky: [[112, 150, 192], [232, 228, 214]], ink: [46, 38, 36], line: 0.55,
      wall: [238, 231, 214], wallSh: [190, 176, 152], wood: [104, 72, 48], woodDark: [56, 40, 32], roof: [84, 92, 106], tileLine: [140, 148, 160],
      thatch: [152, 126, 86], earth: [[206, 186, 148], [176, 154, 118]], stone: [172, 168, 158], pine: [50, 86, 66], pineDark: [30, 56, 46], trunk: [74, 54, 42],
      noren: [[40, 60, 108], [128, 44, 38], [64, 86, 66]], accent: [210, 76, 50], paperLamp: [246, 238, 216], umbrella: [[178, 50, 42], [42, 62, 110], [212, 168, 88]],
      cloth: [[44, 62, 108], [150, 62, 50], [96, 104, 84], [206, 196, 176]], mtn: [[136, 158, 190], [208, 212, 218]], hill: [[92, 120, 108], [168, 178, 168]], snow: [250, 250, 252],
    },
    hiroshige: {
      mode: 'flat', paper: [238, 228, 204], sky: [[40, 70, 122], [238, 230, 206]], ink: [28, 28, 38], line: 0.95,
      wall: [246, 238, 216], wallSh: [214, 196, 160], wood: [128, 86, 54], woodDark: [72, 50, 36], roof: [72, 82, 102], tileLine: [120, 130, 150],
      thatch: [184, 150, 96], earth: [[226, 200, 150], [204, 176, 124]], stone: [194, 184, 162], pine: [48, 106, 72], pineDark: [30, 72, 52], trunk: [96, 68, 48],
      noren: [[34, 62, 124], [186, 54, 40]], accent: [218, 76, 48], paperLamp: [248, 240, 214], umbrella: [[188, 54, 40], [34, 62, 124], [226, 176, 80]],
      cloth: [[34, 62, 124], [186, 54, 40], [232, 222, 196], [80, 110, 80]], mtn: [[96, 128, 170], [214, 214, 206]], hill: [[78, 126, 92], [178, 188, 150]], snow: [252, 252, 250],
    },
    sumi: {
      mode: 'ink', paper: [246, 243, 236], sky: [[250, 249, 245], [244, 241, 234]], ink: [28, 27, 30], line: 0.75,
      wall: [250, 248, 243], wallSh: [196, 192, 186], wood: [92, 88, 86], woodDark: [44, 42, 44], roof: [70, 70, 76], tileLine: [140, 140, 144],
      thatch: [150, 144, 132], earth: [[240, 237, 230], [226, 222, 214]], stone: [200, 198, 192], pine: [40, 42, 42], pineDark: [24, 24, 26], trunk: [44, 40, 38],
      noren: [[50, 50, 56], [196, 46, 38]], accent: [198, 44, 36], paperLamp: [250, 246, 238], umbrella: [[198, 44, 36], [60, 60, 66]],
      cloth: [[44, 44, 50], [120, 118, 116], [230, 228, 222]], mtn: [[176, 176, 178], [232, 230, 226]], hill: [[120, 120, 122], [212, 210, 206]], snow: [252, 252, 250],
    },
    kirie: {
      mode: 'cut', paper: [246, 226, 186], sky: null, ink: [18, 14, 22], line: 0,
      noren: [[18, 14, 22]], accent: [190, 48, 40], umbrella: [[18, 14, 22]], cloth: [[18, 14, 22]], snow: [250, 244, 236],
    },
  };

  // id, depth tone for cut paper (0 = sky, 1 = black)
  const LAYERS = [
    { id: 0, kind: 'mount',  par: 0.03, y0: 250, y1: 580,  base: 560, R: 2, ink: 0.35, lw: 0.6,  det: 0.3, haze: 0.72, tone: 0.24 },
    { id: 1, kind: 'hills',  par: 0.1,  y0: 360, y1: 650,  base: 632, R: 2, ink: 0.5,  lw: 0.7,  det: 0.5, haze: 0.5,  tone: 0.42 },
    { id: 2, kind: 'back',   par: 0.28, y0: 330, y1: 740,  base: 718, R: 2, ink: 0.75, lw: 0.85, det: 0.7, haze: 0.26, tone: 0.62 },
    { id: 3, kind: 'street', par: 0.5,  y0: 200, y1: 1000, base: 800, R: 2, ink: 0.95, lw: 1.1,  det: 1.0, haze: 0.05, tone: 0.84 },
    { id: 4, kind: 'road',   par: 0.72, y0: 120, y1: 1000, base: 900, R: 2, ink: 1.0,  lw: 1.2,  det: 1.0, haze: 0,    tone: 0.94 },
    { id: 5, kind: 'near',   par: 1.0,  y0: 0,   y1: 1000, base: 1000, R: 2, ink: 1.0, lw: 1.4,  det: 1.0, haze: 0,    tone: 1 },
  ];
  const ROAD = 800; // where the house fronts meet the road
  const MIST = [
    { after: 0, y: 470, h: 120, a: 0.9,  par: 0.05, drift: 2, dens: 1.0 },
    { after: 1, y: 560, h: 110, a: 0.85, par: 0.13, drift: 3, dens: 0.9 },
    { after: 2, y: 650, h: 90,  a: 0.45, par: 0.3,  drift: 4, dens: 0.6 },
  ];
  const TOD = [
    [0.0, [62, 70, 102], [80, 86, 112], 1],
    [4.6, [62, 70, 102], [80, 86, 112], 1],
    [5.6, [156, 136, 156], [196, 166, 166], 0.55],
    [6.4, [242, 206, 188], [252, 228, 206], 0.1],
    [7.6, [255, 249, 240], [255, 252, 246], 0],
    [16.6, [255, 251, 243], [255, 253, 248], 0],
    [18.0, [250, 214, 180], [253, 228, 204], 0.05],
    [19.0, [186, 150, 160], [206, 170, 166], 0.35],
    [20.2, [76, 80, 112], [94, 96, 120], 0.9],
    [21.0, [62, 70, 102], [80, 86, 112], 1],
    [24.0, [62, 70, 102], [80, 86, 112], 1],
  ];

  // ------------------------------------------------------------------ painting helpers
  function edge(dl, rng, st, pts, a, w) {
    if (!st.lineA) return;
    dl.poly(brush(pts, (w || 0.8) * st.lw, rng, { taper: 0, wob: st.mode === 'ink' ? 0.35 : 0.08 }), st.line(a));
  }
  function box(dl, rng, st, x, y, w, h, fill, a) {
    const p = rect(x, y, w, h);
    dl.poly(p, fill);
    if (a) edge(dl, rng, st, [x, y, x + w, y, x + w, y + h, x, y + h, x, y], a);
  }
  // A tiled roof seen from the front: a band of tiles, the eave line, the ridge with end tiles.
  function tiledRoof(dl, rng, st, x0, x1, eaveY, h, o) {
    o = o || {};
    const ov = o.ov != null ? o.ov : 10, inset = o.inset != null ? o.inset : h * 0.25;
    const p = [x0 - ov, eaveY + 2, x1 + ov, eaveY + 2, x1 + ov - inset, eaveY - h, x0 - ov + inset, eaveY - h];
    dl.poly(p, st.roof(1, eaveY - h, eaveY));
    if (st.det > 0.5 && st.mode !== 'cut') {
      const n = Math.round((x1 - x0 + 2 * ov) / 4);
      for (let k = 0; k <= n; k++) { const t = k / n; dl.poly(rect(lerp(x0 - ov + inset, x1 + ov - inset, t), eaveY - h, 0.6, h), st.tileLine(0.35)); }
    }
    edge(dl, rng, st, [x0 - ov, eaveY + 2, x1 + ov, eaveY + 2], 0.9, 1.4);
    // ridge with raised ends (onigawara)
    const ry = eaveY - h;
    dl.poly([x0 - ov + inset - 6, ry - 6, x0 - ov + inset - 2, ry - 1, x1 + ov - inset + 2, ry - 1, x1 + ov - inset + 6, ry - 6, x1 + ov - inset + 4, ry + 3, x0 - ov + inset - 4, ry + 3], st.roofDark(1));
    if (st.snowy) dl.poly([x0 - ov + 3, eaveY - 1, x1 + ov - 3, eaveY - 1, x1 + ov - inset, ry, x0 - ov + inset, ry], st.snow(0.95));
    return ry - 6;
  }
  function thatchRoof(dl, rng, st, x0, x1, eaveY, h) {
    const ov = 14, inset = (x1 - x0) * 0.22;
    const p = [x0 - ov, eaveY + 3, x1 + ov, eaveY + 3, x1 - inset, eaveY - h, x0 + inset, eaveY - h];
    dl.poly(p, st.thatch(1, eaveY - h, eaveY));
    if (st.mode !== 'cut') {
      const n = Math.round((x1 - x0) / 3);
      for (let k = 0; k <= n; k++) { const t = k / n; dl.poly(brush([lerp(x0 + inset, x1 - inset, t), eaveY - h, lerp(x0 - ov, x1 + ov, t), eaveY + 2], 0.4 * st.lw, rng, { taper: 0, wob: 0.3 }), st.line(rng.range(0.12, 0.3))); }
    }
    dl.poly(rect(x0 + inset - 6, eaveY - h - 8, x1 - x0 - 2 * inset + 12, 9), st.roofDark(1));
    edge(dl, rng, st, [x0 - ov, eaveY + 3, x1 + ov, eaveY + 3], 0.9, 1.6);
    if (st.snowy) dl.poly([x0 - ov + 4, eaveY, x1 + ov - 4, eaveY, x1 - inset, eaveY - h, x0 + inset, eaveY - h], st.snow(0.95));
    return eaveY - h - 8;
  }
  // a paper lantern (chōchin) hanging from an eave
  function chochin(dl, rng, st, x, y, s) {
    dl.poly(rect(x - 0.4, y - s * 0.9, 0.8, s * 0.5), st.line(0.8));
    dl.poly(blob(x, y, s * 0.34, s * 0.48, 0, 14, rng, 0.04), st.lamp(1));
    if (st.mode !== 'cut') { dl.poly(rect(x - s * 0.34, y - s * 0.06, s * 0.68, s * 0.14), st.accent(0.85)); for (let k = -2; k <= 2; k++) dl.poly(rect(x - s * 0.33, y + k * s * 0.17 - 0.3, s * 0.66, 0.6), st.line(0.25)); }
    dl.poly(rect(x - s * 0.2, y - s * 0.56, s * 0.4, s * 0.1), st.dark(1));
    dl.poly(rect(x - s * 0.2, y + s * 0.46, s * 0.4, s * 0.1), st.dark(1));
    dl.light(x, y, s * 2.4);
  }
  function noren(dl, rng, st, x, y, w, h) {
    const c = st.norenCol(rng), n = rng.int(2, 4), gw = w / n;
    for (let k = 0; k < n; k++) dl.poly([x + k * gw + 0.8, y, x + (k + 1) * gw - 0.8, y, x + (k + 1) * gw - 0.8 + rng.range(-1, 1), y + h, x + k * gw + 0.8 + rng.range(-1, 1), y + h], rgba(c, 0.96));
    if (st.mode !== 'cut') dl.poly(blob(x + w / 2, y + h * 0.45, Math.min(w * 0.12, 7), Math.min(w * 0.12, 7), 0, 10, rng, 0.05), st.wall(0.9)); // the house crest
  }
  // a hanging signboard with a few brushed "characters"
  function kanban(dl, rng, st, x, y, s) {
    box(dl, rng, st, x - s * 0.18, y, s * 0.36, s, st.woodDark(1), 0.8);
    if (st.mode === 'cut') return;
    for (let k = 0; k < 3; k++) { const cy = y + s * (0.18 + k * 0.28); dl.poly(brush([x - s * 0.08, cy, x + s * 0.06, cy + s * 0.04, x - s * 0.02, cy + s * 0.14], 1.1 * st.lw, rng), st.wall(0.85)); }
  }
  // wet road: lamplight runs down in long streaks
  function streak(dl, x, y, r, len) {
    for (let k = 0; k < 6; k++) dl.light(x + (k % 2 ? 0.8 : -0.8), y + (len * k) / 6, r * (1 - k * 0.12));
  }

  // ------------------------------------------------------------------ people
  function traveller(dl, rng, st, x, y, s, kind, dir) {
    const c1 = st.clothCol(rng), c2 = st.clothCol(rng);
    if (kind === 'kago') {
      // a palanquin slung from a pole between two bearers
      for (const bx of [x - s * 0.9, x + s * 0.9]) traveller(dl, rng, st, bx, y, s, 'bearer', dir);
      dl.poly(brush([x - s * 1.3, y - s * 0.86, x + s * 1.3, y - s * 0.86], 1.2 * st.lw, rng, { taper: 0 }), st.woodDark(1));
      dl.poly([x - s * 0.42, y - s * 0.86, x + s * 0.42, y - s * 0.86, x + s * 0.36, y - s * 0.28, x - s * 0.36, y - s * 0.28], rgba(c1, 1));
      dl.poly([x - s * 0.5, y - s * 0.86, x, y - s * 1.06, x + s * 0.5, y - s * 0.86], st.dark(1));
      return;
    }
    if (kind === 'horse') {
      // a packhorse led by its driver: rounded barrel, arched neck, legs a little apart
      const hx = x + dir * s * 0.5, by = y - s * 0.62, hc = st.horse(1);
      for (const [lx, sp] of [[-0.42, -0.05], [-0.3, 0.06], [0.3, -0.06], [0.44, 0.05]]) dl.poly(brush([hx + dir * lx * s, by + s * 0.05, hx + dir * (lx + sp) * s, y - s * 0.12, hx + dir * (lx + sp) * s, y], 0.11 * s * st.lw, rng, { prof: (q) => 1 - 0.5 * q, min: 0.4 }), hc);
      dl.poly(blob(hx, by, s * 0.55, s * 0.2, 0, 16, rng, 0.04), hc);
      dl.poly(brush([hx + dir * s * 0.42, by - s * 0.05, hx + dir * s * 0.62, by - s * 0.3, hx + dir * s * 0.74, by - s * 0.42], 0.16 * s * st.lw, rng, { prof: (q) => 1 - 0.4 * q, min: 0.5 }), hc);
      dl.poly(blob(hx + dir * s * 0.82, by - s * 0.36, s * 0.13, s * 0.06, dir * 0.6, 10, rng, 0.05), hc);
      dl.poly(brush([hx - dir * s * 0.54, by - s * 0.06, hx - dir * s * 0.66, by + s * 0.3], 0.07 * s * st.lw, rng, { prof: (q) => 1 - 0.6 * q }), hc);
      dl.poly(rect(hx - s * 0.3, by - s * 0.42, s * 0.6, s * 0.26), rgba(c1, 1)); // the pack
      dl.poly(rect(hx - s * 0.36, by - s * 0.2, s * 0.72, s * 0.06), rgba(c2, 1));
      edge(dl, rng, st, [hx - s * 0.3, by - s * 0.42, hx + s * 0.3, by - s * 0.42], 0.6, 0.6);
      traveller(dl, rng, st, x - dir * s * 0.35, y, s, 'walker', dir);
      return;
    }
    // a walker in a short robe and leggings, under a kasa hat or an umbrella
    const lean = dir * s * 0.04;
    dl.poly([x - s * 0.15 + lean, y - s * 0.74, x + s * 0.15 + lean, y - s * 0.74, x + s * 0.2, y - s * 0.3, x - s * 0.2, y - s * 0.3], rgba(c1, 1));
    dl.poly(brush([x - s * 0.08, y - s * 0.32, x - s * 0.12 - dir * s * 0.06, y], 2.0 * st.lw, rng, { taper: 0 }), rgba(c2, 1));
    dl.poly(brush([x + s * 0.08, y - s * 0.32, x + s * 0.12 + dir * s * 0.08, y], 2.0 * st.lw, rng, { taper: 0 }), rgba(c2, 1));
    dl.poly(blob(x + lean, y - s * 0.82, s * 0.08, s * 0.09, 0, 8, rng, 0.1), st.skin(1));
    edge(dl, rng, st, [x - s * 0.15 + lean, y - s * 0.74, x - s * 0.2, y - s * 0.3], 0.6, 0.6);
    if (kind === 'bearer') { dl.poly([x - s * 0.24, y - s * 0.86, x + s * 0.24, y - s * 0.86, x, y - s * 0.98], st.straw(1)); return; }
    if (st.wet || kind === 'umbrella') {
      const c = st.umbrellaCol(rng), ux = x + dir * s * 0.06;
      dl.poly(brush([ux, y - s * 0.55, ux, y - s * 1.2], 0.6 * st.lw, rng, { taper: 0 }), st.dark(1));
      dl.poly([ux - s * 0.5, y - s * 1.05, ux, y - s * 1.32, ux + s * 0.5, y - s * 1.05, ux, y - s * 1.12], rgba(c, 1));
      if (st.mode !== 'cut') for (const t of [-0.25, 0, 0.25]) dl.poly(brush([ux, y - s * 1.3, ux + t * s * 1.6, y - s * 1.08], 0.4 * st.lw, rng, { taper: 0 }), st.line(0.3));
      if (st.snowy) dl.poly([ux - s * 0.42, y - s * 1.1, ux, y - s * 1.33, ux + s * 0.42, y - s * 1.1], st.snow(0.95));
    } else {
      dl.poly([x - s * 0.3 + lean, y - s * 0.84, x + lean, y - s * 1.0, x + s * 0.3 + lean, y - s * 0.84], st.straw(1));
      edge(dl, rng, st, [x - s * 0.3 + lean, y - s * 0.84, x + lean, y - s * 1.0, x + s * 0.3 + lean, y - s * 0.84], 0.6, 0.6);
      if (rng() < 0.6) dl.poly(blob(x - dir * s * 0.18, y - s * 0.62, s * 0.12, s * 0.14, 0, 8, rng, 0.2), rgba(c2, 1)); // a bundle on the back
      dl.poly(brush([x + dir * s * 0.24, y - s * 0.7, x + dir * s * 0.34, y], 0.6 * st.lw, rng, { taper: 0 }), st.woodDark(1)); // staff
    }
  }

  // ------------------------------------------------------------------ trees
  function pinePad(dl, rng, st, cx, cy, w) {
    const h = w * rng.range(0.24, 0.34), pts = [], n = 14;
    for (let i = 0; i <= n; i++) { const t = i / n, a = Math.PI + t * Math.PI; pts.push(cx + Math.cos(a) * w * 0.5, cy + Math.sin(a) * h * (0.85 + 0.2 * Math.sin(t * 9 + cx))); }
    for (let i = n; i >= 0; i--) { const t = i / n; pts.push(cx + (t - 0.5) * w * 0.9, cy + h * 0.2 * Math.sin(t * Math.PI)); }
    dl.poly(pts, st.pine(1, cy - h, cy + h * 0.2));
    if (st.mode !== 'cut' && st.det > 0.6) {
      const m = Math.round(clamp(w * 0.35, 4, 18));
      for (let i = 0; i < m; i++) { const t = rng(), bx = cx + (t - 0.5) * w * 0.85, by = cy + h * 0.12; dl.poly(brush([bx, by - h * 0.2, bx + rng.range(-3, 3), by + h * rng.range(0.2, 0.45)], Math.max(0.4, w * 0.02) * st.lw, rng, { prof: (q) => 1 - q }), st.pineDark(0.7)); }
    }
    if (st.snowy) dl.poly(blob(cx, cy - h * 0.55, w * 0.42, h * 0.36, 0, 12, rng, 0.25), st.snow(0.95));
  }
  // a roadside pine of the Tōkaidō avenue: a tall, leaning trunk and flat pads
  function bigPine(dl, rng, st, x, y, H) {
    const lean = rng.range(0.1, 0.35) * H * (rng() < 0.5 ? -1 : 1), n = 16, s0 = (rng() * 1e6) | 0, p = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1); p.push(x + lean * Math.pow(t, 1.5) + H * 0.05 * vnoise(s0, t * 3) * t, y - H * t); }
    const tw = Math.max(5, H * 0.045) * st.lw;
    dl.poly(brush(p, tw, rng, { prof: (t) => 1 - 0.55 * t, wob: 0.12, min: 0.3 }), st.trunk(1));
    if (st.mode !== 'cut') for (let k = 0; k < Math.round(n * 2 * st.det); k++) { const i = Math.floor(rng() * (n - 2)), w = tw * (1 - 0.55 * i / n); dl.poly(blob(p[i * 2] + rng.range(-0.3, 0.3) * w, p[i * 2 + 1], w * 0.3, w * 0.1, rng.range(-0.3, 0.3), 6, rng, 0.4), st.line(rng.range(0.3, 0.6))); }
    const pads = [], nb = rng.int(3, 6), side0 = lean > 0 ? 1 : -1;
    for (let b = 0; b < nb; b++) {
      const t = 0.45 + (0.5 * b) / nb, i = Math.round(t * (n - 1)), bx = p[i * 2], by = p[i * 2 + 1], side = b % 2 ? -side0 : side0, len = H * rng.range(0.16, 0.32);
      const ex = bx + side * len, ey = by + rng.range(-0.1, 0.06) * len;
      dl.poly(brush(curve(bx, by, ex, ey, 6, side * 0.05, rng, 0.3), tw * 0.42, rng, { prof: (q) => 1 - 0.6 * q, min: 0.35 }), st.trunk(1));
      pads.push([ex, ey, len * rng.range(1.0, 1.4)]);
    }
    pads.push([p[(n - 1) * 2], p[(n - 1) * 2 + 1], H * rng.range(0.3, 0.42)]);
    pads.sort((a, b) => a[1] - b[1]);
    for (const q of pads) pinePad(dl, rng, st, q[0], q[1], q[2]);
  }
  function roundTree(dl, rng, st, x, y, r) {
    dl.poly(brush([x, y, x + rng.range(-3, 3), y - r * 0.9], Math.max(2, r * 0.12) * st.lw, rng, { taper: 0 }), st.trunk(1));
    const c = st.bloom ? st.bloom : null;
    for (let k = 0; k < 4; k++) dl.poly(blob(x + rng.range(-0.5, 0.5) * r, y - r * rng.range(0.9, 1.4), r * rng.range(0.45, 0.7), r * rng.range(0.35, 0.5), 0, 12, rng, 0.35), c ? rgba(c[k % c.length], 1) : st.pine(1, y - r * 2, y - r * 0.5));
    if (st.snowy) dl.poly(blob(x, y - r * 1.55, r * 0.55, r * 0.22, 0, 10, rng, 0.3), st.snow(0.95));
  }
  function sugi(dl, rng, st, x, y, s) {
    dl.poly([x - s * 0.17, y, x - s * 0.03, y - s * 0.95, x, y - s * 1.05, x + s * 0.03, y - s * 0.95, x + s * 0.17, y], st.pineDark(1));
    if (st.snowy) dl.poly([x - s * 0.05, y - s * 0.8, x, y - s * 1.0, x + s * 0.05, y - s * 0.8], st.snow(0.9));
  }

  // ------------------------------------------------------------------ buildings
  function machiya(dl, rng, st, x, w, base, h, kind) {
    const g = h * (kind === 'farm' ? 0.62 : 0.48), lit = [];
    const top = base - h;
    if (kind === 'farm') {
      // a low farmhouse under a deep thatched roof, sliding doors along the front
      box(dl, rng, st, x, base - g, w, g, st.wall(1, base - g, base), 0.7);
      const nd = Math.max(2, Math.round(w / 44)), dw = (w - 12) / nd, open = rng.int(0, nd - 1);
      for (let k = 0; k < nd; k++) {
        const dx = x + 6 + k * dw, dy = base - g * 0.8, dh = g * 0.78;
        if (k === open) { box(dl, rng, st, dx + 1, dy, dw - 2, dh, st.dark(0.9), 0.4); continue; }
        box(dl, rng, st, dx + 1, dy, dw - 2, dh, st.shoji(1), 0.5);
        if (st.mode !== 'cut') { for (let c = 1; c < 3; c++) dl.poly(rect(dx + 1 + ((dw - 2) * c) / 3, dy, 0.8, dh), st.wood(0.8, dy, dy + dh)); for (let r = 1; r < 5; r++) dl.poly(rect(dx + 1, dy + (dh * r) / 5, dw - 2, 0.8), st.wood(0.8, dy, dy + dh)); dl.poly(rect(dx + 1, dy + dh * 0.72, dw - 2, dh * 0.28), st.wood(1, dy, dy + dh)); }
        lit.push([dx + dw / 2, dy + dh * 0.4]);
      }
      const ry = thatchRoof(dl, rng, st, x, x + w, base - g, h - g + 20);
      return { lit, top: ry };
    }
    if (kind === 'kura') {
      // a white storehouse: thick plaster, a black-and-white tiled skirt, one heavy shutter
      const wh = h * 0.86;
      box(dl, rng, st, x, base - wh, w, wh, st.wall(1, base - wh, base), 0.8);
      const sk = wh * 0.3;
      dl.poly(rect(x, base - sk, w, sk), st.dark(0.85));
      if (st.mode !== 'cut') { for (let d = -sk; d < w; d += 9) { dl.poly(brush([x + Math.max(0, d), base - sk + Math.max(0, -d), x + Math.min(w, d + sk), base - Math.max(0, d + sk - w)], 0.8 * st.lw, rng, { taper: 0 }), st.wall(0.7)); dl.poly(brush([x + Math.max(0, d), base - Math.max(0, -d), x + Math.min(w, d + sk), base - sk + Math.max(0, d + sk - w)], 0.8 * st.lw, rng, { taper: 0 }), st.wall(0.7)); } }
      const ww = Math.min(26, w * 0.3);
      box(dl, rng, st, x + w / 2 - ww / 2, base - wh * 0.78, ww, ww * 0.9, st.dark(0.9), 0.8);
      const ry = tiledRoof(dl, rng, st, x, x + w, base - wh, h - wh + 18, { ov: 12, inset: 4 });
      return { lit, top: ry };
    }
    // shop or inn: timber lattice below, a pent roof, plaster or open screens above
    box(dl, rng, st, x, base - g, w, g, st.wood(1, base - g, base), 0.8);
    const doorW = Math.min(w * 0.36, 44), dx = x + rng.range(0.12, 0.88) * (w - doorW);
    // lattice (koshi)
    if (st.mode !== 'cut') for (let lx = x + 3; lx < x + w - 2; lx += 3.2) if (lx < dx - 1 || lx > dx + doorW + 1) dl.poly(rect(lx, base - g + 6, 0.9, g - 8), st.woodDark(0.7));
    else for (let lx = x + 5; lx < x + w - 4; lx += 7) if (lx < dx - 2 || lx > dx + doorW + 2) dl.poly(rect(lx, base - g * 0.75, 2.4, g * 0.45), st.shoji(1));
    dl.poly(rect(dx, base - g + 4, doorW, g - 4), st.dark(0.95));
    noren(dl, rng, st, dx - 2, base - g + 3, doorW + 4, g * 0.42);
    lit.push([dx + doorW / 2, base - g * 0.35]);
    // pent roof between the storeys
    const pr = base - g;
    tiledRoof(dl, rng, st, x, x + w, pr, 18, { ov: 12, inset: 3 });
    if (rng() < 0.6) chochin(dl, rng, st, dx + (rng() < 0.5 ? -8 : doorW + 8), pr + 18, rng.range(12, 16));
    if (rng() < 0.45) kanban(dl, rng, st, x + (rng() < 0.5 ? 10 : w - 10), pr + 6, rng.range(28, 40));
    // upper storey
    const uh = h - g - 40, uy = pr - 18 - uh;
    if (kind === 'inn') {
      box(dl, rng, st, x + 4, uy, w - 8, uh, st.shoji(1), 0.8);
      const np = Math.max(2, Math.round(w / 20));
      for (let k = 1; k < np; k++) dl.poly(rect(x + 4 + ((w - 8) * k) / np - 0.6, uy, 1.2, uh), st.wood(1, uy, uy + uh));
      if (st.mode !== 'cut') for (let k = 1; k < 3; k++) dl.poly(rect(x + 4, uy + (uh * k) / 3, w - 8, 0.5), st.wood(0.6, uy, uy + uh));
      dl.poly(rect(x, uy + uh - 9, w, 9), st.wood(1, uy, uy + uh)); // balcony rail
      for (let k = 0; k < Math.round(w / 8); k++) dl.poly(rect(x + 2 + k * 8, uy + uh - 9, 1.4, 9), st.woodDark(0.9));
      for (let k = 0; k < np; k += 2) lit.push([x + 4 + ((w - 8) * (k + 0.5)) / np, uy + uh * 0.45]);
      if (rng() < 0.5) traveller(dl, rng, st, x + w * rng.range(0.25, 0.75), uy + uh - 9, 26, 'bearer', 1); // a guest leaning on the rail
    } else {
      box(dl, rng, st, x + 3, uy, w - 6, uh, st.wall(1, uy, uy + uh), 0.7);
      // slatted mushiko windows
      const nw = rng.int(1, w > 120 ? 3 : 2), ww = Math.min(40, (w - 20) / nw - 8);
      for (let k = 0; k < nw; k++) {
        const wx = x + ((k + 0.5) * w) / nw - ww / 2, wy = uy + uh * 0.28, wh = uh * 0.42;
        dl.poly(rect(wx, wy, ww, wh), st.dark(0.85));
        if (st.mode !== 'cut') for (let s = wx + 2; s < wx + ww - 1; s += 4) dl.poly(rect(s, wy, 2, wh), st.wall(0.9));
        else for (let s = wx + 2; s < wx + ww - 1; s += 5) dl.poly(rect(s, wy + 2, 1.6, wh - 4), st.shoji(1));
        lit.push([wx + ww / 2, wy + wh / 2]);
      }
      if (st.mode === 'soft' || st.mode === 'flat') dl.poly(rect(x + 3, uy, w - 6, uh), [0, uy, 0, uy + uh, 0, st.wallShC(0.28), 1, st.wallShC(0)]);
    }
    // udatsu: small fire walls at the ends of the upper storey
    for (const ex of [x - 4, x + w - 6]) if (rng() < 0.55) { dl.poly(rect(ex, uy - 6, 10, uh + 10), st.wall(1, uy, uy + uh)); dl.poly([ex - 3, uy - 4, ex + 13, uy - 4, ex + 10, uy - 12, ex, uy - 12], st.roofDark(1)); }
    const ry = rng() < 0.85 ? tiledRoof(dl, rng, st, x, x + w, uy, rng.range(30, 44), { ov: 14 }) : thatchRoof(dl, rng, st, x, x + w, uy, rng.range(40, 56));
    return { lit, top: ry };
  }
  function torii(dl, rng, st, x, y, s) {
    const w = s * 1.25, col = st.vermilion(1), pw = s * 0.08;
    for (const px of [x - w * 0.36, x + w * 0.36]) dl.poly([px - pw / 2 - s * 0.02, y, px - pw / 2, y - s * 1.05, px + pw / 2, y - s * 1.05, px + pw / 2 + s * 0.02, y], col);
    dl.poly(rect(x - w * 0.5, y - s * 0.82, w, s * 0.07), col);
    dl.poly([x - w * 0.66, y - s * 1.08, x - w * 0.3, y - s * 1.02, x + w * 0.3, y - s * 1.02, x + w * 0.66, y - s * 1.08, x + w * 0.62, y - s * 1.2, x, y - s * 1.12, x - w * 0.62, y - s * 1.2], col);
    dl.poly([x - w * 0.64, y - s * 1.16, x, y - s * 1.1, x + w * 0.64, y - s * 1.16, x + w * 0.66, y - s * 1.22, x, y - s * 1.16, x - w * 0.66, y - s * 1.22], st.dark(1));
    dl.poly(rect(x - s * 0.06, y - s * 1.02, s * 0.12, s * 0.2), st.dark(0.9));
    if (st.snowy) dl.poly([x - w * 0.64, y - s * 1.2, x + w * 0.64, y - s * 1.2, x + w * 0.6, y - s * 1.25, x - w * 0.6, y - s * 1.25], st.snow(0.95));
  }
  function stoneLantern(dl, rng, st, x, y, s) {
    const c = st.stoneC(1);
    dl.poly(rect(x - s * 0.22, y - s * 0.12, s * 0.44, s * 0.12), c);
    dl.poly(rect(x - s * 0.07, y - s * 0.55, s * 0.14, s * 0.43), c);
    dl.poly(rect(x - s * 0.18, y - s * 0.62, s * 0.36, s * 0.08), c);
    dl.poly(rect(x - s * 0.15, y - s * 0.85, s * 0.3, s * 0.23), c);
    dl.poly(rect(x - s * 0.07, y - s * 0.8, s * 0.14, s * 0.13), st.mode === 'cut' ? st.shoji(1) : st.dark(0.6));
    dl.poly([x - s * 0.32, y - s * 0.84, x + s * 0.32, y - s * 0.84, x, y - s * 1.06], c);
    edge(dl, rng, st, [x - s * 0.32, y - s * 0.84, x, y - s * 1.06, x + s * 0.32, y - s * 0.84], 0.7, 0.7);
    if (st.snowy) dl.poly([x - s * 0.3, y - s * 0.86, x, y - s * 1.08, x + s * 0.3, y - s * 0.86], st.snow(0.95));
    dl.light(x, y - s * 0.73, s * 0.7);
  }

  // ------------------------------------------------------------------ builders
  function ridge(rng, x, base, hw, h, sharp, bumps) {
    const sd = (rng() * 1e6) | 0, N = 60, xs = [], ys = [], sil = [];
    const B = [{ c: rng.range(-0.3, 0.3), h: 1, s: rng.range(0.3, 0.55) }];
    for (let i = 1; i < bumps; i++) B.push({ c: rng.range(-0.8, 0.8), h: rng.range(0.35, 0.8), s: rng.range(0.12, 0.3) });
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      let r = 0;
      for (const b of B) { const v = b.h * Math.exp(-Math.pow(Math.abs(u - b.c) / b.s, sharp)); if (v > r) r = v; }
      r = r * (1 + 0.18 * fbm(sd, u * 5, 3)) * Math.pow(clamp(1 - u * u, 0, 1), 0.3);
      xs.push(x + u * hw); ys.push(base - h * r); sil.push(xs[i], ys[i]);
    }
    sil.push(x + hw, base + 40, x - hw, base + 40);
    return { xs, ys, N, sil };
  }
  const B = {
    mount(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      if (p.fuji) {
        const N = 60, sil = [], xs = [], ys = [];
        for (let i = 0; i <= N; i++) { const u = -1 + (2 * i) / N, a = Math.abs(u), r = a < 0.08 ? 1 : Math.pow(1 - (a - 0.08) / 0.92, 1.7); xs.push(f.x + u * p.hw); ys.push(L.base - p.h * r); sil.push(xs[i], ys[i]); }
        sil.push(f.x + p.hw, L.base + 40, f.x - p.hw, L.base + 40);
        dl.poly(sil, st.mtn(L.base - p.h, L.base));
        if (st.mode !== 'cut') {
          const cap = [];
          for (let i = 0; i <= N; i++) cap.push(xs[i], ys[i] - 0.5);
          for (let i = N; i >= 0; i--) { const u = -1 + (2 * i) / N; cap.push(xs[i], Math.min(L.base, ys[i] + p.h * 0.32 * (0.6 + 0.4 * Math.abs(vnoise(p.hw | 0, u * 18))) * (1 - 0.6 * Math.abs(u)))); }
          dl.beginClip(sil); dl.poly(cap, st.snow(0.95)); dl.endClip();
        }
        return dl;
      }
      const m = ridge(rng, f.x, L.base, p.hw, p.h, rng.range(1.4, 2.2), 3);
      dl.poly(m.sil, st.mtn(L.base - p.h, L.base));
      edge(dl, rng, st, m.sil.slice(0, (m.N + 1) * 2), 0.2, 0.7);
      return dl;
    },
    hills(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      const m = ridge(rng, f.x, L.base, p.hw, p.h, 2.2, 3);
      dl.poly(m.sil, st.hill(L.base - p.h, L.base));
      edge(dl, rng, st, m.sil.slice(0, (m.N + 1) * 2), 0.35, 0.8);
      for (let i = 2; i < m.N - 1; i++) if (rng() < 0.45 && (L.base - m.ys[i]) / p.h > 0.25) for (let k = 0; k < 3; k++) sugi(dl, rng, st, m.xs[i] + rng.range(-6, 6), m.ys[i] + rng.range(4, 16), rng.range(10, 18));
      if (p.pagoda) {
        const i = m.ys.indexOf(Math.min.apply(null, m.ys)), x = m.xs[i], y = m.ys[i] + 8;
        let yy = y, w = 14;
        for (let t = 0; t < 5; t++) { dl.poly(rect(x - w / 2, yy - 7, w, 7), st.wall(1, yy - 7, yy)); dl.poly([x - w / 2 - 7, yy - 6, x + w / 2 + 7, yy - 6, x + w * 0.3, yy - 12, x - w * 0.3, yy - 12], st.roofDark(1)); yy -= 11; w *= 0.88; }
        dl.poly(rect(x - 0.6, yy - 12, 1.2, 14), st.dark(1));
      }
      return dl;
    },
    // rooftops behind the street, with trees and now and then a fire tower or temple hall
    back(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base;
      for (const t of p.trees) if (t.sugi) for (let k = 0; k < 4; k++) sugi(dl, rng, st, t.x + rng.range(-14, 14), base - 10 - rng.range(0, 20), t.r * rng.range(1.4, 2.0)); else roundTree(dl, rng, st, t.x, base - 10, t.r);
      if (p.temple) {
        const tx = p.temple, w = 140;
        box(dl, rng, st, tx - w / 2, base - 70, w, 70, st.wood(1, base - 70, base), 0.6);
        tiledRoof(dl, rng, st, tx - w / 2, tx + w / 2, base - 70, 70, { ov: 26, inset: 30 });
      }
      if (p.tower) {
        // hinomi-yagura: the fire-watch ladder tower with its bell
        const tx = p.tower, ty = base - 10, H = 190;
        for (const s of [-1, 1]) dl.poly(brush([tx + s * 14, ty, tx + s * 7, ty - H], 1.4 * st.lw, rng, { taper: 0 }), st.woodDark(1));
        for (let k = 1; k < 9; k++) { const yy = ty - (H * k) / 9, hw = lerp(14, 7, k / 9); dl.poly(rect(tx - hw, yy, hw * 2, 1.2), st.woodDark(0.9)); }
        dl.poly([tx - 16, ty - H, tx + 16, ty - H, tx, ty - H - 18], st.roofDark(1));
        dl.poly(blob(tx, ty - H + 8, 4, 5, 0, 8, rng, 0.1), st.dark(1));
      }
      for (const r of p.roofs) {
        if (r.thatch) thatchRoof(dl, rng, st, r.x, r.x + r.w, base - r.h, r.rh);
        else { dl.poly(rect(r.x, base - r.h, r.w, r.h), st.wall(1, base - r.h, base)); tiledRoof(dl, rng, st, r.x, r.x + r.w, base - r.h, r.rh, { ov: 10 }); }
      }
      return dl;
    },
    // the road surface, packed earth; on a wet day the houses and lamps show in it
    road(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), x0 = f.p.x0;
      dl.poly(rect(x0 - 1, ROAD - 2, CW + 2, 1004 - ROAD), st.earth(ROAD, 1000));
      if (st.mode !== 'cut') {
        // wheel ruts and footpaths, seeded in world x so they run on across chunks
        for (let r = 0; r < 5; r++) {
          const rs = hash2(f.p.ws, r), yr = lerp(ROAD + 30, 990, (r + 0.5) / 5), pts = [];
          for (let i = 0; i <= 50; i++) { const px = x0 - 2 + i * 8.1; pts.push(px, yr + 3 * vnoise(rs, px / 90)); }
          const hw = (px) => 0.9 * st.lw * sstep(0, 0.4, vnoise(rs + 5, px / 140));
          const pr = new Float32Array(pts.length * 2), n = pts.length >> 1;
          for (let i = 0; i < n; i++) { const w = hw(pts[i * 2]); pr[i * 2] = pts[i * 2]; pr[i * 2 + 1] = pts[i * 2 + 1] - w; const j = (2 * n - 1 - i) * 2; pr[j] = pts[i * 2]; pr[j + 1] = pts[i * 2 + 1] + w; }
          dl.poly(pr, st.line(st.wet ? 0.12 : 0.18));
        }
        if (st.wet) for (let k = 0; k < 4; k++) { const px = x0 + rng() * CW, py = rng.range(ROAD + 40, 980); dl.poly(blob(px, py, rng.range(20, 60), rng.range(3, 7), 0, 12, rng, 0.3), st.puddle(0.6)); }
      }
      return dl;
    },
    house(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      const r = machiya(dl, rng, st, p.x, p.w, ROAD - p.back, p.h, p.kind);
      for (const q of r.lit) dl.light(q[0], q[1], 26);
      if (st.wet) {
        // the house glimmers in the wet road, and so does its lamplight
        const y0 = ROAD + 2;
        for (let y = y0, j = 0; y < y0 + p.h * 0.5; y += 6, j++) { if (rng() < 0.25) continue; const t = (y - y0) / (p.h * 0.5); dl.poly(rect(p.x + rng.range(-2, 2), y, p.w, 3.5), st.reflect(0.3 * (1 - t))); }
        for (const q of r.lit.slice(0, 2)) streak(dl, q[0], ROAD + 8 + (ROAD - q[1]) * 0.15, 11, 40);
      }
      if (st.snowy && st.mode !== 'cut') dl.poly(rect(p.x - 6, ROAD - p.back - 3, p.w + 12, 5), st.snow(0.9));
      return dl;
    },
    shrine(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, s = p.s;
      // a gap in the row: stone steps going back, a pair of lanterns and the gate
      dl.poly([f.x - s * 0.5, ROAD, f.x + s * 0.5, ROAD, f.x + s * 0.3, ROAD - 60, f.x - s * 0.3, ROAD - 60], st.stoneC(1));
      if (st.mode !== 'cut') for (let k = 1; k < 8; k++) { const y = ROAD - k * 7.5, hw = lerp(s * 0.5, s * 0.3, k / 8); dl.poly(rect(f.x - hw, y, hw * 2, 0.8), st.line(0.4)); }
      stoneLantern(dl, rng, st, f.x - s * 0.95, ROAD + 2, s * 0.62);
      stoneLantern(dl, rng, st, f.x + s * 0.95, ROAD + 2, s * 0.62);
      torii(dl, rng, st, f.x, ROAD + 2, s * 1.25);
      return dl;
    },
    // a roadside teahouse: an open stall, a bench draped in red and a tall red parasol
    chaya(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), x = f.x, w = f.p.w;
      for (const px of [x - w / 2, x + w / 2]) dl.poly(rect(px - 2, ROAD - 110, 4, 110), st.woodDark(1));
      dl.poly(rect(x - w / 2, ROAD - 110, w, 70), st.dark(0.55));
      thatchRoof(dl, rng, st, x - w / 2, x + w / 2, ROAD - 110, 40);
      if (rng() < 0.8) { for (let k = 0; k < 3; k++) chochin(dl, rng, st, x - w * 0.3 + k * w * 0.3, ROAD - 92, 11); }
      const bx = x + rng.range(-0.25, 0.1) * w;
      dl.poly(rect(bx - 40, ROAD - 26, 80, 8), st.vermilion(1));
      for (const lx of [bx - 34, bx + 34]) dl.poly(rect(lx - 1.5, ROAD - 18, 3, 18), st.woodDark(1));
      traveller(dl, rng, st, bx - 14, ROAD - 18, 40, 'bearer', 1);
      // the parasol
      const px = x + w * 0.42, py = ROAD - 150;
      dl.poly(brush([px, ROAD, px - 4, py], 1.4 * st.lw, rng, { taper: 0 }), st.woodDark(1));
      dl.poly([px - 70, py + 26, px - 4, py - 8, px + 62, py + 26, px - 4, py + 16], st.vermilion(1));
      if (st.mode !== 'cut') for (const t of [-0.6, -0.3, 0, 0.3, 0.6]) dl.poly(brush([px - 4, py - 6, px - 4 + t * 66, py + 22], 0.5 * st.lw, rng, { taper: 0 }), st.line(0.35));
      if (st.snowy) dl.poly([px - 64, py + 22, px - 4, py - 10, px + 56, py + 22, px - 4, py + 8], st.snow(0.95));
      return dl;
    },
    pine(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed);
      bigPine(dl, rng, st, f.x, f.p.y, f.p.H);
      if (st.mode !== 'cut') dl.poly(blob(f.x, f.p.y + 2, f.p.H * 0.08, 4, 0, 10, rng, 0.3), st.line(0.2));
      return dl;
    },
    people(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      for (const t of p.list) traveller(dl, rng, st, t.x, t.y, t.s, t.kind, p.dir);
      return dl;
    },
    marker(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), y = f.p.y;
      box(dl, rng, st, f.x - 7, y - 64, 14, 64, st.stoneC(1), 0.7);
      dl.poly([f.x - 7, y - 64, f.x, y - 70, f.x + 7, y - 64], st.stoneC(1));
      if (st.mode !== 'cut') for (let k = 0; k < 3; k++) dl.poly(brush([f.x - 2, y - 56 + k * 14, f.x + 2, y - 50 + k * 14], 1.2 * st.lw, rng), st.line(0.6));
      return dl;
    },
    // foreground: a great pine trunk close to the eye, or grass along the near verge
    near(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      if (p.trunk) {
        const H = 1150, x = f.x, lean = rng.range(-60, 60), n = 14, s0 = (rng() * 1e6) | 0, pts = [];
        for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push(x + lean * t + 30 * vnoise(s0, t * 2), 1040 - H * t); }
        dl.poly(brush(pts, 46 * st.lw, rng, { prof: (t) => 1 - 0.3 * t, wob: 0.05, min: 0.5 }), st.trunk(1));
        if (st.mode !== 'cut') for (let k = 0; k < 60; k++) { const i = Math.floor(rng() * (n - 1)), t = i / (n - 1); dl.poly(blob(pts[i * 2] + rng.range(-16, 16), pts[i * 2 + 1] + rng.range(-30, 30), rng.range(6, 16), rng.range(2, 5), rng.range(-0.3, 0.3), 7, rng, 0.4), st.line(rng.range(0.25, 0.55))); }
        const by = rng.range(60, 200), side = rng() < 0.5 ? -1 : 1;
        dl.poly(brush(curve(x, by + 40, x + side * 300, by - 20, 8, 0.1 * side, rng, 0.2), 14 * st.lw, rng, { prof: (q) => 1 - 0.7 * q, min: 0.3 }), st.trunk(1));
        pinePad(dl, rng, st, x + side * 300, by - 30, 260);
        pinePad(dl, rng, st, x + side * 170, by + 10, 180);
        return dl;
      }
      // grass along the near verge
      const n = Math.round(p.n * st.det);
      for (let k = 0; k < n; k++) {
        const gx = f.x + rng.range(-p.hw, p.hw), gy = 1000 + rng.range(0, 10), gh = rng.range(20, 70), bend = rng.range(-0.4, 0.4);
        dl.poly(brush(curve(gx, gy, gx + gh * bend, gy - gh, 6, bend * 0.2, rng, 0.1), rng.range(1.4, 2.6) * st.lw, rng, { prof: (q) => 1 - q, min: 0.05 }), st.grass(rng.range(0.6, 0.95)));
      }
      return dl;
    },
  };

  // ------------------------------------------------------------------ engine
  class TabijiEngine extends Engine {
    get S() { return STYLES[this.o.style] || STYLES.shinhanga; }
    _gen(L, ci) {
      const seed = this.o.seed, rng = RNG(hash4(seed, L.id, ci, 23)), x0 = ci * CW, out = [];
      const m = this.macro(L.id, x0 + CW * 0.5), add = this._adder(L, ci, out);
      if (L.kind === 'mount') {
        const fujiAt = (c) => hash2(seed, c * 7 + 5) % 9 === 0;
        let fuji = fujiAt(ci);
        for (let j = 1; j <= 4 && fuji; j++) if (fujiAt(ci - j)) fuji = false;
        if (fuji) { const hw = rng.range(320, 420); add('mount', x0 + CW / 2, 2, hw + 10, { fuji: true, hw, h: hw * rng.range(0.5, 0.58) }); }
        if (rng() < 0.8) { const hw = rng.range(260, 460); add('mount', x0 + rng() * CW, rng(), hw + 10, { hw, h: rng.range(70, 170) }); }
      } else if (L.kind === 'hills') {
        const n = 1 + (rng() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) { const hw = rng.range(200, 380); add('hills', x0 + rng() * CW, rng(), hw + 20, { hw, h: rng.range(60, 170) * (0.7 + 0.6 * m), pagoda: rng() < P(0.12, 'towers') }); }
      } else if (L.kind === 'back') {
        const roofs = [], trees = [];
        for (let x = x0 + rng.range(-40, 0); x < x0 + CW;) { const w = rng.range(60, 140); roofs.push({ x, w, h: rng.range(14, 50), rh: rng.range(24, 44), thatch: rng() < 0.3 }); x += w * rng.range(0.8, 1.15); }
        for (let k = 0, nt = rng.int(1, 4); k < nt; k++) trees.push({ x: x0 + rng() * CW, r: rng.range(26, 50), sugi: rng() < 0.45 });
        add('back', x0 + CW / 2, 0, CW / 2 + 140, { roofs, trees, temple: rng() < P(0.15, 'towers') ? x0 + rng() * CW : 0, tower: rng() < 0.1 ? x0 + rng() * CW : 0 });
      } else if (L.kind === 'street') {
        add('road', x0 + CW / 2, -10, CW / 2 + 4, { x0, ws: hash2(seed, 7700) });
        // the row of houses, broken now and then by a shrine gate or a teahouse
        const special = rng();
        const occ = new Occ();
        const shrineAt = (c) => hash2(seed, c * 13 + 3) / 4294967296 < P(0.1, 'towers');
        if (shrineAt(ci) && !shrineAt(ci - 1)) { const s = rng.range(150, 190), sx = x0 + rng.range(0.3, 0.7) * CW; occ.add(sx - s * 0.9, sx + s * 0.9); add('shrine', sx, 5, s * 1.2, { s }); }
        else if (special < 0.16) { const w = rng.range(140, 190), sx = x0 + rng.range(0.3, 0.7) * CW; occ.add(sx - w * 0.5 - 30, sx + w * 0.5 + 60); add('chaya', sx, 5, w + 80, { w }); }
        let x = x0 + rng.range(-30, 0);
        while (x < x0 + CW) {
          let w = rng.range(130, 230);
          const r = rng(), kind = r < 0.42 ? 'shop' : r < 0.66 ? 'inn' : r < 0.84 ? 'farm' : 'kura';
          if (kind === 'kura') w = Math.min(w, 150);
          if (!occ.free(x, x + w)) { x += 24; continue; }
          const back = rng() < 0.3 ? rng.range(4, 10) : 0, h = (kind === 'farm' ? rng.range(210, 280) : rng.range(290, 380)) * (0.9 + 0.2 * m);
          add('house', x + w / 2, back ? 2 + rng() * 0.3 : 3 + rng() * 0.5, w / 2 + 30, { x, w, h, kind, back });
          x += w * rng.range(0.92, 1.02);
        }
      } else if (L.kind === 'road') {
        if (rng() < P(0.3, 'trees')) add('pine', x0 + rng() * CW, 2, 260, { y: ROAD + rng.range(14, 30), H: rng.range(520, 700) });
        if (rng() < 0.14) add('marker', x0 + rng() * CW, 3, 20, { y: ROAD + rng.range(20, 40) });
        if (rng() < P(0.6, 'villages')) {
          const dir = rng() < 0.5 ? 1 : -1, list = [], gx = x0 + rng() * CW, n = rng.int(1, 3);
          for (let k = 0; k < n; k++) {
            const y = rng.range(ROAD + 70, 975), s = 60 + (y - ROAD) * 0.35, r = rng();
            list.push({ x: gx + k * rng.range(40, 90) * -dir, y, s, kind: r < 0.12 ? 'kago' : r < 0.24 ? 'horse' : r < 0.45 ? 'umbrella' : 'walker' });
          }
          list.sort((a, b) => a.y - b.y);
          add('people', gx, 5, 320, { list, dir });
        }
      } else {
        const r = rng();
        if (r < P(0.07, 'trees')) add('near', x0 + rng() * CW, 1, 520, { trunk: true });
        else if (r < 0.4) add('near', x0 + rng() * CW, 0, 200, { hw: rng.range(80, 160), n: rng.int(20, 40) });
      }
      return out;
    }
    _applyDerived(force) {
      super._applyDerived(force);
      if ((this.weather === 'rain') !== this._wetSt) this.flushScene();
    }
    _style(L) {
      const S = this.S, a = L.ink, season = this.season, snowy = season === 'winter', wet = this.weather === 'rain';
      this._wetSt = wet;
      if (S.mode === 'cut') return this._cutStyle(L, S, snowy, wet);
      const air = mixc(S.sky[1], S.paper, 0.5);
      const hz = (c, k) => mixc(c, air, clamp(L.haze * (k == null ? 1 : k), 0, 1));
      const grad = (c, k) => (x, y0, y1) => (S.mode === 'soft' && y0 != null ? [0, y0, 0, y1, 0, rgba(hz(mixc(c, [255, 255, 255], 0.12), k), x), 1, rgba(hz(mixc(c, [0, 0, 0], 0.1), k), x)] : rgba(hz(c, k), x));
      const earth = S.earth.map((c) => hz(wet ? mixc(c, [70, 74, 84], 0.28) : snowy ? mixc(c, S.snow, 0.75) : c, 0.5));
      const bloom = season === 'spring' ? [[236, 176, 190], [244, 204, 214], [226, 150, 170]] : season === 'autumn' ? [[204, 84, 44], [226, 140, 60], [184, 60, 38]] : null;
      return {
        L, mode: S.mode, det: L.det, lw: L.lw, snowy, wet, lineA: S.line,
        line: (x) => rgba(hz(S.ink, 0.7), x * S.line * Math.max(0.5, a)),
        dark: (x) => rgba(hz(S.woodDark, 0.6), x),
        wall: grad(S.wall, 0.6), wallShC: (x) => rgba(hz(S.wallSh, 0.6), x),
        wood: grad(S.wood, 0.7), woodDark: (x) => rgba(hz(S.woodDark, 0.6), x),
        roof: grad(S.roof, 0.7), roofDark: (x) => rgba(hz(mixc(S.roof, S.ink, 0.5), 0.7), x), tileLine: (x) => rgba(hz(S.tileLine, 0.7), x),
        thatch: grad(S.thatch, 0.7),
        shoji: (x) => rgba(hz(mixc(S.paperLamp, S.wall, 0.4), 0.5), x),
        lamp: (x) => rgba(S.paperLamp, x), accent: (x) => rgba(hz(S.accent, 0.5), x), vermilion: (x) => rgba(hz(S.accent, 0.6), x),
        stoneC: (x) => rgba(hz(S.stone, 0.6), x),
        pine: grad(S.pine, 0.8), pineDark: (x) => rgba(hz(S.pineDark, 0.85), x), trunk: (x) => rgba(hz(S.trunk, 0.7), x),
        grass: (x) => rgba(hz(snowy ? mixc(S.pineDark, S.snow, 0.5) : S.pineDark, 0.6), x),
        bloom: bloom && S.mode !== 'ink' ? bloom.map((c) => hz(c, 0.7)) : null,
        horse: (x) => rgba(hz(S.mode === 'ink' ? [60, 58, 60] : [96, 70, 52], 0.6), x),
        skin: (x) => rgba(hz([226, 196, 166], 0.6), x), straw: (x) => rgba(hz(S.thatch, 0.6), x),
        snow: (x) => rgba(hz(S.snow, 0.3), x),
        earth: (y0, y1) => [0, y0, 0, y1, 0, rgba(earth[0], 1), 1, rgba(earth[1], 1)],
        puddle: (x) => rgba(hz(mixc(S.sky[0], S.sky[1], 0.5), 0.4), x),
        reflect: (x) => rgba(hz(S.woodDark, 0.6), x),
        mtn: (y0, y1) => [0, y0, 0, y1, 0, rgba(S.mtn[0], 1), 1, rgba(S.mtn[1], 1)],
        hill: (y0, y1) => [0, y0, 0, y1, 0, rgba(hz(S.hill[0], 0.6), 1), 1, rgba(hz(S.hill[1], 0.6), 1)],
        norenCol: (rng) => hz(S.noren[Math.floor(rng() * S.noren.length)], 0.5),
        clothCol: (rng) => hz(S.cloth[Math.floor(rng() * S.cloth.length)], 0.5),
        umbrellaCol: (rng) => hz(S.umbrella[Math.floor(rng() * S.umbrella.length)], 0.5),
      };
    }
    // Cut paper: one flat tone per layer, darker toward the front; windows cut through.
    _cutStyle(L, S, snowy, wet) {
      const sky = this._cutSky(), tone = mixc(sky[1], S.ink, L.tone), c = rgba(tone, 1), f = () => c, fg = () => c;
      const glow = rgba([255, 224, 168], 1);
      return {
        L, mode: 'cut', det: L.det, lw: L.lw, snowy, wet, lineA: 0,
        line: () => c, dark: f, wall: fg, wallShC: f, wood: fg, woodDark: f, roof: fg, roofDark: f, tileLine: f, thatch: fg,
        shoji: () => glow, lamp: () => glow, accent: f, vermilion: () => rgba(mixc(S.accent, tone, L.tone * 0.5), 1),
        stoneC: f, pine: fg, pineDark: f, trunk: f, grass: f, bloom: null, horse: f, skin: f, straw: f,
        snow: (x) => rgba(S.snow, x), earth: () => c, puddle: () => rgba(mixc(tone, sky[1], 0.3), 1), reflect: () => 'rgba(0,0,0,0)',
        mtn: fg, hill: fg, norenCol: () => tone, clothCol: () => tone, umbrellaCol: () => (L.id >= 4 ? mixc(S.accent, tone, 0.35) : tone),
      };
    }
    // the cut-paper sky: two colours by time of day (the layers are tinted from it)
    _cutSky() {
      const h = this.hour != null ? this.hour : 12;
      if (h < 5 || h >= 20.5) return [[30, 34, 66], [70, 72, 110]];
      if (h < 7) return [[120, 120, 170], [248, 196, 150]];
      if (h >= 17.5) return [[96, 90, 150], [250, 170, 110]];
      return [[150, 194, 222], [246, 230, 196]];
    }
    _tod() {
      super._tod();
      // cut paper re-tones every layer with the sky, a few times across a day
      if (this.S.mode === 'cut') { const k = this._cutSky()[1].join(); if (k !== this._cutKey) { const first = this._cutKey == null; this._cutKey = k; if (!first) this.flushScene(); } }
    }
    _autoWeather(season, r) {
      if (season === 'spring') return r < 0.25 ? 'petals' : r < 0.45 ? 'rain' : 'none';
      if (season === 'autumn') return r < 0.22 ? 'petals' : r < 0.42 ? 'rain' : 'none';
      if (season === 'winter') return r < 0.5 ? 'snow' : 'none';
      return r < 0.3 ? 'rain' : 'none';
    }
    _skyGradient() {
      const S = this.S, g = this.ctx.createLinearGradient(0, 0, 0, this.H * 0.72);
      const sk = S.sky || this._cutSky();
      if (S.mode === 'flat') { g.addColorStop(0, rgba(sk[0], 1)); g.addColorStop(0.18, rgba(mixc(sk[0], sk[1], 0.45), 1)); g.addColorStop(0.5, rgba(sk[1], 1)); g.addColorStop(1, rgba(S.paper, 1)); }
      else { g.addColorStop(0, rgba(sk[0], 1)); g.addColorStop(1, rgba(sk[1], 1)); }
      return g;
    }
    _drawSky() {
      const ctx = this.ctx, S = this.S;
      ctx.fillStyle = this.skyGrad; ctx.fillRect(0, 0, this.W, this.H);
      if (this.sun && this.night < 0.6 && S.mode !== 'ink') {
        const e = clamp(this.sun.e, 0, 1), r = this.H * (S.mode === 'cut' ? 0.06 : 0.04);
        ctx.fillStyle = rgba(S.mode === 'cut' ? [255, 246, 220] : S.accent, (S.mode === 'cut' ? 0.9 : lerp(0.85, 0.35, e)) * (1 - this.night / 0.6));
        ctx.beginPath(); ctx.arc(this.sun.x, this.sun.y, r, 0, TAU); ctx.fill();
      }
      if (this.moon) this._drawMoon(this.H * 0.03);
    }
    _paintGrain() {
      const S = this.S;
      if (S.mode === 'ink') return super._paintGrain();
      const T = 256, tile = mkCanvas(T, T), tg = tile.getContext('2d'), img = tg.createImageData(T, T), rng = RNG(77);
      const amp = S.mode === 'cut' ? 10 : 16;
      for (let i = 0; i < T * T; i++) { const v = 255 - Math.floor(Math.pow(rng(), 3) * amp); img.data[i * 4] = v; img.data[i * 4 + 1] = v - 1; img.data[i * 4 + 2] = v - 4; img.data[i * 4 + 3] = 255; }
      tg.putImageData(img, 0, 0);
      // the woodgrain of the printing block
      if (S.mode !== 'cut') for (let i = 0; i < 50; i++) { const y = rng() * T; tg.strokeStyle = 'rgba(120,100,80,' + rng.range(0.025, 0.06).toFixed(3) + ')'; tg.lineWidth = rng.range(0.5, 1.4); tg.beginPath(); tg.moveTo(0, y); for (let x = 0; x <= T; x += 16) tg.lineTo(x, y + 2 * Math.sin(x / 40 + i)); tg.stroke(); }
      return tile;
    }
    // Rain: long straight lines (the Hiroshige way) for the prints; snow and blossom as usual.
    _weather(dt) {
      if (this.reduceMotion || this.weather === 'none') return;
      if (this.weather === 'petals') return this._petals(dt);
      if (this.weather !== 'rain') return super._weather(dt);
      const ctx = this.ctx, W = this.W, H = this.H, k = this.k, S = this.S;
      const want = this._particleCount(S.mode === 'flat' ? 260 : 200);
      while (this.parts.length < want) this.parts.push({ x: Math.random() * W, y: Math.random() * H, v: Math.random(), p: Math.random() * TAU });
      const col = S.mode === 'cut' ? [250, 240, 220] : S.mode === 'soft' ? [236, 240, 246] : S.ink;
      ctx.strokeStyle = rgba(col, S.mode === 'flat' ? 0.32 : S.mode === 'soft' ? 0.3 : 0.18); ctx.lineWidth = Math.max(0.7, 0.8 * k); ctx.beginPath();
      const slant = S.mode === 'flat' ? 0.32 : 0.12;
      for (const q of this.parts) {
        const v = (900 + q.v * 400) * k;
        q.y += v * dt; q.x += v * slant * dt;
        if (q.y > H) { q.y -= H + 60 * k; q.x = Math.random() * W; }
        if (q.x > W) q.x -= W;
        const l = (S.mode === 'flat' ? 60 + q.v * 70 : 18 + q.v * 18) * k;
        ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - l * slant, q.y - l);
      }
      ctx.stroke();
    }
  }
  TabijiEngine.def = {
    layers: LAYERS, mist: MIST, tod: TOD, paper: STYLES.shinhanga.paper, ink: STYLES.shinhanga.ink, sun: STYLES.shinhanga.accent,
    sky: { horizon: 0.4, zenith: 0.12 },
    styles: Object.keys(STYLES), defaults: { style: 'shinhanga' }, builders: B, styleSprites: true, weathers: ['none', 'petals', 'rain', 'snow'],
  };

  window.Paperwall.register({
    id: 'tabiji', name: 'Tabiji', native: '旅路', order: 4,
    tagline: 'Japanese post road',
    blurb: 'A village street on the old highway: shopfronts and inns, a teahouse parasol, shrine gates, roadside pines and travellers passing.',
    Engine: TabijiEngine, paper: '#f0eadc', ink: '#2e2624', accent: '#d24c32',
    styles: [
      { id: 'shinhanga', name: 'Shin-hanga', native: '新版画', blurb: 'Soft graded colour and lamplight on wet roads, after Kawase Hasui', swatch: ['#e8e4d6', '#7096c0', '#68482e', '#d24c32'] },
      { id: 'hiroshige', name: 'Hiroshige', native: '広重', blurb: 'Flat colour, a Prussian-blue sky and slanting lines of rain', swatch: ['#eee4cc', '#28467a', '#80563a', '#c43a2c'] },
      { id: 'sumi', name: 'Sumi', native: '墨', blurb: 'Ink only, with red for lanterns, gates and umbrellas', swatch: ['#f6f3ec', '#a8a6a2', '#1c1b1e', '#c62c24'] },
      { id: 'kirie', name: 'Cut paper', native: '切り絵', blurb: 'Layered paper silhouettes with glowing cut-out windows', swatch: ['#f6e2ba', '#7c6a74', '#120e16', '#be3028'] },
    ],
    weathers: [{ id: 'auto', name: 'Automatic' }, { id: 'none', name: 'Clear' }, { id: 'petals', name: 'Falling blossom' }, { id: 'rain', name: 'Rain' }, { id: 'snow', name: 'Snow' }],
    toggles: [{ id: 'birds', name: 'Birds' }, { id: 'mist', name: 'Mist' }, { id: 'paper', name: 'Paper texture' }],
  });
})();
