/*
 * Yūgen: an endless Japanese landscape. Wet-ink ranges, Kano-school crags, black pines,
 * thatched villages, torii in the shallows, cranes and drifting cloud bands.
 *
 * One scene generator, four ways of painting it (the "style" option):
 *   sumi     sumi-e: wet ink washes on white washi, a single red sun
 *   hanga    woodcut: dense black linework on sepia paper, a big rough red sun
 *   kinpeki  gold-leaf folding screen: gold clouds, mineral greens, ink waves
 *   ukiyoe   woodblock print: prussian-blue bokashi skies, flat colour, outlines
 */
(function () {
  'use strict';
  const { Engine, CW, TAU, clamp, lerp, sstep, hash2, hash4, RNG, vnoise, fbm, rgba, mixc,
    DL, brush, curve, blob, rect, qbez, interpY, Occ, mkCanvas, dens, P } = window.Driftscape;

  // ------------------------------------------------------------------ palettes
  // mode: how land is painted. 'wet' graded ink washes, 'line' hatching, 'mineral' pigment
  // over gold, 'flat' bokashi colour bands with an outline.
  const STYLES = {
    sumi: {
      mode: 'wet', paper: [246, 243, 236], ink: [30, 29, 32], air: [246, 243, 236], accent: [196, 44, 36],
      sun: { r: 0.072, col: [204, 46, 38], tex: 'wet', a: 0.92 },
      land: null, ridge: [30, 29, 32], water: [[247, 245, 239], [243, 241, 235]], waveA: 0.5,
      bark: [36, 32, 30], pine: [34, 36, 34], thatch: [150, 140, 124], tile: [70, 70, 74], wall: [250, 248, 242], wood: [70, 60, 52],
      mist: 'soft', mistA: 1, grain: 'washi', snow: [252, 252, 250],
      bloom: { spring: [[214, 72, 80], [232, 120, 128], [196, 50, 60]], summer: null, autumn: [[196, 60, 40], [214, 96, 48], [170, 44, 36]], winter: null },
    },
    hanga: {
      mode: 'line', paper: [233, 219, 190], ink: [22, 18, 16], air: [233, 219, 190], accent: [206, 52, 36],
      sun: { r: 0.15, col: [222, 64, 46], tex: 'rough', a: 0.94 },
      land: null, ridge: [22, 18, 16], water: [[234, 221, 193], [228, 214, 186]], waveA: 0.75,
      bark: [22, 18, 16], pine: [20, 18, 16], thatch: [150, 126, 96], tile: [40, 34, 32], wall: [238, 226, 200], wood: [40, 30, 24],
      mist: 'soft', mistA: 0.95, grain: 'speck', snow: [246, 238, 222],
      bloom: { spring: [[206, 60, 44], [222, 96, 74]], summer: null, autumn: [[196, 52, 34], [214, 80, 44]], winter: null },
    },
    kinpeki: {
      mode: 'mineral', paper: [214, 172, 84], ink: [42, 36, 30], air: [218, 178, 92], accent: [190, 60, 38],
      sun: null,
      land: [[118, 134, 96], [196, 160, 92]], rock: [[150, 150, 136], [196, 172, 120]], ridge: [64, 108, 86],
      water: [[206, 178, 118], [188, 160, 108]], waveA: 0.85, waveCol: [70, 72, 78],
      bark: [52, 44, 34], pine: [52, 84, 62], thatch: [150, 120, 70], tile: [62, 74, 80], wall: [240, 232, 210], wood: [92, 62, 40],
      mist: 'gold', mistA: 1, grain: 'leaf', snow: [244, 240, 228],
      bloom: { spring: [[244, 240, 230], [236, 200, 204], [250, 248, 242]], summer: [[70, 120, 84], [92, 140, 96]], autumn: [[196, 64, 40], [222, 120, 60], [176, 46, 34]], winter: null },
    },
    ukiyoe: {
      mode: 'flat', paper: [238, 228, 204], ink: [34, 40, 58], air: [228, 224, 206], accent: [200, 66, 46],
      sun: { r: 0.05, col: [206, 66, 50], tex: 'flat', a: 0.95 },
      land: [[86, 124, 92], [214, 196, 152]], rock: [[110, 112, 120], [196, 186, 160]], ridge: [40, 70, 116],
      water: [[92, 138, 170], [44, 82, 132]], waveA: 0.8, waveCol: [236, 240, 238],
      bark: [62, 48, 40], pine: [44, 84, 64], thatch: [170, 140, 96], tile: [58, 66, 86], wall: [244, 236, 216], wood: [96, 64, 44],
      mist: 'band', mistA: 0.9, grain: 'wood', snow: [250, 250, 248],
      bloom: { spring: [[236, 170, 186], [244, 196, 206], [226, 146, 168]], summer: [[86, 128, 80], [104, 146, 92]], autumn: [[204, 74, 44], [226, 132, 56], [180, 50, 36]], winter: null },
    },
  };
  const SEASON_WASH = { spring: 1, summer: 1.1, autumn: 0.95, winter: 0.6 };

  // ------------------------------------------------------------------ layers
  // haze: how far the layer sits in the air (0 = foreground). Colour styles fade toward 'air'.
  const LAYERS = [
    { id: 0, kind: 'distant', par: 0.04, y0: 190, y1: 520,  base: 470, R: 2, ink: 0.32, lw: 0.55, det: 0.25, haze: 0.8 },
    { id: 1, kind: 'far',     par: 0.10, y0: 140, y1: 600,  base: 555, R: 2, ink: 0.45, lw: 0.6,  det: 0.35, haze: 0.6 },
    { id: 2, kind: 'mid',     par: 0.22, y0: 90,  y1: 705,  base: 650, R: 2, ink: 0.6,  lw: 0.75, det: 0.6,  haze: 0.4 },
    { id: 3, kind: 'main',    par: 0.42, y0: 20,  y1: 885,  base: 765, R: 2, ink: 0.8,  lw: 0.9,  det: 1.0,  haze: 0.18 },
    { id: 4, kind: 'valley',  par: 0.66, y0: 560, y1: 935,  base: 848, R: 2, ink: 0.86, lw: 1.0,  det: 0.9,  haze: 0.06 },
    { id: 5, kind: 'near',    par: 1.00, y0: 360, y1: 1000, base: 918, R: 2, ink: 0.94, lw: 1.2,  det: 1.0,  haze: 0 },
  ];
  // Cloud bands (suyari-gasumi): long and flat, drawn after a layer. y = top of the strip.
  const MIST = [
    { after: 0, y: 400, h: 120, a: 0.95, par: 0.06, drift: 2, dens: 1.0 },
    { after: 1, y: 480, h: 130, a: 0.95, par: 0.13, drift: 3, dens: 1.0 },
    { after: 2, y: 230, h: 120, a: 0.5,  par: 0.3,  drift: 5, dens: 0.45 },
    { after: 2, y: 575, h: 140, a: 1.0,  par: 0.27, drift: 4, dens: 1.1 },
    { after: 3, y: 360, h: 150, a: 0.5,  par: 0.5,  drift: 6, dens: 0.5 },
    { after: 3, y: 690, h: 150, a: 0.8,  par: 0.5,  drift: 5, dens: 1.0 },
    { after: 4, y: 800, h: 100, a: 0.55, par: 0.75, drift: 6, dens: 0.8 },
  ];
  const TOD = [
    [0.0, [62, 70, 102], [80, 86, 112], 1],
    [4.6, [62, 70, 102], [80, 86, 112], 1],
    [5.6, [156, 136, 156], [196, 166, 166], 0.55],
    [6.4, [242, 204, 186], [252, 226, 204], 0.1],
    [7.6, [255, 248, 238], [255, 251, 244], 0],
    [16.6, [255, 251, 242], [255, 253, 247], 0],
    [18.0, [250, 214, 180], [253, 228, 204], 0.05],
    [19.0, [186, 150, 160], [206, 170, 166], 0.35],
    [20.2, [76, 80, 112], [94, 96, 120], 0.9],
    [21.0, [62, 70, 102], [80, 86, 112], 1],
    [24.0, [62, 70, 102], [80, 86, 112], 1],
  ];
  const PHRASES = ['山紫水明', '花鳥風月', '風光明媚', '行雲流水', '明鏡止水', '白砂青松', '柳緑花紅', '一期一会', '雪月花', '春風駘蕩', '月下美人', '松風'];

  // ------------------------------------------------------------------ small helpers
  const along = (p, t) => { const n = p.length >> 1, i = clamp(Math.round(t * (n - 1)), 0, n - 1); return [p[i * 2], p[i * 2 + 1]]; };
  // y on an x-monotonic polyline
  function polyY(px, py, x) {
    if (x <= px[0]) return py[0];
    for (let i = 1; i < px.length; i++) if (x <= px[i]) { const t = (x - px[i - 1]) / (px[i] - px[i - 1] || 1); return lerp(py[i - 1], py[i], t); }
    return py[py.length - 1];
  }
  // A ribbon whose width comes from a world-space function, so lines continue across chunks.
  function ribbon(pts, hw) {
    const n = pts.length >> 1, out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
      let dx = pts[b * 2] - pts[a * 2], dy = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.sqrt(dx * dx + dy * dy) || 1; dx /= l; dy /= l;
      const w = hw(pts[i * 2], i), x = pts[i * 2], y = pts[i * 2 + 1];
      out[i * 2] = x - dy * w; out[i * 2 + 1] = y + dx * w;
      const j = (2 * n - 1 - i) * 2;
      out[j] = x + dy * w; out[j + 1] = y - dx * w;
    }
    return out;
  }
  // A spiral foam curl, the claw of a breaking wave (tsume). dir = +1 curls clockwise.
  function curl(dl, rng, st, cx, cy, r, dir) {
    const turns = rng.range(1.1, 1.6), n = 18, pts = [], a0 = rng() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), a = a0 + dir * t * turns * TAU, rr = r * (1 - 0.82 * t);
      pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
    }
    dl.poly(blob(cx, cy, r * 1.05, r * 0.85, 0, 12, rng, 0.2), st.foam(0.95));
    dl.poly(brush(pts, Math.max(0.6, r * 0.16), rng, { prof: (t) => 1 - 0.7 * t, wob: 0.2, min: 0.3 }), st.wave(0.9));
  }

  // ------------------------------------------------------------------ land painting
  // The shared body painter: opaque silhouette, then mode-specific shading inside a clip,
  // then the mode's edge treatment. Returns nothing; callers keep their own ridge arrays.
  function ridgeBands(dl, xs, ys, N, cap, depth, nb, colFn) {
    for (let k = 0; k < nb; k++) {
      const d0 = (k / nb) * depth, d1 = ((k + 1) / nb) * depth, p = [];
      for (let i = 0; i <= N; i++) p.push(xs[i], Math.min(cap, ys[i] + d0));
      for (let i = N; i >= 0; i--) p.push(xs[i], Math.min(cap, ys[i] + d1));
      dl.poly(p, colFn(k / nb));
    }
  }
  function landBody(dl, rng, st, sil, xs, ys, N, base, h, o) {
    const x = (xs[0] + xs[N]) / 2, top = Math.min.apply(null, ys), mode = st.mode, rock = !!o.rock;
    dl.poly(sil, st.body(x, top, base, rock));
    dl.beginClip(sil);
    const wash = (o.wash != null ? o.wash : 1) * st.wash;
    const span = Math.max(20, base - top);
    if (mode === 'wet') {
      // graded wash that follows the ridge, darkest along the skyline (wet ink pooling)
      const a0 = 0.34 * wash * (o.dark || 1);
      ridgeBands(dl, xs, ys, N, base + 80, span * (o.bandDepth || 0.55), 12, (t) => st.ink(a0 * 0.62 * Math.pow(1 - t, 1.6)));
      // dry-brush streaks dragged down from the ridge
      const ns = Math.min(140, Math.round((xs[N] - xs[0]) / 5 * st.det));
      for (let k = 0; k < ns; k++) {
        const i = 1 + Math.floor(rng() * (N - 1)), sx = xs[i], sy = ys[i] + rng.range(0, 6), len = rng.range(0.1, 0.4) * (base - ys[i]);
        if (len < 4) continue;
        dl.poly(brush([sx, sy, sx + rng.range(-2, 2), sy + len * 0.5, sx + rng.range(-4, 4), sy + len], rng.range(1.5, 4) * st.lw, rng, { wob: 0.6, prof: (t) => 1 - t }), st.ink(rng.range(0.03, 0.09) * wash));
      }
      // soft blotches: pigment settling in the paper
      const nbz = Math.round(4 + (xs[N] - xs[0]) / 40);
      for (let k = 0; k < nbz; k++) {
        const i = Math.floor(rng() * (N + 1)), r = rng.range(6, 22) * st.lw;
        dl.poly(blob(xs[i] + rng.range(-6, 6), ys[i] + r * rng.range(0.4, 1.6), r, r * 0.5, rng.range(-0.3, 0.3), 9, rng, 0.5), st.ink(rng.range(0.03, 0.08) * wash));
      }
    } else if (mode === 'line') {
      ridgeBands(dl, xs, ys, N, base + 80, span * 0.4, 6, (t) => st.ink(0.07 * wash * (1 - t)));
      // woodcut hatching: lines running down the slope, packed tighter toward the ridge
      const nh = Math.min(420, Math.round((xs[N] - xs[0]) / 2.2 * st.det + 30));
      for (let k = 0; k < nh; k++) {
        const i = 1 + Math.floor(rng() * (N - 1)), ia = Math.max(0, i - 1), ib = Math.min(N, i + 1);
        const sl = (ys[ib] - ys[ia]) / (xs[ib] - xs[ia] || 1), len = Math.pow(rng(), 1.4) * (base - ys[i]) * 0.75;
        if (len < 3) continue;
        const dx = clamp(sl, -1.2, 1.2) * len * 0.35;
        dl.poly(brush([xs[i], ys[i] + 1, xs[i] + dx * 0.5, ys[i] + len * 0.5, xs[i] + dx, ys[i] + len], rng.range(0.5, 1.0) * st.lw, rng, { prof: (t) => 1 - t, wob: 0.3 }), st.ink(rng.range(0.35, 0.75) * wash));
      }
    } else {
      // pigment band along the ridge (mineral green / prussian blue), soft toward the foot
      const rc = st.ridgeCol;
      ridgeBands(dl, xs, ys, N, base + 80, span * (mode === 'flat' ? 0.6 : 0.45), 14, (t) => rgba(rc, (mode === 'flat' ? 0.3 : 0.25) * Math.pow(1 - t, 1.4) * st.L.ink));
      if (rock || mode === 'mineral') {
        const na = Math.round(Math.min(120, (xs[N] - xs[0]) / 6) * st.det);
        for (let k = 0; k < na; k++) {
          const i = 1 + Math.floor(rng() * (N - 1)), sx = xs[i] + rng.range(-3, 3), sy = ys[i] + 2 + Math.pow(rng(), 1.5) * (base - ys[i]) * 0.7, len = rng.range(6, 18) * st.lw;
          dl.poly(brush([sx, sy, sx + len * 0.25, sy + len], rng.range(1.5, 3.5) * st.lw, rng, { prof: (t) => Math.pow(1 - t, 0.6), wob: 0.3 }), st.ink(rng.range(0.12, 0.3)));
        }
      }
    }
    if (st.snowy && !o.noSnow) {
      // winter: a white cap along the ridge
      ridgeBands(dl, xs, ys, N, base, span * 0.22, 5, (t) => rgba(st.snowC, 0.5 * (1 - t)));
    }
    dl.poly(sil, [x, base - h * (o.mist || 0.42), x, base, 0, rgba(st.airC, 0), 1, rgba(st.airC, 1)]);
    dl.endClip();
    // edge
    if (o.edge === false) return;
    const ew = mode === 'line' ? 1.5 : mode === 'flat' ? 0.9 : mode === 'mineral' ? 1.2 : 1.1;
    const ea = (mode === 'wet' ? 0.38 : mode === 'line' ? 0.9 : 0.7) * (o.edgeA != null ? o.edgeA : 1);
    let i = 0;
    while (i < N) {
      const j = Math.min(N, i + 6 + Math.floor(rng() * 12)), pts = [];
      let ay = 0;
      for (let q = i; q <= j; q++) { pts.push(xs[q], ys[q]); ay += ys[q]; }
      ay /= j - i + 1;
      const a = ea * sstep(0.03, 0.35, (base - ay) / h);
      if (a > 0.02) dl.poly(brush(pts, rng.range(0.7, 1.3) * ew * st.lw, rng, { wob: mode === 'wet' ? 0.6 : 0.3, min: 0.3 }), st.ink(a));
      if (j >= N) break;
      i = j - (rng() < 0.3 ? 1 : 0);
    }
  }

  // Rolling or peaked range (bumps of exponentials), like a wash mountain.
  function rangeShape(rng, x, base, hw, h, o) {
    const sd = (rng() * 1e6) | 0, nb = rng.int(1, o.bumps || 3);
    const bumps = [{ c: rng.range(-0.3, 0.3), h: 1, s: rng.range(0.3, 0.55) }];
    for (let i = 1; i < nb; i++) bumps.push({ c: rng.range(-0.8, 0.8), h: rng.range(0.35, 0.85), s: rng.range(0.1, 0.3) });
    const sharp = o.sharp || rng.range(1.4, 2.4), N = clamp(Math.round(hw / 4), 24, 130);
    const xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), sil = [];
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      let r = 0;
      for (const B of bumps) { const v = B.h * Math.exp(-Math.pow(Math.abs(u - B.c) / B.s, sharp)); if (v > r) r = v; }
      r = (r * (1 + 0.28 * fbm(sd, u * 5 + 3, 4)) + 0.02 * vnoise(sd + 7, u * 60)) * Math.pow(clamp(1 - u * u, 0, 1), 0.3);
      xs[i] = x + u * hw; ys[i] = base - h * Math.max(0, r);
      sil.push(xs[i], ys[i]);
    }
    sil.push(x + hw, base + (o.depth || 60), x - hw, base + (o.depth || 60));
    return { xs, ys, N, sil };
  }

  // A snow-capped volcanic cone with concave flanks and a notched crater rim.
  function volcano(dl, rng, st, x, base, hw, h) {
    const N = 90, xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), sil = [], sd = (rng() * 1e6) | 0, rim = rng.range(0.07, 0.11);
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N, a = Math.abs(u);
      let r = a < rim ? 1 - 0.02 * Math.abs(vnoise(sd, u * 80)) : Math.pow(1 - (a - rim) / (1 - rim), 1.75);
      r *= 1 + 0.015 * vnoise(sd + 3, u * 30);
      xs[i] = x + u * hw; ys[i] = base - h * r;
      sil.push(xs[i], ys[i]);
    }
    sil.push(x + hw, base + 60, x - hw, base + 60);
    landBody(dl, rng, st, sil, xs, ys, N, base, h, { wash: 1.25, bandDepth: 0.9, mist: 0.55, noSnow: true, edgeA: 0.9 });
    // the snowfield: white with a ragged, streaked lower edge (always, except high summer)
    if (st.season !== 'summer' || rng() < 0.5) {
      const depth = h * (st.season === 'winter' ? 0.62 : st.season === 'summer' ? 0.2 : 0.38), cap = [];
      for (let i = 0; i <= N; i++) cap.push(xs[i], ys[i] - 0.5);
      for (let i = N; i >= 0; i--) {
        const u = -1 + (2 * i) / N, streak = 0.55 + 0.45 * Math.abs(vnoise(sd + 11, u * 22)) + 0.25 * Math.max(0, vnoise(sd + 13, u * 60));
        cap.push(xs[i], Math.min(base, ys[i] + depth * streak * (1 - 0.5 * Math.abs(u))));
      }
      dl.beginClip(sil);
      dl.poly(cap, rgba(st.snowC, st.mode === 'wet' ? 1 : 0.95));
      dl.endClip();
    }
  }

  // Kano-school crag: stacked blocks with flat tops and near-vertical faces.
  function cragShape(rng, x, base, hw, h) {
    const K = rng.int(3, 7), ws = [], lean = rng.range(-0.3, 0.3);
    let sum = 0;
    for (let i = 0; i < K; i++) { const w = rng.range(0.5, 1.5); ws.push(w); sum += w; }
    const peak = rng.range(0.25, 0.75), px = [x - hw], py = [base], blocks = [];
    let cx = x - hw;
    // a leaning spire: every point is pushed sideways in proportion to its height
    const push = (X, Y) => { px.push(X + lean * (base - Y) * 0.3); py.push(Y); };
    for (let i = 0; i < K; i++) {
      const w = (ws[i] / sum) * 2 * hw, mid = (cx + w / 2 - (x - hw)) / (2 * hw);
      const e = Math.exp(-Math.pow((mid - peak) / 0.26, 2)), bh = h * clamp(e * rng.range(0.75, 1.05) + rng.range(0, 0.12), 0.1, 1);
      const inset = Math.min(w * 0.2, rng.range(1, 6)), slant = rng.range(-0.5, 0.5) * Math.min(w, bh * 0.6);
      const yl = base - bh + slant * 0.5, yr = base - bh - slant * 0.5;
      // left face, a broken top, right shoulder
      push(cx + inset, yl);
      const nn = rng.int(1, 4);
      for (let k = 1; k <= nn; k++) {
        const t = k / (nn + 1), jag = rng() < 0.35 ? rng.range(4, 14) : rng.range(-3, 3);
        push(cx + inset + (w - 2 * inset) * t, lerp(yl, yr, t) + jag);
      }
      push(cx + w - inset, yr);
      blocks.push({ l: cx + inset, r: cx + w - inset, yl, yr, h: bh });
      cx += w;
    }
    px.push(x + hw); py.push(base);
    for (let i = 1; i < px.length; i++) if (px[i] < px[i - 1] + 0.5) px[i] = px[i - 1] + 0.5; // keep it x-monotonic
    // block edges follow the lean too
    for (const b of blocks) { b.l += lean * (base - b.yl) * 0.3; b.r += lean * (base - b.yr) * 0.3; }
    return { px, py, blocks };
  }
  function crag(dl, rng, st, x, base, hw, h, o) {
    h = Math.min(h, hw * 2.6); // a crag, never a needle
    const { px, py, blocks } = cragShape(rng, x, base, hw, h);
    const N = clamp(Math.round(hw / 4), 24, 140), xs = new Float32Array(N + 1), ys = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) { xs[i] = x - hw + (2 * hw * i) / N; ys[i] = polyY(px, py, xs[i]); }
    const sil = [];
    for (let i = 0; i < px.length; i++) sil.push(px[i], py[i]);
    sil.push(x + hw, base + (o.depth || 60), x - hw, base + (o.depth || 60));
    const top = Math.min.apply(null, py);
    // body and shading
    dl.poly(sil, st.body(x, top, base, true));
    dl.beginClip(sil);
    const mode = st.mode;
    for (const b of blocks) {
      // the shadowed left face of each block, darkest just under its top edge
      const fw = (b.r - b.l) * rng.range(0.25, 0.5), yt = Math.min(b.yl, b.yr);
      const face = [b.l - 2, b.yl, b.l + fw, lerp(b.yl, b.yr, fw / (b.r - b.l)), b.l + fw * 0.8, base + 10, b.l - 6, base + 10];
      const fa = mode === 'line' ? 0.16 : mode === 'wet' ? 0.34 : 0.28;
      dl.poly(face, [b.l, yt, b.l, base, 0, st.ink(fa), 0.6, st.ink(fa * 0.3), 1, st.ink(0)]);
      // fine vertical grain down the faces, the many faint lines that give rock its volume
      const ng = Math.round(clamp(((b.r - b.l) * b.h) / 260, 4, 60) * st.det);
      for (let k = 0; k < ng; k++) {
        const t = rng(), sx = lerp(b.l, b.r, t), sy = lerp(b.yl, b.yr, t) + rng.range(2, 10), len = (base - sy) * rng.range(0.15, 0.6);
        dl.poly(brush([sx, sy, sx + rng.range(-2, 2), sy + len * 0.5, sx + rng.range(-3, 3), sy + len], rng.range(0.4, 0.8) * st.lw, rng, { wob: 0.4 }), st.ink(rng.range(0.06, mode === 'line' ? 0.4 : 0.2)));
      }
      // axe-cut strokes: broad wedges dragged down from the top edge
      const na = Math.round(clamp((b.r - b.l) / 4, 3, 26) * st.det * (o.detail || 1));
      for (let k = 0; k < na; k++) {
        const t = rng(), sx = lerp(b.l, b.r, t), sy = lerp(b.yl, b.yr, t) + rng.range(1, 6) + Math.pow(rng(), 2) * b.h * 0.5;
        const len = rng.range(8, 26) * st.lw * (o.scale || 1), w = (mode === 'line' ? rng.range(0.8, 1.6) : rng.range(2.2, 5.5)) * st.lw;
        dl.poly(brush([sx, sy, sx - len * 0.12, sy + len * 0.55, sx - len * 0.2, sy + len], w, rng, { prof: (q) => Math.pow(1 - q, 0.55), wob: 0.4 }), st.ink(rng.range(0.14, 0.42)));
      }
      // facet line down from the block corners
      for (const cxx of [b.l, b.r]) {
        if (rng() < 0.3) continue;
        const y0 = polyY(px, py, cxx) + 2, len = (base - y0) * rng.range(0.35, 0.8);
        dl.poly(brush(curve(cxx, y0, cxx + rng.range(-6, 6), y0 + len, 6, rng.range(-0.05, 0.05), rng, 0.2), rng.range(0.7, 1.3) * st.lw, rng, { prof: (q) => 1 - 0.8 * q, wob: 0.3 }), st.ink(mode === 'wet' ? 0.4 : 0.6));
      }
      // a horizontal ledge now and then
      if (rng() < 0.5) {
        const ly = lerp(Math.max(b.yl, b.yr), base, rng.range(0.2, 0.5)), ll = (b.r - b.l) * rng.range(0.3, 0.7), lx = rng.range(b.l, b.r - ll);
        dl.poly(brush([lx, ly, lx + ll * 0.5, ly + rng.range(-2, 2), lx + ll, ly + rng.range(-3, 3)], 0.9 * st.lw, rng, { wob: 0.4 }), st.ink(0.35));
      }
    }
    if (mode === 'mineral' || mode === 'flat') {
      // pigment on the tops: malachite green (gold screen) or prussian blue (print)
      for (const b of blocks) {
        const tp = [], d = Math.min(26, b.h * 0.2);
        tp.push(b.l, b.yl - 1, b.r, b.yr - 1, b.r, b.yr + d, b.l, b.yl + d * 0.7);
        dl.poly(tp, [b.l, Math.min(b.yl, b.yr), b.l, Math.max(b.yl, b.yr) + d, 0, rgba(st.ridgeCol, 0.8 * st.L.ink), 1, rgba(st.ridgeCol, 0)]);
      }
    }
    if (st.snowy) for (const b of blocks) dl.poly([b.l, b.yl - 1, b.r, b.yr - 1, b.r - 3, b.yr + 5, b.l + 3, b.yl + 4], rgba(st.snowC, 0.95));
    dl.poly(sil, [x, base - h * (o.mist || 0.4), x, base, 0, rgba(st.airC, 0), 1, rgba(st.airC, 1)]);
    dl.endClip();
    // the outline: angular, confident, broken at the corners
    const ea = mode === 'wet' ? 0.7 : 0.9, ew = mode === 'line' ? 1.6 : 1.3;
    for (let i = 1; i < px.length; i++) {
      if (rng() < 0.08) continue;
      const fy = Math.min(py[i - 1], py[i]), a = ea * sstep(0.02, 0.3, (base - fy) / h);
      if (a < 0.03) continue;
      dl.poly(brush([px[i - 1], py[i - 1], (px[i - 1] + px[i]) / 2 + rng.range(-0.8, 0.8), (py[i - 1] + py[i]) / 2, px[i], py[i]], rng.range(0.8, 1.4) * ew * st.lw, rng, { wob: 0.3, min: 0.35 }), st.ink(a));
    }
    return { xs, ys, N, blocks, top };
  }

  // ------------------------------------------------------------------ trees
  // Japanese black pine: a leaning, twisting trunk and flat cloud-pruned foliage pads.
  function pad(dl, rng, st, cx, cy, w) {
    const h = w * rng.range(0.26, 0.36), nb = rng.int(2, 4);
    const pts = [];
    // bumpy top, flatter bottom
    const n = 16;
    for (let i = 0; i <= n; i++) { const t = i / n, a = Math.PI + t * Math.PI; pts.push(cx + Math.cos(a) * w * 0.5, cy + Math.sin(a) * h * (0.85 + 0.25 * Math.sin(t * Math.PI * nb * 2 + cx))); }
    for (let i = n; i >= 0; i--) { const t = i / n; pts.push(cx + (t - 0.5) * w * 0.92, cy + h * 0.18 * Math.sin(t * Math.PI) + rng.range(-0.4, 0.4)); }
    dl.poly(pts, st.pine(st.mode === 'flat' ? 1 : 0.82));
    // needle tufts fanning from the underside and the crown
    const m = Math.round(clamp(w * 0.5, 5, 26) * st.det);
    for (let i = 0; i < m; i++) {
      const t = rng(), bx = cx + (t - 0.5) * w * 0.9, by = cy + h * 0.16 * Math.sin(t * Math.PI), len = h * rng.range(0.35, 0.7), a = Math.PI / 2 + (t - 0.5) * 1.2 + rng.range(-0.2, 0.2);
      dl.poly(brush([bx, by - len * 0.2, bx + Math.cos(a) * len, by + Math.sin(a) * len * 0.6], Math.max(0.4, w * 0.025) * st.lw, rng, { prof: (q) => 1 - q }), st.ink(rng.range(0.35, 0.7)));
    }
    const mt = Math.round(m * 0.6);
    for (let i = 0; i < mt; i++) {
      const t = rng(), bx = cx + (t - 0.5) * w * 0.8, by = cy - h * 0.7 * Math.sin(t * Math.PI), len = h * rng.range(0.25, 0.5);
      dl.poly(brush([bx, by + len * 0.6, bx + (t - 0.5) * len, by - len * 0.2], Math.max(0.35, w * 0.02) * st.lw, rng, { prof: (q) => 1 - q }), st.ink(rng.range(0.2, 0.45)));
    }
    if (st.snowy) dl.poly(blob(cx, cy - h * 0.55, w * 0.42, h * 0.38, 0, 12, rng, 0.25), rgba(st.snowC, 0.95));
  }
  function trunkPath(rng, x, y, H, lean, wig) {
    const n = 14, s0 = (rng() * 1e6) | 0, p = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      p[i * 2] = x + lean * Math.pow(t, 1.4) + H * wig * vnoise(s0, t * 2.5) * t;
      p[i * 2 + 1] = y - H * t * (1 - 0.2 * Math.abs(lean) / H * t);
    }
    return p;
  }
  function bark(dl, rng, st, p, tw) {
    dl.poly(brush(p, tw, rng, { prof: (t) => 1 - 0.6 * t, wob: 0.15, min: 0.3 }), st.bark(0.92));
    const n = p.length >> 1, nb = Math.round(n * 1.6 * st.det);
    for (let k = 0; k < nb; k++) {
      const i = Math.floor(rng() * (n - 2)), t = i / (n - 1), w = tw * (1 - 0.6 * t);
      dl.poly(blob(p[i * 2] + rng.range(-0.3, 0.3) * w, p[i * 2 + 1] - rng() * 3, w * 0.3, w * 0.12, rng.range(-0.4, 0.4), 6, rng, 0.4), st.ink(rng.range(0.4, 0.8)));
    }
  }
  function jpine(dl, rng, st, x, y, H) {
    const tw = Math.max(1.1, H * 0.05) * st.lw, lean = rng.range(0.25, 0.7) * H * (rng() < 0.5 ? -1 : 1);
    const p = trunkPath(rng, x, y, H, lean, 0.12);
    bark(dl, rng, st, p, tw);
    const side0 = lean > 0 ? 1 : -1, nb = rng.int(3, 6), pads = [];
    for (let b = 0; b < nb; b++) {
      const t = 0.4 + (0.58 * b) / nb + rng() * 0.05, [bx, by] = along(p, t);
      const side = b % 2 ? -side0 : side0, len = H * rng.range(0.2, 0.42) * (1.1 - t * 0.5);
      const ex = bx + side * len, ey = by + rng.range(-0.15, 0.08) * len;
      dl.poly(brush(curve(bx, by, ex, ey, 6, side * rng.range(-0.12, 0.05), rng, 0.3), tw * 0.5 * (1 - t * 0.4), rng, { prof: (q) => 1 - 0.6 * q, min: 0.35 }), st.bark(0.9));
      pads.push([ex, ey - len * 0.06, len * rng.range(0.9, 1.3)]);
    }
    const [tx, ty] = along(p, 1);
    pads.push([tx, ty - H * 0.03, H * rng.range(0.32, 0.45)]);
    pads.sort((a, b) => a[1] - b[1]);
    for (const q of pads) pad(dl, rng, st, q[0], q[1], q[2]);
  }
  // Blossom / maple / broadleaf tree: gnarled limbs and a dotted crown in the season's colour.
  function bloomTree(dl, rng, st, x, y, H) {
    const tw = Math.max(1, H * 0.06) * st.lw, cols = st.bloomCols;
    const p = trunkPath(rng, x, y, H * 0.55, rng.range(-0.2, 0.2) * H, 0.15);
    bark(dl, rng, st, p, tw);
    const tips = [];
    const br = (px, py, ang, len, w, d) => {
      const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
      dl.poly(brush(curve(px, py, ex, ey, 5, rng.range(-0.2, 0.2), rng, 0.35), w, rng, { prof: (q) => 1 - 0.55 * q, min: 0.35 }), st.bark(0.88));
      if (d === 0) { tips.push([ex, ey, len]); return; }
      const nc = rng.int(2, 3);
      for (let c = 0; c < nc; c++) br(ex, ey, ang + rng.range(-0.7, 0.7), len * rng.range(0.6, 0.8), w * 0.6, d - 1);
    };
    const [tx, ty] = along(p, 1);
    br(tx, ty, -Math.PI / 2 + rng.range(-0.5, 0.5), H * 0.24, tw * 0.7, 3);
    if (rng() < 0.7) br(...along(p, 0.75), -Math.PI / 2 + (rng() < 0.5 ? -1 : 1) * rng.range(0.6, 1.1), H * 0.22, tw * 0.55, 2);
    if (!cols) { if (st.snowy) for (const t of tips) dl.poly(brush([t[0] - t[2] * 0.3, t[1] + 1, t[0], t[1] - 0.5], 0.9 * st.lw, rng), rgba(st.snowC, 0.9)); return; }
    for (const t of tips) {
      const r = t[2] * rng.range(0.7, 1.1);
      dl.poly(blob(t[0], t[1], r * 0.8, r * 0.6, 0, 10, rng, 0.45), rgba(cols[0], (st.mode === 'flat' ? 0.5 : 0.1) * st.L.ink));
      const n = Math.round(clamp(r * 1.4, 6, 24) * st.det);
      for (let i = 0; i < n; i++) {
        const c = cols[Math.floor(rng() * cols.length)], rr = rng.range(0.9, 2.1) * st.lw;
        dl.poly(blob(t[0] + rng.norm() * r, t[1] + rng.norm() * r * 0.7, rr, rr * 0.8, 0, 6, rng, 0.3), rgba(c, rng.range(0.6, 0.95) * Math.max(0.5, st.L.ink)));
      }
    }
  }
  // Japanese cedar: a tall, narrow, dark spire, grown in stands on the hills.
  function sugi(dl, rng, st, x, y, s) {
    dl.poly(brush([x, y, x, y - s], Math.max(0.4, s * 0.035) * st.lw, rng, { taper: 0 }), st.bark(0.8));
    const tiers = rng.int(5, 8);
    for (let k = 0; k < tiers; k++) {
      const t = 0.18 + (0.8 * k) / tiers, w = s * 0.2 * (1 - t * 0.75), yy = y - s * t;
      dl.poly([x - w, yy + w * 0.5, x, yy - s * 0.16, x + w, yy + w * 0.5], st.pine(rng.range(0.55, 0.85)));
    }
    if (st.snowy) dl.poly([x - s * 0.06, y - s * 0.86, x, y - s * 1.0, x + s * 0.06, y - s * 0.86], rgba(st.snowC, 0.9));
  }
  function tinyTree(dl, rng, st, x, y, s) {
    if (rng() < 0.6) sugi(dl, rng, st, x, y, s);
    else { dl.poly(brush([x, y, x, y - s * 0.4], 0.5 * st.lw, rng, { taper: 0 }), st.bark(0.6)); dl.poly(blob(x, y - s * 0.6, s * 0.35, s * 0.18, 0, 8, rng, 0.3), st.pine(0.75)); }
  }
  function grove(dl, rng, st, x, w, n, size, gy, avoid) {
    const trees = [];
    n = Math.round(n * dens('trees'));
    for (let i = 0; i < n; i++) {
      const tx = x + rng.range(-w, w), back = rng(), ty = gy(tx) + 2 - back * size * 0.25;
      if (avoid && avoid(tx, ty, size * 0.2)) continue;
      trees.push({ x: tx, y: ty, s: size * (1 - back * 0.35) * rng.range(0.8, 1.2) });
    }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) { if (rng() < 0.75) sugi(dl, rng, st, t.x, t.y, t.s); else bloomTree(dl, rng, st, t.x, t.y, t.s * 0.8); }
  }

  // ------------------------------------------------------------------ buildings
  function snowOn(dl, st, pts) { if (st.snowy) dl.poly(pts, rgba(st.snowC, 0.95)); }
  // Thatched farmhouse (minka): a huge, steep roof over low white walls.
  function minka(dl, rng, st, x, y, s) {
    const w = s * rng.range(1.8, 2.5), wh = s * 0.5, l = x - w / 2, r = x + w / 2, top = y - wh;
    dl.poly(rect(l, top, w, wh), st.wall);
    for (const px of [l, r, l + w * rng.range(0.3, 0.4), l + w * rng.range(0.6, 0.7)]) dl.poly(brush([px, y, px, top], 0.6 * st.lw, rng, { taper: 0, wob: 0.2 }), st.wood(0.85));
    dl.poly(brush([l, top + wh * 0.35, r, top + wh * 0.35], 0.4 * st.lw, rng, { taper: 0 }), st.wood(0.6));
    const wx = l + w * rng.range(0.08, 0.15), ww = s * 0.42, wy = top + wh * 0.42;
    dl.poly(rect(wx, wy, ww, wh * 0.36), st.ink(0.18));
    for (let k = 1; k < 4; k++) dl.poly(rect(wx + (ww * k) / 4, wy, 0.3 * st.lw, wh * 0.36), st.wood(0.7));
    dl.light(wx + ww / 2, wy + wh * 0.18, s * 0.8);
    dl.poly(rect(x + w * 0.12, top + wh * 0.3, s * 0.3, wh * 0.7), st.ink(0.55));
    // the roof: steep hipped thatch with a dark ridge cap and gable vents
    const ov = s * 0.3, rh = s * rng.range(0.95, 1.25), inset = w * rng.range(0.16, 0.24);
    const roofP = [l - ov, top + 1, r + ov, top + 1, r - inset, top - rh, l + inset, top - rh];
    dl.poly(roofP, st.thatch(1));
    const m = Math.max(4, Math.round(w / 2.5));
    for (let k = 0; k <= m; k++) {
      const t = k / m, bx = lerp(l - ov, r + ov, t), tx2 = lerp(l + inset, r - inset, t);
      dl.poly(brush([tx2, top - rh, bx, top], 0.35 * st.lw, rng, { taper: 0, wob: 0.3 }), st.ink(rng.range(0.12, 0.3)));
    }
    dl.poly(brush([l - ov, top + 1, r + ov, top + 1], 1.4 * st.lw, rng, { taper: 0, wob: 0.2 }), st.ink(0.75));
    dl.poly(rect(l + inset - s * 0.08, top - rh - s * 0.12, w - 2 * inset + s * 0.16, s * 0.14), st.ink(0.75));
    for (const sx of [l + inset + s * 0.05, r - inset - s * 0.25]) dl.poly([sx, top - rh + s * 0.02, sx + s * 0.1, top - rh - s * 0.22, sx + s * 0.2, top - rh + s * 0.02], st.ink(0.7));
    if (st.accentRoof && rng() < 0.4) dl.poly([l + inset, top - rh, r - inset, top - rh, r - inset - s * 0.15, top - rh + s * 0.25, l + inset + s * 0.15, top - rh + s * 0.25], st.accent(0.7));
    snowOn(dl, st, [l - ov + 2, top - 1, r + ov - 2, top - 1, r - inset, top - rh, l + inset, top - rh]);
  }
  // Tiled roof with upswept eaves, used by temples, pagodas and gates.
  function tileRoof(dl, rng, st, x, y, hw, h, lift) {
    const n = 12, eave = [], ridgeHW = hw * 0.35;
    for (let i = 0; i < n; i++) { const t = i / (n - 1), u = t * 2 - 1; eave.push(x + u * hw, y - lift * Math.pow(Math.abs(u), 4) + h * 0.08 * (1 - u * u)); }
    const body = eave.slice().concat([x + ridgeHW, y - h, x - ridgeHW, y - h]);
    dl.poly(body, st.tile(1));
    const m = Math.max(3, Math.round(hw / 3));
    for (let k = 0; k <= m; k++) { const u = (k / m) * 2 - 1; dl.poly(brush([x + u * hw * 0.9, y - lift * Math.pow(Math.abs(u), 4) * 0.8, x + u * ridgeHW, y - h], 0.3 * st.lw, rng, { taper: 0 }), st.ink(0.25)); }
    dl.poly(brush(eave, 1.0 * st.lw, rng, { wob: 0.2, min: 0.5 }), st.ink(0.85));
    dl.poly(brush([x - ridgeHW - hw * 0.06, y - h - lift * 0.25, x - ridgeHW, y - h, x + ridgeHW, y - h, x + ridgeHW + hw * 0.06, y - h - lift * 0.25], 1.1 * st.lw, rng, { taper: 0 }), st.ink(0.85));
    snowOn(dl, st, [x - hw * 0.85, y - lift * 0.4, x + hw * 0.85, y - lift * 0.4, x + ridgeHW, y - h, x - ridgeHW, y - h]);
  }
  function shrine(dl, rng, st, x, y, s) {
    const w = s * 1.9, ph = s * 0.75, l = x - w / 2, r = x + w / 2, top = y - ph;
    dl.poly(rect(l - s * 0.25, y - s * 0.14, w + s * 0.5, s * 0.16), st.ink(0.5));
    dl.poly(rect(l + s * 0.1, top + ph * 0.2, w - s * 0.2, ph * 0.65), st.wall);
    for (const px of [l + s * 0.1, x - s * 0.3, x + s * 0.3, r - s * 0.1]) dl.poly(brush([px, y - s * 0.12, px, top], 0.8 * st.lw, rng, { taper: 0 }), st.pillar);
    dl.light(x, y - s * 0.35, s * 0.8);
    tileRoof(dl, rng, st, x, top, w * 0.5 + s * 0.5, s * 0.7, s * 0.28);
  }
  // Five-storey pagoda with a ringed spire (sōrin).
  function pagoda(dl, rng, st, x, y, s) {
    const tiers = 5;
    let yy = y, w = s * 0.75;
    const th = s * 0.62;
    dl.poly(rect(x - w * 0.7, y - s * 0.1, w * 1.4, s * 0.12), st.ink(0.5));
    for (let t = 0; t < tiers; t++) {
      const bh = th * 0.45;
      dl.poly(rect(x - w / 2, yy - bh, w, bh), st.wall);
      dl.poly(brush([x - w / 2, yy, x - w / 2, yy - bh], 0.5 * st.lw, rng, { taper: 0 }), st.pillar);
      dl.poly(brush([x + w / 2, yy, x + w / 2, yy - bh], 0.5 * st.lw, rng, { taper: 0 }), st.pillar);
      tileRoof(dl, rng, st, x, yy - bh, w / 2 + s * 0.42, th * 0.36, s * 0.16);
      yy -= th * 0.78; w *= 0.88;
    }
    dl.poly(brush([x, yy + th * 0.4, x, yy - s * 0.85], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.85));
    for (let k = 0; k < 6; k++) dl.poly(rect(x - s * 0.07, yy - s * 0.1 - k * s * 0.1, s * 0.14, s * 0.03), st.ink(0.75));
    dl.light(x, y - th * 0.3, s * 0.75);
  }
  function torii(dl, rng, st, x, y, s) {
    const w = s * 1.3, col = st.accent(st.mode === 'wet' ? 0.85 : 0.95), pw = Math.max(0.8, s * 0.09);
    for (const px of [x - w * 0.36, x + w * 0.36]) dl.poly([px - pw / 2 - s * 0.02, y, px - pw / 2, y - s * 1.05, px + pw / 2, y - s * 1.05, px + pw / 2 + s * 0.02, y], col);
    dl.poly(rect(x - w * 0.5, y - s * 0.82, w, s * 0.07), col); // nuki
    const kasagi = [x - w * 0.66, y - s * 1.08, x - w * 0.3, y - s * 1.02, x + w * 0.3, y - s * 1.02, x + w * 0.66, y - s * 1.08, x + w * 0.62, y - s * 1.2, x, y - s * 1.12, x - w * 0.62, y - s * 1.2];
    dl.poly(kasagi, col);
    dl.poly(brush([x - w * 0.66, y - s * 1.17, x, y - s * 1.12, x + w * 0.66, y - s * 1.17], Math.max(0.6, s * 0.06), rng, { taper: 0 }), st.ink(0.85));
    dl.poly(rect(x - s * 0.05, y - s * 1.02, s * 0.1, s * 0.2), st.ink(0.6));
  }
  function lantern(dl, rng, st, x, y, s) {
    const c = st.stone;
    dl.poly(rect(x - s * 0.2, y - s * 0.1, s * 0.4, s * 0.1), c);
    dl.poly(rect(x - s * 0.06, y - s * 0.5, s * 0.12, s * 0.4), c);
    dl.poly(rect(x - s * 0.16, y - s * 0.75, s * 0.32, s * 0.25), c);
    dl.poly(rect(x - s * 0.08, y - s * 0.7, s * 0.16, s * 0.14), st.ink(0.4));
    dl.poly([x - s * 0.3, y - s * 0.74, x + s * 0.3, y - s * 0.74, x, y - s * 0.98], st.ink(0.7));
    dl.poly(blob(x, y - s * 1.02, s * 0.05, s * 0.06, 0, 6, rng, 0.1), st.ink(0.7));
    dl.light(x, y - s * 0.63, s * 0.7);
  }
  // Castle keep (tenshu) on a battered stone base.
  function castle(dl, rng, st, x, y, s) {
    const bw = s * 2.6, bh = s * 0.9, bt = s * 1.9, base = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; base.push(x - lerp(bw / 2, bt / 2, Math.pow(t, 0.6)), y - bh * t); }
    for (let i = 8; i >= 0; i--) { const t = i / 8; base.push(x + lerp(bw / 2, bt / 2, Math.pow(t, 0.6)), y - bh * t); }
    dl.poly(base, st.stone);
    for (let k = 0; k < 14; k++) { const yy = y - bh * rng(), hw = lerp(bw / 2, bt / 2, Math.pow((y - yy) / bh, 0.6)); dl.poly(brush([x - hw * rng(), yy, x + hw * rng() * 0.5, yy], 0.4 * st.lw, rng, { taper: 0 }), st.ink(0.25)); }
    dl.poly(brush(base.slice(0, 18), 0.8 * st.lw, rng, { wob: 0.2 }), st.ink(0.6));
    dl.poly(brush(base.slice(18), 0.8 * st.lw, rng, { wob: 0.2 }), st.ink(0.6));
    let yy = y - bh, w = bt * 0.92;
    const tiers = rng.int(3, 4);
    for (let t = 0; t < tiers; t++) {
      const wh = s * (t === 0 ? 0.6 : 0.42);
      dl.poly(rect(x - w / 2, yy - wh, w, wh), st.wall);
      for (let k = 0; k < Math.round(w / (s * 0.3)); k++) dl.poly(rect(x - w / 2 + s * 0.12 + k * s * 0.3, yy - wh * 0.6, s * 0.08, wh * 0.25), st.ink(0.45));
      if (t === 0) dl.light(x, yy - wh * 0.5, s * 0.9);
      tileRoof(dl, rng, st, x, yy - wh, w / 2 + s * 0.3, s * 0.4, s * 0.16);
      if (t < tiers - 1 && rng() < 0.7) { // a triangular gable (chidori-hafu) on the roof slope
        const gx = x + rng.range(-0.15, 0.15) * w, gy = yy - wh - s * 0.08;
        dl.poly([gx - s * 0.35, gy, gx + s * 0.35, gy, gx, gy - s * 0.32], st.tile(1));
        dl.poly(brush([gx - s * 0.38, gy, gx, gy - s * 0.34, gx + s * 0.38, gy], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.8));
      }
      yy -= wh + s * 0.32; w *= 0.72;
    }
    for (const sx of [-1, 1]) dl.poly(blob(x + sx * w * 0.6, yy + s * 0.1, s * 0.06, s * 0.1, 0, 6, rng, 0.2), rgba([214, 170, 70], 0.9));
  }
  function bridge(dl, rng, st, cx, y, span, s) {
    const n = 14, deck = [], under = [], rail = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), bx = cx - span / 2 + span * t, e = Math.sin(Math.PI * t);
      deck.push(bx, y - s * 0.9 * e - s * 0.1); rail.push(bx, y - s * 0.9 * e - s * 0.55); under.push(bx, y + s * 0.2 - s * 0.95 * Math.pow(e, 0.6));
    }
    const body = deck.slice();
    for (let i = n - 1; i >= 0; i--) body.push(under[i * 2], under[i * 2 + 1]);
    dl.poly(body, st.wood(0.95));
    dl.poly(brush(deck, 1.0 * st.lw, rng, { taper: 0 }), st.ink(0.85));
    dl.poly(brush(rail, 0.7 * st.lw, rng, { taper: 0 }), st.pillar);
    for (let i = 1; i < n - 1; i += 2) dl.poly(brush([deck[i * 2], deck[i * 2 + 1], rail[i * 2], rail[i * 2 + 1]], 0.6 * st.lw, rng, { taper: 0 }), st.pillar);
  }
  // A traveller under a wide kasa hat.
  function person(dl, rng, st, x, y, s) {
    dl.poly([x - s * 0.12, y - s * 0.7, x + s * 0.12, y - s * 0.7, x + s * 0.2, y, x - s * 0.18, y], rng() < 0.5 ? st.ink(0.75) : st.wall);
    dl.poly(brush([x - s * 0.12, y - s * 0.7, x - s * 0.18, y], 0.4 * st.lw, rng, { taper: 0 }), st.ink(0.6));
    dl.poly([x - s * 0.3, y - s * 0.72, x, y - s * 0.95, x + s * 0.3, y - s * 0.72], st.thatch(1));
    dl.poly(brush([x - s * 0.3, y - s * 0.72, x, y - s * 0.95, x + s * 0.3, y - s * 0.72], 0.4 * st.lw, rng, { taper: 0 }), st.ink(0.7));
  }
  // Sampan with a boatman poling from the stern, or a square-sailed cargo boat.
  function boat(dl, rng, st, x, y, s, dir) {
    const L = 52 * s, hh = 6 * s;
    const hull = [x - L / 2, y - hh * 1.2, x - L * 0.3, y - hh * 0.4, x + L * 0.35, y - hh * 0.4, x + L / 2, y - hh * 1.5, x + L * 0.4, y, x - L * 0.38, y];
    if (dir < 0) for (let i = 0; i < hull.length; i += 2) hull[i] = 2 * x - hull[i];
    dl.poly(hull, st.ink(0.85));
    if (rng() < 0.3) {
      const mx = x + dir * L * 0.05, sw = L * 0.4, sh = L * 0.65;
      dl.poly(brush([mx, y - hh, mx, y - hh - sh * 1.05], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.85));
      dl.poly(rect(mx - sw / 2, y - hh - sh, sw, sh * 0.85), st.wall);
      for (let k = 0; k <= 5; k++) dl.poly(brush([mx - sw / 2, y - hh - sh + (k * sh * 0.85) / 5, mx + sw / 2, y - hh - sh + (k * sh * 0.85) / 5], 0.4 * st.lw, rng, { taper: 0 }), st.ink(0.55));
      dl.poly(brush([mx - sw / 2, y - hh - sh, mx - sw / 2, y - hh - sh * 0.15], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.6));
      dl.poly(brush([mx + sw / 2, y - hh - sh, mx + sw / 2, y - hh - sh * 0.15], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.6));
    } else {
      const px = x - dir * L * 0.32;
      person(dl, rng, st, px, y - hh * 0.6, 20 * s);
      dl.poly(brush([px + dir * 4 * s, y - hh - 22 * s, px - dir * L * 0.25, y + 14 * s], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.8));
      if (rng() < 0.5) dl.poly([x + dir * L * 0.05 - L * 0.13, y - hh * 0.5, x + dir * L * 0.05 - L * 0.1, y - hh * 2.6, x + dir * L * 0.05 + L * 0.1, y - hh * 2.6, x + dir * L * 0.05 + L * 0.13, y - hh * 0.5], st.thatch(1));
      dl.light(x + dir * L * 0.1, y - hh * 1.6, 7 * s);
    }
    for (let k = 0; k < 4; k++) {
      const ry = y + hh * 0.6 + k * 3.2 * s, rl = L * rng.range(0.4, 1.1), rx = x + rng.range(-0.2, 0.2) * L;
      dl.poly(brush([rx - rl / 2, ry, rx, ry + 0.4, rx + rl / 2, ry], 0.7 * st.lw, rng), st.wave(0.5 - k * 0.1));
    }
  }

  // ------------------------------------------------------------------ water
  // Kano / Hokusai water: long, parallel, gently swelling lines. Every line is a function of
  // WORLD x (seeded per row, not per chunk), so neighbouring chunks join without a seam.
  function waves(dl, st, seed, x0, x1, top, bottom, density) {
    const rows = Math.round(lerp(4, 26, density)), x = x0 - 3;
    const n = Math.ceil((x1 - x + 3) / 6) + 1;
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows, yr = lerp(top + 3, bottom, Math.pow(t, 1.25));
      const rs = hash2(seed, 700 + r), amp = lerp(1.2, 5, t) * (0.6 + (rs % 100) / 160), fq = 0.012 + ((rs >>> 8) % 100) / 9000, ph = ((rs >>> 16) % 628) / 100;
      const pts = [];
      for (let i = 0; i < n; i++) { const px = x + i * 6; pts.push(px, yr + amp * Math.sin(px * fq + ph) + amp * 0.6 * vnoise(rs, px / 70)); }
      const wbase = lerp(0.35, 0.9, t) * st.lw;
      // gaps and tapers also come from world-x noise
      const hw = (px) => { const v = vnoise(rs + 9, px / 160); return wbase * sstep(-0.35, 0.05, v) * (0.7 + 0.3 * vnoise(rs + 3, px / 40)); };
      const a = st.waveA * lerp(0.35, 0.9, t);
      dl.poly(ribbon(pts, hw), st.wave(a));
      if (density > 0.55 && r % 2 === 0) { // the paired line Kano painters run alongside each crest
        const pts2 = pts.map((v, k) => (k % 2 ? v + lerp(1.5, 4, t) : v));
        dl.poly(ribbon(pts2, (px) => hw(px) * 0.6), st.wave(a * 0.6));
      }
    }
  }

  // ------------------------------------------------------------------ feature builders
  const B = {
    distant(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      if (p.fuji) { volcano(dl, rng, st, f.x, L.base, p.hw, p.h); return dl; }
      const m = rangeShape(rng, f.x, L.base, p.hw, p.h, { bumps: 3 });
      landBody(dl, rng, st, m.sil, m.xs, m.ys, m.N, L.base, p.h, { wash: 1.1, mist: 0.6, bandDepth: 0.8, edgeA: 0.6 });
      return dl;
    },
    far(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      const m = p.crag ? crag(dl, rng, st, f.x, L.base, p.hw, p.h, { detail: 0.6, mist: 0.5 }) : rangeShape(rng, f.x, L.base, p.hw, p.h, { bumps: 4 });
      if (!p.crag) landBody(dl, rng, st, m.sil, m.xs, m.ys, m.N, L.base, p.h, { mist: 0.5, edgeA: 0.8 });
      for (let i = 1; i < m.N; i++) if (rng() < 0.2 && (L.base - m.ys[i]) / p.h > 0.35) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1, rng.range(4, 7));
      return dl;
    },
    mid(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base;
      let m;
      if (p.crag) m = crag(dl, rng, st, f.x, base, p.hw, p.h, { detail: 0.8, mist: 0.45 });
      else { m = rangeShape(rng, f.x, base, p.hw, p.h, { bumps: 3 }); landBody(dl, rng, st, m.sil, m.xs, m.ys, m.N, base, p.h, { mist: 0.45 }); }
      for (let i = 1; i < m.N; i++) if (rng() < 0.28 && (base - m.ys[i]) / p.h > 0.3) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1.5, rng.range(5, 10));
      const gy = (gx) => interpY(m.xs, m.ys, m.N, gx);
      if (p.crag && m.blocks) for (const b of m.blocks) if (rng() < 0.45) jpine(dl, rng, st, rng.range(b.l, b.r), Math.max(b.yl, b.yr) + 2, rng.range(10, 18));
      if (p.temple) {
        const i = Math.max(1, m.ys.indexOf(Math.min.apply(null, m.ys)));
        if (rng() < 0.5) pagoda(dl, rng, st, m.xs[i], m.ys[i] + 2, rng.range(4.5, 6)); else shrine(dl, rng, st, m.xs[i], m.ys[i] + 2, rng.range(4.5, 6));
      }
      if (rng() < 0.5) { const gx = f.x + rng.range(-0.6, 0.6) * p.hw; grove(dl, rng, st, gx, rng.range(12, 30), rng.int(5, 12), rng.range(9, 14), (x) => gy(x) + (base - gy(x)) * 0.25); }
      return dl;
    },
    main(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base;
      let m;
      if (p.form === 'crag') m = crag(dl, rng, st, f.x, base, p.hw, p.h, { detail: 1, mist: 0.38, scale: 1.2 });
      else { m = rangeShape(rng, f.x, base, p.hw, p.h, { bumps: 4 }); landBody(dl, rng, st, m.sil, m.xs, m.ys, m.N, base, p.h, { mist: 0.4 }); }
      const gy = (gx) => interpY(m.xs, m.ys, m.N, gx);
      for (let i = 1; i < m.N; i++) if (rng() < 0.22 && (base - m.ys[i]) / p.h > 0.3) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1.5, rng.range(7, 13));
      if (m.blocks) {
        // pines clinging to the ledges, a waterfall in a cleft
        for (const b of m.blocks) if (rng() < 0.6) jpine(dl, rng, st, rng.range(b.l + 4, b.r - 4), Math.max(b.yl, b.yr) + 3, rng.range(18, 36));
        if (m.blocks.length > 2 && rng() < 0.45) {
          const j = 1 + Math.floor(rng() * (m.blocks.length - 2)), b = m.blocks[j], fx = b.l + 2, y0 = gy(fx) + 6, y1 = base - 30;
          if (y1 - y0 > 60) {
            const w = rng.range(3, 6), Lp = [], Rp = [];
            for (let i = 0; i < 10; i++) { const t = i / 9, yy = lerp(y0, y1, t), ww = w * (0.6 + 0.9 * t); Lp.push(fx - ww, yy); Rp.push(fx + ww, yy); }
            const poly = Lp.slice();
            for (let i = 9; i >= 0; i--) poly.push(Rp[i * 2], Rp[i * 2 + 1]);
            dl.poly(poly, rgba(st.foamC, 0.97));
            dl.poly(brush(Lp, 0.6 * st.lw, rng, { wob: 0.5 }), st.ink(0.4));
            dl.poly(brush(Rp, 0.6 * st.lw, rng, { wob: 0.5 }), st.ink(0.4));
            for (let k = 0; k < 4; k++) { const sx = fx + rng.range(-0.6, 0.6) * w, a = y0 + rng.range(0, 0.3) * (y1 - y0); dl.poly(brush([sx, a, sx + rng.range(-1, 1), a + (y1 - a) * rng.range(0.4, 0.9)], 0.45 * st.lw, rng), st.ink(0.18)); }
            dl.poly(blob(fx, y1, w * 4, w * 1.5, 0, 12, rng, 0.4), rgba(st.foamC, 0.7));
          }
        }
      } else {
        const groves = rng.int(1, 3);
        for (let g = 0; g < groves; g++) {
          const gx = f.x + rng.range(-0.75, 0.75) * p.hw, drop = rng.range(0.12, 0.4);
          if ((base - gy(gx)) / p.h < 0.25) continue;
          grove(dl, rng, st, gx, rng.range(14, 40), rng.int(6, 16), rng.range(16, 26), (x) => gy(x) + (base - gy(x)) * drop);
        }
      }
      if (p.temple) {
        for (let tries = 0; tries < 30; tries++) {
          const i = 4 + Math.floor(rng() * (m.N - 8)), fr = (base - m.ys[i]) / p.h;
          if (fr < 0.3 || fr > 0.9) continue;
          const sl = Math.abs(m.ys[i + 3] - m.ys[i - 3]) / (m.xs[i + 3] - m.xs[i - 3]);
          if (sl > 0.3) continue;
          const tx = m.xs[i], ty = m.ys[i] + 3;
          if (p.castle) castle(dl, rng, st, tx, ty + 4, rng.range(9, 12));
          else if (rng() < 0.5) pagoda(dl, rng, st, tx, ty, rng.range(8, 11));
          else { shrine(dl, rng, st, tx, ty, rng.range(7, 9)); if (rng() < 0.6) torii(dl, rng, st, tx + rng.range(16, 26) * (rng() < 0.5 ? -1 : 1), ty + 6, 7); }
          for (let t = 0; t < 2; t++) jpine(dl, rng, st, tx + rng.range(-26, 26), ty + rng.range(4, 10), rng.range(16, 26));
          break;
        }
      }
      return dl;
    },
    hill(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base - 8;
      const m = rangeShape(rng, f.x, base, p.hw, p.h, { bumps: 2, sharp: 2.4, depth: 40 });
      landBody(dl, rng, st, m.sil, m.xs, m.ys, m.N, base, p.h, { mist: 0.5, wash: 0.8 });
      const gy = (gx) => interpY(m.xs, m.ys, m.N, gx);
      grove(dl, rng, st, f.x + rng.range(-0.4, 0.4) * p.hw, p.hw * 0.4, rng.int(8, 18), rng.range(16, 24), (x) => gy(x) + (base - gy(x)) * 0.15);
      if (rng() < P(0.3, 'towers')) { const tx = f.x + rng.range(-0.3, 0.3) * p.hw; pagoda(dl, rng, st, tx, gy(tx) + 3, rng.range(8, 11)); }
      return dl;
    },
    water(f, L, st) {
      const dl = new DL(), x0 = f.p.x0, top = L.base, bottom = L.id === 5 ? 1000 : L.y1;
      dl.poly(rect(x0 - 1, top, CW + 2, bottom - top + 2), st.waterFill(top, bottom));
      waves(dl, st, f.p.ws, x0, x0 + CW, top, bottom, st.waveDensity * (L.id === 5 ? 1 : 0.6));
      return dl;
    },
    // Shore land for villages: a low, flat-topped bank.
    bank(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, W = L.base, x = f.x, hw = p.hw, h = p.h;
      const sd = (rng() * 1e6) | 0, N = clamp(Math.round(hw / 4), 20, 120), xs = new Float32Array(N + 1), ys = new Float32Array(N + 1);
      const by = p.shore ? W + rng.range(10, 30) : W + p.dy;
      const e1 = rng.range(0.25, 1.1), e2 = rng.range(0.25, 1.1), tilt = rng.range(-0.3, 0.3), sil = [];
      for (let i = 0; i <= N; i++) {
        const u = -1 + (2 * i) / N;
        const g = sstep(-1, -1 + e1, u) * (1 - sstep(1 - e2, 1, u)) * (1 + tilt * u) * (1 + 0.25 * fbm(sd, u * 4, 3)) + 0.04 * vnoise(sd + 3, u * 40) * (1 - u * u);
        xs[i] = x + u * hw; ys[i] = by - h * Math.max(0, g); sil.push(xs[i], ys[i]);
      }
      if (p.shore) sil.push(x + hw * 1.2, 1012, x - hw * 1.2, 1012); else sil.push(x + hw, by + 3, x - hw, by + 3);
      const bottom = p.shore ? 1000 : by + 3;
      landBody(dl, rng, st, sil, xs, ys, N, bottom, Math.max(h, 30), { wash: 0.7, mist: 0.01, bandDepth: 0.5, edgeA: 1.1 });
      // a sandy foreshore line and foam where it meets the water
      if (p.shore) for (let k = 0; k < 3; k++) { const sgn = k % 2 ? 1 : -1, fx = x + sgn * hw * rng.range(0.98, 1.15); curl(dl, rng, st, fx, Math.min(995, by + rng.range(0, 14)), rng.range(4, 8) * st.lw, sgn); }
      const gy = (gx) => interpY(xs, ys, N, gx);
      const sc = p.scale || 1, occ = new Occ(), treeOcc = new Occ();
      if (p.grove) grove(dl, rng, st, x + rng.range(-0.5, 0.5) * hw, hw * rng.range(0.15, 0.35), rng.int(6, 16), rng.range(20, 30) * sc, gy);
      // trees stand behind the buildings
      const nTrees = Math.round(p.trees * dens('trees'));
      for (let t = 0, tries = 0; t < nTrees && tries < nTrees * 5; tries++) {
        const tx = x + rng.range(-0.75, 0.75) * hw, ty = gy(tx) + 2;
        const H = Math.min((p.shore ? rng.range(90, 230) : rng.range(40, 100)) * sc, ty - L.y0 - 20);
        const gap = H * 0.3;
        if (H < 20 || !treeOcc.free(tx - gap, tx + gap)) continue;
        treeOcc.add(tx - gap, tx + gap); t++;
        if (rng() < (p.shore ? 0.6 : 0.35)) jpine(dl, rng, st, tx, ty, H * rng.range(0.7, 1)); else bloomTree(dl, rng, st, tx, ty, H * 0.75);
      }
      if (p.village) {
        const want = Math.round(rng.int(3, 7) * Math.sqrt(dens('villages'))), s = rng.range(11, 15) * sc * (p.shore ? 1.4 : 1);
        if (rng() < P(0.3, 'towers')) { const tx = x + rng.range(-0.6, 0.6) * hw; if (occ.free(tx - s, tx + s)) { occ.add(tx - s, tx + s); pagoda(dl, rng, st, tx, gy(tx) + 2, s * 0.9); } }
        const houses = [];
        for (let tries = 0; tries < want * 6 && houses.length < want; tries++) {
          const hs = s * rng.range(0.8, 1.05), half = hs * 1.6, hx = x + rng.range(-0.55, 0.55) * hw;
          if (Math.abs(gy(hx - half * 0.7) - gy(hx + half * 0.7)) > hs * 0.5 || !occ.free(hx - half, hx + half)) continue;
          occ.add(hx - half, hx + half); houses.push([hx, hs]);
        }
        houses.sort((a, b) => a[0] - b[0]);
        for (const [hx, hs] of houses) minka(dl, rng, st, hx, gy(hx) + 2, hs);
        const nl = rng.int(0, 2);
        for (let k = 0; k < nl; k++) { const lx = x + rng.range(-0.6, 0.6) * hw; if (occ.free(lx - 4, lx + 4)) lantern(dl, rng, st, lx, gy(lx) + 2, s * 0.55); }
        if (houses.length && rng() < 0.6) { const px = x + rng.range(-0.6, 0.6) * hw; person(dl, rng, st, px, gy(px) + 2, s * 0.85); }
      }
      if (p.shrine) {
        const tx = x + rng.range(-0.3, 0.3) * hw, s = rng.range(10, 14) * sc;
        if (occ.free(tx - s * 1.3, tx + s * 1.3)) { occ.add(tx - s * 1.3, tx + s * 1.3); shrine(dl, rng, st, tx, gy(tx) + 2, s); const ox = tx + (rng() < 0.5 ? -1 : 1) * s * 2.4; torii(dl, rng, st, ox, gy(ox) + 3, s * 0.9); }
      }
      if (p.stream) {
        // a little stream crossed by an arched bridge
        const bx = x + rng.range(-0.4, 0.4) * hw, yb = gy(bx) + h * 0.35, span = rng.range(26, 40) * sc;
        if (occ.free(bx - span / 2, bx + span / 2)) { occ.add(bx - span / 2, bx + span / 2); bridge(dl, rng, st, bx, Math.min(bottom - 4, yb), span, rng.range(7, 10) * sc); }
      }
      return dl;
    },
    reef(f, L, st) {
      // a rock in the surf, wrapped in foam curls (the bottom of a Kano wave screen)
      const dl = new DL(), rng = RNG(f.seed), p = f.p, y = p.y;
      crag(dl, rng, st, f.x, y, p.hw, p.h, { detail: 1.2, mist: 0.01, depth: 6, scale: 0.8 });
      const nc = rng.int(4, 9);
      for (let k = 0; k < nc; k++) curl(dl, rng, st, f.x + rng.range(-1.2, 1.2) * p.hw, y + rng.range(-4, 10), rng.range(4, 10) * st.lw, rng() < 0.5 ? 1 : -1);
      if (rng() < 0.6) jpine(dl, rng, st, f.x + rng.range(-0.4, 0.4) * p.hw, y - p.h * 0.75, rng.range(30, 60));
      return dl;
    },
    seatorii(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), s = f.p.s, y = f.p.y;
      torii(dl, rng, st, f.x, y, s);
      for (let k = 0; k < 5; k++) { const ry = y + 2 + k * 3, rl = s * rng.range(0.8, 1.8); dl.poly(brush([f.x - rl / 2, ry, f.x, ry + 0.4, f.x + rl / 2, ry], 0.7 * st.lw, rng), st.wave(0.55 - k * 0.08)); }
      return dl;
    },
    boat(f, L, st, eng, S) {
      const dl = new DL(), rng = RNG(f.seed);
      for (let j = f.ci - 2; j <= f.ci + 2; j++)
        for (const g of eng.features(S, j)) if ((g.kind === 'bank' || g.kind === 'reef' || g.kind === 'seatorii') && Math.abs(g.x - f.x) < (g.p.hw || 30) * 1.1 + 50) return dl;
      boat(dl, rng, st, f.x, f.p.y, (0.6 + ((f.p.y - L.base) / 150) * 0.6) * (f.p.scale || 1), rng() < 0.5 ? 1 : -1);
      return dl;
    },
    // An old pine leaning out over the water from the foreground shore.
    greattree(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, y = p.y;
      const sil = [], hw = p.hw, sd = (rng() * 1e6) | 0, xs = new Float32Array(25), ys = new Float32Array(25);
      for (let i = 0; i <= 24; i++) { const u = -1 + i / 12; xs[i] = f.x + u * hw; ys[i] = y - p.h * Math.pow(clamp(1 - u * u, 0, 1), 0.7) * (1 + 0.3 * vnoise(sd, u * 3)); sil.push(xs[i], ys[i]); }
      sil.push(f.x + hw, 1012, f.x - hw, 1012);
      landBody(dl, rng, st, sil, xs, ys, 24, 1000, p.h + 40, { wash: 0.8, mist: 0.01, edgeA: 1.1 });
      for (let k = 0; k < 4; k++) curl(dl, rng, st, f.x + rng.range(-1.1, 1.1) * hw, Math.min(996, y + rng.range(0, 14)), rng.range(5, 9) * st.lw, rng() < 0.5 ? 1 : -1);
      if (p.plum && st.bloomCols) bloomTree(dl, rng, st, f.x, ys[12] + 3, p.H * 0.8);
      else jpine(dl, rng, st, f.x + rng.range(-0.2, 0.2) * hw, ys[12] + 3, p.H);
      if (rng() < 0.5) lantern(dl, rng, st, f.x + rng.range(0.3, 0.6) * hw * (rng() < 0.5 ? -1 : 1), interpY(xs, ys, 24, f.x + 0.45 * hw) + 3, 16);
      return dl;
    },
  };

  // ------------------------------------------------------------------ engine
  class YugenEngine extends Engine {
    _gen(L, ci) {
      const seed = this.o.seed, rng = RNG(hash4(seed, L.id, ci, 13)), x0 = ci * CW, out = [];
      const m = this.macro(L.id, x0 + CW * 0.5), add = this._adder(L, ci, out);
      if (L.kind === 'distant') {
        // a lone snow-capped cone every so often, never two close together
        const fujiAt = (c) => hash2(seed, c * 7 + 3) % 11 === 0;
        let fuji = fujiAt(ci);
        for (let j = 1; j <= 4 && fuji; j++) if (fujiAt(ci - j)) fuji = false;
        if (fuji) { const hw = rng.range(330, 420); add('distant', x0 + CW * 0.5, 2, hw + 10, { fuji: true, hw, h: hw * rng.range(0.5, 0.6) }); }
        const n = 1 + (rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) { const hw = rng.range(260, 420), h = rng.range(50, 140) * (0.7 + 0.6 * m); add('distant', x0 + rng() * CW, rng(), hw + 10, { hw, h }); }
      } else if (L.kind === 'far') {
        const n = 1 + (rng() < 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++) { const crag = rng() < 0.18, hw = crag ? rng.range(80, 170) : rng.range(200, 420), h = rng.range(100, 280) * (0.7 + 0.5 * m); add('far', x0 + rng() * CW, 1 - h / 400 + rng() * 0.3, hw * 1.25 + 20, { hw, h, crag }); }
      } else if (L.kind === 'mid') {
        const n = 1 + (rng() < 0.55 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const crag = rng() < 0.4, hw = crag ? rng.range(70, 170) : rng.range(150, 360), h = rng.range(140, crag ? 380 : 320) * (0.7 + 0.5 * m);
          add('mid', x0 + rng() * CW, 1 - h / 600 + rng() * 0.3, hw * 1.25 + 40, { hw, h, crag, temple: rng() < P(0.3, 'towers') });
        }
      } else if (L.kind === 'main') {
        const mm = sstep(0.25, 0.75, m);
        const n = mm > 0.6 ? 1 + (rng() < P(0.35, 'mountains') ? 1 : 0) : rng() < P(0.45 + 0.5 * mm, 'mountains') ? 1 : 0;
        for (let i = 0; i < n; i++) {
          const form = rng() < 0.3 + 0.3 * mm ? 'crag' : 'range', hw = form === 'crag' ? rng.range(100, 230) : rng.range(170, 400);
          const h = form === 'crag' ? Math.min(680, rng.range(280, 440) + 220 * mm * rng()) : rng.range(180, 360) + 80 * mm;
          const temple = rng() < P(0.6, 'towers');
          add('main', x0 + rng() * CW, 1 - h / 800 + rng() * 0.2, hw * 1.35 + 40, { hw, h, form, temple, castle: temple && form === 'range' && rng() < 0.3 });
        }
      } else if (L.kind === 'valley') {
        add('water', x0 + CW / 2, -10, CW / 2 + 4, { x0, ws: hash2(seed, 4400) });
        if (rng() < 0.5) { const hw = rng.range(140, 300); add('hill', x0 + rng() * CW, -5 + rng(), hw * 1.1 + 50, { hw, h: rng.range(50, 130) }); }
        const r = rng();
        if (r < P(0.6 + 0.25 * m, 'villages')) { const hw = rng.range(150, 380); add('bank', x0 + rng() * CW, 0.3 + rng() * 0.4, hw * 1.1 + 80, { hw, h: rng.range(40, 100), dy: rng.range(0, 25), village: true, trees: rng.int(1, 3), grove: rng() < 0.5, shrine: rng() < P(0.25, 'towers'), stream: rng() < P(0.3, 'rivers'), scale: 1.1 }); }
        else if (r < 0.92) { const hw = rng.range(100, 240); add('bank', x0 + rng() * CW, 0.1 + rng() * 0.2, hw * 1.1 + 80, { hw, h: rng.range(20, 55), dy: rng.range(0, 30), grove: rng() < 0.8, trees: rng.int(0, 2), shrine: rng() < P(0.3, 'towers'), scale: 1.0 }); }
        if (rng() < P(0.3, 'boats')) { const by = L.base + 18 + rng() * 40; add('boat', x0 + rng() * CW, 0.2 + (by - L.base) / 200, 70, { y: by, scale: 0.6 }); }
      } else {
        add('water', x0 + CW / 2, -10, CW / 2 + 4, { x0, ws: hash2(seed, 5500) });
        const r = rng(), open = m < 0.22;
        if (!open && r < 0.55) {
          const hw = rng.range(170, 400);
          add('bank', x0 + rng() * CW, 0.5 + rng() * 0.3, hw * 1.2 + 140, { shore: true, hw, h: rng.range(50, 160), trees: rng.int(1, 3), village: rng() < P(0.45, 'villages'), grove: rng() < 0.3, shrine: rng() < P(0.15, 'towers'), stream: rng() < P(0.35, 'rivers'), scale: 1.3 });
        } else if (r < 0.7) {
          add('reef', x0 + rng() * CW, 0.3 + rng() * 0.2, 140, { y: L.base + rng.range(20, 60), hw: rng.range(30, 80), h: rng.range(50, 140) });
        } else if (r < 0.78) {
          const hw = rng.range(90, 150);
          add('greattree', x0 + rng() * CW, 0.6, hw + 260, { y: L.base + rng.range(10, 40), hw, h: rng.range(30, 60), H: rng.range(260, 380), plum: rng() < 0.4 });
        } else if (r < 0.84 && rng() < P(0.8, 'towers')) {
          add('seatorii', x0 + rng() * CW, 0.2, 40, { y: L.base + rng.range(30, 60), s: rng.range(26, 40) });
        }
        if (rng() < P(0.45, 'boats')) { const by = L.base + 22 + rng() * 60; add('boat', x0 + rng() * CW, (by - L.base) / 200, 80, { y: by }); }
      }
      return out;
    }
    _style(L) {
      const S = STYLES[this.o.style] || STYLES.sumi, season = this.season, a = L.ink;
      const air = S.air, hz = (c, k) => mixc(c, air, clamp(L.haze * (k == null ? 1 : k), 0, 1));
      const ink = S.ink, wash = SEASON_WASH[season] * (S.mode === 'wet' ? 1 : 1);
      const paper = hz(S.mode === 'wet' ? [252, 250, 245] : S.paper, 0.5);
      const bloom = S.bloom[season];
      const water = S.water.map((c) => hz(c, 0.6));
      const snowy = season === 'winter';
      const col = (c, aa) => rgba(hz(c, 0.8), aa * Math.max(0.55, a));
      return {
        L, mode: S.mode, det: L.det, lw: L.lw, season, snowy, wash,
        airC: air, snowC: hz(S.snow, 0.3), foamC: hz(S.mode === 'flat' ? [248, 248, 244] : S.mode === 'mineral' ? [246, 242, 230] : S.paper, 0.3),
        ridgeCol: snowy && S.mode !== 'wet' ? hz([236, 236, 232], 0.4) : hz(S.ridge, 0.7),
        ink: (x) => rgba(ink, x * a),
        accent: (x) => rgba(hz(S.accent, 0.7), x),
        accentRoof: S.mode === 'line',
        pillar: rgba(hz(S.mode === 'wet' ? S.ink : S.accent, 0.7), S.mode === 'wet' ? 0.8 * a : 0.95),
        wall: rgba(hz(S.wall, 0.6), 1),
        stone: rgba(hz(S.mode === 'wet' ? [236, 234, 228] : S.mode === 'line' ? S.paper : [176, 170, 156], 0.6), 1),
        wood: (x) => rgba(hz(S.wood, 0.6), x),
        thatch: (x) => rgba(hz(S.thatch, 0.6), x),
        tile: (x) => rgba(hz(S.tile, 0.6), x),
        bark: (x) => rgba(hz(S.bark, 0.5), x * Math.max(0.6, a)),
        pine: (x) => col(S.pine, x),
        bloomCols: bloom ? bloom.map((c) => hz(c, 0.6)) : null,
        foam: (x) => rgba(hz(S.mode === 'flat' ? [250, 250, 246] : S.mode === 'mineral' ? [246, 242, 230] : S.paper, 0.3), x),
        wave: (x) => rgba(S.waveCol ? hz(S.waveCol, 0.4) : ink, x * (S.waveCol ? 1 : a)),
        waveA: S.waveA, waveDensity: S.mode === 'wet' ? 0.25 : S.mode === 'line' ? 0.55 : S.mode === 'mineral' ? 0.95 : 0.7,
        waterFill: (y0, y1) => [0, y0, 0, y1, 0, rgba(water[0], 1), 1, rgba(water[1], 1)],
        body: (x, top, base, rock) => {
          const pal = rock ? S.rock || S.land : S.land;
          if (!pal) return rgba(paper, 1);
          return [x, top, x, base, 0, rgba(hz(pal[0], 0.85), 1), 1, rgba(hz(pal[1], 0.85), 1)];
        },
      };
    }
    _autoWeather(season, r) {
      if (season === 'spring') return r < 0.3 ? 'petals' : r < 0.42 ? 'rain' : 'none';
      if (season === 'autumn') return r < 0.28 ? 'petals' : r < 0.38 ? 'rain' : 'none';
      if (season === 'winter') return r < 0.45 ? 'snow' : 'none';
      return r < 0.16 ? 'rain' : 'none';
    }
    get S() { return STYLES[this.o.style] || STYLES.sumi; }

    // ---------- sprites
    _sprites() {
      super._sprites();
      const S = this.S, H = this.H;
      this.sunImg = null;
      if (S.sun) {
        const r = Math.round(S.sun.r * H), pad = Math.ceil(r * 0.1), c = mkCanvas(2 * (r + pad), 2 * (r + pad)), g = c.getContext('2d'), cx = r + pad, rng = RNG(hash2(this.o.seed, 61));
        g.fillStyle = rgba(S.sun.col, 1);
        if (S.sun.tex === 'flat') { g.beginPath(); g.arc(cx, cx, r, 0, TAU); g.fill(); }
        else {
          // a brushed disc: slightly irregular rim, then dry streaks scraped out of it
          g.beginPath();
          for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU, rr = r * (1 + (S.sun.tex === 'rough' ? 0.015 : 0.025) * Math.sin(a * 5 + rng() * 0.6)); g.lineTo(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr); }
          g.fill();
          g.globalCompositeOperation = 'destination-out';
          const n = S.sun.tex === 'rough' ? 70 : 26;
          for (let i = 0; i < n; i++) {
            const y = cx + rng.range(-r, r), x = cx + rng.range(-r, r), l = r * rng.range(0.2, 0.9), w = r * rng.range(0.004, 0.02);
            g.globalAlpha = rng.range(0.2, 0.7);
            g.fillRect(x - l / 2, y, l, Math.max(0.6, w));
          }
          g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        }
        this.sunImg = c;
      }
    }
    // Cloud bands. Soft paper mist for the ink styles, gold-leaf clouds with scalloped edges
    // for the screen, crisp bokashi strips for the print.
    _paintMist(g, mb, i, w, h) {
      const S = this.S, kx = this.kx, rng = RNG(hash2(this.o.seed, 300 + i));
      if (S.mist === 'soft') {
        const n = Math.round(26 * mb.dens), paper = S.paper;
        for (let j = 0; j < n; j++) {
          const rx = rng.range(160, 480) * kx, ry = Math.min(h * 0.42, rx * rng.range(0.07, 0.16));
          const cx = rng() * w, cy = ry + rng() * (h - 2 * ry), a = rng.range(0.35, 0.75);
          for (const ox of [-w, 0, w]) {
            g.save(); g.translate(cx + ox, cy); g.scale(1, ry / rx);
            const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
            gr.addColorStop(0, rgba(paper, a)); gr.addColorStop(0.55, rgba(paper, a * 0.8)); gr.addColorStop(1, rgba(paper, 0));
            g.fillStyle = gr; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore();
          }
        }
        return;
      }
      const gold = S.mist === 'gold', k = this.k, n = gold ? Math.max(1, Math.round(2.2 * mb.dens)) : Math.max(2, Math.round(5 * mb.dens));
      for (let j = 0; j < n; j++) {
        const bw = rng.range(gold ? 420 : 300, gold ? 900 : 680) * kx, bh = Math.min(h * 0.62, rng.range(30, 70) * k), cx = ((j + rng.range(0.1, 0.9)) / n) * w, cy = bh * 0.7 + rng() * (h - bh * 1.4);
        // gold: a long cloud with a few broad, low lobes on top, flat underneath, darker rim
        const lobes = [];
        if (gold) {
          const m = Math.max(3, Math.round(bw / (bh * 2.2)));
          for (let q = 0; q < m; q++) { const t = (q + 0.5) / m, e = Math.sin(Math.PI * t); lobes.push([(t - 0.5) * bw * 0.9, -bh * 0.12 * e, bh * (0.3 + 0.22 * e) * rng.range(0.85, 1.15)]); }
        }
        for (const ox of [-w, 0, w]) {
          const x0 = cx + ox - bw / 2, x1 = cx + ox + bw / 2;
          if (x1 < -bh || x0 > w + bh) continue;
          g.beginPath();
          if (S.mist === 'gold') {
            for (const L of lobes) { g.moveTo(cx + ox + L[0] + L[2], cy + L[1]); g.arc(cx + ox + L[0], cy + L[1], L[2], 0, TAU); }
            g.roundRect(x0 + bw * 0.04, cy - bh * 0.05, bw * 0.92, bh * 0.34, bh * 0.17);
            g.save(); g.strokeStyle = 'rgba(140,96,34,0.6)'; g.lineWidth = Math.max(2, 2.6 * k); g.stroke(); g.restore();
            const gr = g.createLinearGradient(0, cy - bh * 0.7, 0, cy + bh * 0.4);
            gr.addColorStop(0, 'rgb(240,210,128)'); gr.addColorStop(0.6, 'rgb(226,188,102)'); gr.addColorStop(1, 'rgb(210,166,80)');
            g.fillStyle = gr; g.fill();
          } else {
            // print: a long strip of pale colour whose ends fade out (a wiped bokashi block)
            g.rect(x0, cy - bh * 0.32, bw, bh * 0.64);
            const c = j % 3 === 0 ? [246, 222, 214] : [250, 247, 238], gr = g.createLinearGradient(x0, 0, x1, 0);
            gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.25, rgba(c, 0.9)); gr.addColorStop(0.75, rgba(c, 0.9)); gr.addColorStop(1, rgba(c, 0));
            g.fillStyle = gr; g.fill();
          }
        }
      }
    }
    _paintGrain() {
      const S = this.S, rng = RNG(77);
      if (S.grain === 'leaf') {
        // gold leaf: squares of slightly different sheen, with darker overlapping seams
        const sq = Math.max(24, Math.round(this.H * 0.085)), T = sq * 3, tile = mkCanvas(T, T), g = tile.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, T, T);
        for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
          const v = Math.round(rng.range(228, 255));
          g.fillStyle = 'rgb(' + v + ',' + v + ',' + Math.round(v * 0.985) + ')'; g.fillRect(x * sq, y * sq, sq, sq);
          g.fillStyle = 'rgba(160,120,60,0.18)'; g.fillRect(x * sq, y * sq, sq, Math.max(1, sq * 0.02)); g.fillRect(x * sq, y * sq, Math.max(1, sq * 0.02), sq);
          for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(150,110,60,' + rng.range(0.04, 0.12).toFixed(3) + ')'; const r = rng.range(2, sq * 0.12); g.beginPath(); g.ellipse(x * sq + rng() * sq, y * sq + rng() * sq, r, r * 0.5, rng() * 3, 0, TAU); g.fill(); }
        }
        return tile;
      }
      const T = 256, tile = mkCanvas(T, T), tg = tile.getContext('2d'), img = tg.createImageData(T, T);
      const amp = S.grain === 'speck' ? 40 : S.grain === 'wood' ? 18 : 16, pw = S.grain === 'speck' ? 4 : 3;
      for (let i = 0; i < T * T; i++) { const v = 255 - Math.floor(Math.pow(rng(), pw) * amp); img.data[i * 4] = v; img.data[i * 4 + 1] = v - 2; img.data[i * 4 + 2] = v - 6; img.data[i * 4 + 3] = 255; }
      tg.putImageData(img, 0, 0);
      tg.lineCap = 'round';
      if (S.grain === 'wood') {
        // the woodgrain of the printing block, pulled across the whole sheet
        for (let i = 0; i < 60; i++) { const y = rng() * T; tg.strokeStyle = 'rgba(120,100,80,' + rng.range(0.03, 0.07).toFixed(3) + ')'; tg.lineWidth = rng.range(0.5, 1.6); tg.beginPath(); tg.moveTo(0, y); for (let x = 0; x <= T; x += 16) tg.lineTo(x, y + 2 * Math.sin(x / 40 + i)); tg.stroke(); }
      } else {
        const nf = S.grain === 'washi' ? 260 : 160;
        for (let i = 0; i < nf; i++) {
          const x = rng() * T, y = rng() * T, a = rng() * TAU, l = rng.range(6, 26);
          tg.strokeStyle = 'rgba(150,130,105,' + rng.range(0.03, 0.09).toFixed(3) + ')'; tg.lineWidth = rng.range(0.3, 1);
          tg.beginPath(); tg.moveTo(x, y); tg.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); tg.stroke();
        }
      }
      return tile;
    }
    _paintOverlay(g, top, bot) {
      super._paintOverlay(g, top, bot);
      if (this.S.grain === 'leaf' && this.o.paper) {
        // the leaf texture again, a touch stronger, so the gold reads as metal
        g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.35;
        g.fillStyle = g.createPattern(this.grain, 'repeat'); g.fillRect(0, 0, this.W, this.H);
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      }
    }
    _skyGradient() {
      const S = this.S, H = this.H, g = this.ctx.createLinearGradient(0, 0, 0, H * 0.75);
      if (S.mode === 'flat') {
        // bokashi: a band of prussian blue printed along the top edge, fading to the paper
        g.addColorStop(0, 'rgb(44,74,124)'); g.addColorStop(0.16, 'rgb(96,132,168)'); g.addColorStop(0.42, 'rgb(226,222,204)'); g.addColorStop(1, rgba(S.paper, 1));
      } else if (S.mode === 'mineral') {
        g.addColorStop(0, 'rgb(222,182,96)'); g.addColorStop(1, 'rgb(214,172,84)');
      } else {
        g.addColorStop(0, rgba(mixc(S.paper, [255, 255, 255], 0.35), 1)); g.addColorStop(1, rgba(S.paper, 1));
      }
      return g;
    }
    _drawSky() {
      const ctx = this.ctx, S = this.S;
      ctx.fillStyle = this.skyGrad; ctx.fillRect(0, 0, this.W, this.H);
      if (S.mode === 'flat' && this.sun && this.night < 0.9) {
        // dawn and dusk glow printed in a second block along the horizon
        const glow = clamp(1 - Math.abs(this.sun.e) * 3, 0, 1) * (1 - this.night);
        if (glow > 0.02) { const gr = ctx.createLinearGradient(0, this.H * 0.2, 0, this.H * 0.55); gr.addColorStop(0, 'rgba(236,150,110,0)'); gr.addColorStop(1, rgba([236, 150, 110], 0.55 * glow)); ctx.fillStyle = gr; ctx.fillRect(0, this.H * 0.2, this.W, this.H * 0.35); }
      }
      if (this.sun && this.sunImg && this.night < 0.6) {
        const e = clamp(this.sun.e, 0, 1), img = this.sunImg, s = lerp(1.08, 0.92, e);
        ctx.globalAlpha = S.sun.a * (1 - this.night / 0.6);
        ctx.drawImage(img, this.sun.x - (img.width * s) / 2, this.sun.y - (img.height * s) / 2, img.width * s, img.height * s);
        ctx.globalAlpha = 1;
      }
      if (this.moon) this._drawMoon(this.H * (S.mode === 'line' ? 0.05 : 0.032));
    }
    _drawInscription() {
      if (!this.inscr) return;
      const x = this.S.sun && this.S.sun.r > 0.1 ? 52 * this.k : this.W - this.inscr.width - 46 * this.k;
      this.ctx.drawImage(this.inscr, Math.round(x), Math.round(56 * this.k));
    }
    _paintInscription() {
      const S = this.S, k = this.k, fs = Math.round(30 * k), phrase = PHRASES[hash2(this.o.seed, 41) % PHRASES.length];
      const ins = mkCanvas(Math.round(fs * 1.6), Math.round(fs * (phrase.length * 1.14 + 2.7))), ig = ins.getContext('2d');
      ig.font = fs + "px 'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'MS Mincho', 'Noto Serif CJK JP', serif";
      ig.textAlign = 'center'; ig.textBaseline = 'top'; ig.fillStyle = rgba(S.mode === 'flat' ? [34, 40, 58] : S.ink, 0.78);
      for (let i = 0; i < phrase.length; i++) ig.fillText(phrase[i], ins.width / 2, i * fs * 1.14);
      // a round-cornered hanko seal
      const ss = Math.round(fs * 1.2), sx = (ins.width - ss) / 2, sy = phrase.length * fs * 1.14 + fs * 0.7, sr = RNG(hash2(this.o.seed, 42)), rr = ss * 0.18;
      ig.fillStyle = rgba(S.accent, 0.9);
      ig.beginPath(); ig.moveTo(sx + rr, sy); ig.arcTo(sx + ss, sy, sx + ss, sy + ss, rr); ig.arcTo(sx + ss, sy + ss, sx, sy + ss, rr); ig.arcTo(sx, sy + ss, sx, sy, rr); ig.arcTo(sx, sy, sx + ss, sy, rr); ig.fill();
      ig.globalCompositeOperation = 'destination-out';
      ig.font = 'bold ' + Math.round(ss * 0.62) + "px 'Yu Mincho', 'MS Mincho', serif";
      ig.textBaseline = 'middle';
      ig.fillText('幽', sx + ss / 2, sy + ss * 0.54);
      for (let i = 0; i < 36; i++) { ig.beginPath(); ig.arc(sx + sr() * ss, sy + sr() * ss, sr() * ss * 0.025, 0, TAU); ig.fill(); }
      ig.globalCompositeOperation = 'source-over';
      return ins;
    }
    // Cranes: long necks and trailing legs; slow, deep wingbeats.
    _birds(dt) {
      const ctx = this.ctx, k = this.k;
      this.birdT -= dt;
      if (this.o.birds && !this.reduceMotion && this.birdT <= 0 && this.night < 0.5 && this.weather !== 'rain' && this.flocks.length < 2) {
        const r = RNG((Math.random() * 1e9) | 0), dir = r() < 0.5 ? 1 : -1, n = r.int(2, 6), birds = [];
        for (let j = 0; j < n; j++) birds.push({ dx: -dir * j * r.range(16, 26), dy: (j % 2 ? 1 : -1) * Math.ceil(j / 2) * r.range(6, 10) + r.range(-3, 3), ph: r() * TAU, f: r.range(0.9, 1.3) });
        this.flocks.push({ x: dir > 0 ? -80 * k : this.W + 80 * k, y: r.range(70, 300), vx: dir * r.range(16, 26), s: r.range(5, 8), dir, birds });
        this.birdT = r.range(30, 90);
      }
      if (!this.flocks.length) return;
      const S = this.S;
      ctx.strokeStyle = rgba(S.mode === 'flat' ? [34, 40, 58] : S.ink, 0.75); ctx.lineWidth = Math.max(1, 1.2 * k); ctx.lineCap = 'round';
      ctx.beginPath();
      for (const fl of this.flocks) {
        fl.x += fl.vx * this.kx * dt;
        const fy = fl.y + 8 * Math.sin(this.time * 0.3);
        for (const b of fl.birds) {
          const bx = fl.x + b.dx * k, by = (fy + b.dy) * k, s = fl.s * k, f = Math.sin(this.time * TAU * b.f / 2 + b.ph), d = fl.dir;
          ctx.moveTo(bx - s * 1.2, by - s * 0.5 * f - s * 0.1);
          ctx.quadraticCurveTo(bx - s * 0.5, by - s * 0.6 * f, bx, by);
          ctx.quadraticCurveTo(bx + s * 0.5, by - s * 0.6 * f, bx + s * 1.2, by - s * 0.5 * f - s * 0.1);
          ctx.moveTo(bx, by); ctx.lineTo(bx + d * s * 0.9, by - s * 0.08);   // neck
          ctx.moveTo(bx, by); ctx.lineTo(bx - d * s * 1.0, by + s * 0.12);   // legs
        }
      }
      ctx.stroke();
      this.flocks = this.flocks.filter((fl) => fl.x > -400 * k && fl.x < this.W + 400 * k);
    }
    // Falling blossom in spring, maple leaves in autumn (plus the shared rain and snow).
    _weather(dt) {
      if (this.weather !== 'petals' || this.reduceMotion) return super._weather(dt);
      this._petals(dt);
    }
  }
  YugenEngine.def = {
    layers: LAYERS, mist: MIST, tod: TOD, paper: STYLES.sumi.paper, ink: STYLES.sumi.ink, sun: STYLES.sumi.accent,
    sky: { horizon: 0.42, zenith: 0.12 },
    styles: Object.keys(STYLES), defaults: { style: 'sumi' }, builders: B, styleSprites: true, weathers: ['none', 'petals', 'rain', 'snow'],
  };

  window.Driftscape.register({
    id: 'yugen', name: 'Yūgen', native: '幽玄', seal: '幽', order: 2,
    tagline: 'Japanese ink landscape',
    blurb: 'Snow-capped cones, Kano-school crags, black pines, thatched villages and torii in the shallows, with cranes drifting past.',
    Engine: YugenEngine, paper: '#f6f3ec', ink: '#1e1d20', accent: '#c42c24',
    styles: [
      { id: 'sumi', name: 'Sumi-e', native: '墨絵', blurb: 'Wet ink washes on white washi, a single red sun', swatch: ['#f6f3ec', '#9a9894', '#1e1d20', '#cc2e26'] },
      { id: 'hanga', name: 'Woodcut', native: '版画', blurb: 'Dense black linework on sepia paper under a big red sun', swatch: ['#e9dbbe', '#8a7458', '#161210', '#de402e'] },
      { id: 'kinpeki', name: 'Gold screen', native: '金碧', blurb: 'Gold-leaf clouds, mineral greens and ink waves', swatch: ['#d6ac54', '#4a765c', '#2a241e', '#be3c26'] },
      { id: 'ukiyoe', name: 'Ukiyo-e', native: '浮世絵', blurb: 'Prussian-blue bokashi skies and flat woodblock colour', swatch: ['#eee4cc', '#5c8aaa', '#2c4a7c', '#c8422e'] },
    ],
    weathers: [{ id: 'auto', name: 'Automatic' }, { id: 'none', name: 'Clear' }, { id: 'petals', name: 'Falling blossom' }, { id: 'rain', name: 'Rain' }, { id: 'snow', name: 'Snow' }],
    toggles: [{ id: 'birds', name: 'Cranes' }, { id: 'mist', name: 'Cloud bands' }, { id: 'inscription', name: 'Inscription and seal' }, { id: 'paper', name: 'Paper texture' }],
  });
})();
