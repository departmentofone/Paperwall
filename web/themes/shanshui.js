/*
 * Shan Shui: procedural, infinitely scrolling Chinese ink landscape.
 * Inspired by LingDong-'s shan-shui-inf (MIT). Written from scratch for Canvas 2D.
 */
(function () {
  'use strict';
  const { Engine, CW, TAU, clamp, lerp, sstep, hash2, hash4, RNG, vnoise, fbm, rgba, mixc,
    DL, brush, curve, offsetLine, blob, rect, qbez, interpY, Occ, mkCanvas, dens, P } = window.Paperwall;

  // ------------------------------------------------------------------ colour
  const PAPER = [240, 233, 216];
  // Ink is a warm mid-grey, never black: the darkest mark lands around 50% grey on the paper.
  // This restraint, plus white-bodied mountains, is most of what gives the painting its calm.
  const INK = [78, 74, 70];
  const JADE_A = [58, 118, 116], JADE_B = [96, 140, 108];
  const SEAL_RED = [176, 38, 32];

  const SEASONS = {
    spring: { leaf: [[204, 108, 128], [226, 150, 162], [112, 140, 92]], willow: [112, 148, 86], wash: 1.0 },
    summer: { leaf: [[48, 70, 52], [66, 90, 60], [38, 52, 44]], willow: [66, 98, 66], wash: 1.1 },
    autumn: { leaf: [[170, 64, 38], [196, 122, 50], [138, 50, 34], [120, 92, 48]], willow: [156, 128, 58], wash: 0.9 },
    winter: { leaf: null, willow: [100, 100, 92], wash: 0.55 },
  };

  // ------------------------------------------------------------------ layers
  // "High distance" composition (高远): the farther a layer is, the HIGHER its baseline sits on
  // the scroll, so distant ranges fill the upper half instead of all resting on one horizon.
  // y0..y1 is the vertical band a layer's chunk bitmaps cover; base is where its ground/water is.
  const LAYERS = [
    { id: 0, kind: 'distant', par: 0.04, y0: 230, y1: 500,  base: 440, R: 2, ink: 0.35, lw: 0.5,  det: 0.2,  fill: [214, 211, 202] },
    { id: 1, kind: 'far',     par: 0.10, y0: 140, y1: 590,  base: 520, R: 2, ink: 0.42, lw: 0.55, det: 0.3,  fill: [232, 229, 220] },
    { id: 2, kind: 'mid',     par: 0.22, y0: 110, y1: 700,  base: 625, R: 2, ink: 0.55, lw: 0.7,  det: 0.55, fill: [242, 239, 231] },
    { id: 3, kind: 'main',    par: 0.42, y0: 30,  y1: 880,  base: 745, R: 2, ink: 0.75, lw: 0.85, det: 1.0,  fill: [251, 249, 244] },
    { id: 4, kind: 'valley',  par: 0.66, y0: 600, y1: 925,  base: 835, R: 2, ink: 0.8,  lw: 0.95, det: 0.9,  fill: [251, 249, 244] },
    { id: 5, kind: 'near',    par: 1.00, y0: 420, y1: 1000, base: 905, R: 2, ink: 0.85, lw: 1.15, det: 1.0,  fill: [251, 249, 244] },
  ];
  // Mist strips drawn after a given layer (y = top of strip). The low ones veil each layer's
  // foot; the high, thin ones are clouds drifting across the peaks.
  const MIST = [
    { after: 0, y: 365, h: 140, a: 0.9, par: 0.06, drift: 2, dens: 1.0 },
    { after: 1, y: 450, h: 150, a: 0.95, par: 0.13, drift: 3, dens: 1.0 },
    { after: 2, y: 200, h: 200, a: 0.35, par: 0.3, drift: 5, dens: 0.5 },
    { after: 2, y: 545, h: 160, a: 1.0, par: 0.27, drift: 4, dens: 1.1 },
    { after: 3, y: 330, h: 220, a: 0.42, par: 0.5, drift: 6, dens: 0.5 },
    { after: 3, y: 670, h: 160, a: 0.75, par: 0.5, drift: 5, dens: 1.0 },
    { after: 4, y: 790, h: 110, a: 0.55, par: 0.75, drift: 6, dens: 0.8 },
  ];

  // time of day: hour, overlay tint top, tint bottom, night amount
  const TOD = [
    [0.0, [58, 66, 96], [76, 82, 108], 1],
    [4.6, [58, 66, 96], [76, 82, 108], 1],
    [5.6, [150, 130, 150], [190, 160, 160], 0.55],
    [6.4, [238, 198, 178], [250, 222, 198], 0.1],
    [7.6, [255, 247, 236], [255, 250, 242], 0],
    [16.6, [255, 250, 240], [255, 252, 246], 0],
    [18.0, [248, 214, 182], [252, 228, 204], 0.05],
    [19.0, [182, 150, 158], [204, 170, 164], 0.35],
    [20.2, [72, 76, 106], [90, 92, 116], 0.9],
    [21.0, [58, 66, 96], [76, 82, 108], 1],
    [24.0, [58, 66, 96], [76, 82, 108], 1],
  ];


  // ------------------------------------------------------------------ painters
  function texture(dl, rng, st, xs, ys, N, base, h, o) {
    const det = st.det * (o.detail != null ? o.detail : 1);
    const hw = (xs[N] - xs[0]) / 2;
    if (o.style === 'dots') { // Mi-style rice dots: wet horizontal blobs
      const n = Math.min(520, Math.round((det * hw * h) / 240));
      for (let k = 0; k < n; k++) {
        const i = 1 + Math.floor(rng() * (N - 1)), span = base - ys[i];
        if (span < 4) continue;
        const d = Math.pow(rng(), 1.8) * span * 0.9;
        const rx = rng.range(2.5, 7) * st.lw, ry = rx * rng.range(0.35, 0.55);
        dl.poly(blob(xs[i] + rng.range(-4, 4), ys[i] + 2 + d + ry, rx, ry, rng.range(-0.15, 0.15), 8, rng, 0.35),
          st.ink(rng.range(0.08, 0.3) * (1 - (d / span) * 0.7)));
      }
      return;
    }
    const axe = o.style === 'axe';
    // ---- Ring texture (the volume of the mountain) ------------------------------------------
    // Picture the mountain as R nested copies of its own silhouette, each smaller and settling
    // toward the base. Texture strokes are short arcs riding the space BETWEEN those rings, placed
    // only on the left or right third of the mountain: flanks fill with soft, overlapping, very
    // light lines while the middle stays lit. Volume comes from line density, not dark ink.
    const R = 10, cx = (xs[0] + xs[N]) / 2, sd = (rng() * 1e6) | 0;
    const ring = (layer, q) => {
      // point q of a fractional ring 'layer' (0 = silhouette, R-1 = innermost)
      const p = 1 - layer / R, sink = layer * h * 0.012;
      return [cx + (xs[q] - cx) * p, base - (base - ys[q]) * p + sink];
    };
    const tex = Math.round(Math.min(420, det * (60 + (hw * h) / 260)) * (axe ? 0.5 : 1));
    for (let k = 0; k < tex; k++) {
      const layer = (k / tex) * (R - 1);
      const mid = Math.floor((rng() < 0.5 ? rng() / 3 : 2 / 3 + rng() / 3) * N);
      const hlen = Math.floor(rng() * N * 0.2);
      const a = Math.max(0, mid - hlen), b = Math.min(N, mid + hlen);
      if (b - a < 2) continue;
      const amp = (30 / (layer + 1)) * (h / 320); // outer rings wander more, inner ones settle
      const pts = [];
      for (let q = a; q <= b; q++) {
        const [px, py] = ring(layer, q);
        pts.push(px + amp * vnoise(sd + k, q * 0.5), py + amp * 0.5 * vnoise(sd + k + 7, q * 0.5));
      }
      dl.poly(brush(pts, rng.range(0.9, 1.6) * st.lw, rng, { wob: 0.5, min: 0.2 }), st.ink(rng.range(0.04, 0.42)));
    }
    if (o.shade) { // occasional soft shading: a few broad, very faint passes on the flanks
      for (let k = 0; k < tex * 0.3; k++) {
        const layer = rng() * (R - 1), mid = Math.floor((rng() < 0.5 ? rng() / 3 : 2 / 3 + rng() / 3) * N);
        const hlen = Math.floor(rng() * N * 0.15), a = Math.max(0, mid - hlen), b = Math.min(N, mid + hlen), pts = [];
        for (let q = a; q <= b; q++) pts.push(...ring(layer, q));
        if (pts.length >= 6) dl.poly(brush(pts, 5 * st.lw, rng, { wob: 0.4 }), st.ink(0.06));
      }
    }
    const n = Math.min(300, Math.round((det * hw * h) / (axe ? 900 : 1800)));
    for (let k = 0; k < n; k++) {
      const i = 1 + Math.floor(rng() * (N - 1)), span = base - ys[i];
      if (span < 6) continue;
      const df = Math.pow(rng(), 1.5) * 0.85;
      const sx = xs[i] + rng.range(-2, 2), sy = ys[i] + 2 + df * span;
      const ia = Math.max(0, i - 1), ib = Math.min(N, i + 1);
      const sl = (ys[ib] - ys[ia]) / (xs[ib] - xs[ia]);
      const dir = sl < 0 ? -1 : 1;
      const a = lerp(Math.atan(Math.abs(sl)), Math.PI / 2, axe ? 0.55 : 0.35) + rng.range(-0.2, 0.2);
      const len = (axe ? rng.range(6, 20) : rng.range(10, 42)) * (0.5 + 0.5 * st.lw) * (1 - df * 0.5);
      const pts = curve(sx, sy, sx + dir * Math.cos(a) * len, sy + Math.sin(a) * len, axe ? 4 : 6, rng.range(-0.12, 0.12), rng, 0.25);
      const fade = 1 - df * 0.7;
      if (axe) dl.poly(brush(pts, rng.range(2, 5) * st.lw, rng, { prof: (t) => Math.pow(1 - t, 0.6), wob: 0.4 }), st.ink(rng.range(0.1, 0.28) * fade));
      else dl.poly(brush(pts, rng.range(0.5, 1.1) * st.lw, rng, { wob: 0.4 }), st.ink(rng.range(0.2, 0.45) * fade));
    }
  }

  function findPeaks(xs, ys, N, base, h, minF) {
    const out = [], win = Math.max(3, Math.round(N * 0.06));
    for (let i = 2; i < N - 1; i++) {
      if ((base - ys[i]) / h < minF) continue;
      let ok = true;
      for (let j = Math.max(0, i - win); j <= Math.min(N, i + win); j++) if (ys[j] < ys[i]) { ok = false; break; }
      if (ok && (!out.length || i - out[out.length - 1] > win)) out.push(i);
    }
    return out;
  }

  function spines(dl, rng, st, xs, ys, peaks, base) {
    for (const ip of peaks) {
      for (const side of [-1, 1]) {
        if (rng() > 0.8) continue;
        const px = xs[ip], py = ys[ip], span = base - py;
        const ex = px + side * span * rng.range(0.25, 0.6), ey = py + span * rng.range(0.4, 0.75);
        const pts = curve(px, py + 1, ex, ey, 10, side * rng.range(0.03, 0.12), rng, 0.3);
        dl.poly(brush(pts, 0.9 * st.lw, rng, { prof: (t) => 1 - 0.8 * t, wob: 0.5 }), st.ink(0.3));
        const m = Math.round(rng.range(6, 16) * st.det);
        for (let j = 0; j < m; j++) {
          const q = 1 + Math.floor(rng() * 8), hx = pts[q * 2], hy = pts[q * 2 + 1];
          const len = rng.range(5, 15) * st.lw, a = rng.range(1.0, 1.35);
          const hp = curve(hx, hy, hx + side * Math.cos(a) * len, hy + Math.sin(a) * len, 4, 0.05, rng, 0.2);
          dl.poly(brush(hp, rng.range(0.5, 1.0) * st.lw, rng), st.ink(rng.range(0.2, 0.4)));
        }
      }
    }
  }

  function waterfall(dl, rng, st, xs, ys, peaks, base) {
    if (peaks.length < 2) return;
    const a = peaks[0], b = peaks[1];
    let v = a;
    for (let i = a; i <= b; i++) if (ys[i] > ys[v]) v = i;
    const top = Math.min(ys[a], ys[b]);
    if (ys[v] - top < 25 || base - ys[v] < 60) return;
    const x0 = xs[v], y0 = ys[v] + 4, y1 = base - (base - ys[v]) * 0.12, n = 12;
    const w = rng.range(2.5, 5.5), s = (rng() * 1e6) | 0;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = lerp(y0, y1, t), cx = x0 + 4 * vnoise(s, t * 3), ww = w * (0.6 + 0.8 * t);
      L.push(cx - ww, y); R.push(cx + ww, y);
    }
    const poly = L.slice();
    for (let i = n - 1; i >= 0; i--) poly.push(R[i * 2], R[i * 2 + 1]);
    dl.poly(poly, rgba(PAPER, 0.96));
    dl.poly(brush(L, 0.6 * st.lw, rng, { wob: 0.5 }), st.ink(0.35));
    dl.poly(brush(R, 0.6 * st.lw, rng, { wob: 0.5 }), st.ink(0.35));
    dl.poly(blob(x0, y1, w * 4, w * 1.6, 0, 12, rng, 0.4), rgba(PAPER, 0.7));
  }

  function outline(dl, rng, st, xs, ys, N, base, h, alpha) {
    let i = 0;
    while (i < N) {
      const j = Math.min(N, i + 6 + Math.floor(rng() * 14));
      const pts = [];
      let ay = 0;
      for (let q = i; q <= j; q++) { pts.push(xs[q], ys[q] + rng.range(-0.3, 0.3)); ay += ys[q]; }
      ay /= j - i + 1;
      const a = alpha * sstep(0.04, 0.4, (base - ay) / h);
      if (a > 0.02) {
        dl.poly(brush(pts, rng.range(0.8, 1.6) * st.lw, rng, { wob: 0.4, min: 0.25 }), st.ink(a));
        // a second, fainter pass slightly inside: the doubled, searching line of a pencil sketch
        const off = rng.range(1, 2.5) * st.lw;
        dl.poly(brush(pts.map((v, k) => (k % 2 ? v + off : v + rng.range(-0.6, 0.6))), rng.range(0.5, 0.9) * st.lw, rng, { wob: 0.5, min: 0.2 }), st.ink(a * 0.45));
      }
      if (j >= N) break;
      i = j - (rng() < 0.3 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
    }
  }

  function mossDots(dl, rng, st, xs, ys, N, base, h, count) {
    for (let k = 0; k < count * 3; k++) {
      const i = Math.floor(rng() * (N + 1)), f = (base - ys[i]) / h;
      if (rng() > f * f) continue;
      const nc = rng.int(1, 3);
      for (let c = 0; c < nc; c++) {
        const rx = rng.range(1, 2.4) * st.lw;
        dl.poly(blob(xs[i] + rng.range(-3, 3), ys[i] + rng.range(0, 5), rx, rx * 0.65, rng.range(-0.4, 0.4), 6, rng, 0.3), st.ink(rng.range(0.55, 0.9)));
      }
    }
  }

  function tinyTree(dl, rng, st, x, y, s) {
    const r = rng();
    if (r < 0.3) { // teardrop: the classic distant ridge tree
      dl.poly(brush([x, y + 1, x, y - s * 0.4], 0.45 * st.lw, rng, { taper: 0 }), st.ink(0.6));
      dl.poly([x, y - s, x + s * 0.26, y - s * 0.42, x + s * 0.12, y - s * 0.22, x - s * 0.12, y - s * 0.22, x - s * 0.26, y - s * 0.42], st.ink(rng.range(0.55, 0.8)));
    } else if (r < 0.65) {
      dl.poly(brush([x, y, x + rng.range(-0.1, 0.1) * s, y - s], 0.55 * st.lw, rng, { taper: 0, wob: 0.1 }), st.ink(0.7));
      for (let k = 0; k < 3; k++) {
        const yy = y - s * (0.35 + 0.22 * k), w = s * (0.42 - 0.11 * k);
        dl.poly(brush([x - w, yy + w * 0.3, x, yy - 0.3, x + w, yy + w * 0.3], 0.9 * st.lw, rng), st.ink(0.6));
      }
    } else {
      dl.poly(brush([x, y, x, y - s * 0.5], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.6));
      dl.poly(blob(x, y - s * 0.72, s * 0.3, s * 0.38, 0, 8, rng, 0.4), st.ink(0.5));
    }
  }

  // Slender conifer, sketched: a thin trunk and tiers of small, soft, overlapping dabs.
  // Many light marks rather than one dark shape, so groves read as texture, not silhouettes.
  function fir(dl, rng, st, x, y, s) {
    const lean = rng.range(-0.06, 0.06) * s;
    dl.poly(brush([x, y, x + lean * 0.5, y - s * 0.5, x + lean, y - s], Math.max(0.45, s * 0.03) * st.lw, rng, { prof: (t) => 1 - 0.6 * t, min: 0.4 }), st.ink(0.6));
    const m = rng.int(5, 8);
    for (let k = 0; k < m; k++) {
      const t = 0.25 + (0.72 * k) / m, yy = y - s * t, w = s * 0.2 * (1 - t * 0.7) * rng.range(0.8, 1.2), cx = x + lean * t;
      const nd = Math.max(2, Math.round(w / 1.6));
      for (let d = 0; d < nd; d++) {
        const dx = rng.range(-w, w), r = Math.max(0.6, w * rng.range(0.22, 0.4));
        dl.poly(blob(cx + dx, yy + Math.abs(dx) * 0.25 + rng.range(-1, 1), r, r * 0.55, rng.range(-0.3, 0.3), 7, rng, 0.5), st.needle(rng.range(0.25, 0.5)));
      }
    }
    dl.poly([x + lean - s * 0.04, y - s * 0.95, x + lean, y - s * 1.06, x + lean + s * 0.04, y - s * 0.95], st.needle(0.45));
  }

  // Broadleaf tree reduced to a trunk and a few overlapping wet crown blobs.
  function roundTree(dl, rng, st, x, y, s) {
    const tw = Math.max(0.6, s * 0.06) * st.lw;
    dl.poly(brush([x, y, x + rng.range(-0.1, 0.1) * s, y - s * 0.55], tw, rng, { prof: (t) => 1 - 0.5 * t, min: 0.4 }), st.ink(0.75));
    const nb = rng.int(3, 5), bare = !st.sp.leaf;
    for (let k = 0; k < nb; k++) {
      const cx = x + rng.range(-0.22, 0.22) * s, cy = y - s * rng.range(0.55, 0.85), r = s * rng.range(0.16, 0.26);
      if (bare) dl.poly(brush(curve(x, y - s * 0.45, cx, cy - r, 4, rng.range(-0.2, 0.2), rng, 0.3), tw * 0.5, rng), st.ink(0.6));
      else dl.poly(blob(cx, cy, r, r * 0.8, 0, 10, rng, 0.4), st.leaf(rng, rng.range(0.3, 0.55)));
    }
  }

  // A stream winding from the back edge of the land toward the viewer, widening as it nears.
  // Drawn inside the land's clip, so it emerges from behind the skyline. Returns a lookup
  // (y -> centre/width) so houses and trees can stay out of the water.
  function river(dl, rng, st, x0, top, bottom, wTop, wBot) {
    const big = (bottom - top) / 120;
    const n = 22, ph = rng() * TAU, amp = rng.range(20, 50) * big, fq = rng.range(1.3, 2.6), drift = rng.range(-60, 60) * big;
    const C = [], Wd = [], L = [], R = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = lerp(top - 6, bottom, t);
      const cx = x0 + amp * Math.sin(t * Math.PI * fq + ph) * t + drift * t * t, w = lerp(wTop, wBot, Math.pow(t, 1.3));
      C.push(cx, y); Wd.push(w);
      L.push(cx - w / 2, y); R.push(cx + w / 2, y);
    }
    const poly = L.slice();
    for (let i = n - 1; i >= 0; i--) poly.push(R[i * 2], R[i * 2 + 1]);
    dl.poly(poly, rgba(mixc(PAPER, [250, 248, 241], 0.6), 1));
    // soft shadow of the banks on the water, then the inked banks
    const sw = Wd.map((w) => Math.min(w * 0.3, 10));
    dl.poly(brush(L.map((v, i) => (i % 2 ? v : v + sw[i >> 1] * 0.5)), 6 * st.lw, rng, { taper: 0, wob: 0.6 }), st.ink(0.07));
    dl.poly(brush(R.map((v, i) => (i % 2 ? v : v - sw[i >> 1] * 0.5)), 6 * st.lw, rng, { taper: 0, wob: 0.6 }), st.ink(0.05));
    dl.poly(brush(L, 1.0 * st.lw, rng, { wob: 0.5, min: 0.3 }), st.ink(0.7));
    dl.poly(brush(R, 0.9 * st.lw, rng, { wob: 0.5, min: 0.3 }), st.ink(0.55));
    // ripples: little wave marks, denser and darker toward the viewer
    const m = 30 + Math.round(n * 2.2);
    for (let k = 0; k < m; k++) {
      const i = 2 + Math.floor(Math.pow(rng(), 0.7) * (n - 3)), cx = C[i * 2] + rng.range(-0.32, 0.32) * Wd[i], y = C[i * 2 + 1] + rng.range(-4, 4);
      const l = Wd[i] * rng.range(0.12, 0.4), a = 0.18 + 0.3 * (i / n);
      dl.poly(brush([cx - l / 2, y, cx - l / 4, y - l * 0.08, cx, y, cx + l / 4, y - l * 0.08, cx + l / 2, y], rng.range(0.55, 1) * st.lw, rng), st.ink(a * rng.range(0.7, 1.2)));
    }
    return {
      at(y) { const t = clamp((y - (top - 6)) / (bottom - top + 6), 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(t)), f = t - i; return [lerp(C[i * 2], C[i * 2 + 2], f), lerp(Wd[i], Wd[i + 1], f)]; },
      top, bottom,
    };
  }

  // Arched stone bridge with a railing.
  function bridge(dl, rng, st, cx, y, span, s) {
    const n = 12, deck = [], under = [], rail = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), bx = cx - span / 2 + span * t, e = Math.sin(Math.PI * t);
      deck.push(bx, y - s * 0.55 * e - s * 0.12);
      rail.push(bx, y - s * 0.55 * e - s * 0.5);
      under.push(bx, y + s * 0.2 - s * 0.75 * Math.pow(e, 0.7));
    }
    const body = deck.slice();
    for (let i = n - 1; i >= 0; i--) body.push(under[i * 2], under[i * 2 + 1]);
    dl.poly(body, st.paper);
    dl.poly(brush(deck, 1.0 * st.lw, rng, { taper: 0, wob: 0.2 }), st.ink(0.85));
    dl.poly(brush(under, 0.8 * st.lw, rng, { wob: 0.3 }), st.ink(0.65));
    dl.poly(brush(rail, 0.45 * st.lw, rng, { taper: 0 }), st.ink(0.55));
    for (let i = 1; i < n - 1; i += 2) dl.poly(brush([deck[i * 2], deck[i * 2 + 1], rail[i * 2], rail[i * 2 + 1]], 0.45 * st.lw, rng, { taper: 0 }), st.ink(0.6));
    if (rng() < 0.5) person(dl, rng, st, cx + rng.range(-0.2, 0.2) * span, y - s * 0.62, s * 1.1);
  }

  // A dense clump of small trees; back rows sit higher and smaller so the grove has depth.
  function grove(dl, rng, st, x, w, n, size, gy, avoid) {
    const trees = [];
    n = Math.round(n * dens('trees'));
    for (let i = 0; i < n; i++) {
      const tx = x + rng.range(-w, w), back = rng(), ty = gy(tx) + 2 - back * size * 0.25;
      if (avoid && avoid(tx, ty, size * 0.2)) continue;
      trees.push({ x: tx, y: ty, s: size * (1 - back * 0.35) * rng.range(0.8, 1.2) });
    }
    trees.sort((a, b) => a.y - b.y);
    const mix = rng();
    for (const t of trees) {
      const r = rng();
      if (r < 0.55 + mix * 0.3) fir(dl, rng, st, t.x, t.y, t.s);
      else if (r < 0.9) roundTree(dl, rng, st, t.x, t.y, t.s * 0.8);
      else tinyTree(dl, rng, st, t.x, t.y, t.s * 0.6);
    }
  }



  // A cluster of houses. The back row stands on the skyline; a smaller front row sits lower on
  // the slope, each house on its own little terrace (the way painters seat buildings on hills).
  // Every placement reserves space, so nothing is generated on top of anything else.
  function village(dl, rng, st, x, w, s, gy, avoid, occ) {
    occ = occ || new Occ();
    const front = new Occ(), want = Math.round(rng.int(4, 8) * Math.sqrt(dens('villages')));
    const backs = [], fronts = [];
    const flat = (hx, half, hs) => Math.abs(gy(hx - half * 0.7) - gy(hx + half * 0.7)) < hs * 0.45;
    // a pagoda rising behind the roofs
    if (rng() < P(0.35, 'towers')) {
      const tx = x + rng.range(-0.8, 0.8) * w, half = s * 0.75;
      if (!(avoid && avoid(tx, gy(tx), half)) && occ.free(tx - half, tx + half) && flat(tx, half, s)) {
        occ.add(tx - half, tx + half);
        pagoda(dl, rng, st, tx, gy(tx) + 2, s * rng.range(0.8, 1.0));
      }
    }
    for (let tries = 0; tries < want * 6 && backs.length + fronts.length < want; tries++) {
      const isFront = backs.length >= 2 && rng() < 0.35;
      const hs = s * (isFront ? rng.range(0.9, 1.05) : rng.range(0.75, 0.9)), half = hs * 1.55;
      const hx = x + rng.range(-w, w), hy = gy(hx) + (isFront ? s * rng.range(1.5, 1.9) : 1.5);
      if (avoid && avoid(hx, hy, half)) continue;
      if (!flat(hx, half, hs)) continue;
      const o = isFront ? front : occ;
      if (!o.free(hx - half, hx + half)) continue;
      o.add(hx - half, hx + half);
      (isFront ? fronts : backs).push({ x: hx, y: hy, s: hs, half });
    }
    backs.sort((a, b) => a.x - b.x);
    for (const hs of backs) house(dl, rng, st, hs.x, hs.y, hs.s);
    // a footpath stepping down between the rows
    if (fronts.length) {
      const pts = [], m = 8;
      for (let i = 0; i < m; i++) { const px = x - w + (2 * w * i) / (m - 1); pts.push(px, gy(px) + s * 0.75 + rng.range(-1.5, 1.5)); }
      dl.poly(brush(pts, 0.5 * st.lw, rng, { wob: 0.5 }), st.ink(0.25));
    }
    for (const hs of fronts) {
      // terrace: a small level platform cut into the slope
      const tw = hs.half * 1.05, th = hs.s * 0.32;
      dl.poly([hs.x - tw, hs.y, hs.x + tw, hs.y, hs.x + tw * 0.92, hs.y + th, hs.x - tw * 0.92, hs.y + th], st.paper);
      dl.poly(brush([hs.x - tw, hs.y, hs.x + tw, hs.y], 0.6 * st.lw, rng, { taper: 0, wob: 0.3 }), st.ink(0.4));
      dl.poly(brush([hs.x - tw * 0.92, hs.y + th, hs.x + tw * 0.92, hs.y + th], 0.5 * st.lw, rng, { wob: 0.4 }), st.ink(0.25));
      house(dl, rng, st, hs.x, hs.y, hs.s);
      if (rng() < 0.45) { // low fence along the terrace edge
        const fl = tw * rng.range(0.5, 0.8), fx = hs.x + (rng() < 0.5 ? -1 : 1) * (tw - fl / 2), fy = hs.y + th * 0.6;
        dl.poly(brush([fx - fl / 2, fy - hs.s * 0.2, fx + fl / 2, fy - hs.s * 0.2], 0.4 * st.lw, rng, { taper: 0 }), st.ink(0.4));
        for (let k = 0; k <= 4; k++) { const px = fx - fl / 2 + (fl * k) / 4; dl.poly(brush([px, fy, px, fy - hs.s * 0.28], 0.35 * st.lw, rng, { taper: 0 }), st.ink(0.45)); }
      }
    }
    const np = rng.int(0, 2);
    for (let i = 0; i < np && fronts.length; i++) { const px = x + rng.range(-w, w); person(dl, rng, st, px, gy(px) + s * 0.8, s * 0.75); }
  }

  // Shared mountain body painter; returns the ridge for placing extras.
  function mtnBody(dl, rng, st, x, base, hw, h, o) {
    const sd = (rng() * 1e6) | 0;
    const form = o.form || 'spire';
    let nb = 1 + Math.floor(rng() * (o.bumps || 3)), sharp = o.sharp || rng.range(1.3, 2.4);
    const bumps = [{ c: rng.range(-0.3, 0.3), h: 1, s: rng.range(0.24, 0.45) }];
    if (form === 'massif') { bumps[0].s = rng.range(0.45, 0.7); sharp = rng.range(1.8, 2.8); nb = rng.int(3, 6); }
    else if (form === 'dome') { bumps[0].s = rng.range(0.4, 0.6); sharp = rng.range(2.2, 3); nb = rng.int(1, 2); }
    h = Math.min(h, hw * bumps[0].s * 4.5); // no needle-thin spires
    for (let i = 1; i < nb; i++) bumps.push(form === 'massif'
      ? { c: rng.range(-0.75, 0.75), h: rng.range(0.55, 0.95), s: rng.range(0.08, 0.2) }
      : { c: rng.range(-0.8, 0.8), h: rng.range(0.25, 0.85), s: rng.range(0.08, 0.32) });
    const skew = rng.range(-0.45, 0.45), plateau = rng() < 0.3 ? rng.range(0.82, 0.95) : 2;
    const N = clamp(Math.round(hw / 4), 24, 140);
    const xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), ridge = new Float32Array((N + 1) * 2 + 4);
    let top = base;
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N, us = u + skew * (1 - u * u) * 0.5;
      let r = 0;
      for (const B of bumps) { const v = B.h * Math.exp(-Math.pow(Math.abs(us - B.c) / B.s, sharp)); if (v > r) r = v; }
      if (r > plateau) r = plateau + (r - plateau) * 0.15; // flat-topped mesas
      r = (r * (1 + 0.3 * fbm(sd, u * 5 + 3, 4)) + 0.022 * vnoise(sd + 7, u * 70)) * Math.pow(clamp(1 - u * u, 0, 1), 0.3);
      xs[i] = x + u * hw; ys[i] = base - h * Math.max(0, r);
      if (ys[i] < top) top = ys[i];
      ridge[i * 2] = xs[i]; ridge[i * 2 + 1] = ys[i];
    }
    const depth = o.depth != null ? o.depth : 60, m = (N + 1) * 2;
    ridge[m] = x + hw; ridge[m + 1] = base + depth; ridge[m + 2] = x - hw; ridge[m + 3] = base + depth;
    const sil = ridge;

    dl.poly(sil, o.fill || st.paper);
    dl.beginClip(sil);
    const wa = (o.wash != null ? o.wash : 0.22) * st.sp.wash;
    dl.poly(sil, [x, top, x, base, 0, st.ink(wa), 0.6, st.ink(wa * 0.25), 1, st.ink(0)]);
    if (st.jade && o.jade !== false) dl.poly(sil, [x, top, x, base, 0, rgba(JADE_A, 0.45 * st.L.ink), 0.45, rgba(JADE_B, 0.2 * st.L.ink), 0.85, rgba(JADE_B, 0)]);
    if (o.bare) {
      // distant range: flat tonal wash with soft vertical bleeding, no linework
      const ns = Math.round(hw / 9);
      for (let k = 0; k < ns; k++) {
        const sx = x + rng.range(-1, 1) * hw, sw = rng.range(3, 14);
        dl.poly(rect(sx - sw / 2, top, sw, base - top), st.ink(rng.range(0.02, 0.06)));
      }
    } else { if (o.shade == null) o.shade = rng() < 0.25; texture(dl, rng, st, xs, ys, N, base, h, o); }
    const peaks = findPeaks(xs, ys, N, base, h, 0.4);
    if (o.spines) spines(dl, rng, st, xs, ys, peaks, base);
    if (o.fall && rng() < o.fall) waterfall(dl, rng, st, xs, ys, peaks, base);
    dl.poly(sil, [x, base - h * (o.mist || 0.42), x, base, 0, rgba(PAPER, 0), 1, rgba(PAPER, 1)]);
    dl.endClip();
    if (!o.bare) outline(dl, rng, st, xs, ys, N, base, h, o.olA != null ? o.olA : 0.62);
    if (o.ripples) {
      // shoreline: faint horizontal strokes where the foot meets the water
      const nr = Math.round(o.ripples * rng.range(3, 7));
      for (let k = 0; k < nr; k++) {
        const len = rng.range(20, 90) * st.lw, rx = x + rng.range(-1.05, 1.05) * (hw - len / 2), ry = base + rng.range(-6, 18);
        dl.poly(brush([rx - len / 2, ry, rx, ry + rng.range(-0.8, 0.8), rx + len / 2, ry], rng.range(0.5, 1) * st.lw, rng), st.ink(rng.range(0.12, 0.3)));
      }
    }
    return { xs, ys, N, top, peaks };
  }

  function needles(dl, rng, st, cx, cy, r) {
    dl.poly(blob(cx, cy - r * 0.12, r * 1.1, r * 0.42, rng.range(-0.1, 0.1), 12, rng, 0.35), st.needle(0.1));
    const m = Math.round(clamp(r * 1.2, 7, 28) * st.det);
    const sx = cx, sy = cy + r * 0.18;
    for (let i = 0; i < m; i++) {
      const a = Math.PI + 0.15 + (i / Math.max(1, m - 1)) * (Math.PI - 0.3) + rng.range(-0.08, 0.08);
      const len = r * rng.range(0.65, 1.1);
      const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len * 0.5;
      dl.poly(brush([sx, sy, (sx + ex) / 2, (sy + ey) / 2 - len * 0.04, ex, ey], Math.max(0.5, r * 0.07), rng, { prof: (t) => 1 - 0.8 * t }), st.needle(rng.range(0.4, 0.7)));
    }
  }

  function trunk(dl, rng, st, x, y, H, lean, tw, wig) {
    const n = 14, s0 = (rng() * 1e6) | 0, p = new Array(n * 2), wg = wig || 0.06;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      p[i * 2] = x + lean * t * t + H * wg * vnoise(s0, t * 3) * t;
      p[i * 2 + 1] = y - H * t;
    }
    dl.poly(brush(p, tw, rng, { prof: (t) => 1 - 0.55 * t, wob: 0.12, min: 0.3 }), st.paper);
    dl.poly(brush(p, tw, rng, { prof: (t) => 1 - 0.55 * t, wob: 0.12, min: 0.3 }), st.ink(0.4));
    dl.poly(brush(offsetLine(p, -tw * 0.4), tw * 0.3, rng, { prof: (t) => 1 - 0.4 * t, wob: 0.5 }), st.ink(0.9));
    dl.poly(brush(offsetLine(p, tw * 0.4), tw * 0.2, rng, { prof: (t) => 1 - 0.4 * t, wob: 0.5 }), st.ink(0.75));
    const nb = Math.round(n * 2.2 * st.det);
    for (let k = 0; k < nb; k++) {
      const i = Math.floor(rng() * (n - 3)), t = i / (n - 1), w = tw * (1 - 0.55 * t);
      dl.poly(blob(p[i * 2] + rng.range(-0.3, 0.3) * w, p[i * 2 + 1] - rng() * 4, w * 0.28, w * 0.12, rng.range(-0.5, 0.5), 6, rng, 0.4), st.ink(rng.range(0.5, 0.85)));
    }
    return p;
  }
  const along = (p, t) => { const n = p.length >> 1, i = clamp(Math.round(t * (n - 1)), 0, n - 1); return [p[i * 2], p[i * 2 + 1]]; };

  function pine(dl, rng, st, x, y, H) {
    const tw = Math.max(1.2, H * 0.045) * st.lw;
    const p = trunk(dl, rng, st, x, y, H, rng.range(-0.35, 0.35) * H, tw, 0.14);
    const nb = rng.int(4, 8);
    let side = rng() < 0.5 ? -1 : 1;
    for (let b = 0; b < nb; b++) {
      const t = 0.38 + (0.58 * b) / nb + rng() * 0.04;
      const [px, py] = along(p, t);
      const len = H * rng.range(0.14, 0.34) * (1.15 - t * 0.6), ang = rng.range(-0.3, 0.25);
      const ex = px + side * Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
      dl.poly(brush(curve(px, py, ex, ey, 7, rng.range(-0.15, 0.15), rng, 0.35), tw * 0.5 * (1 - t * 0.5), rng, { prof: (t2) => 1 - 0.7 * t2, min: 0.35 }), st.ink(0.8));
      const r = len * rng.range(0.6, 0.85);
      needles(dl, rng, st, ex, ey, r);
      if (r > 10 && rng() < 0.7) needles(dl, rng, st, ex - side * r * 0.6, ey + r * 0.12, r * 0.7);
      side = rng() < 0.75 ? -side : side;
    }
    const [tx, ty] = along(p, 1);
    needles(dl, rng, st, tx, ty, H * 0.17);
    needles(dl, rng, st, tx + H * 0.06, ty + H * 0.05, H * 0.12);
  }

  function leafy(dl, rng, st, x, y, H) {
    const bare = !st.sp.leaf;
    const mode = rng() < 0.5 ? 'dot' : 'split';
    const leaves = (cx, cy, r) => {
      if (bare) return;
      dl.poly(blob(cx, cy, r * 0.9, r * 0.7, 0, 10, rng, 0.4), st.leafWash(0.12));
      const n = Math.round(clamp(r * 1.1, 6, 18) * st.det);
      for (let i = 0; i < n; i++) {
        const lx = cx + rng.norm() * r, ly = cy + rng.norm() * r * 0.7, rr = rng.range(0.9, 2.2) * st.lw;
        if (mode === 'dot') dl.poly(blob(lx, ly, rr, rr * 0.7, rng() * 3, 6, rng, 0.3), st.leaf(rng, rng.range(0.55, 0.85)));
        else dl.poly(brush([lx - rr * 1.2, ly + rr, lx, ly - rr * 0.4, lx + rr * 1.2, ly + rr], rr * 0.7, rng), st.leaf(rng, rng.range(0.55, 0.85)));
      }
    };
    const br = (px, py, ang, len, w, d) => {
      const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
      dl.poly(brush(curve(px, py, ex, ey, 5, rng.range(-0.15, 0.15), rng, 0.3), w, rng, { prof: (t) => 1 - 0.5 * t, min: 0.4 }), st.ink(0.8));
      if (d === 0) { leaves(ex, ey, len * 1.1); return; }
      const nc = rng.int(2, 3);
      for (let c = 0; c < nc; c++) br(ex, ey, ang + rng.range(-0.75, 0.75), len * rng.range(0.6, 0.8), w * 0.62, d - 1);
    };
    br(x, y, -Math.PI / 2 + rng.range(-0.15, 0.15), H * 0.38, Math.max(1.2, H * 0.05) * st.lw, bare ? 4 : 3);
  }

  function willow(dl, rng, st, x, y, H) {
    const tw = Math.max(1.2, H * 0.045) * st.lw;
    const p = trunk(dl, rng, st, x, y, H * 0.55, rng.range(-0.12, 0.12) * H, tw);
    const tips = rng.int(3, 5);
    for (let k = 0; k < tips; k++) {
      const [bx, by] = along(p, rng.range(0.7, 1));
      const dir = rng() < 0.5 ? -1 : 1, bl = H * rng.range(0.12, 0.3);
      const sx = bx + dir * bl, sy = by - bl * rng.range(0.2, 0.6);
      dl.poly(brush(curve(bx, by, sx, sy, 5, 0.1, rng, 0.2), tw * 0.4, rng, { prof: (t) => 1 - 0.7 * t }), st.ink(0.75));
      const strands = Math.round(rng.int(5, 9) * st.det);
      for (let s = 0; s < strands; s++) {
        const len = H * rng.range(0.35, 0.75), d2 = dir * rng.range(0.2, 1), ox = sx + rng.range(-4, 4);
        const pts = qbez(ox, sy, ox + d2 * len * 0.35, sy - len * 0.12, ox + d2 * len * 0.45, sy + len * 0.8, 9);
        dl.poly(brush(pts, rng.range(0.45, 0.85) * st.lw, rng, { prof: (t) => 1 - 0.85 * t }), st.willow(rng.range(0.35, 0.6)));
      }
    }
  }

  function roof(dl, rng, st, x, y, hw, h, lift, pointed) {
    const rh = pointed ? hw * 0.08 : hw * 0.5;
    const eave = [x - hw, y - lift, x - hw * 0.6, y - lift * 0.15, x, y + h * 0.06, x + hw * 0.6, y - lift * 0.15, x + hw, y - lift];
    dl.poly(eave.concat([x + hw * 0.8, y - lift * 0.9 - h * 0.12, x + hw * 0.5, y - h * 0.45, x + rh, y - h, x - rh, y - h, x - hw * 0.5, y - h * 0.45, x - hw * 0.8, y - lift * 0.9 - h * 0.12]), st.ink(0.3));
    const m = Math.max(3, Math.round(hw / 3));
    for (let k = 0; k < m; k++) {
      const t = ((k + 0.5) / m) * 2 - 1;
      dl.poly(brush([x + t * hw * 0.85, y - lift * t * t * 0.6, x + t * rh, y - h], 0.35 * st.lw, rng, { taper: 0 }), st.ink(0.22));
    }
    dl.poly(brush(eave, 0.85 * st.lw, rng, { wob: 0.3, min: 0.4 }), st.ink(0.6));
    dl.poly(brush([x - rh - hw * 0.06, y - h - lift * 0.35, x - rh, y - h, x + rh, y - h, x + rh + hw * 0.06, y - h - lift * 0.35], 1.0 * st.lw, rng, { taper: 0, wob: 0.3 }), st.ink(0.65));
  }

  function house(dl, rng, st, x, y, s) {
    const w = s * rng.range(1.6, 2.4), hh = s * 0.62, l = x - w / 2, r = x + w / 2, top = y - hh;
    dl.poly(rect(l, top, w, hh), st.paper);
    for (const px of [l, r]) dl.poly(brush([px, y, px, top], 0.55 * st.lw, rng, { taper: 0, wob: 0.3 }), st.ink(0.5));
    dl.poly(brush([l, y, r, y], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.5));
    dl.poly(rect(x - s * 0.17, y - s * 0.4, s * 0.34, s * 0.4), st.ink(0.3));
    const wx = l + w * 0.12, wy = top + hh * 0.22;
    dl.poly(rect(wx, wy, s * 0.3, s * 0.2), st.ink(0.22));
    dl.light(wx + s * 0.15, wy + s * 0.1, s * 0.85);
    roof(dl, rng, st, x, top, w / 2 + s * 0.4, s * 0.55, s * 0.18, false);
  }

  function pavilion(dl, rng, st, x, y, s) {
    const w = s * 1.5, ph = s * 0.9, l = x - w / 2, r = x + w / 2, top = y - ph;
    dl.poly(rect(l - s * 0.2, y - s * 0.12, w + s * 0.4, s * 0.14), st.ink(0.45));
    for (const px of [l + s * 0.1, x - s * 0.15, x + s * 0.15, r - s * 0.1]) dl.poly(brush([px, y - s * 0.1, px, top], 0.7 * st.lw, rng, { taper: 0, wob: 0.1 }), st.ink(0.75));
    dl.poly(brush([l, y - s * 0.35, r, y - s * 0.35], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.5));
    roof(dl, rng, st, x, top, w * 0.5 + s * 0.45, s * 0.65, s * 0.25, true);
    dl.light(x, y - s * 0.4, s * 0.75);
  }

  function pagoda(dl, rng, st, x, y, s) {
    const tiers = rng.int(3, 6);
    let yy = y, w = s * 0.9;
    const th = s * 0.75;
    for (let t = 0; t < tiers; t++) {
      const bh = th * 0.55;
      dl.poly(rect(x - w / 2, yy - bh, w, bh), st.paper);
      dl.poly(brush([x - w / 2, yy, x - w / 2, yy - bh], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.7));
      dl.poly(brush([x + w / 2, yy, x + w / 2, yy - bh], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.7));
      roof(dl, rng, st, x, yy - bh, w / 2 + s * 0.35, th * 0.45, s * 0.18, t === tiers - 1);
      yy -= th * 0.8; w *= 0.85;
    }
    dl.poly(brush([x, yy + th * 0.3, x, yy - s * 0.6], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.8));
    dl.light(x, y - th * 0.3, s * 0.75);
  }

  function person(dl, rng, st, x, y, s) {
    const white = rng() < 0.5;
    const robe = [x - s * 0.12, y - s * 0.75, x + s * 0.12, y - s * 0.75, x + s * 0.22, y, x - s * 0.2, y];
    dl.poly(robe, white ? st.paper : st.ink(0.72));
    if (white) dl.poly(brush(robe.concat([robe[0], robe[1]]), 0.45 * st.lw, rng, { taper: 0, wob: 0.2 }), st.ink(0.7));
    dl.poly(blob(x, y - s * 0.85, s * 0.09, s * 0.1, 0, 8, rng, 0.1), st.ink(0.8));
    if (rng() < 0.5) dl.poly([x - s * 0.24, y - s * 0.86, x, y - s * 1.02, x + s * 0.24, y - s * 0.86], st.ink(0.7));
    if (rng() < 0.4) dl.poly(brush([x + s * 0.25, y - s * 0.95, x + s * 0.32, y], 0.45 * st.lw, rng, { taper: 0 }), st.ink(0.75));
  }

  function rock(dl, rng, st, x, y, w, h) {
    const N = 16, xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), sd = (rng() * 1e6) | 0, p = [];
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      xs[i] = x + u * w;
      ys[i] = y - h * Math.max(0, Math.pow(clamp(1 - u * u, 0, 1), 0.6) * (1 + 0.35 * vnoise(sd, u * 3 + 2)));
      p.push(xs[i], ys[i]);
    }
    p.push(x + w, y + 3, x - w, y + 3);
    dl.poly(p, st.paper);
    dl.beginClip(p);
    dl.poly(p, [x - w * 0.5, y - h, x + w * 0.3, y, 0, st.ink(0.42), 1, st.ink(0.04)]);
    texture(dl, rng, st, xs, ys, N, y + 3, h, { style: 'axe', detail: 1.5 });
    dl.endClip();
    outline(dl, rng, st, xs, ys, N, y + 8, h + 8, 0.95);
  }

  function reeds(dl, rng, st, x, y) {
    const n = rng.int(5, 12);
    for (let i = 0; i < n; i++) {
      const bx = x + rng.range(-8, 8), hh = rng.range(8, 24), lean = rng.range(-6, 6);
      dl.poly(brush(qbez(bx, y, bx + lean * 0.2, y - hh * 0.6, bx + lean, y - hh, 5), rng.range(0.5, 0.9) * st.lw, rng, { prof: (t) => 1 - t }), st.willow(rng.range(0.4, 0.75)));
    }
  }

  function boat(dl, rng, st, x, y, s) {
    const L = 46 * s, hh = 7 * s;
    dl.poly([x - L / 2, y - hh * 0.9, x + L / 2, y - hh * 1.15, x + L * 0.35, y, x, y + hh * 0.25, x - L * 0.35, y], st.ink(0.78));
    if (rng() < 0.6) {
      const cx = x - L * 0.05, cy = y - hh * 0.85, rx = L * 0.2, ry = hh * 1.5, p = [];
      for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; p.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
      dl.poly(p, st.ink(0.35));
      dl.poly(brush(p, 0.8 * st.lw, rng, { taper: 0 }), st.ink(0.8));
      dl.light(cx, cy - ry * 0.4, 6 * s);
    }
    person(dl, rng, st, x + L * 0.3, y - hh * 0.9, 18 * s);
    dl.poly(brush([x + L * 0.38, y - hh - 20 * s, x + L * 0.62, y + 8 * s], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.75));
    for (let k = 0; k < 4; k++) {
      const ry = y + hh * 0.5 + k * 3 * s, rl = L * rng.range(0.4, 1.1), rx = x + rng.range(-0.2, 0.2) * L;
      dl.poly(brush([rx - rl / 2, ry, rx, ry + 0.4, rx + rl / 2, ry], 0.6 * st.lw, rng), st.ink(0.22 - k * 0.04));
    }
  }

  // ------------------------------------------------------------------ feature builders
  const B = {
    distant(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      mtnBody(dl, rng, st, f.x, L.base, p.hw, p.h, { form: 'dome', bare: true, wash: 0.0, fill: st.paper, mist: 0.6, jade: false });
      return dl;
    },
    far(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      const m = mtnBody(dl, rng, st, f.x, L.base, p.hw, p.h, { style: p.style, form: p.form, wash: 0.26, olA: 0.6, detail: 0.8, fill: st.paper, mist: 0.5, ripples: 0.6 });
      for (let i = 1; i < m.N; i++) if (rng() < 0.18 && (L.base - m.ys[i]) / p.h > 0.4) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1, rng.range(3, 6));
      if (m.peaks.length && rng() < P(0.15, 'towers')) { const i = m.peaks[0]; pagoda(dl, rng, st, m.xs[i], m.ys[i] + 1.5, 2.6); }
      return dl;
    },
    mid(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base;
      const m = mtnBody(dl, rng, st, f.x, base, p.hw, p.h, { style: p.style, form: p.form, spines: true, wash: 0.2, olA: 0.75, mist: 0.45, ripples: 1 });
      if (p.trees) for (let i = 1; i < m.N; i++) if (rng() < 0.32 && (base - m.ys[i]) / p.h > 0.3) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1.5, rng.range(4, 9));
      mossDots(dl, rng, st, m.xs, m.ys, m.N, base, p.h, p.hw / 10);
      const gy = (gx) => interpY(m.xs, m.ys, m.N, gx);
      if (rng() < 0.6) { const gx = f.x + rng.range(-0.6, 0.6) * p.hw; grove(dl, rng, st, gx, rng.range(10, 30), rng.int(5, 12), rng.range(8, 13), (x) => gy(x) + (base - gy(x)) * 0.25); }
      if (p.hamlet) { const hx = f.x + rng.range(-0.5, 0.5) * p.hw; village(dl, rng, st, hx, p.hw * 0.15, rng.range(4, 5.5), (x) => gy(x) + (base - gy(x)) * 0.3); }
      if (p.temple && m.peaks.length) { const i = m.peaks[Math.floor(rng() * m.peaks.length)]; pagoda(dl, rng, st, m.xs[i], m.ys[i] + 2, rng.range(4, 5.5)); }
      return dl;
    },
    main(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base;
      const m = mtnBody(dl, rng, st, f.x, base, p.hw, p.h, { style: p.style, form: p.form, spines: true, fall: 0.4, bumps: 4, mist: 0.4, ripples: 1 });
      for (let i = 1; i < m.N; i++) if (rng() < 0.3 && (base - m.ys[i]) / p.h > 0.3) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1.5, rng.range(6, 13));
      mossDots(dl, rng, st, m.xs, m.ys, m.N, base, p.h, p.hw / 5);
      // forest groves clinging to the slopes
      const gy = (gx) => interpY(m.xs, m.ys, m.N, gx);
      const groves = rng.int(1, 3);
      for (let g = 0; g < groves; g++) {
        const gx = f.x + rng.range(-0.75, 0.75) * p.hw, drop = rng.range(0.12, 0.4);
        if ((base - gy(gx)) / p.h < 0.25) continue;
        grove(dl, rng, st, gx, rng.range(14, 40), rng.int(5, 16), rng.range(14, 26), (x) => gy(x) + (base - gy(x)) * drop);
      }
      if (p.temple) {
        for (let tries = 0; tries < 30; tries++) {
          const i = 4 + Math.floor(rng() * (m.N - 8)), fr = (base - m.ys[i]) / p.h;
          if (fr < 0.3 || fr > 0.85) continue;
          const sl = Math.abs(m.ys[i + 3] - m.ys[i - 3]) / (m.xs[i + 3] - m.xs[i - 3]);
          if (sl > 0.35) continue;
          const tx = m.xs[i], ty = m.ys[i] + 3;
          if (rng() < 0.5) pagoda(dl, rng, st, tx, ty, rng.range(6, 9));
          else { pavilion(dl, rng, st, tx, ty, rng.range(6, 8)); if (rng() < 0.7) house(dl, rng, st, tx + rng.range(10, 18) * (rng() < 0.5 ? -1 : 1), ty + 4, 6); }
          for (let t = 0; t < 3; t++) pine(dl, rng, st, tx + rng.range(-22, 22), ty + rng.range(3, 9), rng.range(14, 26));
          break;
        }
      }
      // foothills in front of the main peak
      const nf = rng.int(0, 2);
      for (let k = 0; k < nf; k++) {
        const fx = f.x + rng.range(-0.7, 0.7) * p.hw, fhw = p.hw * rng.range(0.25, 0.45), fh = p.h * rng.range(0.12, 0.3), fb = base + rng.range(4, 18);
        const fm = mtnBody(dl, rng, st, fx, fb, fhw, fh, { style: p.style, mist: 0.55, depth: 50, bumps: 2, ripples: 0.7 });
        for (let i = 1; i < fm.N; i++) if (rng() < 0.3 && (fb - fm.ys[i]) / fh > 0.3) tinyTree(dl, rng, st, fm.xs[i], fm.ys[i] + 1.5, rng.range(6, 12));
        if (rng() < P(0.8, 'villages')) { // hamlet in the lee of the foothill
          const fgy = (gx) => interpY(fm.xs, fm.ys, fm.N, gx), hx = fx + rng.range(-0.35, 0.35) * fhw;
          village(dl, rng, st, hx, fhw * 0.3, rng.range(6, 8), (x) => Math.min(fb - 4, fgy(x) + (fb - fgy(x)) * 0.35));
        }
      }
      return dl;
    },
    hill(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base - 8;
      const m = mtnBody(dl, rng, st, f.x, base, p.hw, p.h, { style: p.style, form: p.form, wash: 0.18, olA: 0.85, mist: 0.5, depth: 40, ripples: 0.8, detail: 0.8 });
      for (let i = 1; i < m.N; i++) if (rng() < 0.3 && (base - m.ys[i]) / p.h > 0.35) tinyTree(dl, rng, st, m.xs[i], m.ys[i] + 1.5, rng.range(7, 14));
      const gy = (gx) => interpY(m.xs, m.ys, m.N, gx);
      if (rng() < 0.6) { const gx = f.x + rng.range(-0.5, 0.5) * p.hw; grove(dl, rng, st, gx, rng.range(15, 40), rng.int(6, 14), rng.range(16, 26), (x) => gy(x) + (base - gy(x)) * 0.2); }
      if (rng() < P(0.55, 'villages')) { const hx = f.x + rng.range(-0.4, 0.4) * p.hw; village(dl, rng, st, hx, p.hw * 0.25, rng.range(9, 12), (x) => gy(x) + (base - gy(x)) * 0.15); }
      else if (rng() < P(0.3, 'towers')) { const tx = f.x + rng.range(-0.3, 0.3) * p.hw; pagoda(dl, rng, st, tx, gy(tx) + 3, rng.range(8, 11)); }
      return dl;
    },
    water(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), x0 = f.p.x0, W = L.base, depth = f.p.depth || 1000 - W;
      for (let k = 0; k < 3; k++) {
        const y = W + rng.range(-1, 10), x = x0 + rng() * CW, l = rng.range(80, 220);
        dl.poly(brush([x - l / 2, y, x, y + 0.5, x + l / 2, y], 0.6 * st.lw, rng), st.ink(0.06));
      }
      const n = Math.round(26 * depth / 95);
      for (let k = 0; k < Math.min(n, 30); k++) {
        const y = W + 4 + Math.pow(rng(), 0.8) * depth, x = x0 + rng() * CW, d = (y - W) / 150;
        const l = rng.range(8, 40) * (1 + d);
        dl.poly(brush([x - l / 2, y, x, y + rng.range(-0.6, 0.6), x + l / 2, y], rng.range(0.5, 1.0) * st.lw, rng), st.ink(rng.range(0.07, 0.2)));
      }
      return dl;
    },
    bank(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, W = L.base, x = f.x, hw = p.hw, h = p.h;
      const sd = (rng() * 1e6) | 0, N = clamp(Math.round(hw / 4), 20, 120);
      const xs = new Float32Array(N + 1), ys = new Float32Array(N + 1);
      const by = p.shore ? W + rng.range(10, 30) : W + p.dy;
      const e1 = rng.range(0.25, 1.1), e2 = rng.range(0.25, 1.1), tilt = rng.range(-0.35, 0.35);
      const sil = [];
      for (let i = 0; i <= N; i++) {
        const u = -1 + (2 * i) / N;
        // flat-topped land with asymmetric slopes and a rocky, irregular skyline
        const g = sstep(-1, -1 + e1, u) * (1 - sstep(1 - e2, 1, u)) * (1 + tilt * u) * (1 + 0.3 * fbm(sd, u * 4, 3)) + 0.05 * vnoise(sd + 3, u * 40) * (1 - u * u);
        xs[i] = x + u * hw; ys[i] = by - h * Math.max(0, g);
        sil.push(xs[i], ys[i]);
      }
      if (p.shore) sil.push(x + hw * 1.25, 1012, x - hw * 1.25, 1012); else sil.push(x + hw, by + 3, x - hw, by + 3);
      const bottom = p.shore ? 1000 : by + 3;
      dl.poly(sil, st.paper);
      dl.beginClip(sil);
      dl.poly(sil, [x, by - h, x, bottom, 0, st.ink(0.2), 0.5, st.ink(0.1), 1, st.ink(0.04)]);
      const layers = p.shore ? 6 : 2;
      for (let k = 1; k <= layers; k++) {
        const d = k * rng.range(7, 15), i0 = Math.floor(rng() * N * 0.5), i1 = Math.min(N, i0 + Math.floor(N * rng.range(0.3, 0.6)));
        const pts = [];
        for (let q = i0; q <= i1; q++) pts.push(xs[q], ys[q] + d + rng() * 1.5);
        dl.poly(brush(pts, 0.7 * st.lw, rng, { wob: 0.5 }), st.ink(0.34 - k * 0.03));
      }
      texture(dl, rng, st, xs, ys, N, bottom, Math.max(h, 30), { style: 'axe', detail: 0.6 });
      const sc = p.scale || 1;
      let rv = null;
      if (p.river) {
        const rx = x + rng.range(-0.45, 0.45) * hw;
        rv = river(dl, rng, st, rx, interpY(xs, ys, N, rx), bottom + 4, p.shore ? 8 : 4, p.shore ? rng.range(90, 140) : rng.range(28, 48));
      }
      dl.endClip();
      outline(dl, rng, st, xs, ys, N, by, h, 0.95);
      const avoid = rv ? (ax, ay, m) => { if (ay < rv.top - 4) return false; const r = rv.at(ay); return Math.abs(ax - r[0]) < r[1] / 2 + m; } : null;
      if (rv && rng() < 0.75) {
        const yb = lerp(rv.top, Math.min(rv.bottom, 990), rng.range(0.3, 0.65)), r = rv.at(yb);
        bridge(dl, rng, st, r[0], yb, r[1] * 1.35 + 16 * sc, (p.shore ? 15 : 8) * sc);
      }
      for (let i = 1; i < N; i++) {
        if (rng() > 0.35) continue;
        dl.poly(brush([xs[i], ys[i] + 1, xs[i] + rng.range(-2, 2), ys[i] - rng.range(2, 6) * st.lw], 0.6 * st.lw, rng, { prof: (t) => 1 - t }), st.ink(0.5));
      }
      const gy = (gx) => interpY(xs, ys, N, gx);
      const nr = rng.int(0, p.shore ? 3 : 1);
      for (let k = 0; k < nr; k++) {
        const rx = x + (rng() < 0.5 ? -1 : 1) * hw * rng.range(0.5, 0.95);
        rock(dl, rng, st, rx, gy(rx) + 4, rng.range(10, 32), rng.range(8, 26));
      }
      for (const sgn of [-1, 1]) if (rng() < 0.5) reeds(dl, rng, st, x + sgn * hw * rng.range(0.82, 0.98), p.shore ? by + rng.range(-4, 8) : by + 1);
      // Draw order = depth order: groves and trees stand behind, buildings in front of them.
      // Buildings share one occupancy map so they never overlap; trees keep their own spacing.
      const occ = new Occ(), treeOcc = new Occ(), props = [];
      if (p.grove) grove(dl, rng, st, x + rng.range(-0.5, 0.5) * hw, hw * rng.range(0.15, 0.35), rng.int(7, 20), rng.range(22, 34) * sc, gy, avoid);
      const types = p.shore ? ['pine', 'pine', 'leafy', 'leafy', 'willow', 'fir'] : ['willow', 'willow', 'leafy', 'pine', 'fir'];
      const nTrees = Math.round(p.trees * dens('trees'));
      for (let t = 0, tries = 0; t < nTrees && tries < nTrees * 5; tries++) {
        const tx = x + rng.range(-0.75, 0.75) * hw, ty = gy(tx) + 2;
        const H = Math.min((p.shore ? rng.range(90, 270) : rng.range(40, 110)) * sc, ty - L.y0 - 20);
        if (H < 20 || (avoid && avoid(tx, ty, 6))) continue;
        const gap = H * 0.28; // a tree's crown needs room; don't sprout trees out of each other
        if (!treeOcc.free(tx - gap, tx + gap)) continue;
        treeOcc.add(tx - gap, tx + gap); t++;
        const ty2 = rng.pick(types);
        if (ty2 === 'pine') pine(dl, rng, st, tx, ty, H * rng.range(0.6, 1));
        else if (ty2 === 'leafy') leafy(dl, rng, st, tx, ty, H * 0.75);
        else if (ty2 === 'fir') { for (let k = rng.int(1, 3); k > 0; k--) fir(dl, rng, st, tx + rng.range(-10, 10), ty + rng.range(0, 3), Math.min(110, H * rng.range(0.45, 0.7))); }
        else willow(dl, rng, st, tx, ty, H * 0.8);
      }
      if (p.tower) {
        const tx = x + rng.range(-0.5, 0.5) * hw, s = rng.range(11, 16) * sc;
        if (!(avoid && avoid(tx, gy(tx), s)) && occ.free(tx - s * 0.8, tx + s * 0.8)) { occ.add(tx - s * 0.8, tx + s * 0.8); pagoda(dl, rng, st, tx, gy(tx) + 2, s); }
      }
      if (p.village) village(dl, rng, st, x + rng.range(-0.2, 0.2) * hw, hw * 0.45, rng.range(11, 15) * sc * (p.shore ? 1.5 : 1), gy, avoid, occ);
      if (p.house) {
        for (let tries = 0; tries < 20; tries++) {
          const i = 3 + Math.floor(rng() * (N - 6)), sl = Math.abs(ys[i + 2] - ys[i - 2]) / (xs[i + 2] - xs[i - 2]);
          const s = rng.range(13, 20) * sc, half = s * 1.55;
          if (sl > 0.25 || (avoid && avoid(xs[i], ys[i], half)) || !occ.free(xs[i] - half, xs[i] + half)) continue;
          occ.add(xs[i] - half, xs[i] + half);
          house(dl, rng, st, xs[i], ys[i] + 2, s);
          const hx = xs[i] + (rng() < 0.5 ? -1 : 1) * s * 3.1, h2 = s * 0.85 * 1.55;
          if (rng() < 0.5 && occ.free(hx - h2, hx + h2) && !(avoid && avoid(hx, gy(hx), h2))) { occ.add(hx - h2, hx + h2); house(dl, rng, st, hx, gy(hx) + 2, s * 0.85); }
          if (rng() < 0.7) { const px = xs[i] + rng.range(1.7, 2.4) * s * (rng() < 0.5 ? -1 : 1); props.push([px, gy(px) + 1]); }
          break;
        }
      }
      if (p.pav) {
        const px = x + rng.range(-0.3, 0.3) * hw, s = rng.range(12, 16) * sc;
        if (occ.free(px - s, px + s) && !(avoid && avoid(px, gy(px), s))) { occ.add(px - s, px + s); pavilion(dl, rng, st, px, gy(px) + 1, s); }
      }
      for (const [px, py] of props) person(dl, rng, st, px, py, rng.range(12, 16));
      return dl;
    },
    boat(f, L, st, eng, S) {
      const dl = new DL(), rng = RNG(f.seed);
      for (let j = f.ci - 2; j <= f.ci + 2; j++)
        for (const g of eng.features(S, j)) if (g.kind === 'bank' && Math.abs(g.x - f.x) < g.p.hw * 1.08 + 45) return dl;
      const s = (0.6 + ((f.p.y - L.base) / 150) * 0.6) * (f.p.scale || 1);
      boat(dl, rng, st, f.x, f.p.y, s);
      return dl;
    },
  };

  // ------------------------------------------------------------------ engine
  class ShanShuiEngine extends Engine {
    _gen(L, ci) {
      const rng = RNG(hash4(this.o.seed, L.id, ci, 11)), x0 = ci * CW, out = [];
      const m = this.macro(L.id, x0 + CW * 0.5);
      const add = this._adder(L, ci, out);
      if (L.kind === 'distant') {
        // continuous pale ranges along the top of the scroll
        const n = 1 + (rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) { const hw = rng.range(300, 450), h = rng.range(60, 170) * (0.7 + 0.6 * m); add('distant', x0 + rng() * CW, rng(), hw + 10, { hw, h }); }
      } else if (L.kind === 'far') {
        const n = 1 + (rng() < 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const hw = rng.range(220, 440), h = rng.range(110, 320) * (0.7 + 0.5 * m);
          add('far', x0 + rng() * CW, 1 - h / 400 + rng() * 0.3, hw * 1.15 + 20, { hw, h, form: rng() < 0.6 ? 'massif' : 'spire', style: rng() < 0.4 ? 'dots' : 'hemp' });
        }
      } else if (L.kind === 'mid') {
        const n = 1 + (rng() < 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const r = rng(), form = r < 0.45 ? 'massif' : r < 0.7 ? 'dome' : 'spire';
          const hw = rng.range(160, 380), h = rng.range(150, form === 'spire' ? 440 : 330) * (0.7 + 0.5 * m);
          add('mid', x0 + rng() * CW, 1 - h / 600 + rng() * 0.3, hw * 1.15 + 40, { hw, h, form, style: rng() < 0.7 ? 'hemp' : 'axe', temple: rng() < P(0.35, 'towers'), hamlet: rng() < P(0.35, 'villages'), trees: rng() < 0.75 });
        }
      } else if (L.kind === 'valley') {
        // the inhabited middle distance: plateaus with villages, wooded islets, sails
        add('water', x0 + CW / 2, -10, CW / 2 + 130, { x0, depth: 65 });
        if (rng() < 0.55) { // rolling wooded hills behind the banks, filling the middle distance
          const hw = rng.range(140, 320);
          add('hill', x0 + rng() * CW, -5 + rng(), hw * 1.15 + 50, { hw, h: rng.range(50, 140), form: rng() < 0.6 ? 'dome' : 'massif', style: rng() < 0.7 ? 'hemp' : 'axe' });
        }
        const r = rng();
        if (r < P(0.62 + 0.25 * m, 'villages')) { const hw = rng.range(160, 400); add('bank', x0 + rng() * CW, 0.3 + rng() * 0.4, hw * 1.1 + 100, { shore: false, hw, h: rng.range(45, 115), dy: rng.range(0, 25), village: true, river: rng() < P(0.45, 'rivers'), grove: rng() < 0.7, trees: rng.int(1, 3), scale: 1.15 }); }
        else if (r < 0.94) { const hw = rng.range(100, 260); add('bank', x0 + rng() * CW, 0.1 + rng() * 0.2, hw * 1.1 + 100, { shore: false, hw, h: rng.range(20, 60), dy: rng.range(0, 30), grove: rng() < 0.85, river: rng() < P(0.2, 'rivers'), trees: rng.int(0, 2), pav: rng() < P(0.2, 'towers'), tower: rng() < P(0.15, 'towers'), scale: 1.05 }); }
        if (rng() < P(0.3, 'boats')) { const by = L.base + 15 + rng() * 45; add('boat', x0 + rng() * CW, 0.2 + (by - L.base) / 200, 70, { y: by, scale: 0.6 }); }
      } else if (L.kind === 'main') {
        const mm = sstep(0.25, 0.75, m);
        const n = mm > 0.6 ? 1 + (rng() < P(0.35, 'mountains') ? 1 : 0) : rng() < P(0.5 + 0.5 * mm, 'mountains') ? 1 : 0;
        for (let i = 0; i < n; i++) {
          // calm stretches (low macro) get broad low massifs/domes instead of towering spires
          const r = rng() * (0.35 + 0.65 * mm) + (1 - mm) * 0.45, form = r < 0.28 ? 'spire' : r < 0.82 ? 'massif' : 'dome';
          const hw = rng.range(170, 420);
          const h = form === 'spire' ? Math.min(700, rng.range(280, 400) + 300 * mm * rng()) : form === 'massif' ? rng.range(220, 420) + 120 * mm : rng.range(170, 320);
          add('main', x0 + rng() * CW, 1 - h / 800 + rng() * 0.2, hw * 1.25 + 20, { hw, h, form, style: rng() < 0.6 ? 'hemp' : 'axe', temple: rng() < P(0.65, 'towers') });
        }
      } else {
        add('water', x0 + CW / 2, -10, CW / 2 + 130, { x0 });
        const r = rng(), open = m < 0.2;
        if (!open && r < 0.7) {
          const hw = rng.range(170, 430), vil = rng() < P(0.4, 'villages'), riv = rng() < P(0.4, 'rivers');
          // land carrying a river is drawn in front of its neighbours so the river is never buried
          add('bank', x0 + rng() * CW, 0.5 + rng() * 0.3 + (riv ? 0.35 : 0), hw * 1.25 + 140, { shore: true, hw, h: rng.range(60, 190), trees: rng.int(1, 4), house: !vil && rng() < 0.45, village: vil, grove: rng() < 0.35, river: riv, tower: rng() < P(0.1, 'towers'), scale: 1.3 });
        }
        else if (r < 0.8) { const hw = rng.range(80, 260); add('bank', x0 + rng() * CW, 0.1 + rng() * 0.2, hw * 1.1 + 100, { shore: false, hw, h: rng.range(8, 34), dy: rng.range(0, 28), trees: rng.int(0, 2), pav: rng() < 0.18 }); }
        if (rng() < P(0.45, 'boats')) { const by = L.base + 20 + rng() * 65; add('boat', x0 + rng() * CW, (by - L.base) / 200, 70, { y: by }); }
      }
      return out;
    }
    _style(L) {
      const sp = SEASONS[this.season], c = clamp(this.o.color * (this.o.style === 'jade' ? 1.3 : 1), 0, 1), a = L.ink;
      const leafCols = sp.leaf ? sp.leaf.map((k) => rgba(mixc(INK, k, c), 1).replace(',1.000)', ',')) : null;
      const leafWashC = sp.leaf ? mixc(INK, sp.leaf[0], c) : INK;
      const willowC = mixc(INK, sp.willow, c * 0.8);
      const needleC = this.o.style === 'jade' ? mixc(INK, [40, 80, 70], 0.6) : INK;
      return {
        L, sp, det: L.det, lw: L.lw, jade: this.o.style === 'jade',
        paper: rgba(L.fill, 1),
        ink: (x) => rgba(INK, x * a),
        needle: (x) => rgba(needleC, x * a),
        leaf: (rng, x) => leafCols[Math.floor(rng() * leafCols.length)] + clamp(x * a, 0, 1).toFixed(3) + ')',
        leafWash: (x) => rgba(leafWashC, x * a),
        willow: (x) => rgba(willowC, x * a),
      };
    }
  }
  ShanShuiEngine.def = {
    layers: LAYERS, mist: MIST, tod: TOD, paper: PAPER, ink: INK, sun: SEAL_RED,
    styles: ['ink', 'jade'], defaults: { style: 'ink' }, builders: B,
  };

  window.Paperwall.register({
    id: 'shanshui', name: 'Shan Shui', native: '山水', order: 1,
    tagline: 'Chinese ink landscape',
    blurb: 'Misty mountains, river villages and pine groves in the Song-dynasty manner, drawn in grey ink on warm paper.',
    Engine: ShanShuiEngine, paper: '#f0e9d8', ink: '#4e4a46', accent: '#b02620',
    styles: [
      { id: 'ink', name: 'Ink', blurb: 'Monochrome grey ink and white-bodied mountains', swatch: ['#f0e9d8', '#8a847c', '#4e4a46', '#b02620'] },
      { id: 'jade', name: 'Blue-green', native: '青绿', blurb: 'Qinglu mineral pigments washed over the peaks', swatch: ['#f0e9d8', '#608c6c', '#3a7674', '#b02620'] },
    ],
    weathers: [{ id: 'auto', name: 'Automatic' }, { id: 'none', name: 'Clear' }, { id: 'rain', name: 'Rain' }, { id: 'snow', name: 'Snow' }],
    toggles: [{ id: 'birds', name: 'Birds' }, { id: 'mist', name: 'Drifting mist' }, { id: 'paper', name: 'Paper texture' }],
  });
})();
