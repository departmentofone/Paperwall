/*
 * Sprawl: a cyberpunk megacity. Arcologies in the haze, skylines of lit windows, an elevated
 * railway, and close up a wet street of shopfronts under neon. Flying traffic, ground cars and
 * trains move live between the layers, so buildings in front hide them.
 *
 * Each style is its own viewpoint as well as its own palette:
 *   noir      street level in the rain, neon on wet asphalt
 *   synth     the far skyline over a glowing grid floor, a striped sun, palms in front
 *   smog      looking out over the rooftops through orange haze, from a balcony
 *   phosphor  the street again, drawn as green wireframe on a black terminal
 */
(function () {
  'use strict';
  const { Engine, CW, TAU, clamp, lerp, sstep, hash2, hash4, RNG, vnoise, rgba, mixc,
    DL, brush, curve, rect, blob, Occ, mkCanvas, P, glowSprite } = window.Paperwall;

  // neon tube colours; index i uses glow sprite i + 1
  const NEON = [[255, 46, 170], [30, 228, 255], [255, 172, 40], [255, 56, 64], [130, 255, 90], [168, 92, 255]];
  const STYLES = {
    noir: {
      view: 'street', sky: { night: [[3, 4, 14], [34, 14, 50], [104, 34, 96]], day: [[62, 70, 90], [118, 112, 128], [160, 142, 148]] },
      body: [16, 17, 30], haze: [64, 38, 92], low: [70, 34, 80], edge: [70, 80, 130], wet: true,
      win: [[255, 184, 104], [255, 160, 86], [150, 200, 255]], winOff: [22, 24, 38], neon: NEON, road: [12, 12, 20], mist: [120, 60, 140],
    },
    synth: {
      view: 'grid', sky: { fixed: [[16, 4, 40], [92, 18, 112], [255, 92, 120]] },
      body: [22, 6, 44], haze: [150, 40, 130], low: [120, 30, 120], edge: [255, 60, 200],
      win: [[255, 90, 220], [70, 230, 255]], winOff: [30, 10, 56], neon: [[255, 60, 200], [60, 230, 255], [255, 200, 60], [255, 70, 120], [190, 90, 255], [255, 120, 255]], road: [18, 4, 38], mist: [255, 90, 170],
    },
    smog: {
      view: 'roofs', sky: { night: [[24, 12, 10], [92, 42, 24], [168, 84, 36]], day: [[150, 82, 34], [214, 132, 58], [236, 176, 96]] },
      body: [44, 32, 30], haze: [190, 112, 56], low: [120, 70, 40], edge: [120, 90, 70],
      win: [[255, 196, 120], [255, 160, 90]], winOff: [40, 30, 28], neon: [[40, 230, 210], [255, 70, 150], [255, 200, 90], [255, 80, 60], [150, 255, 120], [120, 160, 255]], road: [30, 22, 20], mist: [214, 128, 60],
    },
    phosphor: {
      view: 'street', wire: true, sky: { fixed: [[0, 6, 2], [0, 14, 6], [0, 30, 12]] },
      body: [0, 6, 2], haze: [0, 6, 2], low: [0, 6, 2], edge: [70, 255, 130], wet: true,
      win: [[90, 255, 140], [60, 200, 110]], winOff: [0, 6, 2], neon: Array(6).fill([110, 255, 150]), road: [0, 6, 2], mist: [40, 140, 70],
    },
  };
  const LAYERS = [
    { id: 0, kind: 'mega', par: 0.025, y0: 0, y1: 800, base: 780, R: 2, lw: 0.7, det: 0.3, depth: 0.12 },
    { id: 1, kind: 'far', par: 0.08, y0: 100, y1: 810, base: 790, R: 2, lw: 0.8, det: 0.5, depth: 0.32 },
    { id: 2, kind: 'mid', par: 0.2, y0: 40, y1: 840, base: 830, R: 2, lw: 0.9, det: 0.7, depth: 0.55 },
    { id: 3, kind: 'rail', par: 0.36, y0: 360, y1: 900, base: 890, R: 1, lw: 1.0, det: 0.85, depth: 0.72 },
    { id: 4, kind: 'street', par: 0.62, y0: 0, y1: 1000, base: 880, R: 2, lw: 1.1, det: 1, depth: 0.9 },
    { id: 5, kind: 'near', par: 1.0, y0: 0, y1: 1000, base: 1000, R: 2, lw: 1.3, det: 1, depth: 1 },
  ];
  const MIST = [
    { after: 0, y: 560, h: 240, a: 0.8, par: 0.04, drift: 3, dens: 1.0 },
    { after: 1, y: 640, h: 190, a: 0.7, par: 0.12, drift: 5, dens: 0.9 },
    { after: 2, y: 720, h: 140, a: 0.45, par: 0.26, drift: 7, dens: 0.7 },
  ];
  // the city never really gets dark: night only deepens the tint a little
  const TOD = [
    [0, [206, 200, 236], [214, 206, 236], 1], [5, [206, 200, 236], [214, 206, 236], 1],
    [6.5, [236, 222, 236], [244, 230, 236], 0.55], [8, [255, 255, 255], [255, 255, 255], 0.15],
    [17, [255, 255, 255], [255, 255, 255], 0.15], [18.6, [240, 222, 232], [248, 230, 236], 0.5],
    [20, [206, 200, 236], [214, 206, 236], 1], [24, [206, 200, 236], [214, 206, 236], 1],
  ];
  const RAIL_Y = 430, RAIL_H = 34; // the elevated railway deck
  const ROAD = 880;                 // street level in the street views

  // ------------------------------------------------------------------ geometry helpers
  const R0 = () => 0.5;
  const line = (pts, w) => brush(pts, w, R0, { taper: 0, wob: 0 });
  const closed = (p) => p.concat([p[0], p[1]]);
  const circ = (cx, cy, r, n, ry) => { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * (ry || r)); } return p; };
  // a filled shape; in wireframe it becomes a black shape with a glowing edge
  function solid(dl, st, pts, fill, a) {
    dl.poly(pts, st.wire ? st.void : fill);
    if (st.wire) dl.poly(line(closed(pts), st.wireW), st.line(a == null ? 1 : a));
  }
  function box(dl, st, x, y, w, h, fill, a) { solid(dl, st, rect(x, y, w, h), fill, a); }

  // A neon tube along a polyline: a wide soft halo, the coloured tube, and a pale hot core.
  function tube(dl, st, pts, c, w, nLights, r) {
    const n = st.neon(c);
    w *= st.tubeW;
    if (st.wire) r = (r || 40) * 0.5;
    dl.poly(line(pts, w * 4.5), rgba(n.rgb, 0.16 * st.haloA));
    dl.poly(line(pts, w), rgba(n.rgb, 1));
    dl.poly(line(pts, w * 0.38), rgba(mixc(n.rgb, [255, 255, 255], 0.7), 1));
    if (nLights) {
      const m = pts.length / 2 - 1;
      for (let k = 0; k < nLights; k++) { const i = Math.round(((k + 0.5) / nLights) * m); dl.light(pts[i * 2], pts[i * 2 + 1], r || 40, n.g); }
    }
  }
  // small neon pictograms for sign faces: no lettering, just shapes
  function icon(dl, st, kind, cx, cy, s, c, lights) {
    const T = (p) => tube(dl, st, p, c, 2.2, lights, s * 2.2);
    if (kind === 0) T(closed(circ(cx, cy, s * 0.42, 20)));
    else if (kind === 1) T(closed([cx, cy - s * 0.45, cx + s * 0.45, cy + s * 0.35, cx - s * 0.45, cy + s * 0.35]));
    else if (kind === 2) { T([cx - s * 0.45, cy - s * 0.35, cx - s * 0.05, cy, cx - s * 0.45, cy + s * 0.35]); T([cx + s * 0.0, cy - s * 0.35, cx + s * 0.4, cy, cx, cy + s * 0.35]); }
    else if (kind === 3) { const p = []; for (let i = 0; i <= 16; i++) p.push(cx - s * 0.5 + (s * i) / 16, cy + Math.sin((i / 16) * TAU * 1.5) * s * 0.22); T(p); }
    else if (kind === 4) T(closed([cx, cy - s * 0.48, cx + s * 0.36, cy, cx, cy + s * 0.48, cx - s * 0.36, cy]));
    else if (kind === 5) for (let i = 0; i < 3; i++) { const bx = cx + (i - 1) * s * 0.3, bh = s * (0.3 + 0.25 * ((i * 7) % 3)); T([bx, cy + s * 0.4, bx, cy + s * 0.4 - bh]); }
    else if (kind === 6) { T(closed(circ(cx, cy, s * 0.42, 20))); T([cx - s * 0.42, cy, cx + s * 0.42, cy]); }
    else { T([cx - s * 0.4, cy, cx + s * 0.4, cy]); T([cx, cy - s * 0.4, cx, cy + s * 0.4]); }
  }

  // ------------------------------------------------------------------ buildings
  // Rows of windows, lit in clusters (whole floors of an office, a dark block next to it).
  function windows(dl, st, rng, x, y0, y1, w, fh, ww, wh, gap, litP, lights) {
    const cols = Math.max(1, Math.floor((w - gap) / (ww + gap))), off = (w - cols * (ww + gap) + gap) / 2, sd = (rng() * 1e6) | 0;
    const colr = st.winCol(rng);
    for (let y = y0 + fh * 0.3, r = 0; y + wh < y1 - fh * 0.2; y += fh, r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x + off + c * (ww + gap), lv = 0.6 * (vnoise(sd + r * 13, c * 0.35) * 0.5 + 0.5) + 0.4 * (vnoise(sd + 77, r * 0.22) * 0.5 + 0.5), on = lv < litP + 0.2 * (rng() - 0.5);
        if (on) { dl.poly(rect(wx, y, ww, wh), st.win(colr, 1)); if (lights && !st.wire && rng() < lights) dl.light(wx + ww / 2, y + wh / 2, ww * 2.2, 0); }
        else if (st.wire) dl.poly(rect(wx, y, ww, wh), st.line(0.18));
        else if (st.det > 0.6) dl.poly(rect(wx, y, ww, wh), st.winOff(1));
      }
    }
  }
  // A tower seen from far: body, setbacks or a spire, windows, an aircraft beacon.
  function tower(dl, rng, st, x, w, base, h, o) {
    const top = base - h, kind = rng.int(0, 4);
    box(dl, st, x, top, w, h, st.body(top, base));
    let crown = top;
    if (kind === 1 && w > 30) { const sw = w * rng.range(0.5, 0.75), sh = h * rng.range(0.08, 0.2); box(dl, st, x + (w - sw) / 2, top - sh, sw, sh, st.body(top - sh, base)); crown = top - sh; }
    else if (kind === 2) { const sh = Math.min(w * 0.8, h * 0.15); solid(dl, st, [x, top + 0.5, x + w, top + 0.5, x + w / 2, top - sh], st.body(top - sh, base)); crown = top - sh; }
    else if (kind === 3) { const sh = h * 0.06; solid(dl, st, [x, top + 0.5, x + w, top + 0.5, x + w, top - sh, x + w * 0.2, top - sh * 1.6], st.body(top - sh, base)); }
    if (rng() < 0.6) { const ax = x + w * rng.range(0.3, 0.7), ah = h * rng.range(0.06, 0.18); dl.poly(rect(ax - 0.6, crown - ah, 1.2, ah + 1), st.wire ? st.line(1) : st.edgeC(0.9)); dl.poly(rect(ax - 1.4, crown - ah - 1.4, 2.8, 2.8), rgba([255, 60, 60], 1)); dl.light(ax, crown - ah, o.beacon || 10, 4); }
    // rim light from the street glow below, and a cool edge on top
    if (!st.wire) { dl.poly(rect(x, top, w, 1.2), st.edgeC(0.5)); dl.poly(rect(x, base - h * 0.35, w, h * 0.35), [0, base - h * 0.35, 0, base, 0, st.lowC(0), 1, st.lowC(0.35)]); }
    if (st.view === 'grid') {
      const c = rng() < 0.5 ? 0 : 1;
      tube(dl, st, [x, base, x, top, x + w, top], c, 1.2, 1, 24);
      for (let by = top + 20; by < base - 10; by += rng.range(26, 60)) if (rng() < 0.4) dl.poly(rect(x + 3, by, w - 6, 1.6), st.neonFill(c, 0.6));
    }
    windows(dl, st, rng, x + 2, top + 4, base, w - 4, o.fh, o.ww, o.wh, o.gap, st.view === 'grid' ? o.lit * 0.45 : o.lit, o.wl);
    return crown;
  }
  // An arcology: a wide stepped mass, banded with light, crowned with beacons.
  function arcology(dl, rng, st, cx, base, w, h) {
    const tiers = rng.int(3, 5);
    let y = base, tw = w;
    for (let t = 0; t < tiers; t++) {
      const th = (h / tiers) * rng.range(0.8, 1.2), x = cx - tw / 2;
      solid(dl, st, [x, y, x + tw, y, x + tw - tw * 0.04, y - th, x + tw * 0.04, y - th], st.body(y - th, base), 0.6);
      for (let by = y - th * 0.15; by > y - th + 6; by -= rng.range(10, 18)) if (rng() < 0.55) dl.poly(rect(x + tw * 0.06, by, tw * 0.88, 1.1), st.win(st.winCol(rng), rng.range(0.25, 0.6)));
      for (let k = 0; k < 3; k++) if (rng() < 0.5) { const vx = x + tw * rng.range(0.15, 0.85); dl.poly(rect(vx, y - th, 1.6, th), st.neonFill(rng.int(0, 5), 0.5)); }
      y -= th; tw *= rng.range(0.55, 0.75);
    }
    const sp = h * rng.range(0.1, 0.25);
    dl.poly(rect(cx - 1.5, y - sp, 3, sp), st.wire ? st.line(0.8) : st.edgeC(0.8));
    dl.light(cx, y - sp, 16, 4); dl.light(cx - tw * 0.4, y, 12, 4); dl.light(cx + tw * 0.4, y, 12, 4);
  }
  // A billboard screen: a coloured gradient field with a big pictogram and scan lines.
  function screen(dl, st, rng, x, y, w, h) {
    const a = rng.int(0, 5), b = (a + rng.int(1, 4)) % 6, ca = st.neon(a), cb = st.neon(b);
    box(dl, st, x - 3, y - 3, w + 6, h + 6, st.void);
    dl.poly(rect(x, y, w, h), st.wire ? st.line(0.12) : [x, y, x + w, y + h, 0, rgba(mixc(ca.rgb, [0, 0, 0], 0.35), 1), 1, rgba(mixc(cb.rgb, [0, 0, 0], 0.5), 1)]);
    icon(dl, st, rng.int(0, 7), x + w * rng.range(0.35, 0.65), y + h / 2, Math.min(w, h) * 0.8, b, 0);
    for (let sy = y + 2; sy < y + h; sy += 3) dl.poly(rect(x, sy, w, 0.8), 'rgba(0,0,0,0.25)');
    dl.light(x + w * 0.3, y + h / 2, Math.max(w, h) * 0.5, ca.g); dl.light(x + w * 0.7, y + h / 2, Math.max(w, h) * 0.5, cb.g);
    for (const lx of [x + w * 0.2, x + w * 0.8]) dl.poly(rect(lx - 1, y + h + 3, 2, h * 0.25), st.wire ? st.line(0.6) : st.edgeC(0.5));
  }
  // A blade sign: a tall narrow box sticking out from a facade, a stack of neon marks inside.
  function bladeSign(dl, st, rng, x, y, w, h, c) {
    box(dl, st, x, y, w, h, st.void);
    tube(dl, st, closed(rect(x + 2, y + 2, w - 4, h - 4)), c, 2, 3, w * 1.6);
    const n = Math.max(2, Math.round(h / (w * 1.1))), c2 = rng() < 0.5 ? c : (c + 3) % 6;
    for (let i = 0; i < n; i++) { const cy = y + ((i + 0.5) * h) / n; icon(dl, st, rng.int(0, 7), x + w / 2, cy, w * 0.55, c2, 0); }
    for (const by of [y + h * 0.15, y + h * 0.85]) dl.poly(rect(x - 8, by - 1, 8, 2), st.metal(1));
  }
  // A close facade on the street: shopfront, sign boxes, floors of windows, AC units, pipes.
  function shopHouse(dl, rng, st, x, w, base, h, lit) {
    const top = base - h, sh = 118;
    box(dl, st, x, top, w, h, st.body(top, base, true), 0.8);
    // floors
    const fh = rng.range(58, 72), nWin = Math.max(1, Math.round(w / 52)), ww = Math.min(34, (w - 20) / nWin - 16), wh = fh * 0.42;
    const colr = st.winCol(rng), blinds = rng() < 0.5;
    for (let fy = base - sh - 40 - fh; fy > top + 16; fy -= fh) {
      if (!st.wire) dl.poly(rect(x, fy + fh - 3, w, 3), st.edgeC(0.25));
      for (let i = 0; i < nWin; i++) {
        const wx = x + ((i + 0.5) * w) / nWin - ww / 2, wy = fy + fh * 0.22;
        const on = rng() < (st.wire ? 0.4 : 0.24);
        if (on) {
          const c = rng() < 0.75 ? colr : st.winCol(rng);
          box(dl, st, wx, wy, ww, wh, st.win(c, 1), 0.9);
          if (blinds && !st.wire) for (let b = wy + 3; b < wy + wh; b += 4) dl.poly(rect(wx, b, ww, 1.2), st.winOff(0.55));
          if (!st.wire && rng() < 0.12) dl.light(wx + ww / 2, wy + wh / 2, ww * 1.1, 0);
          lit.push([wx + ww / 2, wy + wh / 2, 0, ww]);
        } else box(dl, st, wx, wy, ww, wh, st.winOff(1), 0.4);
        if (rng() < 0.28) { const ax = wx + rng.range(0, ww - 22), ay = wy + wh + 3; box(dl, st, ax, ay, 24, 14, st.metal(1), 0.7); if (!st.wire) dl.poly(circ(ax + 12, ay + 7, 4.5, 10), st.winOff(1)); }
      }
    }
    // a drain pipe and sometimes a fire escape
    const px = rng() < 0.5 ? x + 4 : x + w - 8;
    dl.poly(rect(px, top + 10, 4, h - sh - 10), st.wire ? st.line(0.5) : st.metal(1));
    if (rng() < 0.3 && w > 140) {
      const fx = x + w * rng.range(0.2, 0.5), fw = 70;
      for (let fy = base - sh - 30; fy > top + fh; fy -= fh) {
        dl.poly(rect(fx, fy, fw, 2), st.metal(1));
        for (let k = 0; k <= fw; k += 7) dl.poly(rect(fx + k, fy - 12, 1, 12), st.metal(0.8));
        dl.poly(line([fx + 4, fy, fx + fw - 4, fy + fh - 2], 2), st.metal(0.9));
      }
    }
    // shopfront
    const sy = base - sh;
    if (rng() < 0.7) {
      const c = st.winCol(rng);
      dl.poly(rect(x + 6, sy + 22, w - 12, sh - 22), st.wire ? st.line(0.15) : [0, sy + 22, 0, base, 0, st.win(c, 0.95), 1, st.win(mixc(c, [255, 255, 255], 0.3), 1)]);
      for (let mx = x + 6; mx < x + w - 6; mx += rng.range(30, 50)) dl.poly(rect(mx, sy + 22, 2, sh - 22), st.wire ? st.line(0.6) : st.metal(1));
      dl.light(x + w * 0.3, base - sh * 0.4, sh * 0.8, 0); dl.light(x + w * 0.7, base - sh * 0.4, sh * 0.8, 0);
      lit.push([x + w / 2, base - sh * 0.4, 0, w * 0.6]);
    } else {
      box(dl, st, x + 6, sy + 22, w - 12, sh - 22, st.metal(1), 0.7);
      if (!st.wire) for (let ly = sy + 26; ly < base; ly += 5) dl.poly(rect(x + 6, ly, w - 12, 1.2), st.winOff(0.8));
    }
    // a sign box over the shop, and an awning
    const c = rng.int(0, 5), bw = Math.min(w - 20, rng.range(70, 150)), bx = x + rng.range(10, w - 10 - bw);
    box(dl, st, bx, sy - 16, bw, 34, st.void);
    tube(dl, st, closed(rect(bx + 3, sy - 13, bw - 6, 28)), c, 1.8, 2, 50);
    for (let k = 0, n = Math.max(1, Math.floor(bw / 44)); k < n; k++) icon(dl, st, rng.int(0, 7), bx + ((k + 0.5) * bw) / n, sy + 1, 20, (c + k) % 6, 0);
    lit.push([bx + bw / 2, sy, c + 1, bw]);
    if (rng() < 0.5) { const ac = st.neon((c + 2) % 6); dl.poly([x + 4, sy + 20, x + w - 4, sy + 20, x + w + 6, sy + 44, x - 6, sy + 44], st.wire ? st.void : rgba(mixc(ac.rgb, [0, 0, 0], 0.55), 1)); tube(dl, st, [x - 6, sy + 44, x + w + 6, sy + 44], (c + 2) % 6, 1.4, 1, 40); }
    // blade sign
    if (rng() < 0.7 && h > 300) {
      const bw2 = rng.range(26, 40), bh = rng.range(150, Math.min(320, h - sh - 60)), bx2 = rng() < 0.5 ? x + 10 : x + w - bw2 - 10, by = sy - 40 - bh - rng.range(0, 60);
      const c2 = rng.int(0, 5);
      bladeSign(dl, st, rng, bx2, by, bw2, bh, c2);
      lit.push([bx2 + bw2 / 2, by + bh / 2, c2 + 1, bw2]);
    }
    // rooftop
    if (top > 60) {
      if (rng() < 0.4) { const tx = x + rng.range(10, w - 50); box(dl, st, tx, top - 44, 40, 34, st.metal(1), 0.8); for (const lx of [tx + 6, tx + 30]) dl.poly(rect(lx, top - 10, 3, 10), st.metal(1)); }
      if (rng() < 0.5) { const ax = x + rng.range(10, w - 10), ah = rng.range(40, 120); dl.poly(rect(ax, top - ah, 2, ah), st.wire ? st.line(0.8) : st.metal(1)); dl.poly(rect(ax - 1.5, top - ah - 2, 5, 4), rgba([255, 60, 60], 1)); dl.light(ax + 1, top - ah, 14, 4); }
    }
  }
  // A low rooftop seen from above it (the smog view): parapet, tanks, AC banks, dishes.
  function roof(dl, rng, st, x, w, base, h) {
    const top = base - h;
    box(dl, st, x, top, w, h, st.body(top, base), 0.8);
    windows(dl, st, rng, x + 4, top + 30, base, w - 8, 36, 12, 16, 8, 0.4, 0.08);
    dl.poly(rect(x - 3, top - 6, w + 6, 8), st.wire ? st.line(0.8) : st.edgeC(0.6));
    for (let i = 0, n = rng.int(1, 4); i < n; i++) {
      const k = rng(), tx = x + rng.range(6, w - 50);
      if (k < 0.35) { box(dl, st, tx, top - 52, 38, 40, st.metal(1), 0.8); dl.poly(blob(tx + 19, top - 52, 19, 5, 0, 12, rng, 0), st.metal(1)); for (const lx of [tx + 5, tx + 31]) dl.poly(rect(lx, top - 12, 3, 12), st.metal(1)); }
      else if (k < 0.6) { box(dl, st, tx, top - 22, 46, 18, st.metal(1), 0.7); if (!st.wire) for (let f = 0; f < 3; f++) dl.poly(circ(tx + 8 + f * 15, top - 13, 5, 10), st.winOff(1)); }
      else if (k < 0.8) { const ah = rng.range(60, 160); dl.poly(rect(tx, top - ah, 2.5, ah), st.wire ? st.line(0.8) : st.metal(1)); dl.poly(rect(tx - 2, top - ah - 2, 6.5, 4), rgba([255, 60, 60], 1)); dl.light(tx + 1, top - ah, 16, 4); }
      else { dl.poly(blob(tx + 16, top - 26, 18, 10, -0.5, 14, rng, 0), st.metal(1)); dl.poly(rect(tx + 14, top - 18, 3, 18), st.metal(1)); }
    }
    if (rng() < 0.35) { const c = rng.int(0, 5), sw = rng.range(50, 100), sx = x + rng.range(4, Math.max(5, w - sw - 4)); tube(dl, st, [sx, top - 14, sx + sw, top - 14], c, 2.2, 2, 40); icon(dl, st, rng.int(0, 7), sx + sw / 2, top - 34, 24, c, 1); }
  }
  // Palms for the synthwave beach: black silhouettes against the sun.
  function palm(dl, rng, st, x, base, h) {
    const lean = rng.range(-0.25, 0.25) * h, pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(x + lean * t * t, base - h * t); }
    const black = st.wire ? st.void : 'rgba(8,2,18,1)';
    dl.poly(brush(pts, h * 0.035, R0, { prof: (t) => 1 - 0.5 * t, wob: 0, min: 0.4 }), black);
    const tx = pts[20], ty = pts[21];
    // fronds fan out from the crown and droop under their own weight
    const n = rng.int(9, 12);
    for (let k = 0; k < n; k++) {
      const a = -Math.PI * (0.06 + 0.88 * (k + rng.range(-0.3, 0.3)) / (n - 1)), L = h * rng.range(0.3, 0.42);
      const ca = Math.cos(a), sa = Math.sin(a), droop = L * (0.5 + 0.5 * Math.abs(ca)), q = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; q.push(tx + ca * L * t, ty + sa * L * t * (1 - 0.5 * t) + droop * t * t); }
      dl.poly(brush(q, h * 0.026, R0, { prof: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)), 0.6), wob: 0, min: 0.02 }), black);
      // leaflets hanging off each frond
      for (let i = 2; i < 14; i += 2) {
        const px = q[i * 2], py = q[i * 2 + 1], ll = L * 0.2 * (1 - i / 18);
        dl.poly(line([px, py, px + ca * ll * 0.5 - sa * ll * 0.2, py + ll], h * 0.007), black);
        dl.poly(line([px, py, px + ca * ll * 0.9, py + ll * 0.6], h * 0.006), black);
      }
    }
    dl.poly(circ(tx, ty + 4, h * 0.022, 10), black);
  }
  // A walker under a glowing umbrella, a lamp post, steam from a grate.
  function walker(dl, rng, st, x, y, s, c) {
    const body = st.wire ? st.void : 'rgba(10,10,18,1)';
    solid(dl, st, [x - s * 0.16, y - s * 0.8, x + s * 0.16, y - s * 0.8, x + s * 0.2, y - s * 0.28, x - s * 0.2, y - s * 0.28], body);
    dl.poly(line([x - s * 0.07, y - s * 0.3, x - s * 0.1, y], s * 0.07), body); dl.poly(line([x + s * 0.07, y - s * 0.3, x + s * 0.12, y], s * 0.07), body);
    dl.poly(circ(x, y - s * 0.88, s * 0.09, 10), body);
    if (c != null) {
      dl.poly(line([x + s * 0.05, y - s * 0.6, x + s * 0.05, y - s * 1.12], s * 0.03), body);
      const ub = [x - s * 0.5, y - s * 1.0, x - s * 0.3, y - s * 1.17, x + s * 0.05, y - s * 1.24, x + s * 0.4, y - s * 1.17, x + s * 0.6, y - s * 1.0];
      dl.poly(ub.concat([x + s * 0.05, y - s * 1.06]), rgba(mixc(st.neon(c).rgb, [0, 0, 0], 0.6), st.wire ? 0 : 0.85));
      tube(dl, st, ub, c, 1.3, 2, s * 0.8);
    }
  }

  // ------------------------------------------------------------------ builders
  const B = {
    mega(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      if (p.mtn) {
        // synthwave mountains: a dark ridge with glowing contour lines
        const pts = [f.x - p.hw, p.base];
        for (let i = 0; i <= 40; i++) { const u = -1 + i / 20, v = Math.max(0, 1 - Math.abs(u)) ** 1.2 * (0.8 + 0.2 * Math.sin(u * 9 + p.ph)); pts.push(f.x + u * p.hw, p.base - p.h * v); }
        pts.push(f.x + p.hw, p.base);
        dl.poly(pts, st.body(p.base - p.h, p.base));
        for (let k = 1; k <= 4; k++) { const q = []; for (let i = 0; i <= 40; i++) { const u = -1 + i / 20, v = Math.max(0, 1 - Math.abs(u)) ** 1.2 * (0.8 + 0.2 * Math.sin(u * 9 + p.ph)); q.push(f.x + u * p.hw, p.base - p.h * v * (1 - k * 0.2)); } dl.poly(line(q, 1.1), st.neonFill(0, 0.55 - k * 0.1)); }
        dl.poly(line(pts.slice(2, -2), 1.6), st.neonFill(0, 0.9));
        return dl;
      }
      arcology(dl, rng, st, f.x, p.base, p.w, p.h);
      return dl;
    },
    tower(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      tower(dl, rng, st, p.x, p.w, p.base, p.h, p.o);
      if (p.blade) bladeSign(dl, st, rng, p.x + (p.side > 0 ? p.w - 2 : -p.blade.w + 2), p.base - p.h * rng.range(0.4, 0.75), p.blade.w, p.blade.h, p.blade.c);
      if (p.screen) screen(dl, st, rng, p.x + (p.w - p.screen.w) / 2, p.base - p.h - p.screen.h - 14, p.screen.w, p.screen.h);
      if (p.holo) {
        // a giant hologram hanging in the haze: a translucent ring and a slow vertical scan
        const n = st.neon(p.holo.c), cx = p.x + p.w / 2, cy = p.base - p.h - p.holo.r * 1.4;
        for (let k = 0; k < 3; k++) dl.poly(line(closed(circ(cx, cy, p.holo.r * (1 - k * 0.22), 40, p.holo.r * (1 - k * 0.22) * 0.38)), 2), rgba(n.rgb, 0.55 - k * 0.12));
        dl.poly(circ(cx, cy, p.holo.r * 0.95, 40, p.holo.r * 0.95), rgba(n.rgb, 0.07));
        for (let y = cy - p.holo.r; y < cy + p.holo.r; y += 6) dl.poly(rect(cx - p.holo.r * 0.6, y, p.holo.r * 1.2, 1), rgba(n.rgb, 0.1));
        dl.light(cx, cy, p.holo.r * 1.3, n.g);
      }
      return dl;
    },
    rail(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), x0 = f.p.x0, y = RAIL_Y;
      for (let px = Math.ceil((x0 - 30) / 280) * 280; px < x0 + CW + 30; px += 280) {
        solid(dl, st, [px - 13, y + RAIL_H, px + 13, y + RAIL_H, px + 16, L.base + 10, px - 16, L.base + 10], st.body(y, L.base), 0.7);
        dl.poly([px - 44, y + RAIL_H, px + 44, y + RAIL_H, px + 13, y + RAIL_H + 30, px - 13, y + RAIL_H + 30], st.wire ? st.void : st.bodyC(1));
        if (st.wire) dl.poly(line([px - 44, y + RAIL_H, px - 13, y + RAIL_H + 30, px + 13, y + RAIL_H + 30, px + 44, y + RAIL_H], st.wireW), st.line(0.7));
      }
      box(dl, st, x0 - 1, y, CW + 2, RAIL_H, st.body(y, y + RAIL_H), 0.9);
      dl.poly(rect(x0 - 1, y + RAIL_H - 6, CW + 2, 2), st.wire ? st.line(0.5) : st.edgeC(0.5));
      for (let lx = Math.ceil(x0 / 100) * 100; lx < x0 + CW; lx += 100) { dl.poly(rect(lx - 1, y - 16, 2, 16), st.metal(1)); dl.poly(rect(lx - 3, y - 18, 6, 3), st.win(st.winCol(rng), 1)); dl.light(lx, y - 17, 14, 0); }
      dl.poly(rect(x0 - 1, y - 4, CW + 2, 2), st.metal(1));
      return dl;
    },
    road(f, L, st) {
      const dl = new DL(), x0 = f.p.x0;
      if (st.view === 'grid') { dl.poly(rect(x0 - 1, f.p.y, CW + 2, 1000 - f.p.y + 4), [0, f.p.y, 0, 1000, 0, rgba(st.S.road, 1), 1, rgba(mixc(st.S.road, [60, 10, 80], 0.6), 1)]); return dl; }
      dl.poly(rect(x0 - 1, ROAD, CW + 2, 24), st.wire ? st.void : st.metal(1));
      dl.poly(rect(x0 - 1, ROAD + 24, CW + 2, 1000 - ROAD), st.wire ? st.void : [0, ROAD + 24, 0, 1000, 0, rgba(st.S.road, 1), 1, rgba(mixc(st.S.road, [0, 0, 0], 0.4), 1)]);
      dl.poly(rect(x0 - 1, ROAD + 22, CW + 2, 3), st.wire ? st.line(0.8) : st.edgeC(0.5));
      for (let dx = Math.ceil(x0 / 120) * 120; dx < x0 + CW; dx += 120) dl.poly(rect(dx, 962, 60, 4), st.wire ? st.line(0.5) : 'rgba(200,200,190,0.35)');
      if (st.wet && !st.wire) dl.poly(rect(x0 - 1, ROAD + 25, CW + 2, 60), [0, ROAD + 25, 0, ROAD + 85, 0, 'rgba(120,110,170,0.22)', 1, 'rgba(120,110,170,0)']);
      return dl;
    },
    shop(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, lit = [];
      shopHouse(dl, rng, st, p.x, p.w, ROAD, p.h, lit);
      if (st.wet) {
        // the street mirrors the signs and windows: coloured streaks running down the asphalt
        for (const q of lit) {
          if (!q[2] && rng() < 0.6) continue;
          const n = q[2] ? st.neon(q[2] - 1) : { rgb: st.S.win[0], g: 0 }, d = ROAD - q[1], ry = ROAD + 26 + d * 0.12, len = 30 + d * 0.16, hw = Math.min(q[3], 60) * 0.35;
          dl.poly(rect(q[0] - hw, ry, hw * 2, len), [0, ry, 0, ry + len, 0, rgba(n.rgb, st.wire ? 0.35 : 0.22), 1, rgba(n.rgb, 0)]);
          if (q[2]) for (let k = 0; k < 2; k++) dl.light(q[0], ry + (len * k) / 2, hw * 1.2, n.g);
        }
      }
      return dl;
    },
    // wires strung across the street, anchored at world positions so they run on across chunks
    cables(f, L, st) {
      const dl = new DL(), x0 = f.p.x0, ws = f.p.ws, col = st.wire ? st.line(0.7) : 'rgba(6,6,12,0.95)';
      for (let t = 0; t < 3; t++) {
        const span = 380, ofs = t * 127;
        for (let a = Math.floor((x0 - ofs) / span); a * span + ofs < x0 + CW; a++) {
          const ax = a * span + ofs;
          if (ax < x0) continue;
          const h1 = 150 + (hash2(ws + t, a) % 320), h2 = 150 + (hash2(ws + t, a + 1) % 320), sag = 30 + (hash2(ws + 9, a * 3 + t) % 70), q = [];
          for (let i = 0; i <= 24; i++) { const u = i / 24; q.push(ax + span * u, lerp(h1, h2, u) + sag * 4 * u * (1 - u)); }
          dl.poly(line(q, 1.6 * L.lw), col);
          const r = RNG(hash2(ws + t * 31, a));
          if (r() < 0.35) { const u = r.range(0.3, 0.7), hx = ax + span * u, hy = lerp(h1, h2, u) + sag * 4 * u * (1 - u); dl.poly(rect(hx - 0.6, hy, 1.2, 16), col); icon(dl, st, r.int(0, 7), hx, hy + 30, 26, r.int(0, 5), 1); }
        }
      }
      return dl;
    },
    roof(f, L, st) { const dl = new DL(), rng = RNG(f.seed), p = f.p; roof(dl, rng, st, p.x, p.w, 1004, p.h); return dl; },
    near(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      if (p.palm) { palm(dl, rng, st, f.x, 1010, p.h); return dl; }
      if (p.rail) {
        // the balcony we're standing on
        const x0 = p.x0, bar = st.wire ? st.void : 'rgba(10,8,8,1)';
        box(dl, st, x0 - 1, 948, CW + 2, 8, bar, 0.9); box(dl, st, x0 - 1, 990, CW + 2, 14, bar, 0.9);
        for (let bx = Math.ceil(x0 / 26) * 26; bx < x0 + CW; bx += 26) dl.poly(rect(bx, 956, 3, 34), st.wire ? st.line(0.6) : bar);
        return dl;
      }
      if (p.lamp) {
        const x = f.x, black = st.wire ? st.void : 'rgba(8,8,14,1)', top = 300;
        solid(dl, st, [x - 6, 1004, x + 6, 1004, x + 4, top, x - 4, top], black);
        dl.poly(line([x, top, x + 10, top - 30, x + 90, top - 44], 6), black);
        box(dl, st, x + 70, top - 50, 44, 12, black);
        dl.poly(rect(x + 74, top - 39, 36, 3), 'rgba(220,240,255,1)');
        dl.light(x + 92, top - 30, 120, 7);
        if (p.cable) dl.poly(line(curve(x, top + 40, x + p.cable, top + 20, 12, 0.08, rng, 0), 2), black);
        return dl;
      }
      for (const w of p.walkers) walker(dl, rng, st, w.x, w.y, w.s, w.c);
      if (p.steam && !st.wire) for (let k = 0; k < 6; k++) dl.poly(blob(p.steam + rng.range(-20, 20), 990 - k * 34, 30 + k * 12, 16 + k * 6, 0, 14, rng, 0.3), 'rgba(200,190,220,' + (0.12 - k * 0.015).toFixed(3) + ')');
      return dl;
    },
  };

  // ------------------------------------------------------------------ engine
  class SprawlEngine extends Engine {
    get S() { return STYLES[this.o.style] || STYLES.noir; }
    _gen(L, ci) {
      const seed = this.o.seed, rng = RNG(hash4(seed, L.id, ci, 77)), x0 = ci * CW, out = [], S = this.S, view = S.view;
      const m = this.macro(L.id, x0 + CW / 2), add = this._adder(L, ci, out);
      if (L.kind === 'mega') {
        if (view === 'grid') { if (rng() < 0.9) { const hw = rng.range(260, 480); add('mega', x0 + rng() * CW, rng(), hw, { mtn: true, hw, h: rng.range(90, 220), base: 712, ph: rng() * 9 }); } }
        else if (rng() < 0.55) { const w = rng.range(260, 560); add('mega', x0 + rng() * CW, rng(), w / 2 + 40, { w, h: rng.range(380, 640) * (0.8 + 0.4 * m), base: L.base }); }
      } else if (L.kind === 'far' || L.kind === 'mid') {
        const far = L.kind === 'far', base = view === 'grid' ? (far ? 706 : 710) : L.base;
        if (view === 'grid' && !far && rng() < 0.75) return out;
        let x = x0 + rng.range(-20, 0);
        while (x < x0 + CW) {
          const w = far ? rng.range(28, 84) : rng.range(70, 160), gap = far ? rng.range(-6, 10) : rng.range(10, 70);
          let h = far ? rng.range(110, 430) : rng.range(220, 600);
          if (view === 'grid') h *= far ? 0.42 : 0.5;
          h *= 0.75 + 0.5 * m;
          const o = far ? { fh: 8, ww: 2.4, wh: 3.4, gap: 2.6, lit: 0.42, wl: 0 } : { fh: 12, ww: 4, wh: 6, gap: 4, lit: 0.4, wl: 0.012 };
          const p = { x, w, h, base, o, side: rng() < 0.5 ? -1 : 1 };
          if (!far && rng() < 0.3) p.blade = { w: rng.range(12, 18), h: rng.range(60, 140), c: rng.int(0, 5) };
          if (!far && rng() < P(0.18, 'towers')) p.screen = { w: rng.range(60, 120), h: rng.range(36, 70) };
          if (!far && view === 'roofs' && rng() < 0.3) p.holo = { r: rng.range(60, 110), c: rng.int(0, 5) };
          add('tower', x + w / 2, far ? rng() : 1 + rng(), w / 2 + 160, p);
          x += w + gap;
        }
      } else if (L.kind === 'rail') {
        if (view !== 'grid') add('rail', x0 + CW / 2, 0, CW / 2 + 50, { x0 });
      } else if (L.kind === 'street') {
        if (view === 'grid') { add('road', x0 + CW / 2, 0, CW / 2 + 4, { x0, y: 712 }); return out; }
        if (view === 'roofs') {
          let x = x0 + rng.range(-30, 0);
          while (x < x0 + CW) { const w = rng.range(110, 240); add('roof', x + w / 2, rng(), w / 2 + 70, { x, w, h: rng.range(110, 300) }); x += w + rng.range(4, 50); }
          return out;
        }
        add('road', x0 + CW / 2, 0, CW / 2 + 4, { x0 });
        add('cables', x0 + CW / 2, 9, CW / 2 + 420, { x0, ws: hash2(seed, 4100) });
        let x = x0 + rng.range(-40, 0);
        while (x < x0 + CW) {
          const w = rng.range(150, 280), r = rng(), h = r < 0.5 ? rng.range(290, 470) : r < 0.85 ? rng.range(470, 700) : rng.range(700, 960);
          add('shop', x + w / 2, 1 + rng(), w / 2 + 60, { x, w, h });
          x += w + (rng() < 0.2 ? rng.range(40, 110) : rng.range(0, 8));
        }
      } else {
        if (view === 'roofs') { add('near', x0 + CW / 2, 0, CW / 2 + 4, { rail: true, x0 }); return out; }
        if (view === 'grid') { if (rng() < 0.35) add('near', x0 + rng() * CW, 1, 260, { palm: true, h: rng.range(380, 620) }); return out; }
        if (rng() < P(0.22, 'trees')) add('near', x0 + rng() * CW, 1, 160, { lamp: true, cable: rng() < 0.5 ? rng.range(-300, 300) : 0 });
        if (rng() < P(0.6, 'villages')) {
          const walkers = [];
          for (let k = 0, n = rng.int(1, 3); k < n; k++) { const y = rng.range(ROAD + 30, 1000), s = 70 + (y - ROAD) * 0.6; walkers.push({ x: x0 + rng() * CW, y, s, c: rng() < 0.6 ? rng.int(0, 5) : null }); }
          walkers.sort((a, b) => a.y - b.y);
          add('near', x0 + CW / 2, 2, CW / 2 + 80, { walkers, steam: rng() < 0.3 ? x0 + rng() * CW : 0 });
        }
      }
      return out;
    }
    _applyDerived(force) {
      super._applyDerived(force);
      if ((this.weather === 'rain') !== this._wetSt) this.flushScene();
      if (this.S && this.S.view !== this._carView) { this._carView = this.S.view; this.cars = []; this.train = null; this._filled = false; }
    }
    _style(L) {
      const S = this.S, d = L.depth, wire = !!S.wire, rain = this.weather === 'rain';
      this._wetSt = rain;
      const haze = (c, k) => mixc(c, S.haze, clamp((1 - d) * (k == null ? 1 : k), 0, 1));
      const body = haze(S.body, 0.95), low = haze(S.low, 0.8), edge = haze(S.edge, 0.7);
      const green = S.edge;
      return {
        L, S, view: S.view, wire, det: L.det, lw: L.lw, wet: rain && S.wet !== false && S.view === 'street',
        wireW: 0.9 * L.lw, tubeW: 0.6 + 0.6 * d, haloA: 0.6 + 0.6 * d,
        void: wire ? 'rgba(0,6,2,1)' : rgba(body, 1),
        line: (a) => rgba(green, a * (0.25 + 0.75 * d)),
        bodyC: (a) => rgba(body, a),
        body: (y0, y1, close) => (wire ? 'rgba(0,6,2,1)' : close ? [0, y0, 0, y1, 0, rgba(mixc(body, [0, 0, 0], 0.15), 1), 1, rgba(mixc(body, low, 0.35), 1)] : rgba(body, 1)),
        lowC: (a) => rgba(low, a), edgeC: (a) => rgba(edge, a),
        metal: (a) => (wire ? 'rgba(0,6,2,1)' : rgba(mixc(body, [70, 74, 92], 0.25 * d), a)),
        winCol: (rng) => S.win[Math.floor(rng() * S.win.length)],
        win: (c, a) => rgba(wire ? c : mixc(c, S.haze, (1 - d) * 0.45), a * (wire ? 0.5 + 0.5 * d : 1)),
        winOff: (a) => rgba(wire ? [0, 6, 2] : haze(S.winOff, 0.9), a),
        neon: (i) => ({ rgb: wire ? S.neon[0] : mixc(S.neon[i % 6], S.haze, (1 - d) * 0.35), g: (i % 6) + 1 }),
        neonFill: (i, a) => rgba(mixc(S.neon[i % 6], S.haze, (1 - d) * 0.35), a),
      };
    }
    _glowSprites() {
      const S = this.S, w = [255, 196, 130];
      const list = [glowSprite(w, mixc(w, [255, 140, 80], 0.5), [255, 120, 60])];
      for (const c of S.neon) list.push(glowSprite(mixc(c, [255, 255, 255], 0.35), c, c));
      list.push(glowSprite([235, 245, 255], [180, 210, 255], [140, 170, 255])); // 7: cold white (lamps, headlights)
      if (S.wire) return list.map(() => list[1]);
      return list;
    }
    _lit() {
      const fixed = this.S.sky.fixed;
      return fixed ? 1 : 0.55 + 0.45 * sstep(0.25, 0.85, this.night);
    }
    _autoWeather(season, r) {
      const v = this.S.view;
      if (v === 'grid') return 'none';
      if (season === 'winter' && r < 0.3) return 'snow';
      return r < (v === 'roofs' ? 0.55 : 0.5) ? 'rain' : 'none';
    }
    _skyCols() {
      const sk = this.S.sky;
      if (sk.fixed) return sk.fixed;
      const t = clamp(this.night, 0, 1);
      return sk.day.map((c, i) => mixc(c, sk.night[i], t));
    }
    _skyGradient() {
      const c = this._skyCols(), g = this.ctx.createLinearGradient(0, 0, 0, this.H * (this.S.view === 'grid' ? 0.712 : 0.8));
      g.addColorStop(0, rgba(c[0], 1)); g.addColorStop(0.55, rgba(c[1], 1)); g.addColorStop(1, rgba(c[2], 1));
      return g;
    }
    _drawSky() {
      const ctx = this.ctx, W = this.W, H = this.H, S = this.S;
      ctx.fillStyle = this.skyGrad; ctx.fillRect(0, 0, W, H);
      if (!this.stars) { const r = RNG(hash2(this.o.seed, 5)); this.stars = []; for (let i = 0; i < 140; i++) this.stars.push(r(), Math.pow(r(), 1.6) * 0.5, r()); }
      if (S.view === 'grid' || S.wire) {
        ctx.fillStyle = S.wire ? 'rgba(110,255,150,0.5)' : 'rgba(255,230,250,0.75)';
        for (let i = 0; i < this.stars.length; i += 3) { const s = (0.6 + this.stars[i + 2] * 1.2) * this.k; ctx.fillRect(this.stars[i] * W, this.stars[i + 1] * H, s, s); }
      }
      if (S.view === 'grid') {
        // the striped sun sitting on the horizon
        const cx = W * 0.5, cy = H * 0.56, r = H * 0.25, g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
        g.addColorStop(0, '#ffe55a'); g.addColorStop(0.5, '#ff8a3c'); g.addColorStop(1, '#ff2a8c');
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35;
        const hg = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.2); hg.addColorStop(0, 'rgba(255,80,140,0.6)'); hg.addColorStop(1, 'rgba(255,80,140,0)');
        ctx.fillStyle = hg; ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4); ctx.restore();
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
        ctx.fillStyle = this.skyGrad;
        for (let i = 0; i < 8; i++) { const y = cy - r * 0.12 + i * r * 0.15, h = r * (0.02 + i * 0.016); ctx.fillRect(cx - r - 2, y, 2 * r + 4, h); }
        return;
      }
      if (S.view === 'roofs' && this.sun && this.night < 0.7) {
        // a big pale sun through the smog
        const r = H * 0.09, x = this.sun.x, y = Math.max(this.sun.y, H * 0.18), g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        g.addColorStop(0, 'rgba(255,236,190,' + (0.85 * (1 - this.night)).toFixed(3) + ')'); g.addColorStop(0.3, 'rgba(255,200,120,' + (0.35 * (1 - this.night)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,160,80,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
      }
      if (this.moon && !S.wire) this._drawMoon(H * 0.03);
    }
    _paintOverlay(g, top, bot) {
      const W = this.W, H = this.H, fixed = this.S.sky.fixed;
      g.globalCompositeOperation = 'source-over';
      if (fixed) { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); }
      else { const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, rgba(top, 1)); lg.addColorStop(1, rgba(bot, 1)); g.fillStyle = lg; g.fillRect(0, 0, W, H); }
      if (this.o.paper) {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = g.createPattern(this.grain, 'repeat'); g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
      const D = Math.hypot(W, H), vg = g.createRadialGradient(W / 2, H * 0.5, D * 0.28, W / 2, H * 0.5, D * 0.62);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }
    // film grain, or scan lines for the terminal
    _paintGrain() {
      const T = 256, tile = mkCanvas(T, T), tg = tile.getContext('2d'), img = tg.createImageData(T, T), rng = RNG(91), wire = this.S.wire;
      for (let i = 0; i < T * T; i++) { const y = (i / T) | 0, v = 255 - Math.floor(Math.pow(rng(), 4) * 40) - (wire && y % 3 === 0 ? 70 : 0); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      tg.putImageData(img, 0, 0);
      return tile;
    }
    _paintMist(g, mb, i, w, h) {
      const kx = this.kx, c = this.S.mist, rng = RNG(hash2(this.o.seed, 400 + i)), n = Math.round(26 * mb.dens), a0 = this.S.view === 'roofs' ? 0.95 : this.S.wire ? 0.18 : 0.42;
      for (let j = 0; j < n; j++) {
        const rx = rng.range(160, 480) * kx, ry = Math.min(h * 0.45, rx * rng.range(0.1, 0.2)), cx = rng() * w, cy = ry + rng() * (h - 2 * ry), a = rng.range(0.4, 1) * a0;
        for (const ox of [-w, 0, w]) {
          g.save(); g.translate(cx + ox, cy); g.scale(1, ry / rx);
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, rgba(c, a)); gr.addColorStop(1, rgba(c, 0));
          g.fillStyle = gr; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore();
        }
      }
    }

    // ---------------------------------------------------------------- live traffic
    // Moving things are drawn right after the layer they belong behind, so nearer buildings
    // cover them; their lights go into the light map at the same depth.
    _birds(dt) {
      const k = this.k, W = this.W, S = this.S, on = this.o.birds && !this.reduceMotion;
      if (this._lastCam == null) this._lastCam = this.cam;
      const dc = (this.cam - this._lastCam) * this.kx; this._lastCam = this.cam;
      this.cars = this.cars || []; this.carT = (this.carT || 0) - dt;
      // fill the sky on the first frame so traffic is already moving when the wallpaper appears
      const fill = on && !this._filled && S.view !== 'grid' ? 9 : 0;
      if (fill) { this._filled = true; if (Math.random() < 0.6) this._trainNow = true; }
      for (let n = 0; n <= fill; n++) if (on && (n < fill || this.carT <= 0) && S.view !== 'grid') {
        const r = Math.random, dir = r() < 0.5 ? 1 : -1, ground = S.view === 'street' && r() < 0.35;
        const depth = ground ? 4 : S.view === 'roofs' ? (r() < 0.5 ? 2 : 3) : r() < 0.55 ? 1 : 2;
        const s = ground ? 1 : depth === 1 ? 0.25 : depth === 2 ? 0.45 : 0.7;
        const y = ground ? lerp(930, 990, r()) : depth === 1 ? lerp(180, 420, r()) : depth === 2 ? lerp(140, 420, r()) : lerp(260, 520, r());
        this.cars.push({ depth, ground, s, y, x: n < fill ? r() * W : dir > 0 ? -200 * k : W + 200 * k, v: dir * (ground ? lerp(260, 420, r()) : lerp(70, 180, r())) * s, c: Math.floor(r() * 6), dir });
        this.carT = ground ? lerp(2, 7, r()) : lerp(0.6, 3, r());
      }
      for (const c of this.cars) c.x += c.v * k * dt - dc * LAYERS[c.depth].par;
      this.cars = this.cars.filter((c) => c.x > -400 * k && c.x < W + 400 * k);
      // the train
      if (on && S.view !== 'grid') {
        if (!this.train && (this._trainNow || Math.random() < dt / 40)) { const dir = Math.random() < 0.5 ? 1 : -1, x = this._trainNow ? Math.random() * W * 0.6 : dir > 0 ? -1100 * k : W + 200 * k; this._trainNow = false; this.train = { dir, x, v: dir * 160, cars: 4 + Math.floor(Math.random() * 3) }; }
        if (this.train) { const t = this.train; t.x += t.v * k * dt - dc * LAYERS[3].par; if (t.x < -1400 * k || t.x > W + 1400 * k) this.train = null; }
      }
    }
    _drawLayer(i) {
      super._drawLayer(i);
      const ctx = this.ctx, k = this.k, S = this.S;
      if (i === 4 && S.view === 'grid') this._grid();
      if (!this.cars) return;
      const wire = S.wire;
      for (const c of this.cars) {
        if (c.depth !== i) continue;
        const s = c.s * k, x = c.x, y = c.y * k, d = c.dir;
        ctx.fillStyle = wire ? 'rgb(0,6,2)' : 'rgb(12,12,22)';
        if (c.ground) {
          ctx.beginPath(); ctx.moveTo(x - 60 * s, y); ctx.lineTo(x + 60 * s, y); ctx.lineTo(x + 56 * s, y - 16 * s); ctx.lineTo(x + 30 * s * d, y - 30 * s); ctx.lineTo(x - 26 * s * d, y - 30 * s); ctx.lineTo(x - 56 * s, y - 16 * s); ctx.closePath(); ctx.fill();
          if (wire) { ctx.strokeStyle = 'rgba(110,255,150,0.9)'; ctx.lineWidth = k; ctx.stroke(); }
          ctx.fillStyle = 'rgba(255,250,235,1)'; ctx.fillRect(x + d * 54 * s - 3 * s, y - 14 * s, 6 * s, 4 * s);
          ctx.fillStyle = 'rgba(255,40,50,1)'; ctx.fillRect(x - d * 56 * s - 3 * s, y - 14 * s, 6 * s, 4 * s);
        } else {
          ctx.beginPath(); ctx.ellipse(x, y, 22 * s, 6 * s, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = rgba(S.neon[c.c], 0.9); ctx.fillRect(x - 16 * s, y + 4 * s, 32 * s, 1.6 * s);
          ctx.fillStyle = 'rgba(255,250,235,1)'; ctx.fillRect(x + d * 20 * s - 2 * s, y - 1.5 * s, 4 * s, 3 * s);
          ctx.fillStyle = 'rgba(255,40,50,1)'; ctx.fillRect(x - d * 22 * s - 2 * s, y - 1.5 * s, 4 * s, 3 * s);
        }
      }
      if (i === 3 && this.train) {
        const t = this.train, y = RAIL_Y * k, ch = 30 * k, cw = 150 * k;
        for (let j = 0; j < t.cars; j++) {
          const x = t.x + j * (cw + 4 * k);
          ctx.fillStyle = wire ? 'rgb(0,6,2)' : 'rgb(30,32,48)'; ctx.fillRect(x, y - ch, cw, ch);
          ctx.fillStyle = wire ? 'rgba(110,255,150,0.7)' : 'rgba(255,226,170,0.95)';
          for (let w = x + 8 * k; w < x + cw - 12 * k; w += 16 * k) ctx.fillRect(w, y - ch + 7 * k, 10 * k, 9 * k);
          ctx.fillStyle = rgba(S.neon[1], 0.9); ctx.fillRect(x, y - 5 * k, cw, 2 * k);
        }
      }
    }
    _lightsLayer(i) {
      super._lightsLayer(i);
      const g = this.lg, k = this.k, h = 0.5;
      g.globalCompositeOperation = 'lighter';
      if (this.cars) for (const c of this.cars) {
        if (c.depth !== i) continue;
        const s = c.s * k, gw = this.glows, y = c.y * k, d = c.dir;
        if (c.ground) { const r = 70 * s; g.drawImage(gw[7], (c.x + d * 80 * s - r) * h, (y - 12 * s - r * 0.5) * h, 2 * r * h, r * h); g.drawImage(gw[4], (c.x - d * 56 * s - 20 * s) * h, (y - 32 * s) * h, 40 * s * h, 40 * s * h); }
        else { const r = 22 * s; g.drawImage(gw[c.c + 1], (c.x - r) * h, (y - r * 0.5) * h, 2 * r * h, 1.4 * r * h); g.drawImage(gw[7], (c.x + d * 20 * s - 8 * s) * h, (y - 8 * s) * h, 16 * s * h, 16 * s * h); }
      }
      if (i === 3 && this.train) {
        const t = this.train, y = RAIL_Y * k, cw = 150 * k;
        for (let j = 0; j < t.cars; j++) { const x = t.x + j * (cw + 4 * k); g.drawImage(this.glows[0], x * h, (y - 50 * k) * h, cw * h, 50 * k * h); }
      }
    }
    // the synthwave floor: a perspective grid whose lines slide with the near layer
    _grid() {
      const ctx = this.ctx, W = this.W, H = this.H, yh = 712 * this.k, cx = W / 2, sp = 90 * this.k;
      const off = (this.cam * this.kx) % sp;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'butt';
      for (const pass of [[4 * this.k, 0.14], [1.2 * this.k, 0.7]]) {
        ctx.lineWidth = pass[0]; ctx.beginPath();
        for (let i = 1; i < 16; i++) { const y = yh + (H - yh) / (1 + (15 - i) * 0.32) - 0; ctx.moveTo(0, y); ctx.lineTo(W, y); }
        for (let xb = -W * 3 - off; xb < W * 4; xb += sp) { ctx.moveTo(cx + (xb - cx) * 0.02, yh); ctx.lineTo(xb, H); }
        const g = ctx.createLinearGradient(0, yh, 0, H); g.addColorStop(0, 'rgba(255,60,200,0)'); g.addColorStop(0.25, 'rgba(255,60,200,' + pass[1] * 0.6 + ')'); g.addColorStop(1, 'rgba(255,90,220,' + pass[1] + ')');
        ctx.strokeStyle = g; ctx.stroke();
      }
      ctx.restore();
    }
    // rain catches the neon: pale streaks, a little brighter than the default
    _weather(dt) {
      if (this.weather !== 'rain' || this.reduceMotion) return super._weather(dt);
      const ctx = this.ctx, W = this.W, H = this.H, k = this.k;
      const want = this._particleCount(240);
      while (this.parts.length < want) this.parts.push({ x: Math.random() * W, y: Math.random() * H, v: Math.random(), p: Math.random() * TAU });
      ctx.strokeStyle = this.S.wire ? 'rgba(110,255,150,0.22)' : 'rgba(190,200,255,0.26)'; ctx.lineWidth = Math.max(0.7, 0.8 * k); ctx.beginPath();
      for (const q of this.parts) {
        const v = (900 + q.v * 400) * k;
        q.y += v * dt; q.x += v * 0.1 * dt;
        if (q.y > H) { q.y -= H + 40 * k; q.x = Math.random() * W; }
        if (q.x > W) q.x -= W;
        const l = (22 + q.v * 26) * k;
        ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - l * 0.1, q.y - l);
      }
      ctx.stroke();
    }
  }
  SprawlEngine.def = {
    layers: LAYERS, mist: MIST, tod: TOD, paper: [20, 18, 30], ink: [200, 200, 230], sun: [255, 120, 80],
    sky: { horizon: 0.5, zenith: 0.12 },
    styles: Object.keys(STYLES), defaults: { style: 'noir' }, builders: B, styleSprites: true, weathers: ['none', 'rain', 'snow'],
  };

  window.Paperwall.register({
    id: 'sprawl', name: 'Sprawl', native: '', order: 5,
    tagline: 'Cyberpunk city',
    blurb: 'A megacity under neon, with arcologies in the haze and flying traffic over wet streets.',
    Engine: SprawlEngine, paper: '#14121e', ink: '#c8c8e6', accent: '#ff2eaa',
    styles: [
      { id: 'noir', name: 'Neon noir', native: '', blurb: 'Street level in the rain, signs mirrored in the asphalt', swatch: ['#0c0c18', '#2a1446', '#ff2eaa', '#1ee4ff'] },
      { id: 'synth', name: 'Synthwave', native: '', blurb: 'A skyline on a glowing grid, under a striped sun', swatch: ['#10042a', '#5c1270', '#ff5c78', '#ffe55a'] },
      { id: 'smog', name: 'Amber smog', native: '', blurb: 'Rooftops and holograms in orange haze, seen from a balcony', swatch: ['#2c201e', '#be7038', '#ecb060', '#28e6d2'] },
      { id: 'phosphor', name: 'Phosphor', native: '', blurb: 'The street as green wireframe on a black terminal', swatch: ['#000602', '#001e0c', '#46ff82', '#a0ffbe'] },
    ],
    weathers: [{ id: 'auto', name: 'Automatic' }, { id: 'none', name: 'Clear' }, { id: 'rain', name: 'Rain' }, { id: 'snow', name: 'Snow' }],
    toggles: [{ id: 'birds', name: 'Traffic' }, { id: 'mist', name: 'Haze' }, { id: 'paper', name: 'Film grain' }],
  });
})();
