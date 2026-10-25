/*
 * Jiangnan: an endless canal town south of the Yangtze, seen from a boat. White walls and
 * black tiles, stepped horse-head gables, stone quays and arched bridges, willows over the
 * water and every house doubled in the canal. A close view: less land, more town.
 *
 * Three ways of painting it (the "style" option):
 *   wu       lines and dots: crisp black roofs on white walls, wiry willows, dots of colour
 *   rain     misty rain: grey wet ink, soft reflections, red lanterns in the drizzle
 *   qinghua  blue and white: the whole town painted in cobalt on porcelain
 */
(function () {
  'use strict';
  const { Engine, CW, TAU, clamp, lerp, sstep, hash2, hash4, RNG, vnoise, fbm, rgba, mixc,
    DL, brush, curve, blob, rect, interpY, Occ, mkCanvas, P } = window.Paperwall;

  // ------------------------------------------------------------------ palettes
  const STYLES = {
    wu: {
      mode: 'line', paper: [249, 248, 243], air: [249, 248, 243], ink: [22, 22, 26],
      wall: [254, 253, 250], stain: [150, 150, 146], roof: [26, 26, 30], roofA: 0.95, wood: [74, 64, 56], stone: [168, 166, 160],
      water: [[240, 241, 238], [228, 232, 231]], refl: [196, 200, 200], ripple: [40, 44, 48], rippleA: 0.5, rippleLong: true,
      tree: [36, 42, 38], dots: [[206, 44, 38], [42, 92, 178], [56, 142, 84], [150, 62, 148], [236, 176, 36]],
      lantern: [206, 44, 38], umbrella: [[206, 44, 38], [42, 92, 178], [236, 176, 36]], hill: [178, 184, 178], seal: [196, 44, 36],
      sky: [[252, 251, 247], [246, 245, 240]], mistA: 0.85, grain: 'washi', sun: true,
    },
    rain: {
      mode: 'wet', paper: [232, 233, 230], air: [224, 227, 226], ink: [42, 44, 48],
      wall: [240, 240, 236], stain: [120, 124, 124], roof: [58, 60, 66], roofA: 0.82, wood: [84, 78, 72], stone: [150, 152, 150],
      water: [[218, 222, 222], [196, 202, 204]], refl: [176, 182, 184], ripple: [242, 244, 242], rippleA: 0.55, rippleLong: false,
      tree: [74, 80, 76], dots: null,
      lantern: [198, 50, 38], umbrella: [[198, 50, 38], [64, 78, 110]], hill: [196, 200, 198], seal: [184, 50, 40],
      sky: [[206, 210, 210], [230, 232, 229]], mistA: 1.25, grain: 'washi', sun: false,
    },
    qinghua: {
      mode: 'blue', paper: [246, 248, 250], air: [244, 247, 251], ink: [26, 50, 122],
      wall: [249, 251, 253], stain: [120, 146, 204], roof: [30, 54, 128], roofA: 0.92, wood: [50, 76, 150], stone: [126, 148, 200],
      water: [[240, 244, 250], [228, 236, 248]], refl: [170, 190, 226], ripple: [34, 60, 138], rippleA: 0.5, rippleLong: true,
      tree: [30, 54, 128], dots: [[44, 72, 156], [74, 104, 186], [24, 44, 116]],
      lantern: [44, 72, 156], umbrella: [[44, 72, 156], [96, 126, 200]], hill: [168, 186, 222], seal: [36, 62, 146],
      sky: [[248, 250, 253], [242, 246, 251]], mistA: 0.9, grain: 'glaze', sun: false,
    },
  };

  // ------------------------------------------------------------------ layout
  // Q: top of the stone quay (where the front houses stand). W: the canal's waterline.
  const Q = 712, W = 748, FQ = 622, FW = 630;
  const LAYERS = [
    { id: 0, kind: 'hills', par: 0.05, y0: 330, y1: 600, base: 580, R: 2, ink: 0.32, lw: 0.6, det: 0.3, haze: 0.72 },
    { id: 1, kind: 'far',   par: 0.17, y0: 380, y1: 725, base: FQ, R: 2, ink: 0.55, lw: 0.65, det: 0.45, haze: 0.45 },
    { id: 2, kind: 'row',   par: 0.42, y0: 40,  y1: 1000, base: Q, R: 2, ink: 0.95, lw: 1.1, det: 1.0, haze: 0.04 },
    { id: 3, kind: 'canal', par: 0.62, y0: 720, y1: 1000, base: W, R: 2, ink: 0.95, lw: 1.2, det: 1.0, haze: 0 },
    { id: 4, kind: 'near',  par: 1.0,  y0: 0,   y1: 1000, base: 1000, R: 2, ink: 1.0, lw: 1.3, det: 1.0, haze: 0 },
  ];
  const MIST = [
    { after: 0, y: 470, h: 130, a: 0.9,  par: 0.08, drift: 2, dens: 1.0 },
    { after: 1, y: 560, h: 110, a: 0.8,  par: 0.2,  drift: 3, dens: 0.9 },
    { after: 2, y: 250, h: 150, a: 0.32, par: 0.45, drift: 4, dens: 0.4 },
  ];
  const TOD = [
    [0.0, [62, 70, 102], [80, 86, 112], 1],
    [4.6, [62, 70, 102], [80, 86, 112], 1],
    [5.6, [156, 136, 156], [196, 166, 166], 0.55],
    [6.4, [242, 208, 190], [252, 228, 206], 0.1],
    [7.6, [255, 249, 240], [255, 252, 246], 0],
    [16.6, [255, 251, 243], [255, 253, 248], 0],
    [18.0, [250, 216, 184], [253, 230, 206], 0.05],
    [19.0, [186, 152, 162], [206, 172, 168], 0.35],
    [20.2, [76, 80, 112], [94, 96, 120], 0.9],
    [21.0, [62, 70, 102], [80, 86, 112], 1],
    [24.0, [62, 70, 102], [80, 86, 112], 1],
  ];

  // mirror a polygon in the water surface y = w
  const mirror = (p, w) => { const o = new Array(p.length); for (let i = 0; i < p.length; i += 2) { o[i] = p[i]; o[i + 1] = 2 * w - p[i + 1]; } return o; };
  // a fading reflection of a shape: strongest at the waterline, gone after `len`
  function reflect(dl, p, w, len, col, a) {
    const m = mirror(p, w);
    let top = Infinity, x = 0;
    for (let i = 1; i < m.length; i += 2) if (m[i] < top) { top = m[i]; x = m[i - 1]; }
    dl.poly(m, [x, Math.max(w, top), x, Math.max(w, top) + len, 0, rgba(col, a), 1, rgba(col, 0)]);
  }

  // A reflection broken into horizontal slices by the ripples: each slice shifts a little
  // further sideways and fades as it goes down.
  function slices(dl, rng, x0, x1, yTop, len, col, a) {
    for (let y = yTop, j = 0; y < yTop + len; y += 5.5, j++) {
      const t = (y - yTop) / len;
      if (rng() < 0.12 + 0.3 * t) continue;
      const jit = rng.range(-2, 2) * (1 + t * 4), sh = rng.range(0.25, 0.4) * t * (x1 - x0);
      dl.poly(rect(x0 + jit + rng() * sh, y, x1 - x0 - sh * rng(), 5.5 * rng.range(0.5, 0.95)), rgba(col, a * Math.pow(1 - t, 1.3)));
    }
  }

  // ------------------------------------------------------------------ architecture
  // Black tile cap along a wall top, with the upturned "horse head" at both ends.
  function cap(dl, rng, st, x0, x1, y, th, tips) {
    const up = tips ? th * 1.1 : th * 0.2;
    const p = [x0 - th * 0.7, y + th * 0.25, x0 - th * 1.0, y - up, x0 - th * 0.3, y - th * 0.45, x1 + th * 0.3, y - th * 0.45, x1 + th * 1.0, y - up, x1 + th * 0.7, y + th * 0.25];
    dl.poly(p, st.roof(1));
    if (st.mode !== 'wet') dl.poly(brush([x0 - th * 0.6, y + th * 0.2, x1 + th * 0.6, y + th * 0.2], Math.max(0.5, th * 0.12), rng, { taper: 0 }), st.ink(0.6));
    return p;
  }
  // Soft water stains climbing a white wall from its foot (the damp of a canal town).
  function stains(dl, rng, st, x, w, base, h) {
    dl.poly(rect(x, base - h * 0.32, w, h * 0.32), [x, base - h * 0.32, x, base, 0, st.stain(0), 1, st.stain(0.22 * st.wash)]);
    const n = Math.round((w / 30) * st.wash);
    for (let i = 0; i < n; i++) {
      const sx = x + rng() * w, sw = rng.range(10, 30), sh = Math.min(h * 0.18, sw * rng.range(0.4, 0.9));
      dl.poly(blob(sx, base - sh * 0.45, sw, sh * 0.5, 0, 10, rng, 0.4), st.stain(rng.range(0.03, 0.07) * st.wash));
    }
  }
  function outline(dl, rng, st, pts, a) {
    if (st.mode === 'wet') a *= 0.45;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (rng() < 0.12) continue;
      dl.poly(brush([pts[i], pts[i + 1], pts[i + 2], pts[i + 3]], rng.range(0.6, 1.1) * st.lw, rng, { wob: 0.25, min: 0.4 }), st.ink(a * rng.range(0.6, 1)));
    }
  }
  function windowBox(dl, rng, st, x, y, w, h, lit) {
    dl.poly(rect(x, y, w, h), st.ink(st.mode === 'blue' ? 0.75 : 0.8));
    if (w > 6 && st.det > 0.6) {
      // a lattice of lighter bars
      const n = Math.max(1, Math.round(w / 6));
      for (let k = 1; k < n; k++) dl.poly(rect(x + (w * k) / n - 0.3, y, 0.6, h), st.wood(0.6));
      dl.poly(rect(x, y + h / 2 - 0.3, w, 0.6), st.wood(0.6));
    }
    if (lit) dl.light(x + w / 2, y + h / 2, Math.max(8, w * 1.4));
  }
  function lanternRed(dl, rng, st, x, y, s) {
    dl.poly(brush([x, y - s * 0.8, x, y - s * 0.45], 0.4 * st.lw, rng, { taper: 0 }), st.ink(0.7));
    dl.poly(blob(x, y, s * 0.36, s * 0.46, 0, 12, rng, 0.05), st.lantern(0.95));
    dl.poly(rect(x - s * 0.18, y - s * 0.52, s * 0.36, s * 0.1), st.ink(0.85));
    dl.poly(rect(x - s * 0.14, y + s * 0.42, s * 0.28, s * 0.08), st.ink(0.85));
    dl.light(x, y, s * 2.2);
  }

  // A gable end facing the canal: white stepped wall with black caps on every step.
  function gableHouse(dl, rng, st, x, w, base, h, o) {
    const steps = rng.int(w > 120 ? 2 : 1, w > 120 ? 3 : 2), cw = w * rng.range(0.26, 0.36), sw = (w - cw) / 2 / steps, dh = Math.min(h * 0.17, sw * 1.3);
    const p = [x, base];
    for (let i = steps; i >= 1; i--) { const yy = base - h + i * dh, xl = x + (steps - i) * sw; p.push(xl, yy, xl + sw, yy); }
    p.push(x + steps * sw, base - h, x + w - steps * sw, base - h);
    for (let i = 1; i <= steps; i++) { const yy = base - h + i * dh, xr = x + w - (steps - i) * sw; p.push(xr - sw, yy, xr, yy); }
    p.push(x + w, base);
    // fix the stair: step corners need a vertical riser between levels
    const sil = [x, base];
    for (let i = steps; i >= 1; i--) { const yy = base - h + i * dh, xl = x + (steps - i) * sw; sil.push(xl, yy, xl + sw, yy); }
    sil.push(x + steps * sw, base - h, x + w - steps * sw, base - h);
    for (let i = 1; i <= steps; i++) { const yy = base - h + i * dh, xr = x + w - (steps - i) * sw; sil.push(xr - sw, yy, xr, yy); }
    sil.push(x + w, base);
    dl.poly(sil, st.wall(1));
    stains(dl, rng, st, x, w, base, h);
    // a side shadow: the gable is lit from one side
    if (st.mode !== 'line' || rng() < 0.5) dl.poly(rect(x, base - h * 0.95, w * 0.12, h * 0.95), [x, 0, x + w * 0.12, 0, 0, st.stain(0.16), 1, st.stain(0)]);
    const th = Math.max(5, Math.min(10, w * 0.06));
    for (let i = steps; i >= 1; i--) { const yy = base - h + i * dh, xl = x + (steps - i) * sw, xr = x + w - (steps - i) * sw; cap(dl, rng, st, xl, xl + sw, yy, th, true); cap(dl, rng, st, xr - sw, xr, yy, th, true); }
    cap(dl, rng, st, x + steps * sw, x + w - steps * sw, base - h, th, true);
    // small windows high up, maybe a door at the foot
    const rows = h > 260 ? 2 : 1, ws = rng.range(8, 13);
    for (let r = 0; r < rows; r++) {
      const nw = rng.int(1, w > 120 ? 4 : 2), wy = base - h * (r ? rng.range(0.66, 0.74) : rng.range(0.38, 0.5));
      for (let k = 0; k < nw; k++) { const wx = x + w * ((k + 1) / (nw + 1)) - ws / 2; windowBox(dl, rng, st, wx, wy, ws, ws * 1.25, rng() < 0.5); }
    }
    // a painted frieze under the top step (a band of grey under the caps)
    if (rng() < 0.6) dl.poly(rect(x + steps * sw, base - h + 7, w - 2 * steps * sw, h * 0.05), st.stain(0.14));
    if (rng() < 0.55) { const dw = rng.range(14, 22), dx = x + w * rng.range(0.25, 0.75) - dw / 2; dl.poly(rect(dx, base - dw * 1.7, dw, dw * 1.7), st.ink(0.82)); dl.poly(rect(dx - 2, base - dw * 1.7 - 3, dw + 4, 3), st.stone(0.9)); dl.light(dx + dw / 2, base - dw, dw * 1.4); }
    if (st.mode === 'line') outline(dl, rng, st, [x, base, x, base - h + steps * dh], 0.7), outline(dl, rng, st, [x + w, base, x + w, base - h + steps * dh], 0.7);
    if (o.reflect) {
      const y0 = 2 * o.reflect - base;
      slices(dl, rng, x, x + w, y0, h * 0.85, st.reflWall, 0.75);
      slices(dl, rng, x + w * 0.1, x + w * 0.9, y0 + h * 0.5, h * 0.35, st.reflRoof0, 0.35);
    }
    return { top: base - h - th };
  }

  // A long facade facing the canal: eave roof, one or two storeys, end walls above the roof.
  function longHouse(dl, rng, st, x, w, base, h, o) {
    const two = h > 150 && rng() < 0.75, rh = Math.min(h * rng.range(0.2, 0.28), 60), wh = h - rh, ov = rng.range(6, 12), wood = rng() < 0.4;
    // walls
    const top = base - wh;
    dl.poly(rect(x, top, w, wh), st.wall(1));
    if (wood) {
      // shopfront: dark timber boards on the ground floor
      const gh = two ? wh * 0.44 : wh * 0.55;
      dl.poly(rect(x + 3, base - gh, w - 6, gh), st.wood(st.mode === 'wet' ? 0.6 : 0.88));
      const nb = Math.max(3, Math.round(w / 10));
      for (let k = 1; k < nb; k++) dl.poly(rect(x + 3 + ((w - 6) * k) / nb - 0.35, base - gh, 0.7, gh), st.ink(0.55));
      if (rng() < 0.7) dl.light(x + w / 2, base - gh * 0.5, Math.min(60, w * 0.4));
    } else stains(dl, rng, st, x, w, base, wh);
    if (two) {
      // a pent roof between the storeys, and a row of lattice windows above it
      const py = base - wh * 0.5;
      dl.poly([x - ov * 0.6, py + 4, x + w + ov * 0.6, py + 4, x + w, py - 9, x, py - 9], st.roof(0.95));
      dl.poly(brush([x - ov * 0.6, py + 4, x + w + ov * 0.6, py + 4], 1.1 * st.lw, rng, { taper: 0 }), st.ink(0.85));
      const nw = Math.max(1, Math.round(w / rng.range(28, 44))), ww = (w - 12) / nw;
      for (let k = 0; k < nw; k++) windowBox(dl, rng, st, x + 6 + k * ww + ww * 0.12, top + wh * 0.12, ww * 0.76, wh * 0.26, rng() < 0.45);
      if (!wood && rng() < 0.6) { const dw = rng.range(14, 20), dx = x + w * rng.range(0.2, 0.8); dl.poly(rect(dx - dw / 2, base - dw * 1.6, dw, dw * 1.6), st.ink(0.82)); }
    } else if (!wood) {
      const nw = rng.int(1, 3);
      for (let k = 0; k < nw; k++) windowBox(dl, rng, st, x + w * ((k + 1) / (nw + 1)) - 6, top + wh * 0.3, 12, 12, rng() < 0.4);
    }
    // the roof: a dark band of tiles with an eave line and a ridge with lifted ends
    const roof = [x - ov, top + 2, x + w + ov, top + 2, x + w + ov * 0.4, top - rh, x - ov * 0.4, top - rh];
    dl.poly(roof, st.roof(1));
    if (st.det > 0.5) {
      const nt = Math.round(w / 3.4);
      for (let k = 0; k <= nt; k++) { const t = k / nt, bx = lerp(x - ov, x + w + ov, t), tx = lerp(x - ov * 0.4, x + w + ov * 0.4, t); dl.poly(brush([tx, top - rh, bx, top + 1], 0.32 * st.lw, rng, { taper: 0 }), st.tileLine(rng.range(0.25, 0.5))); }
    }
    dl.poly(brush([x - ov, top + 2, x + w + ov, top + 2], 1.6 * st.lw, rng, { taper: 0, wob: 0.15 }), st.ink(0.9));
    dl.poly(brush([x - ov * 0.4 - 4, top - rh - 5, x - ov * 0.4, top - rh, x + w + ov * 0.4, top - rh, x + w + ov * 0.4 + 4, top - rh - 5], 2.2 * st.lw, rng, { taper: 0 }), st.roof(1));
    // end walls rising above the roof line (fire walls)
    const ends = [];
    if (rng() < 0.75) ends.push(x - 2);
    if (rng() < 0.75) ends.push(x + w - 8);
    for (const ex of ends) {
      const eh = rh + rng.range(12, 34), ew = 10;
      dl.poly(rect(ex, top - eh, ew, eh + 4), st.wall(1));
      dl.poly(rect(ex, top - eh, ew * 0.3, eh), st.stain(0.12));
      cap(dl, rng, st, ex, ex + ew, top - eh, 6, true);
    }
    // lanterns under the eave
    if (rng() < (o.lanterns || 0.35)) { const nl = rng.int(1, 2); for (let k = 0; k < nl; k++) lanternRed(dl, rng, st, x + w * ((k + 1) / (nl + 1)), top + 16, rng.range(9, 13)); }
    if (st.mode === 'line') { outline(dl, rng, st, [x, base, x, top], 0.65); outline(dl, rng, st, [x + w, base, x + w, top], 0.65); }
    if (o.reflect) {
      const y0 = 2 * o.reflect - base;
      slices(dl, rng, x, x + w, y0, wh, wood ? st.reflRoof0 : st.reflWall, wood ? 0.35 : 0.75);
      slices(dl, rng, x - ov, x + w + ov, y0 + wh, rh * 1.6, st.reflRoof0, 0.5);
    }
    return { top: top - rh };
  }

  // Seven-storey pagoda with upswept eaves (seen in the distance over the rooftops).
  function pagoda(dl, rng, st, x, y, s, a) {
    let yy = y, w = s * 0.8;
    const tiers = 7, th = s * 0.5;
    for (let t = 0; t < tiers; t++) {
      const bh = th * 0.55;
      dl.poly(rect(x - w / 2, yy - bh, w, bh), st.wall(a));
      const ew = w / 2 + s * 0.28, ey = yy - bh;
      dl.poly([x - ew, ey + 1, x - ew - s * 0.12, ey - s * 0.12, x - w * 0.3, ey - th * 0.32, x + w * 0.3, ey - th * 0.32, x + ew + s * 0.12, ey - s * 0.12, x + ew, ey + 1], st.roof(a));
      yy -= th * 0.82; w *= 0.88;
    }
    dl.poly(brush([x, yy + th * 0.3, x, yy - s * 0.7], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.8 * a));
  }

  // Tree crown behind the rooftops: wiry lines and dots, a wet blot, or cobalt leaves.
  function crown(dl, rng, st, x, y, r) {
    if (st.mode === 'wet') {
      for (let k = 0; k < 4; k++) dl.poly(blob(x + rng.range(-0.4, 0.4) * r, y + rng.range(-0.3, 0.3) * r, r * rng.range(0.5, 0.9), r * rng.range(0.35, 0.6), 0, 14, rng, 0.45), st.tree(rng.range(0.15, 0.3)));
      return;
    }
    dl.poly(blob(x, y, r, r * 0.62, 0, 16, rng, 0.4), st.tree(st.mode === 'blue' ? 0.16 : 0.06));
    const nl = Math.round(r * 1.1 * st.det);
    for (let k = 0; k < nl; k++) {
      const a = rng() * TAU, rr = r * Math.sqrt(rng()), sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr * 0.6, l = rng.range(6, 16);
      dl.poly(brush(curve(sx, sy, sx + rng.range(-l, l), sy + rng.range(-l, l) * 0.6, 5, rng.range(-0.3, 0.3), rng, 0.4), rng.range(0.5, 1.1) * st.lw, rng), st.tree(rng.range(0.4, 0.85)));
    }
    if (st.dots) {
      const nd = Math.round(r * 0.9 * st.det);
      for (let k = 0; k < nd; k++) { const a = rng() * TAU, rr = r * Math.sqrt(rng()) * 1.05, c = st.dots[Math.floor(rng() * st.dots.length)], d = rng.range(1.6, 3.6) * st.lw; dl.poly(blob(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.62, d, d * 0.85, 0, 7, rng, 0.3), rgba(c, rng.range(0.7, 0.95))); }
    }
  }

  // Weeping willow: a dark, twisting trunk and long hanging fronds.
  function willow(dl, rng, st, x, y, H, reflectAt) {
    const lean = rng.range(-0.3, 0.3) * H, n = 12, s0 = (rng() * 1e6) | 0, tr = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1); tr.push(x + lean * t * t + H * 0.06 * vnoise(s0, t * 3), y - H * 0.62 * t); }
    dl.poly(brush(tr, Math.max(3, H * 0.05) * st.lw, rng, { prof: (t) => 1 - 0.55 * t, wob: 0.25, min: 0.3 }), st.ink(st.mode === 'wet' ? 0.6 : 0.9));
    const tx = tr[(n - 1) * 2], ty = tr[(n - 1) * 2 + 1];
    // a few limbs, then fronds falling from their arcs
    const limbs = rng.int(3, 5), tips = [];
    for (let b = 0; b < limbs; b++) {
      const a = -Math.PI / 2 + rng.range(-1.1, 1.1), l = H * rng.range(0.2, 0.38), ex = tx + Math.cos(a) * l, ey = ty + Math.sin(a) * l;
      dl.poly(brush(curve(tx, ty, ex, ey, 6, rng.range(-0.25, 0.25), rng, 0.3), Math.max(1.2, H * 0.018) * st.lw, rng, { prof: (q) => 1 - 0.7 * q, min: 0.3 }), st.ink(st.mode === 'wet' ? 0.5 : 0.85));
      tips.push([tx, ty, ex, ey]);
    }
    const nf = Math.round(rng.range(20, 34) * st.det);
    for (let f = 0; f < nf; f++) {
      const L = tips[f % tips.length], t = rng.range(0.3, 1), fx = lerp(L[0], L[2], t), fy = lerp(L[1], L[3], t), len = H * rng.range(0.3, 0.75);
      const sway = rng.range(-0.08, 0.08) * len, end = Math.min(fy + len, (reflectAt || 2000) - 4);
      const pts = [fx, fy, fx + sway * 0.4, lerp(fy, end, 0.4), fx + sway, end];
      dl.poly(brush(pts, rng.range(0.5, 0.9) * st.lw, rng, { prof: (q) => 1 - 0.6 * q, wob: 0.2 }), st.leaf(rng.range(0.45, 0.85)));
      if (st.det > 0.6) for (let k = 0; k < 4; k++) { const q = rng.range(0.2, 1), lx = fx + sway * q, ly = lerp(fy, end, q); dl.poly(brush([lx, ly, lx + rng.range(-3, 3), ly + rng.range(3, 6)], 1.1 * st.lw, rng, { prof: (u) => Math.sin(Math.PI * u) }), st.leaf(0.6)); }
    }
    if (reflectAt) reflect(dl, brush(tr, Math.max(3, H * 0.05) * st.lw, rng, { prof: (t) => 1 - 0.55 * t }), reflectAt, H * 0.5, st.reflRoof0, 0.35);
  }

  // Semicircular stone arch bridge; with its reflection the arch closes into a full ring.
  function archBridge(dl, rng, st, cx, span, w) {
    const r = span * 0.44, deckH = r + 26, n = 20, top = W - deckH;
    const outer = [], inner = [];
    const half = span / 2 + 34;
    for (let i = 0; i <= n; i++) { const t = i / n, xx = cx - half + 2 * half * t, e = Math.sin(Math.PI * t); outer.push(xx, W - 10 - (deckH - 2) * Math.pow(e, 0.7)); }
    const body = outer.slice();
    body.push(cx + half, W + 1, cx - half, W + 1);
    dl.poly(body, st.stone(1));
    // the arch opening
    const arc = [];
    for (let i = 0; i <= n; i++) { const a = Math.PI + (i / n) * Math.PI; arc.push(cx + Math.cos(a) * r, W + Math.sin(a) * r); }
    dl.poly(arc, st.water(1));
    dl.poly(brush(arc, 1.4 * st.lw, rng, { taper: 0, wob: 0.15 }), st.ink(0.8));
    // voussoirs round the arch
    for (let i = 1; i < 12; i++) { const a = Math.PI + (i / 12) * Math.PI; dl.poly(brush([cx + Math.cos(a) * r, W + Math.sin(a) * r, cx + Math.cos(a) * (r + 12), W + Math.sin(a) * (r + 12)], 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.45)); }
    dl.poly(brush(outer, 1.5 * st.lw, rng, { taper: 0, wob: 0.15 }), st.ink(0.85));
    const rail = outer.map((v, k) => (k % 2 ? v - 12 : v));
    dl.poly(brush(rail, 1.0 * st.lw, rng, { taper: 0 }), st.ink(0.7));
    for (let i = 1; i < n; i += 2) dl.poly(brush([outer[i * 2], outer[i * 2 + 1], rail[i * 2], rail[i * 2 + 1]], 0.7 * st.lw, rng, { taper: 0 }), st.ink(0.6));
    // reflection: the arch ring completes in the water
    const ring = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; ring.push(cx + Math.cos(a) * (r + 12), W + Math.sin(a) * (r + 12)); }
    for (let i = n; i >= 0; i--) { const a = (i / n) * Math.PI; ring.push(cx + Math.cos(a) * r, W + Math.sin(a) * r); }
    dl.poly(ring, st.reflRoof(0.45));
    reflect(dl, body, W, deckH, st.reflWall, 0.35);
    return outer;
  }

  // A figure in a long gown; under an oiled-paper umbrella when it rains.
  function figure(dl, rng, st, x, y, s, umbrella) {
    dl.poly([x - s * 0.14, y - s * 0.72, x + s * 0.14, y - s * 0.72, x + s * 0.2, y, x - s * 0.2, y], rng() < 0.5 ? st.ink(0.8) : st.cloth());
    dl.poly(blob(x, y - s * 0.82, s * 0.1, s * 0.11, 0, 8, rng, 0.1), st.ink(0.85));
    if (umbrella) {
      const c = st.umbrella[Math.floor(rng() * st.umbrella.length)];
      dl.poly(brush([x + s * 0.05, y - s * 0.5, x + s * 0.05, y - s * 1.12], 0.5 * st.lw, rng, { taper: 0 }), st.ink(0.8));
      dl.poly([x - s * 0.5, y - s * 0.96, x + s * 0.05, y - s * 1.22, x + s * 0.6, y - s * 0.96, x + s * 0.05, y - s * 1.02], rgba(c, 0.95));
    }
  }

  // Wupeng boat: a long low hull, black arched awnings, a boatman sculling at the stern.
  function boat(dl, rng, st, x, y, s, dir) {
    const L = 120 * s, hh = 9 * s;
    const hull = [x - L / 2, y - hh * 1.4, x - L * 0.38, y - hh * 0.6, x + L * 0.38, y - hh * 0.6, x + L / 2, y - hh * 1.5, x + L * 0.44, y + hh * 0.2, x - L * 0.44, y + hh * 0.2];
    if (dir < 0) for (let i = 0; i < hull.length; i += 2) hull[i] = 2 * x - hull[i];
    dl.poly(hull, st.ink(0.88));
    // two or three awning hoops, black matting
    const na = rng.int(2, 3), aw = L * 0.16;
    for (let k = 0; k < na; k++) {
      const ax = x + dir * (-L * 0.12 + k * aw * 0.95), ah = hh * (2.4 - k * 0.25), arc = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; arc.push(ax - aw / 2 + aw * t, y - hh * 0.6 - ah * Math.sin(Math.PI * t)); }
      arc.push(ax + aw / 2, y - hh * 0.5, ax - aw / 2, y - hh * 0.5);
      dl.poly(arc, st.roof(0.95));
      dl.poly(brush(arc.slice(0, 22), 0.6 * st.lw, rng, { taper: 0 }), st.ink(0.6));
    }
    const px = x - dir * L * 0.36;
    figure(dl, rng, st, px, y - hh, 30 * s, false);
    dl.poly(brush([px - dir * 2 * s, y - hh - 18 * s, px - dir * L * 0.3, y + 10 * s], 0.8 * st.lw, rng, { taper: 0 }), st.ink(0.8));
    dl.light(x + dir * L * 0.05, y - hh * 2, 10 * s);
    reflect(dl, hull, y + hh * 0.2, hh * 4, st.reflRoof0, 0.5);
    for (let k = 0; k < 3; k++) { const ry = y + hh * (0.8 + k * 0.7), rl = L * rng.range(0.6, 1.2); dl.poly(brush([x - rl / 2, ry, x, ry + 0.5, x + rl / 2, ry], 0.8 * st.lw, rng), st.ripple(0.6 - k * 0.15)); }
  }

  // Horizontal ripple lines that break up the reflections. Seeded per row in WORLD x so
  // neighbouring chunks join without a seam.
  function ripples(dl, st, seed, x0, x1, top, bottom, rows, a) {
    const x = x0 - 3, n = Math.ceil((x1 - x + 3) / 8) + 1;
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows, yr = lerp(top, bottom, Math.pow(t, 1.3));
      const rs = hash2(seed, 800 + r), pts = [];
      for (let i = 0; i < n; i++) { const px = x + i * 8; pts.push(px, yr + 1.2 * vnoise(rs, px / 50)); }
      const long = st.rippleLong, wbase = lerp(0.5, 1.4, t) * st.lw;
      const hw = (px) => { const v = vnoise(rs + 9, px / (long ? 220 : 60)); return wbase * sstep(long ? 0.1 : 0.2, long ? 0.4 : 0.45, v); };
      const pr = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { const w = hw(pts[i * 2]); pr[i * 2] = pts[i * 2]; pr[i * 2 + 1] = pts[i * 2 + 1] - w; const j = (2 * n - 1 - i) * 2; pr[j] = pts[i * 2]; pr[j + 1] = pts[i * 2 + 1] + w; }
      dl.poly(pr, st.ripple(a * lerp(0.6, 1, t)));
    }
  }

  // ------------------------------------------------------------------ feature builders
  const B = {
    hills(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, base = L.base, N = 48, sd = (rng() * 1e6) | 0, sil = [], xs = [], ys = [];
      for (let i = 0; i <= N; i++) { const u = -1 + (2 * i) / N, r = Math.pow(clamp(1 - u * u, 0, 1), 1.3) * (1 + 0.25 * fbm(sd, u * 3, 3)); xs.push(f.x + u * p.hw); ys.push(base - p.h * r); sil.push(xs[i], ys[i]); }
      sil.push(f.x + p.hw, base + 40, f.x - p.hw, base + 40);
      dl.poly(sil, [f.x, base - p.h, f.x, base, 0, st.hill(0.55), 1, st.hill(0)]);
      if (st.mode !== 'wet') dl.poly(brush(sil.slice(0, (N + 1) * 2), 0.8 * st.lw, rng, { wob: 0.4, min: 0.2 }), st.ink(0.18));
      if (p.pagoda) { const i = ys.indexOf(Math.min.apply(null, ys)); pagoda(dl, rng, st, xs[i], ys[i] + 2, rng.range(7, 10), 0.55); }
      return dl;
    },
    farwater(f, L, st) {
      const dl = new DL();
      dl.poly(rect(f.p.x0 - 1, FQ - 2, CW + 2, L.y1 - FQ + 2), st.waterFill(FQ, L.y1));
      return dl;
    },
    // the town across the water: small houses, trees and now and then a pagoda
    farrow(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      for (const t of p.trees) crown(dl, rng, st, t[0], t[1], t[2]);
      if (p.pagoda) pagoda(dl, rng, st, p.pagoda, FQ - 26, rng.range(12, 16), 0.85);
      for (const hs of p.houses) {
        const o = { reflect: FW };
        if (hs.g) gableHouse(dl, rng, st, hs.x, hs.w, FQ - hs.back, hs.h, o); else longHouse(dl, rng, st, hs.x, hs.w, FQ - hs.back, hs.h, Object.assign(o, { lanterns: 0.15 }));
      }
      dl.poly(rect(f.p.x0 - 2, FQ - 2, CW + 4, FW - FQ + 2), st.stone(0.9));
      return dl;
    },
    water(f, L, st) {
      const dl = new DL();
      dl.poly(rect(f.p.x0 - 1, Q - 4, CW + 2, 1004 - Q), st.waterFill(Q, 1000));
      return dl;
    },
    backtree(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed);
      crown(dl, rng, st, f.x, f.p.y, f.p.r);
      return dl;
    },
    house(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, o = { reflect: W, lanterns: 0.4 };
      if (p.g) gableHouse(dl, rng, st, p.x, p.w, Q - p.back, p.h, o); else longHouse(dl, rng, st, p.x, p.w, Q - p.back, p.h, o);
      // lit windows shimmer in the canal too
      if (dl.lights) { const Lt = dl.lights, n = Lt.length; for (let k = 0; k < n; k += 3) dl.light(Lt[k], 2 * W - Lt[k + 1] + 6, Lt[k + 2] * 0.8); }
      return dl;
    },
    // the stone embankment along the front, with water steps; leaves a gap where a bridge is
    quay(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, segs = [];
      if (p.gap) segs.push([p.x0 - 2, p.gap[0]], [p.gap[1], p.x0 + CW + 2]); else segs.push([p.x0 - 2, p.x0 + CW + 2]);
      for (const [a, b] of segs) {
        if (b - a < 2) continue;
        const body = rect(a, Q, b - a, W - Q);
        dl.poly(body, [0, Q, 0, W, 0, st.stone(0.95), 1, st.stoneDark(0.95)]);
        dl.poly(rect(a, Q - 1, b - a, 4), st.stone(1));
        // coursed blocks
        for (let row = 0; row < 3; row++) {
          const yy = Q + 4 + row * ((W - Q - 4) / 3);
          dl.poly(rect(a, yy, b - a, 0.6), st.ink(0.3));
          for (let bx = a + ((row * 11 + p.x0) % 23); bx < b; bx += rng.range(18, 30)) dl.poly(rect(bx, yy, 0.6, (W - Q - 4) / 3), st.ink(0.22));
        }
        dl.poly(brush([a, Q + 1, b, Q + 1], 1.0 * st.lw, rng, { taper: 0 }), st.ink(0.7));
        reflect(dl, body, W, (W - Q) * 1.4, st.reflRoof0, 0.45);
      }
      // a flight of steps down to the water (where people wash and boats tie up)
      if (p.steps != null) {
        const sx = p.steps, sw = 34;
        for (let k = 0; k < 5; k++) { const yy = Q + k * ((W - Q) / 5); dl.poly(rect(sx - k * 6, yy, sw, (W - Q) / 5 + 0.5), st.stone(1)); dl.poly(rect(sx - k * 6, yy, sw, 0.8), st.ink(0.5)); }
        if (p.washer) figure(dl, rng, st, sx + 12, W - 2, 26, false);
      }
      return dl;
    },
    bridge(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      // the side channel under the bridge: open water up to the far bank
      dl.poly(rect(p.g0, Q - 4, p.g1 - p.g0, W - Q + 6), st.water(1));
      const deck = archBridge(dl, rng, st, (p.g0 + p.g1) / 2, p.g1 - p.g0);
      if (p.walker) { const t = rng.range(0.3, 0.7), i = Math.round(t * 20); figure(dl, rng, st, deck[i * 2], deck[i * 2 + 1], 34, p.umbrella); }
      return dl;
    },
    willow(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed);
      willow(dl, rng, st, f.x, Q + 2, f.p.H, W);
      return dl;
    },
    person(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed);
      figure(dl, rng, st, f.x, Q + 1, f.p.s, f.p.umbrella);
      return dl;
    },
    ripples(f, L, st) {
      const dl = new DL();
      ripples(dl, st, f.p.ws, f.p.x0, f.p.x0 + CW, W + 6, 1000, 16, st.rippleA);
      return dl;
    },
    boat(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p;
      boat(dl, rng, st, f.x, p.y, p.s, p.dir);
      return dl;
    },
    // willow fronds hanging into view from a tree just above the frame
    fronds(f, L, st) {
      const dl = new DL(), rng = RNG(f.seed), p = f.p, n = Math.round(p.n * st.det);
      const branch = curve(f.x - p.hw, -20 + rng.range(-10, 10), f.x + p.hw, rng.range(10, 60), 12, rng.range(-0.08, 0.08), rng, 0.2);
      dl.poly(brush(branch, 3.4 * st.lw, rng, { prof: (t) => 1 - 0.6 * t, wob: 0.2, min: 0.3 }), st.ink(st.mode === 'wet' ? 0.55 : 0.9));
      for (let i = 0; i < n; i++) {
        const t = rng(), k = Math.round(t * 11), bx = branch[k * 2], by = branch[k * 2 + 1], len = rng.range(0.25, 1) * p.len;
        const sway = rng.range(-0.06, 0.1) * len, pts = [bx, by, bx + sway * 0.3, by + len * 0.35, bx + sway * 0.75, by + len * 0.72, bx + sway, by + len];
        dl.poly(brush(pts, rng.range(0.7, 1.3) * st.lw, rng, { prof: (q) => 1 - 0.7 * q, wob: 0.15 }), st.leaf(rng.range(0.5, 0.9)));
        const nl = Math.round(len / 14 * st.det);
        for (let q = 0; q < nl; q++) {
          const u = rng.range(0.15, 1), lx = bx + sway * u, ly = by + len * u, side = rng() < 0.5 ? -1 : 1, ll = rng.range(5, 10);
          dl.poly(brush([lx, ly, lx + side * ll * 0.35, ly + ll], 1.8 * st.lw, rng, { prof: (v) => Math.sin(Math.PI * v) }), st.leaf(rng.range(0.4, 0.8)));
        }
        if (st.dots && rng() < 0.35) { const c = st.dots[Math.floor(rng() * st.dots.length)], u = rng.range(0.3, 1); dl.poly(blob(bx + sway * u, by + len * u, 2.6, 2.2, 0, 7, rng, 0.3), rgba(c, 0.9)); }
      }
      return dl;
    },
  };

  // ------------------------------------------------------------------ engine
  class JiangnanEngine extends Engine {
    get S() { return STYLES[this.o.style] || STYLES.wu; }
    // Where the front row breaks for a side channel and its bridge (a pure function of the
    // chunk, so a house in the previous chunk can stop short of it).
    _gap(ci) {
      const h = hash2(this.o.seed, ci * 13 + 7);
      if ((h % 1000) / 1000 >= P(0.22, 'rivers')) return null;
      const span = 110 + ((h >>> 10) % 50), a = 60 + ((h >>> 16) % Math.max(1, CW - span - 120));
      return [ci * CW + a, ci * CW + a + span];
    }
    _gen(L, ci) {
      const seed = this.o.seed, rng = RNG(hash4(seed, L.id, ci, 17)), x0 = ci * CW, out = [];
      const m = this.macro(L.id, x0 + CW * 0.5), add = this._adder(L, ci, out);
      if (L.kind === 'hills') {
        if (rng() < 0.7) { const hw = rng.range(240, 480); add('hills', x0 + rng() * CW, rng(), hw + 10, { hw, h: rng.range(50, 150), pagoda: rng() < P(0.12, 'towers') }); }
      } else if (L.kind === 'far') {
        add('farwater', x0 + CW / 2, -10, CW / 2 + 4, { x0 });
        const houses = [], trees = [];
        for (let x = x0 + rng.range(-20, 10); x < x0 + CW;) {
          const w = rng.range(40, 90), h = rng.range(36, 80) * (0.8 + 0.4 * m);
          houses.push({ x, w, h, g: rng() < 0.45, back: rng() < 0.3 ? 4 : 0 });
          x += w * rng.range(0.7, 1.05);
        }
        for (let k = 0, nt = rng.int(1, 3); k < nt; k++) trees.push([x0 + rng() * CW, FQ - rng.range(70, 110), rng.range(24, 40)]);
        add('farrow', x0 + CW / 2, 0, CW / 2 + 100, { x0, houses, trees, pagoda: rng() < P(0.12, 'towers') ? x0 + rng() * CW : 0 });
      } else if (L.kind === 'row') {
        add('water', x0 + CW / 2, -10, CW / 2 + 4, { x0 });
        const gap = this._gap(ci), next = this._gap(ci + 1), occ = new Occ();
        if (gap) occ.add(gap[0] - 6, gap[1] + 6);
        const limit = next ? next[0] - 8 : Infinity;
        let x = x0 + rng.range(-30, 0);
        while (x < x0 + CW) {
          let w = rng.range(100, 270);
          const g = rng() < 0.42, back = rng() < 0.35 ? rng.range(4, 14) : 0;
          if (g) w = Math.min(w, 200);
          if (!occ.free(x, x + w)) { x = Math.max(x + 20, gap ? gap[1] + 8 : x + 20); continue; }
          if (x + w > limit) { w = limit - x; if (w < 50) break; }
          const h = (g ? rng.range(220, 380) : rng.range(160, 320)) * (back ? 0.9 : 1) * (0.85 + 0.3 * m);
          add('house', x + w / 2, back ? 2 + rng() * 0.2 : 3 + rng() * 0.5, w / 2 + 24, { x, w, h, g, back });
          if (rng() < 0.45) add('backtree', x + rng() * w, 1 + rng() * 0.5, 110, { y: Q - h - rng.range(0, 50), r: rng.range(50, 95) });
          x += w * rng.range(0.82, 1.0);
        }
        const steps = !gap && rng() < 0.35 ? x0 + rng.range(40, CW - 80) : null;
        add('quay', x0 + CW / 2, 5, CW / 2 + 20, { x0, gap, steps, washer: rng() < 0.6 });
        if (gap) add('bridge', (gap[0] + gap[1]) / 2, 6, (gap[1] - gap[0]) / 2 + 60, { g0: gap[0], g1: gap[1], walker: rng() < 0.6, umbrella: this.weather === 'rain' || this.S.mode === 'wet' });
        if (rng() < P(0.4, 'trees')) { const wx = x0 + rng() * CW; if (!gap || wx < gap[0] - 30 || wx > gap[1] + 30) add('willow', wx, 7, 200, { H: rng.range(220, 340) }); }
        if (rng() < 0.3) { const px = x0 + rng() * CW; if (!gap || px < gap[0] - 20 || px > gap[1] + 20) add('person', px, 6.5, 20, { s: rng.range(34, 42), umbrella: this.weather === 'rain' || rng() < 0.3 }); }
      } else if (L.kind === 'canal') {
        add('ripples', x0 + CW / 2, -5, CW / 2 + 4, { x0, ws: hash2(seed, 6600) });
        if (rng() < P(0.4, 'boats')) { const y = rng.range(810, 950); add('boat', x0 + rng() * CW, y / 1000, 200, { y, s: 1.1 + (y - 810) / 140 * 0.7, dir: rng() < 0.5 ? 1 : -1 }); }
      } else {
        if (m > 0.45 && rng() < P(0.55, 'trees')) { const hw = rng.range(140, 260); add('fronds', x0 + rng() * CW, 1, hw + 40, { hw, n: rng.int(16, 30), len: rng.range(220, 480) }); }
      }
      return out;
    }
    _style(L) {
      const S = this.S, a = L.ink, air = S.air;
      const hz = (c, k) => mixc(c, air, clamp(L.haze * (k == null ? 1 : k) * (S.mode === 'wet' ? 1.35 : 1), 0, 1));
      const water = S.water.map((c) => hz(c, 0.4));
      const ink = hz(S.ink, 0.6), roof = hz(S.roof, 0.8);
      return {
        L, mode: S.mode, det: L.det, lw: L.lw, wash: S.mode === 'wet' ? 1.6 : S.mode === 'line' ? 0.7 : 1,
        dots: S.dots ? S.dots.map((c) => hz(c, 0.6)) : null, umbrella: S.umbrella,
        ink: (x) => rgba(ink, x * Math.max(0.5, a)),
        roof: (x) => rgba(roof, x * S.roofA * Math.max(0.6, a)),
        tileLine: (x) => rgba(S.mode === 'blue' ? [236, 242, 252] : mixc(roof, [255, 255, 255], 0.35), x),
        wall: (x) => rgba(hz(S.wall, 0.4), x),
        stain: (x) => rgba(hz(S.stain, 0.5), x),
        wood: (x) => rgba(hz(S.wood, 0.6), x),
        stone: (x) => rgba(hz(S.stone, 0.6), x),
        stoneDark: (x) => rgba(hz(mixc(S.stone, S.ink, 0.45), 0.6), x),
        cloth: () => rgba(hz(S.mode === 'blue' ? [120, 146, 204] : [110, 120, 136], 0.6), 0.9),
        tree: (x) => rgba(hz(S.tree, 0.7), x * Math.max(0.55, a)),
        leaf: (x) => rgba(hz(S.mode === 'line' ? [46, 70, 52] : S.tree, 0.6), x * Math.max(0.55, a)),
        lantern: (x) => rgba(hz(S.lantern, 0.5), x),
        hill: (x) => rgba(S.hill, x),
        water: (x) => rgba(water[0], x),
        waterFill: (y0, y1) => [0, y0, 0, y1, 0, rgba(water[0], 1), 1, rgba(water[1], 1)],
        reflWall: hz(S.refl, 0.4), reflRoof0: hz(mixc(S.roof, S.water[1], 0.35), 0.4),
        reflRoof: (x) => rgba(hz(mixc(S.roof, S.water[1], 0.35), 0.4), x),
        ripple: (x) => rgba(S.ripple, x),
        rippleA: S.rippleA, rippleLong: S.rippleLong,
      };
    }
    _autoWeather(season, r) {
      const wet = this.S.mode === 'wet';
      if (season === 'winter') return r < 0.4 ? 'snow' : wet && r < 0.7 ? 'rain' : 'none';
      return r < (wet ? 0.6 : 0.2) ? 'rain' : 'none';
    }
    _paintMist(g, mb, i, w, h) {
      const S = this.S, kx = this.kx, rng = RNG(hash2(this.o.seed, 300 + i)), n = Math.round(28 * mb.dens), paper = S.air, amul = S.mistA;
      for (let j = 0; j < n; j++) {
        const rx = rng.range(160, 460) * kx, ry = Math.min(h * 0.42, rx * rng.range(0.08, 0.18));
        const cx = rng() * w, cy = ry + rng() * (h - 2 * ry), al = Math.min(0.95, rng.range(0.3, 0.65) * amul);
        for (const ox of [-w, 0, w]) {
          g.save(); g.translate(cx + ox, cy); g.scale(1, ry / rx);
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
          gr.addColorStop(0, rgba(paper, al)); gr.addColorStop(0.55, rgba(paper, al * 0.8)); gr.addColorStop(1, rgba(paper, 0));
          g.fillStyle = gr; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore();
        }
      }
    }
    _paintGrain() {
      if (this.S.grain !== 'glaze') return super._paintGrain();
      // porcelain: a clean ground with the faint crackle of the glaze
      const T = 256, tile = mkCanvas(T, T), g = tile.getContext('2d'), rng = RNG(91);
      g.fillStyle = '#fff'; g.fillRect(0, 0, T, T);
      g.lineCap = 'round';
      for (let i = 0; i < 46; i++) {
        let x = rng() * T, y = rng() * T, a = rng() * TAU;
        g.strokeStyle = 'rgba(120,140,180,' + rng.range(0.05, 0.12).toFixed(3) + ')'; g.lineWidth = rng.range(0.4, 0.8);
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { a += rng.range(-0.8, 0.8); x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
        g.stroke();
      }
      return tile;
    }
    _paintOverlay(g, top, bot) {
      super._paintOverlay(g, top, bot);
      if (this.S.mode !== 'blue') return;
      // a porcelain band: double cobalt rules along the top and bottom of the picture
      const k = this.k, Wd = this.W, H = this.H;
      g.fillStyle = 'rgb(70,96,170)';
      for (const y of [16, 26]) { g.fillRect(0, Math.round(y * k), Wd, Math.max(1, Math.round((y === 16 ? 3 : 1.2) * k))); g.fillRect(0, Math.round(H - (y + 3) * k), Wd, Math.max(1, Math.round((y === 16 ? 3 : 1.2) * k))); }
    }
    _skyGradient() {
      const S = this.S, g = this.ctx.createLinearGradient(0, 0, 0, this.H * 0.7);
      g.addColorStop(0, rgba(S.sky[0], 1)); g.addColorStop(1, rgba(S.sky[1], 1));
      return g;
    }
    _drawSky() {
      const ctx = this.ctx, S = this.S;
      ctx.fillStyle = this.skyGrad; ctx.fillRect(0, 0, this.W, this.H);
      if (S.sun && this.sun && this.night < 0.6) {
        const e = clamp(this.sun.e, 0, 1), r = this.H * 0.034;
        ctx.fillStyle = rgba(S.seal, lerp(0.85, 0.5, e) * (1 - this.night / 0.6));
        ctx.beginPath(); ctx.arc(this.sun.x, this.sun.y * 0.8, r, 0, TAU); ctx.fill();
      }
      if (this.moon) this._drawMoon(this.H * 0.028);
    }
    // Swallows: small forked silhouettes darting low over the water in loose pairs.
    _birds(dt) {
      const ctx = this.ctx, k = this.k;
      this.birdT -= dt;
      if (this.o.birds && !this.reduceMotion && this.birdT <= 0 && this.night < 0.5 && this.weather !== 'snow' && this.flocks.length < 2) {
        const r = RNG((Math.random() * 1e9) | 0), dir = r() < 0.5 ? 1 : -1, n = r.int(1, 3), birds = [];
        for (let j = 0; j < n; j++) birds.push({ dx: -dir * j * r.range(30, 70), dy: r.range(-30, 30), ph: r() * TAU, f: r.range(0.6, 1.1) });
        this.flocks.push({ x: dir > 0 ? -40 * k : this.W + 40 * k, y: r.range(160, 420), vx: dir * r.range(90, 140), s: r.range(7, 10), dir, birds });
        this.birdT = r.range(14, 40);
      }
      if (!this.flocks.length) return;
      ctx.fillStyle = rgba(this.S.ink, 0.85);
      ctx.beginPath();
      for (const fl of this.flocks) {
        fl.x += fl.vx * this.kx * dt;
        for (const b of fl.birds) {
          const bx = fl.x + b.dx * k, by = (fl.y + b.dy + 40 * Math.sin(this.time * b.f + b.ph)) * k, s = fl.s * k, d = fl.dir;
          const flap = 0.5 + 0.5 * Math.sin(this.time * 9 * b.f + b.ph);
          // swept wings, a body and a long forked tail, all one shape
          ctx.moveTo(bx + d * s * 0.6, by);
          ctx.quadraticCurveTo(bx, by - s * (0.2 + 0.6 * flap), bx - d * s * 0.7, by - s * (0.5 + 0.5 * flap));
          ctx.quadraticCurveTo(bx - d * s * 0.1, by - s * 0.05, bx - d * s * 0.9, by + s * 0.25);
          ctx.lineTo(bx - d * s * 0.55, by + s * 0.05);
          ctx.lineTo(bx - d * s * 0.95, by + s * 0.45);
          ctx.quadraticCurveTo(bx - d * s * 0.2, by + s * 0.12, bx + d * s * 0.6, by);
        }
      }
      ctx.fill();
      this.flocks = this.flocks.filter((fl) => fl.x > -300 * k && fl.x < this.W + 300 * k);
    }
  }
  JiangnanEngine.def = {
    layers: LAYERS, mist: MIST, tod: TOD, paper: STYLES.wu.paper, ink: STYLES.wu.ink, sun: STYLES.wu.seal,
    sky: { horizon: 0.36, zenith: 0.1 },
    styles: Object.keys(STYLES), defaults: { style: 'wu' }, builders: B, styleSprites: true, weathers: ['none', 'rain', 'snow'],
  };

  window.Paperwall.register({
    id: 'jiangnan', name: 'Jiangnan', native: '江南', order: 3,
    tagline: 'Chinese canal town',
    blurb: 'White walls and black tiles along a canal, stepped gables, arched bridges and willows, every house doubled in the water.',
    Engine: JiangnanEngine, paper: '#f9f8f3', ink: '#16161a', accent: '#c42c24',
    styles: [
      { id: 'wu', name: 'Lines and dots', native: '点线', blurb: 'Black roofs on white walls, wiry willows and dots of colour', swatch: ['#f9f8f3', '#c8ccc8', '#1a1a1e', '#ce2c26'] },
      { id: 'rain', name: 'Misty rain', native: '烟雨', blurb: 'Grey wet ink, soft reflections and red lanterns in the drizzle', swatch: ['#e8e9e6', '#a0a4a4', '#3a3c42', '#c63226'] },
      { id: 'qinghua', name: 'Blue and white', native: '青花', blurb: 'The whole town painted in cobalt on porcelain', swatch: ['#f6f8fa', '#a8bade', '#1e3a82', '#2c4a9c'] },
    ],
    weathers: [{ id: 'auto', name: 'Automatic' }, { id: 'none', name: 'Clear' }, { id: 'rain', name: 'Rain' }, { id: 'snow', name: 'Snow' }],
    toggles: [{ id: 'birds', name: 'Swallows' }, { id: 'mist', name: 'Mist' }, { id: 'paper', name: 'Paper texture' }],
  });
})();
