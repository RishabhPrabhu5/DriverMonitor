/* ─────────────────────────────────────────────────────────────
   SVG analog gauges (speedometer, fuel) with a smoothed needle.
   Pure DOM/SVG — no dependencies.
   ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // angle: 0° = 12 o'clock, clockwise positive
  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arcPath(cx, cy, r, a0, a1) {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  class Gauge {
    constructor(svg, opts) {
      this.svg = svg;
      this.o = Object.assign({
        min: 0, max: 100,
        startAngle: -135, endAngle: 135,
        majorStep: 20, minorStep: 10,
        label: '', unit: '',
        zones: [],                 // [{from, to, color}]
        tickLabels: null,          // {value: 'text'} override
        format: v => String(Math.round(v)),
        subtext: null,             // fn(value) → string
        needleLength: 108,
      }, opts);
      this.value = this.o.min;
      this.display = this.o.min;
      this.build();
    }

    angleFor(v) {
      const { min, max, startAngle, endAngle } = this.o;
      const t = (clamp(v, min, max) - min) / (max - min);
      return startAngle + t * (endAngle - startAngle);
    }

    build() {
      const o = this.o, svg = this.svg;
      const S = 300, cx = 150, cy = 150, r = 120;
      svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
      svg.innerHTML = '';

      // bezel + face
      el('circle', { cx, cy, r: 146, fill: '#0a0e13', stroke: '#2a3645', 'stroke-width': 3 }, svg);
      el('circle', { cx, cy, r: 138, fill: 'url(#face-' + svg.id + ')' }, svg);
      const defs = el('defs', {}, svg);
      const grad = el('radialGradient', { id: 'face-' + svg.id }, defs);
      el('stop', { offset: '0%', 'stop-color': '#182230' }, grad);
      el('stop', { offset: '100%', 'stop-color': '#0e141c' }, grad);

      // track
      el('path', { d: arcPath(cx, cy, r, o.startAngle, o.endAngle), fill: 'none', stroke: '#2a3645', 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);

      // zones (thin colored arcs just outside the track)
      for (const z of o.zones) {
        el('path', {
          d: arcPath(cx, cy, r + 8, this.angleFor(z.from), this.angleFor(z.to)),
          fill: 'none', stroke: z.color, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: .9,
        }, svg);
      }

      // ticks
      const ticks = el('g', { stroke: '#9fb0c3', 'stroke-linecap': 'round' }, svg);
      const labels = el('g', { fill: '#e6edf3', 'font-size': 15, 'font-weight': 600, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'system-ui, sans-serif' }, svg);
      const step = o.minorStep || o.majorStep;
      for (let v = o.min; v <= o.max + 1e-9; v += step) {
        const isMajor = Math.abs(((v - o.min) / o.majorStep) - Math.round((v - o.min) / o.majorStep)) < 1e-6;
        const a = this.angleFor(v);
        const [x0, y0] = polar(cx, cy, isMajor ? r - 14 : r - 7, a);
        const [x1, y1] = polar(cx, cy, r - 1, a);
        el('line', { x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': isMajor ? 3 : 1.5, opacity: isMajor ? 1 : .6 }, ticks);
        if (isMajor) {
          const [lx, ly] = polar(cx, cy, r - 32, a);
          const txt = o.tickLabels ? (o.tickLabels[v] ?? '') : String(Math.round(v));
          const t = el('text', { x: lx, y: ly }, labels);
          t.textContent = txt;
        }
      }

      // readout
      this.readout = el('text', { x: cx, y: cy + 44, 'text-anchor': 'middle', fill: '#e6edf3', 'font-size': 40, 'font-weight': 700, 'font-family': 'ui-monospace, Menlo, monospace' }, svg);
      this.readout.textContent = o.format(this.value);
      const unit = el('text', { x: cx, y: cy + 66, 'text-anchor': 'middle', fill: '#9fb0c3', 'font-size': 13, 'letter-spacing': 2, 'font-family': 'system-ui, sans-serif' }, svg);
      unit.textContent = o.unit;
      this.sub = el('text', { x: cx, y: cy + 90, 'text-anchor': 'middle', fill: '#6b7b8f', 'font-size': 12, 'font-family': 'system-ui, sans-serif' }, svg);
      const lbl = el('text', { x: cx, y: cy - 40, 'text-anchor': 'middle', fill: '#6b7b8f', 'font-size': 12, 'letter-spacing': 3, 'font-family': 'system-ui, sans-serif' }, svg);
      lbl.textContent = o.label;

      // needle
      this.needle = el('g', { transform: `translate(${cx} ${cy}) rotate(${this.angleFor(this.value)})` }, svg);
      el('path', { d: `M -3.5 14 L 0 -${o.needleLength} L 3.5 14 Z`, fill: '#58c4ff', stroke: '#9fe0ff', 'stroke-width': .5 }, this.needle);
      el('circle', { cx: 0, cy: 0, r: 9, fill: '#1a2330', stroke: '#58c4ff', 'stroke-width': 2 }, this.needle);
      el('circle', { cx: 0, cy: 0, r: 3, fill: '#58c4ff' }, this.needle);
    }

    set(v) { this.value = clamp(v, this.o.min, this.o.max); }

    /** advance the smoothed needle; dt in ms */
    tick(dt) {
      const k = 1 - Math.exp(-dt / 120);         // ~120 ms time constant
      this.display += (this.value - this.display) * k;
      if (Math.abs(this.value - this.display) < 0.05) this.display = this.value;
      this.needle.setAttribute('transform', `translate(150 150) rotate(${this.angleFor(this.display).toFixed(2)})`);
      this.readout.textContent = this.o.format(this.display);
      if (this.o.subtext) this.sub.textContent = this.o.subtext(this.display);
    }
  }

  global.DM = global.DM || {};
  global.DM.Gauge = Gauge;
})(window);
