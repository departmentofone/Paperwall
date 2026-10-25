/*
 * Paperwall core: the shared machinery behind every living wallpaper theme.
 *
 * Performance model
 *   - The world is split into parallax layers, each cut into fixed-width chunks.
 *   - Every scene element (mountain, bank, boat, ...) is generated deterministically
 *     from (seed, layer, chunk) and turned into a cached "display list" of polygons.
 *   - A chunk is rasterised ONCE into its own small canvas. Per frame we only blit
 *     one strip per layer + a few cheap animated overlays (mist, birds, weather, lights).
 *   - All geometry is in resolution-independent units (screen height = 1000), so a
 *     resize only re-rasterises chunks; it never regenerates the scene.
 *
 * A theme (web/themes/*.js) supplies the painters and the scene recipe, then calls
 * Paperwall.register({...}) so the page, the gallery and the tray menu can find it.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ math / rng
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function h32(x) {
    x |= 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  const hash2 = (a, b) => h32((Math.imul(a | 0, 0x9e3779b1) + h32(b)) | 0);
  const hash4 = (a, b, c, d) => hash2(hash2(hash2(a, b), c), d);

  function RNG(seed) {
    let s = (seed >>> 0) || 1;
    const r = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (a, b) => a + (b - a) * r();
    r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.norm = () => (r() + r() + r() - 1.5) / 1.5;
    return r;
  }

  function vnoise(seed, x) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash2(seed, i) / 4294967296, hash2(seed, i + 1) / 4294967296, u) * 2 - 1;
  }
  function fbm(seed, x, oct) {
    let s = 0, a = 0.5, fr = 1, n = 0;
    for (let o = 0; o < oct; o++) { s += a * vnoise(seed + o * 131, x * fr); n += a; a *= 0.5; fr *= 2.03; }
    return s / n;
  }

  // ------------------------------------------------------------------ colour
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  const mixc = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];

  const CW = 400; // chunk width in world units (screen height = 1000 units)

  // ------------------------------------------------------------------ display list
  class DL {
    constructor() { this.ops = []; this.minx = Infinity; this.maxx = -Infinity; this.lights = null; this.stack = []; }
    _t() { return this.stack.length ? this.stack[this.stack.length - 1].ops : this.ops; }
    poly(p, fill) {
      if (!p || p.length < 6) return;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < p.length; i += 2) { const x = p[i]; if (x < mn) mn = x; if (x > mx) mx = x; }
      const op = { pts: p instanceof Float32Array ? p : new Float32Array(p), fill, minx: mn, maxx: mx };
      this._t().push(op);
      for (const g of this.stack) { if (mn < g.minx) g.minx = mn; if (mx > g.maxx) g.maxx = mx; }
      if (mn < this.minx) this.minx = mn;
      if (mx > this.maxx) this.maxx = mx;
    }
    beginClip(p) { const g = { clip: p instanceof Float32Array ? p : new Float32Array(p), ops: [], minx: Infinity, maxx: -Infinity }; this._t().push(g); this.stack.push(g); }
    endClip() { this.stack.pop(); }
    light(x, y, r) { (this.lights || (this.lights = [])).push(x, y, r); }
  }

  function tracePath(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
  }
  function drawOps(ctx, ops, x0, x1) {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.maxx < x0 || op.minx > x1) continue;
      if (op.clip) { ctx.save(); tracePath(ctx, op.clip); ctx.clip(); drawOps(ctx, op.ops, x0, x1); ctx.restore(); continue; }
      const f = op.fill;
      if (typeof f === 'string') ctx.fillStyle = f;
      else { const g = ctx.createLinearGradient(f[0], f[1], f[2], f[3]); for (let k = 4; k < f.length; k += 2) g.addColorStop(f[k], f[k + 1]); ctx.fillStyle = g; }
      tracePath(ctx, op.pts);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ brush geometry
  // Turns a polyline into a filled, pressure-varying brush stroke polygon.
  function brush(p, w, rng, o) {
    const n = p.length >> 1;
    if (n < 2) return null;
    const prof = o && o.prof, wob = o && o.wob != null ? o.wob : 0.3;
    const taper = o && o.taper != null ? o.taper : 1, mn = o && o.min != null ? o.min : 0.1;
    const out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
      let dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1];
      const l = Math.sqrt(dx * dx + dy * dy) || 1; dx /= l; dy /= l;
      const t = i / (n - 1);
      let f = prof ? prof(t) : taper ? Math.pow(Math.sin(Math.PI * t), 0.5 * taper) : 1;
      f = mn + (1 - mn) * f;
      const hw = 0.5 * w * f * (1 + wob * (rng() * 2 - 1));
      const x = p[i * 2], y = p[i * 2 + 1];
      out[i * 2] = x - dy * hw; out[i * 2 + 1] = y + dx * hw;
      const j = (2 * n - 1 - i) * 2;
      out[j] = x + dy * hw; out[j + 1] = y - dx * hw;
    }
    return out;
  }
  function curve(x0, y0, x1, y1, n, bend, rng, wig) {
    const p = new Array(n * 2), dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / L, ny = dx / L, s = (rng() * 1e6) | 0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), e = Math.sin(Math.PI * t);
      const off = L * (bend * e + (wig || 0) * vnoise(s, t * 3) * e);
      p[i * 2] = x0 + dx * t + nx * off; p[i * 2 + 1] = y0 + dy * t + ny * off;
    }
    return p;
  }
  function offsetLine(p, d) {
    const n = p.length >> 1, o = new Array(p.length);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
      let dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1];
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      o[i * 2] = p[i * 2] - (dy / l) * d; o[i * 2 + 1] = p[i * 2 + 1] + (dx / l) * d;
    }
    return o;
  }
  function blob(cx, cy, rx, ry, rot, n, rng, irr) {
    const p = new Float32Array(n * 2), c = Math.cos(rot), s = Math.sin(rot), ph = rng() * TAU;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = 1 + irr * (rng() - 0.5) + irr * 0.3 * Math.sin(a * 2 + ph);
      const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r;
      p[i * 2] = cx + x * c - y * s; p[i * 2 + 1] = cy + x * s + y * c;
    }
    return p;
  }
  const rect = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h];
  function qbez(x0, y0, cx, cy, x1, y1, n) {
    const p = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), u = 1 - t;
      p[i * 2] = u * u * x0 + 2 * u * t * cx + t * t * x1;
      p[i * 2 + 1] = u * u * y0 + 2 * u * t * cy + t * t * y1;
    }
    return p;
  }
  function interpY(xs, ys, N, x) {
    const t = ((x - xs[0]) / (xs[N] - xs[0])) * N;
    if (t <= 0) return ys[0];
    if (t >= N) return ys[N];
    const i = Math.floor(t);
    return ys[i] + (ys[i + 1] - ys[i]) * (t - i);
  }

  // Horizontal occupancy map: keeps houses, towers and tree trunks from being generated on
  // top of each other within one piece of land.
  class Occ {
    constructor() { this.r = []; }
    free(a, b) { for (const q of this.r) if (b > q[0] && a < q[1]) return false; return true; }
    add(a, b) { this.r.push([a, b]); }
  }

  // ------------------------------------------------------------------ engine
  // Options every theme understands. A theme adds its own defaults (style, ...) in def.defaults.
  const DEFAULTS = {
    seed: 0, speed: 1, fps: 30, quality: 'auto', time: 'auto', season: 'auto', weather: 'auto',
    style: '', color: 0.35, birds: true, mist: true, paper: true, hud: false,
  };
  // Resolution presets cap the internal canvas HEIGHT (width follows the screen), so 21:9 and
  // 32:9 monitors get the same sharpness as 16:9 at the same preset. 'auto' renders at the
  // screen's own height, up to 4K (config.js can lower it with autoHeight).
  const QUALITY = { low: 720, '1080p': 1080, '1440p': 1440, '4k': 2160, native: Infinity, medium: 900, high: 1080, ultra: Infinity };
  const CONFIG = window.PAPERWALL_CONFIG || window.SHANSHUI_CONFIG || {};
  // density multiplier from config.js (1 = default); P() scales a probability by it
  const dens = (k) => (CONFIG.density && CONFIG.density[k] != null ? +CONFIG.density[k] : 1);
  const P = (p, k) => Math.min(1, p * dens(k));
  const PRESET_HOURS = { dawn: 6.3, day: 11, dusk: 18.2, night: 23 };
  const SEASON_OF_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }

  // The scrolling machinery shared by every theme. A theme subclasses Engine and provides:
  //   static def = { layers, mist, tod, paper, ink, sun, defaults, builders }
  //   _gen(L, ci)  -> features for one chunk       _style(L) -> painter palette for one layer
  // and may override the _paint* / _draw* hooks (mist sprites, paper grain, sky, birds, weather).
  class Engine {
    constructor(canvas, opts) {
      const D = this.def = this.constructor.def;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.o = Object.assign({}, DEFAULTS, D.defaults || {}, CONFIG.defaults || {}, opts || {});
      if (D.styles && D.styles.indexOf(this.o.style) < 0) this.o.style = D.defaults.style;
      this.baseSpeed = +CONFIG.baseSpeed || 21;
      this.ramp = 0;
      // Respect the OS "reduce motion" preference (Windows: Settings > Accessibility > Animation effects)
      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reduceMotion = !!(mq && mq.matches);
      this._mq = mq; this._mqf = (e) => { this.reduceMotion = e.matches; this.parts = []; };
      if (mq && mq.addEventListener) mq.addEventListener('change', this._mqf);
      if (!this.o.seed) this.o.seed = (Math.random() * 1e9) | 0;
      this.ls = D.layers.map((L) => ({ L, chunks: new Map(), feats: new Map(), pool: [], first: 0, last: -1 }));
      this.cam = (hash2(this.o.seed, 5) % 5000);
      this.time = 0; this.last = 0; this.paused = false; this.raf = 0;
      this.flocks = []; this.birdT = 6; this.parts = []; this.idlePending = false;
      this.stats = { fps: 0, ms: 0, chunkMs: 0, frames: 0, acc: 0 };
      this._frame = this._frame.bind(this);
      this.resize();
      this._applyDerived(true);
    }

    // ---------- options
    set(key, val) {
      if (!(key in this.o)) return;
      const d = this.o[key];
      if (typeof d === 'boolean') val = val === true || val === 'true' || val === 1 || val === '1';
      else if (typeof d === 'number') val = +val;
      if (key === 'style' && this.def.styles && this.def.styles.indexOf(val) < 0) return;
      if (this.o[key] === val) return;
      this.o[key] = val;
      if (key === 'quality') this.resize();
      else if (key === 'seed') {
        // keep a snapshot of the old painting and dissolve it away over the new one
        if (this.W) { const snap = mkCanvas(this.W, this.H); snap.getContext('2d').drawImage(this.canvas, 0, 0); this.fade = { img: snap, t0: this.time }; }
        this.cam = hash2(val, 5) % 5000; this.flushScene(); this._sprites();
      }
      else if (key === 'style' && this.def.styleSprites) { this._applyDerived(false); this._sprites(); }
      else this._applyDerived(false);
    }
    _applyDerived(force) {
      const season = this.o.season === 'auto' ? SEASON_OF_MONTH[new Date().getMonth()] : this.o.season;
      const key = season + '|' + this.o.style + '|' + this.o.color;
      if (force || key !== this.styleKey) { this.season = season; this.styleKey = key; this.flushScene(); }
      let w = this.o.weather;
      if (w === 'auto') {
        const day = Math.floor(Date.now() / 864e5);
        w = this._autoWeather(season, hash2(this.o.seed, day) / 4294967296);
      }
      if ((this.def.weathers || ['none', 'rain', 'snow']).indexOf(w) < 0) w = 'none'; // e.g. petals on a theme that has none
      if (w !== this.weather) { this.weather = w; this.parts = []; }
      this.todKey = '';
    }
    _autoWeather(season, r) {
      return season === 'winter' ? (r < 0.45 ? 'snow' : 'none') : r < (season === 'autumn' ? 0.12 : 0.18) ? 'rain' : 'none';
    }

    // ---------- sizing
    resize() {
      const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth), cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const maxH = QUALITY[this.o.quality] || CONFIG.autoHeight || 2160;
      const scale = Math.min(1, maxH / (cssH * dpr));
      const W = Math.round(cssW * dpr * scale), H = Math.round(cssH * dpr * scale);
      if (W === this.W && H === this.H) return;
      this.W = this.canvas.width = W; this.H = this.canvas.height = H;
      this.k = H / 1000;
      this.cwPx = Math.max(8, 2 * Math.round((CW * this.k) / 2)); // even, so half-res light strips align exactly
      this.kx = this.cwPx / CW;
      for (const S of this.ls) {
        S.chunks.clear(); S.pool.length = 0;
        S.bandPx = Math.ceil((S.L.y1 - S.L.y0) * this.k);
        S.nb = Math.floor(W / this.cwPx) + 2; // strip covers the screen plus one chunk of slack
        S.strip = S.lstrip = null; S.stripFirst = null;
      }
      this._sprites();
      this.todKey = '';
    }
    flushScene() {
      this.st = this.def.layers.map((L) => this._style(L));
      for (const S of this.ls) { for (const c of S.chunks.values()) S.pool.push(c); S.chunks.clear(); S.feats.clear(); S.stripFirst = null; }
    }

    // ---------- scene graph
    macro(lid, x) { return clamp((fbm(hash2(this.o.seed, 900 + lid), x / 2600, 3) + 1) / 2, 0, 1); }
    features(S, ci) {
      let fs = S.feats.get(ci);
      if (fs) return fs;
      fs = this._gen(S.L, ci);
      S.feats.set(ci, fs);
      return fs;
    }
    // helper for _gen: a feature list for chunk ci, with a deterministic per-feature seed
    _adder(L, ci, out) {
      const seed = this.o.seed;
      return (kind, x, z, ext, p) => out.push({ id: ci * 32 + out.length, ci, kind, x, z, ext, p, seed: hash4(seed, L.id, ci, 101 + out.length), dl: null });
    }
    _dl(S, f) {
      if (!f.dl) f.dl = this.def.builders[f.kind](f, S.L, this.st[S.L.id], this, S);
      return f.dl;
    }
    _chunk(S, ci) {
      let c = S.chunks.get(ci);
      if (c) return c;
      const t0 = performance.now();
      c = S.pool.pop() || mkCanvas(this.cwPx, S.bandPx);
      const ctx = c.getContext('2d'), L = S.L;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(this.kx, 0, 0, this.k, -ci * CW * this.kx, -L.y0 * this.k);
      const x0 = ci * CW, x1 = x0 + CW, list = [];
      for (let j = ci - L.R; j <= ci + L.R; j++) for (const f of this.features(S, j)) if (f.x + f.ext >= x0 && f.x - f.ext <= x1) list.push(f);
      list.sort((a, b) => a.z - b.z || a.id - b.id);
      let anyLight = false;
      for (const f of list) {
        const dl = this._dl(S, f);
        if (dl.maxx < x0 - 2 || dl.minx > x1 + 2) continue;
        drawOps(ctx, dl.ops, x0 - 2, x1 + 2);
        if (dl.lights) anyLight = true;
      }
      // Light map, baked in the same painter's order: each lantern is added when its feature
      // is painted, and everything painted after it (a hill in front, a nearer bank) erases
      // the light behind its shape. So lanterns are only ever seen where their house is.
      c.hasLight = anyLight;
      if (anyLight) {
        const lc = c.light || (c.light = mkCanvas(c.width, c.height)), lg = lc.getContext('2d');
        lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, lc.width, lc.height);
        lg.setTransform(this.kx, 0, 0, this.k, -ci * CW * this.kx, -L.y0 * this.k);
        let lit = false;
        for (const f of list) {
          const dl = f.dl;
          if (dl.maxx < x0 - 2 || dl.minx > x1 + 2) continue;
          if (lit) { lg.globalCompositeOperation = 'destination-out'; drawOps(lg, dl.ops, x0 - 2, x1 + 2); }
          if (dl.lights) {
            lg.globalCompositeOperation = 'lighter';
            const Lt = dl.lights;
            for (let k = 0; k < Lt.length; k += 3) { const r = Lt[k + 2]; lg.drawImage(this.glow, Lt[k] - r, Lt[k + 1] - r, 2 * r, 2 * r); }
            lit = true;
          }
        }
        lg.globalCompositeOperation = 'source-over';
      }
      S.chunks.set(ci, c);
      this.stats.chunkMs = performance.now() - t0;
      return c;
    }

    // ---------- sprites (resolution dependent)
    _sprites() {
      const k = this.k, kx = this.kx;
      this.mist = this.def.mist.map((mb, i) => {
        const w = Math.round(1800 * kx), h = Math.round(mb.h * k), c = mkCanvas(w, h);
        this._paintMist(c.getContext('2d'), mb, i, w, h);
        return c;
      });
      this.mistPat = this.mist.map((c) => this.ctx.createPattern(c, 'repeat-x'));
      this.lightC = mkCanvas(Math.ceil(this.W / 2), Math.ceil(this.H / 2));
      this.lg = this.lightC.getContext('2d');
      this.mistPatL = this.mist.map((c) => this.lg.createPattern(c, 'repeat-x'));
      this.grain = this._paintGrain();
      this.overlay = mkCanvas(this.W, this.H);
      // warm light glow
      const gl = mkCanvas(64, 64), gg = gl.getContext('2d'), gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,214,140,0.95)'); gr.addColorStop(0.25, 'rgba(255,170,80,0.45)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
      gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
      this.glow = gl;
      this.todKey = '';
    }
    // Default mist: soft paper-coloured radial blobs, tiled seamlessly across the strip width.
    _paintMist(g, mb, i, w, h) {
      const kx = this.kx, paper = this.def.paper;
      const rng = RNG(hash2(this.o.seed, 300 + i)), n = Math.round(30 * mb.dens);
      for (let j = 0; j < n; j++) {
        const rx = rng.range(120, 420) * kx, ry = Math.min(h * 0.45, rx * rng.range(0.12, 0.25));
        const cx = rng() * w, cy = ry + rng() * (h - 2 * ry), a = rng.range(0.25, 0.6);
        for (const ox of [-w, 0, w]) {
          g.save(); g.translate(cx + ox, cy); g.scale(1, ry / rx);
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
          gr.addColorStop(0, rgba(paper, a)); gr.addColorStop(1, rgba(paper, 0));
          g.fillStyle = gr; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore();
        }
      }
    }
    // Default paper grain: speckle plus a few short fibres (multiplied over the frame).
    _paintGrain() {
      const T = 256, tile = mkCanvas(T, T), tg = tile.getContext('2d'), rng = RNG(77);
      const img = tg.createImageData(T, T);
      for (let i = 0; i < T * T; i++) { const v = 255 - Math.floor(Math.pow(rng(), 3) * 26); img.data[i * 4] = v; img.data[i * 4 + 1] = v - 2; img.data[i * 4 + 2] = v - 5; img.data[i * 4 + 3] = 255; }
      tg.putImageData(img, 0, 0);
      tg.lineCap = 'round';
      for (let i = 0; i < 160; i++) {
        const x = rng() * T, y = rng() * T, a = rng() * TAU, l = rng.range(4, 18);
        tg.strokeStyle = 'rgba(150,130,105,' + rng.range(0.04, 0.1).toFixed(3) + ')'; tg.lineWidth = rng.range(0.4, 1.1);
        tg.beginPath(); tg.moveTo(x, y); tg.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); tg.stroke();
      }
      return tile;
    }

    // ---------- time of day
    _hour() {
      const t = this.o.time;
      if (t === 'cycle') return (8 + this.time * 0.1) % 24;
      if (PRESET_HOURS[t] != null) return PRESET_HOURS[t];
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }
    _tod() {
      const hr = this._hour(), TOD = this.def.tod;
      let i = 0;
      while (i < TOD.length - 2 && TOD[i + 1][0] <= hr) i++;
      const a = TOD[i], b = TOD[i + 1], t = sstep(0, 1, (hr - a[0]) / (b[0] - a[0] || 1));
      let top = mixc(a[1], b[1], t), bot = mixc(a[2], b[2], t);
      if (this.weather === 'rain') { top = mixc(top, [200, 202, 206], 0.35); bot = mixc(bot, [214, 214, 216], 0.3); }
      this.hour = hr; this.night = lerp(a[3], b[3], t);
      this.mistMul = this.weather === 'rain' ? 1.15 : 1;
      const key = top.join() + bot.join() + Math.round(hr * 20) + this.o.paper;
      if (key === this.todKey) return;
      this.todKey = key;
      // sun & moon placement
      const W = this.W, H = this.H, sp = this.def.sky || {}, horizon = (sp.horizon || 0.46) * H, zen = (sp.zenith || 0.07) * H;
      const se = Math.sin((Math.PI * (hr - 6)) / 12.6);
      this.sun = se > -0.05 ? { x: lerp(0.82, 0.18, clamp((hr - 6) / 12.6, 0, 1)) * W, y: lerp(horizon, zen, Math.pow(Math.max(se, 0), 0.8)), e: se } : null;
      const mh = (hr + 12) % 24, me = Math.sin((Math.PI * (mh - 6)) / 12.6);
      this.moon = me > 0 && this.night > 0.05 ? { x: lerp(0.8, 0.2, clamp((mh - 6) / 12.6, 0, 1)) * W, y: lerp(horizon, zen, Math.pow(me, 0.8)), phase: ((Date.now() / 864e5 - 10962.76) / 29.530589) % 1 } : null;
      this._paintOverlay(this.overlay.getContext('2d'), top, bot);
      this.skyGrad = this._skyGradient();
    }
    // multiply overlay: tint gradient, moon glow, paper grain, vignette
    _paintOverlay(g, top, bot) {
      const W = this.W, H = this.H;
      g.globalCompositeOperation = 'source-over';
      const lg = g.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, rgba(top, 1)); lg.addColorStop(1, rgba(bot, 1));
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
      if (this.moon) {
        const R = 0.32 * H, rg = g.createRadialGradient(this.moon.x, this.moon.y, 0, this.moon.x, this.moon.y, R), n = this.night;
        rg.addColorStop(0, 'rgba(255,253,245,' + (0.92 * n).toFixed(3) + ')'); rg.addColorStop(0.09, 'rgba(250,248,240,' + (0.6 * n).toFixed(3) + ')');
        rg.addColorStop(0.35, 'rgba(230,232,240,' + (0.16 * n).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(230,232,240,0)');
        g.fillStyle = rg; g.fillRect(this.moon.x - R, this.moon.y - R, 2 * R, 2 * R);
      }
      if (this.o.paper) {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = g.createPattern(this.grain, 'repeat'); g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        const D = Math.hypot(W, H), vg = g.createRadialGradient(W / 2, H * 0.45, D * 0.3, W / 2, H * 0.45, D * 0.62);
        vg.addColorStop(0, 'rgba(150,128,104,0)'); vg.addColorStop(1, 'rgba(150,128,104,0.28)');
        g.fillStyle = vg; g.fillRect(0, 0, W, H);
      }
    }
    _skyGradient() {
      const paper = this.def.paper, sk = this.ctx.createLinearGradient(0, 0, 0, this.H * 0.75);
      sk.addColorStop(0, rgba(mixc(paper, [250, 248, 242], 0.5), 1)); sk.addColorStop(1, rgba(paper, 1));
      return sk;
    }

    // ---------- per-frame drawing
    // Each layer is composited into ONE long strip bitmap at exact whole-pixel chunk
    // positions (so chunks never show seams), and that strip is then placed on screen at a
    // sub-pixel offset. Result: perfectly smooth parallax, and one draw call per layer.
    _drawLayer(i) {
      const S = this.ls[i], cw = this.cwPx;
      const camF = this.cam * S.L.par * this.kx;
      const cam = CONFIG.pixelSnap ? Math.round(camF) : camF;
      const first = Math.floor(cam / cw);
      if (first !== S.stripFirst) this._strip(S, first);
      this.ctx.drawImage(S.strip, first * cw - cam, Math.round(S.L.y0 * this.k));
      S.first = first; S.last = first + S.nb - 1; S.camPx = cam;
    }
    _strip(S, first) {
      const cw = this.cwPx, nb = S.nb;
      if (!S.strip) S.strip = mkCanvas(nb * cw, S.bandPx);
      const g = S.strip.getContext('2d'), shift = S.stripFirst == null ? nb : first - S.stripFirst;
      // half-resolution light strip that travels with the colour strip (glows are soft anyway)
      const hcw = cw / 2, lit = S.L.id > 0;
      if (lit && !S.lstrip) S.lstrip = mkCanvas(nb * hcw, Math.ceil(S.bandPx / 2));
      const lg = lit ? S.lstrip.getContext('2d') : null, lh = lit ? S.lstrip.height : 0;
      const slide = (ctx2, canvas, w, h, s) => {
        ctx2.globalCompositeOperation = 'copy';
        ctx2.drawImage(canvas, -shift * w, 0);
        ctx2.globalCompositeOperation = 'source-over';
        if (shift > 0) ctx2.clearRect((nb - shift) * w, 0, shift * w, h); else ctx2.clearRect(0, 0, -shift * w, h);
      };
      let from = 0, to = nb; // slots that need fresh chunks
      if (Math.abs(shift) < nb) {
        // slide the existing strips instead of re-blitting every chunk
        slide(g, S.strip, cw, S.bandPx);
        if (lit) slide(lg, S.lstrip, hcw, lh);
        if (shift > 0) from = nb - shift; else to = -shift;
      } else { g.clearRect(0, 0, nb * cw, S.bandPx); if (lit) lg.clearRect(0, 0, nb * hcw, lh); }
      for (let j = from; j < to; j++) {
        const ci = first + j, c = this._chunk(S, ci);
        g.drawImage(c, j * cw, 0);
        if (lit && c.hasLight) lg.drawImage(c.light, j * hcw, 0, hcw, lh);
        S.chunks.delete(ci); S.pool.push(c); // chunk bitmaps are only a staging area now
      }
      S.stripFirst = first;
      for (const ci of S.feats.keys()) if (ci < first - S.L.R - 1) S.feats.delete(ci);
    }
    _mistOff(mb, idx) { return ((this.cam * mb.par + this.time * mb.drift) * this.kx) % this.mist[idx].width; }
    _drawMist(mb, idx) {
      // repeating pattern → seamless and sub-pixel smooth, in a single fill
      const pat = this.mistPat[idx], ctx = this.ctx, h = this.mist[idx].height;
      const off = this._mistOff(mb, idx);
      const y = Math.round(mb.y * this.k);
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, -off, y]));
      ctx.globalAlpha = Math.min(1, mb.a * this.mistMul);
      ctx.fillStyle = pat;
      ctx.fillRect(0, y, this.W, h);
      ctx.globalAlpha = 1;
    }
    _drawSky() {
      const ctx = this.ctx, H = this.H;
      ctx.fillStyle = this.skyGrad; ctx.fillRect(0, 0, this.W, H);
      if (this.sun && this.night < 0.6) {
        const e = clamp(this.sun.e, 0, 1), r = H * lerp(0.036, 0.028, e);
        ctx.fillStyle = rgba(this.def.sun, lerp(0.78, 0.2, e) * (1 - this.night));
        ctx.beginPath(); ctx.arc(this.sun.x, this.sun.y, r, 0, TAU); ctx.fill();
      }
      if (this.moon) this._drawMoon(this.H * 0.026);
    }
    _drawMoon(r) {
      const ctx = this.ctx, m = this.moon, kk = Math.cos(m.phase * TAU);
      ctx.save(); ctx.translate(m.x, m.y);
      if (m.phase > 0.5) ctx.scale(-1, 1);
      ctx.fillStyle = rgba([255, 252, 238], Math.min(1, this.night * 1.2));
      ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.max(0.01, Math.abs(kk) * r), r, 0, Math.PI / 2, -Math.PI / 2, kk > 0);
      ctx.fill(); ctx.restore();
    }
    _birds(dt) {
      const ctx = this.ctx, k = this.k;
      this.birdT -= dt;
      if (this.o.birds && !this.reduceMotion && this.birdT <= 0 && this.night < 0.5 && this.weather === 'none' && this.flocks.length < 2) {
        const r = RNG((Math.random() * 1e9) | 0), dir = r() < 0.5 ? 1 : -1, n = r.int(3, 9), birds = [];
        for (let j = 0; j < n; j++) birds.push({ dx: -dir * j * r.range(10, 16), dy: (j % 2 ? 1 : -1) * Math.ceil(j / 2) * r.range(4, 7) + r.range(-2, 2), ph: r() * TAU, f: r.range(1.6, 2.6) });
        this.flocks.push({ x: dir > 0 ? -60 * k : this.W + 60 * k, y: r.range(120, 420), vx: dir * r.range(18, 34), s: r.range(3.5, 6), birds });
        this.flocks[this.flocks.length - 1].y = r.range(60, 300);
        this.birdT = r.range(25, 80);
      }
      if (!this.flocks.length) return;
      ctx.strokeStyle = rgba(this.def.ink, 0.7); ctx.lineWidth = Math.max(1, 1.1 * k); ctx.lineCap = 'round';
      ctx.beginPath();
      for (const fl of this.flocks) {
        fl.x += fl.vx * this.kx * dt;
        const fy = fl.y + 6 * Math.sin(this.time * 0.4);
        for (const b of fl.birds) {
          const bx = fl.x + b.dx * k, by = (fy + b.dy) * k, s = fl.s * k, f = Math.sin(this.time * TAU * b.f / 2 + b.ph);
          ctx.moveTo(bx - s, by - s * 0.35 * f - s * 0.1);
          ctx.quadraticCurveTo(bx - s * 0.45, by - s * 0.45 * f, bx, by);
          ctx.quadraticCurveTo(bx + s * 0.45, by - s * 0.45 * f, bx + s, by - s * 0.35 * f - s * 0.1);
        }
      }
      ctx.stroke();
      this.flocks = this.flocks.filter((fl) => fl.x > -400 * k && fl.x < this.W + 400 * k);
    }
    _particleCount(base) {
      const area = clamp((this.W * this.H) / 2.07e6, 0.3, 1.6);
      return Math.round(base * area * (this.o.quality === 'low' ? 0.6 : 1));
    }
    _weather(dt) {
      if (this.weather === 'none' || this.reduceMotion) return;
      const ctx = this.ctx, W = this.W, H = this.H, k = this.k;
      const want = this._particleCount(this.weather === 'rain' ? 220 : 170);
      while (this.parts.length < want) this.parts.push({ x: Math.random() * W, y: Math.random() * H, v: Math.random(), p: Math.random() * TAU });
      if (this.weather === 'rain') {
        ctx.strokeStyle = rgba(this.def.ink, 0.16); ctx.lineWidth = Math.max(0.7, 0.7 * k); ctx.beginPath();
        for (const q of this.parts) {
          const v = (600 + q.v * 300) * k;
          q.y += v * dt; q.x += v * 0.18 * dt;
          if (q.y > H) { q.y -= H + 30 * k; q.x = Math.random() * W; }
          if (q.x > W) q.x -= W;
          const l = (12 + q.v * 12) * k;
          ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - l * 0.18, q.y - l);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(252,252,255,' + (0.85 - 0.35 * this.night).toFixed(3) + ')'; ctx.beginPath();
        for (const q of this.parts) {
          const v = (25 + q.v * 40) * k;
          q.y += v * dt; q.x += Math.sin(this.time * 0.8 + q.p) * 12 * k * dt;
          if (q.y > H) { q.y -= H + 10 * k; q.x = Math.random() * W; }
          const r = (0.8 + q.v * 1.6) * k;
          ctx.moveTo(q.x + r, q.y); ctx.arc(q.x, q.y, r, 0, TAU);
        }
        ctx.fill();
      }
    }
    // Falling blossom (maple leaves in autumn), for themes that offer a 'petals' weather.
    _petals(dt) {
      const ctx = this.ctx, W = this.W, H = this.H, k = this.k, autumn = this.season === 'autumn';
      const want = this._particleCount(autumn ? 70 : 110);
      while (this.parts.length < want) this.parts.push({ x: Math.random() * W, y: Math.random() * H, v: Math.random(), p: Math.random() * TAU, c: Math.random() < 0.5 ? 0 : 1 });
      const cols = autumn ? [[196, 64, 36], [222, 128, 52]] : [[240, 182, 196], [248, 214, 222]];
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = rgba(cols[c], 0.9 - 0.4 * this.night); ctx.beginPath();
        for (const q of this.parts) {
          if (q.c !== c) continue;
          if (c === 0) { // advance once per particle
            q.y += (20 + q.v * 26) * k * dt; q.x += (14 + 10 * Math.sin(this.time * 0.6 + q.p)) * k * dt;
          }
          const r = (autumn ? 2.4 : 1.8) * (0.7 + q.v * 0.7) * k, rot = this.time * (0.8 + q.v) + q.p, flip = Math.abs(Math.sin(this.time * 1.4 + q.p));
          ctx.moveTo(q.x + r, q.y); ctx.ellipse(q.x, q.y, r, Math.max(0.3, r * 0.55 * flip), rot, 0, TAU);
        }
        ctx.fill();
      }
      for (const q of this.parts) {
        if (q.c === 1) { q.y += (20 + q.v * 26) * k * dt; q.x += (14 + 10 * Math.sin(this.time * 0.6 + q.p)) * k * dt; }
        if (q.y > H + 10) { q.y = -10; q.x = Math.random() * W; }
        if (q.x > W + 10) q.x -= W + 20;
      }
    }
    // Night lights, depth-correct. They're accumulated back-to-front in a half-resolution
    // buffer: before a layer adds its own lanterns, that layer's strip ERASES (destination-out)
    // the light of everything behind its opaque hills, and each mist band dims what's behind it.
    // The buffer is then added onto the finished, night-tinted frame.
    _lightsLayer(i) {
      const S = this.ls[i], g = this.lg, s = 0.5;
      g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1;
      g.drawImage(S.strip, (S.first * this.cwPx - S.camPx) * s, Math.round(S.L.y0 * this.k) * s, S.strip.width * s, S.strip.height * s);
      if (!S.lstrip) return;
      // this layer's own lanterns (already occluded within the layer when the chunk was baked);
      // a slow, small breathing per layer: candlelight, not a strobe
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.9 + 0.1 * Math.sin(this.time * 0.7 + i * 1.9) * Math.sin(this.time * 0.29 + i);
      g.drawImage(S.lstrip, (S.first * this.cwPx - S.camPx) * s, Math.round(S.L.y0 * this.k) * s);
      g.globalAlpha = 1;
    }
    _lightsMist(mb, idx) {
      const g = this.lg, s = 0.5, pat = this.mistPatL[idx], off = this._mistOff(mb, idx), y = Math.round(mb.y * this.k);
      pat.setTransform(new DOMMatrix([s, 0, 0, s, -off * s, y * s]));
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = Math.min(1, mb.a * this.mistMul) * 0.85;
      g.fillStyle = pat;
      g.fillRect(0, y * s, this.W * s, this.mist[idx].height * s);
    }
    render(dt) {
      const ctx = this.ctx, MIST = this.def.mist;
      this._tod();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      this._drawSky();
      const lit = sstep(0.25, 0.85, this.night);
      if (lit > 0) { this.lg.globalCompositeOperation = 'source-over'; this.lg.globalAlpha = 1; this.lg.clearRect(0, 0, this.lightC.width, this.lightC.height); }
      for (let i = 0; i < this.ls.length; i++) {
        this._drawLayer(i);
        if (lit > 0) this._lightsLayer(i);
        if (this.o.mist) for (let m = 0; m < MIST.length; m++) if (MIST[m].after === i) { this._drawMist(MIST[m], m); if (lit > 0) this._lightsMist(MIST[m], m); }
      }
      this._birds(dt);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.overlay, 0, 0);
      if (lit > 0) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = lit;
        ctx.drawImage(this.lightC, 0, 0, this.W, this.H);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
      this._weather(dt);
      if (this.fade) this._crossfade();
      if (this.o.hud) this._hud();
    }
    // Scene change: the old painting dissolves with an ease-out curve (fast start, gentle
    // settle), so a new seed feels like turning to a new scroll rather than a hard cut.
    _crossfade() {
      const p = (this.time - this.fade.t0) / 1.6;
      if (p >= 1) { this.fade = null; return; }
      this.ctx.globalAlpha = Math.pow(1 - p, 3);
      this.ctx.drawImage(this.fade.img, 0, 0);
      this.ctx.globalAlpha = 1;
    }
    _hud() {
      const ctx = this.ctx, s = this.stats;
      let n = 0;
      for (const S of this.ls) n += S.chunks.size;
      const lines = [s.fps.toFixed(0) + ' fps  ' + s.ms.toFixed(1) + ' ms/frame', 'chunks ' + n + '  last chunk ' + s.chunkMs.toFixed(1) + ' ms', this.W + 'x' + this.H + '  ' + this.season + '  ' + this.weather + '  ' + this.hour.toFixed(2) + 'h', this.o.style + '  seed ' + this.o.seed];
      ctx.font = '12px monospace'; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, 8, 300, 16 * lines.length + 8);
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, 14, 24 + i * 16));
    }

    // ---------- loop
    start() { if (!this.raf && !this.timer && !this.paused) { this.last = performance.now(); this.ramp = 0; this.raf = requestAnimationFrame(this._frame); } }
    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.timer) clearTimeout(this.timer);
      this.raf = this.timer = 0;
    }
    pause(p) { this.paused = !!p; if (p) this.stop(); else this.start(); }
    // Stop for good and let go of every bitmap (theme switch).
    destroy() {
      this.paused = true; this.stop();
      if (this._mq && this._mq.removeEventListener) this._mq.removeEventListener('change', this._mqf);
      for (const S of this.ls) { S.chunks.clear(); S.pool.length = 0; S.feats.clear(); S.strip = S.lstrip = null; }
      this.mist = this.mistPat = this.mistPatL = this.overlay = this.lightC = this.fade = null;
    }
    // Sleep on a timer until the next frame is actually due, then request ONE animation frame.
    // Keeping requestAnimationFrame permanently armed makes the browser run its whole frame
    // pipeline on every vsync (144x/s on a 144 Hz monitor) even when we draw nothing.
    _schedule() {
      if (this.paused || this.raf || this.timer) return;
      this.timer = setTimeout(() => { this.timer = 0; if (!this.paused) this.raf = requestAnimationFrame(this._frame); }, this._nextWait());
    }
    _nextWait() {
      const minDt = 1000 / clamp(this.o.fps, 1, 240);
      const floorHz = this.flocks.length || this.weather !== 'none' ? 15 : 4;
      const pxRate = Math.abs(this.baseSpeed * this.o.speed * this.kx);
      if (this.o.hud || (!CONFIG.pixelSnap && pxRate > 0)) return minDt - 2; // smooth: every frame moves
      let wait;
      if (pxRate >= floorHz) { const px = this.cam * this.kx; wait = ((Math.floor(px + 0.5) + 0.5 - px) / pxRate) * 1000; }
      else { const q = this.time * floorHz; wait = ((Math.floor(q) + 1 - q) / floorHz) * 1000; }
      return Math.max(minDt - 2, wait - 4); // a vsync of slack; an early wake just reschedules
    }
    _frame(now) {
      this.raf = 0;
      if (this.paused) return;
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      // ease into motion after start/resume (ease-out cubic over ~1.2 s): nothing lurches
      this.ramp = Math.min(1, this.ramp + dt / 1.2);
      const ease = 1 - Math.pow(1 - this.ramp, 3);
      this.cam += this.baseSpeed * this.o.speed * dt * ease * (this.reduceMotion ? 0.35 : 1);
      this.time += dt;
      this.pendDt = (this.pendDt || 0) + dt;
      // Skip frames that would be pixel-identical to the last one: layers move in whole
      // pixels, so at slow scroll speeds most ticks change nothing. Halves GPU/compositor load.
      this._tod();
      const sig = this._signature();
      if (sig === this.lastSig) { this._schedule(); return; }
      this.lastSig = sig;
      const t0 = performance.now();
      this.stats.renders = (this.stats.renders || 0) + 1;
      this.render(this.pendDt);
      this.pendDt = 0;
      const s = this.stats;
      s.ms = lerp(s.ms, performance.now() - t0, 0.1); s.frames++; s.acc += dt;
      if (s.acc >= 1) { s.fps = s.frames / s.acc; s.frames = 0; s.acc = 0; }
      if (!this.idlePending) {
        this.idlePending = true;
        const ric = window.requestIdleCallback || ((f) => setTimeout(f, 16));
        ric(() => { this.idlePending = false; if (!this.paused) this._prefetch(); }, { timeout: 1000 });
      }
      this._schedule();
    }
    _signature() {
      const floorHz = this.flocks.length || this.weather !== 'none' ? 15 : 4;
      const pxRate = Math.abs(this.baseSpeed * this.o.speed * this.kx);
      if (this.o.hud || this.fade || (!CONFIG.pixelSnap && pxRate > 0)) return NaN; // smooth mode: always draw
      // Pixel-snap mode: one shared clock drives every redraw — the nearest layer's whole-pixel
      // steps, or a fixed floor rate when scrolling is slower than that.
      const tick = pxRate >= floorHz ? Math.round(this.cam * this.kx) : Math.floor(this.time * floorHz);
      return this.todKey + '|' + tick;
    }
    // Rasterise the next chunk of each layer ahead of time so scrolling never stalls.
    _prefetch() {
      const t0 = performance.now();
      for (const S of this.ls) {
        if (S.last < S.first || !S.strip) continue;
        if (!S.chunks.has(S.last + 1)) this._chunk(S, S.last + 1);
        if (performance.now() - t0 > 12) return;
      }
    }
    // Render the full scene once, synchronously (used for first paint).
    warm() { this._tod(); this.render(0); }
  }

  // ------------------------------------------------------------------ theme registry
  const themes = [];
  function register(t) {
    const i = themes.findIndex((x) => x.id === t.id);
    if (i >= 0) themes[i] = t; else themes.push(t);
  }
  const theme = (id) => themes.find((t) => t.id === id) || themes.find((t) => t.id === (CONFIG.defaults || {}).theme) || themes[0];

  window.Paperwall = {
    Engine, DEFAULTS, CONFIG, CW, register, themes, theme,
    // painter toolkit for themes
    TAU, clamp, lerp, sstep, h32, hash2, hash4, RNG, vnoise, fbm, rgba, mixc,
    DL, drawOps, brush, curve, offsetLine, blob, rect, qbez, interpY, Occ, mkCanvas, dens, P,
  };
})();
