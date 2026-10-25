/*
 * Paperwall stage: owns the canvas, runs whichever theme is selected and swaps themes with a
 * crossfade. Shared by the wallpaper page (index.html) and the gallery window (gallery.html).
 */
(function () {
  'use strict';
  const D = window.Paperwall;

  class Stage {
    // container: element the canvas goes into. opts: initial settings (theme, style, seed, ...)
    constructor(container, opts, cfg) {
      cfg = cfg || {};
      this.box = container;
      this.fade = cfg.fade !== false;
      this.cls = cfg.canvasClass || '';
      this.o = {};
      this.styles = {}; // last style chosen for each theme
      for (const k in opts || {}) if (k !== 'theme' && k !== 'style') this.o[k] = opts[k];
      if (!this.o.seed) this.o.seed = (Math.random() * 1e9) | 0;
      this.userPaused = false; this.focusPaused = false; this.eng = null;
      const t = D.theme(opts && opts.theme);
      if (opts && opts.style) this.styles[t.id] = opts.style;
      this._mount(t, false);
      let rt = 0;
      this._onResize = () => { clearTimeout(rt); rt = setTimeout(() => this.resize(), 200); };
      addEventListener('resize', this._onResize);
      // re-evaluate season / auto weather a few times an hour (cheap no-op when unchanged)
      this._tick = setInterval(() => { if (this.eng) this.eng._applyDerived(false); }, 10 * 60 * 1000);
    }
    get theme() { return this.t; }
    get paused() { return this.userPaused || this.focusPaused; }
    get(key) { return key === 'theme' ? this.t.id : this.eng ? this.eng.o[key] : this.o[key]; }

    _mount(t, crossfade) {
      const old = this.eng, oldC = this.canvas;
      const c = document.createElement('canvas');
      if (this.cls) c.className = this.cls;
      if (!this.fade) c.style.transition = 'none';
      this.box.appendChild(c);
      const opts = Object.assign({}, this.o);
      if (this.styles[t.id]) opts.style = this.styles[t.id];
      this.t = t; this.canvas = c;
      this.eng = new t.Engine(c, opts);
      this.styles[t.id] = this.eng.o.style;
      document.documentElement.style.setProperty('--paper', t.paper);
      this.eng.warm();
      requestAnimationFrame(() => c.classList.add('on'));
      if (!this.paused) this.eng.start(); else this.eng.paused = true;
      if (old) {
        old.pause(true);
        const done = () => { old.destroy(); if (oldC.parentNode) oldC.remove(); };
        if (crossfade && this.fade) { oldC.style.zIndex = 0; c.style.zIndex = 1; setTimeout(done, 1000); } else done();
      }
    }
    set(key, val) {
      if (key === 'theme') {
        const t = D.theme(val);
        if (t !== this.t) this._mount(t, true);
        return;
      }
      if (key === 'style') {
        this.styles[this.t.id] = val;
        if (this.eng) this.eng.set('style', val);
        return;
      }
      this.o[key] = val;
      if (this.eng) this.eng.set(key, val);
      if (this.eng && key in this.eng.o) this.o[key] = this.eng.o[key];
    }
    // Apply several settings at once; the theme goes first so its style lands on it.
    config(obj) {
      if (obj.theme != null && obj.style != null) this.styles[D.theme(obj.theme).id] = obj.style;
      if (obj.theme != null) this.set('theme', obj.theme);
      for (const k in obj) if (k !== 'theme') this.set(k, obj[k]);
    }
    pause(p) { this.userPaused = !!p; this._apply(); }
    _apply() { if (this.eng) this.eng.pause(this.paused); }
    resize() { if (!this.eng) return; this.eng.resize(); this.eng.lastSig = ''; this.eng.render(0); }

    // Pause once the window has been out of focus for `ms` (alt-tab, minimise, hidden tab).
    autoPause(ms) {
      let timer = 0;
      const away = (now) => {
        clearTimeout(timer);
        if (now) { this.focusPaused = true; this._apply(); return; }
        timer = setTimeout(() => { this.focusPaused = true; this._apply(); }, ms);
      };
      const back = () => { clearTimeout(timer); if (this.focusPaused) { this.focusPaused = false; this._apply(); } };
      addEventListener('blur', () => away(false));
      addEventListener('focus', back);
      addEventListener('pointerdown', back);
      document.addEventListener('visibilitychange', () => (document.hidden ? away(true) : document.hasFocus() && back()));
      if (!document.hasFocus()) away(false);
    }
    destroy() {
      removeEventListener('resize', this._onResize);
      clearInterval(this._tick);
      if (this.eng) this.eng.destroy();
      if (this.canvas) this.canvas.remove();
      this.eng = null;
    }
  }

  // Plain description of every theme, for the Windows tray menu and the gallery.
  D.manifest = () => D.themes.slice().sort((a, b) => (a.order || 9) - (b.order || 9)).map((t) => ({
    id: t.id, name: t.name, native: t.native || '', tagline: t.tagline, blurb: t.blurb,
    styles: t.styles.map((s) => ({ id: s.id, name: s.name, native: s.native || '', blurb: s.blurb, swatch: s.swatch })),
    weathers: t.weathers, toggles: t.toggles, defaultStyle: t.Engine.def.defaults.style,
  }));
  D.Stage = Stage;
})();
