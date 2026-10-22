// The host's live mirror of the crowd: every phone drawn where it physically is,
// showing exactly what it is showing right now (the host runs the same pure renderer
// the phones do). Phones can be dragged to fix a position or dropped in by hand.
import { cssFloor, luma, render } from '../core/effects';
import { distance, type Point } from '../core/layout';
import { clamp01 } from '../core/math';
import { h } from '../ui/dom';
import type { HostSession } from './session';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Stage {
  readonly el: HTMLElement;
  /** When set, clicking empty floor reports a room-space point (used to aim ripples). */
  onPick: ((p: Point) => void) | null = null;
  private canvas = h('canvas.stage-canvas', { tabindex: 0, role: 'img', 'aria-describedby': 'stage-keys' });
  private empty = h('div.stage-empty');
  private tray = h('div.tray', { role: 'group', 'aria-label': 'Phones not placed yet' });
  private table = h('table.sr-only', { 'aria-label': 'Phone positions' });
  private hint = h('p.stage-hint', { id: 'stage-keys', hidden: true });
  private said = h('p.sr-only', { role: 'status' });
  private selected: number | null = null;
  /** Keyboard crosshair for aiming onPick when no phone is selected. */
  private aim: Point = { x: 0.5, y: 0.5 };
  private drag: { seat: number; p: Point; start: Point } | null = null;
  private box: Box = { x: 0, y: 0, w: 1, h: 1 };

  constructor(private readonly session: HostSession) {
    this.el = h('section.stage', { 'aria-label': 'Room map' }, h('div.stage-frame', {}, this.canvas, this.empty), this.hint, this.said, this.tray, this.table);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('keydown', (e) => this.key(e));
    this.canvas.addEventListener('focus', () => (this.hint.hidden = false));
    this.canvas.addEventListener('blur', () => (this.hint.hidden = true));
    session.subscribe(() => this.sync());
    this.sync();
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private sync(): void {
    const s = this.session;
    const seats = [...s.seats.values()].sort((a, b) => a.seat - b.seat);
    const placed = seats.filter((x) => s.layout.positions.has(x.seat));
    const unplaced = seats.filter((x) => !s.layout.positions.has(x.seat));
    this.empty.hidden = placed.length > 0;
    this.empty.textContent =
      seats.length === 0
        ? 'No phones yet. Scan the QR code with a phone to join.'
        : `${seats.length} phone${seats.length === 1 ? '' : 's'} joined. Scan the room with the camera, or pick a number below and tap the map to place it.`;
    this.canvas.setAttribute('aria-label', `Room map with ${placed.length} placed phone${placed.length === 1 ? '' : 's'}`);
    this.tray.hidden = unplaced.length === 0;
    this.tray.replaceChildren(
      h('span.tray-label', {}, 'Not placed'),
      ...unplaced.map((x) =>
        h(
          'button.chip',
          {
            type: 'button',
            'aria-pressed': String(this.selected === x.seat),
            'data-offline': x.link ? undefined : 'true',
            onclick: () => {
              this.selected = this.selected === x.seat ? null : x.seat;
              this.sync();
              this.canvas.focus();
            },
          },
          String(x.seat + 1),
        ),
      ),
    );
    this.table.replaceChildren(
      h('tr', {}, h('th', {}, 'Phone'), h('th', {}, 'Online'), h('th', {}, 'Across'), h('th', {}, 'Deep')),
      ...seats.map((x) => {
        const p = s.layout.positions.get(x.seat);
        const raw = x.raw;
        return h(
          'tr',
          { 'data-seat': x.seat, 'data-raw-x': raw?.x ?? '', 'data-raw-y': raw?.y ?? '', 'data-x': p?.x ?? '', 'data-y': p?.y ?? '', 'data-source': x.source ?? '' },
          h('td', {}, String(x.seat + 1)),
          h('td', {}, x.link ? 'yes' : 'no'),
          h('td', {}, p ? `${Math.round(p.x * 100)}%` : 'unplaced'),
          h('td', {}, p ? `${Math.round(p.y * 100)}%` : 'unplaced'),
        );
      }),
    );
  }

  private toRoom(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, r.width);
    return { x: ((e.clientX - r.left) * dpr - this.box.x) / this.box.w, y: ((e.clientY - r.top) * dpr - this.box.y) / this.box.h };
  }

  private hit(p: Point): number | null {
    const { positions, aspect } = this.session.layout;
    let best: number | null = null;
    let bestD = 0.06;
    for (const [seat, q] of positions) {
      const d = distance(q, p, aspect);
      if (d < bestD) [best, bestD] = [seat, d];
    }
    return best;
  }

  private down(e: PointerEvent): void {
    const p = this.toRoom(e);
    const seat = this.hit(p);
    if (seat !== null) {
      this.select(seat);
      this.drag = { seat, p, start: p };
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  private move(e: PointerEvent): void {
    if (this.drag) this.drag.p = this.toRoom(e);
  }

  private up(e: PointerEvent): void {
    const p = this.toRoom(e);
    if (this.drag) {
      if (distance(this.drag.start, p, 1) > 0.005) this.session.placeManually(this.drag.seat, p);
      this.drag = null;
      return;
    }
    if (this.selected !== null && !this.session.layout.positions.has(this.selected)) {
      this.session.placeManually(this.selected, p);
      this.selected = null;
    } else if (this.onPick && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05) {
      this.aim = p;
      this.onPick(p);
    }
  }

  private select(seat: number | null): void {
    this.selected = seat;
    this.said.textContent = seat === null ? 'No phone picked' : `Phone ${seat + 1} picked`;
    this.sync();
  }

  private key(e: KeyboardEvent): void {
    const seat = this.selected;
    if (e.key === '[' || e.key === ']') {
      const placed = [...this.session.layout.positions.keys()].sort((a, b) => a - b);
      if (!placed.length) return;
      const i = seat === null ? -1 : placed.indexOf(seat);
      const n = placed.length;
      this.select(placed[e.key === ']' ? (i + 1) % n : i < 0 ? n - 1 : (i - 1 + n) % n]);
    } else if (e.key === 'Escape' && seat !== null) this.select(null);
    else if (e.key === 'Enter' && seat === null && this.onPick) {
      this.onPick({ ...this.aim });
      this.said.textContent = `Ripple centre set at ${Math.round(this.aim.x * 100)}% across, ${Math.round(this.aim.y * 100)}% deep`;
    } else {
      const step = e.shiftKey ? 0.1 : 0.02;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      if (seat !== null) {
        const at = this.session.layout.positions.get(seat) ?? { x: 0.5, y: 0.5 };
        this.session.placeManually(seat, { x: at.x + d[0], y: at.y + d[1] });
      } else if (this.onPick) {
        this.aim = { x: clamp01(this.aim.x + d[0]), y: clamp01(this.aim.y + d[1]) };
      } else return;
    }
    e.preventDefault();
  }

  private draw(): void {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    if (r.width === 0) return;
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const { positions, aspect } = this.session.layout;
    const n = Math.max(1, positions.size);
    const pad = 28 * dpr;
    const availW = c.width - 2 * pad;
    const availH = c.height - 2 * pad;
    const a = positions.size > 1 ? aspect : 16 / 9;
    const w = Math.min(availW, availH * a);
    const hh = w / a;
    this.box = { x: (c.width - w) / 2, y: (c.height - hh) / 2, w, h: hh };

    // Floor grid.
    ctx.strokeStyle = 'rgba(242, 234, 216, 0.06)';
    ctx.lineWidth = dpr;
    for (let i = 0; i <= 10; i++) {
      const gx = this.box.x + (i / 10) * w;
      const gy = this.box.y + (i / 10) * hh;
      ctx.beginPath();
      ctx.moveTo(gx, this.box.y);
      ctx.lineTo(gx, this.box.y + hh);
      ctx.moveTo(this.box.x, gy);
      ctx.lineTo(this.box.x + w, gy);
      ctx.stroke();
    }
    const aiming = this.onPick && this.selected === null && document.activeElement === c;
    const hint = `Keys: [ ] pick a phone, arrows move it, Shift for big steps, Esc lets go${this.onPick ? '. With no phone picked, arrows aim the ripple and Enter sets it' : ''}.`;
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    if (this.onPick) {
      ctx.fillStyle = 'rgba(255, 176, 0, 0.7)';
      ctx.font = `${12 * dpr}px "Archivo Variable", sans-serif`;
      ctx.fillText('Tap the floor to set the ripple centre', this.box.x, this.box.y - 10 * dpr);
    }
    if (aiming) {
      const ax = this.box.x + this.aim.x * w;
      const ay = this.box.y + this.aim.y * hh;
      const r = 12 * dpr;
      ctx.strokeStyle = '#ffb000';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(ax - r, ay);
      ctx.lineTo(ax + r, ay);
      ctx.moveTo(ax, ay - r);
      ctx.lineTo(ax, ay + r);
      ctx.moveTo(ax + r * 0.6, ay);
      ctx.arc(ax, ay, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    const size = Math.max(14 * dpr, Math.min(72 * dpr, (Math.sqrt((w * hh) / n) * 0.5)));
    const now = this.session.now();
    for (const [seat, p0] of positions) {
      const s = this.session.seats.get(seat);
      const p = this.drag?.seat === seat ? this.drag.p : p0;
      const f = render(this.session.programOf(seat), { seat, pos: p, aspect }, now);
      const pw = size * 0.62;
      const x = this.box.x + p.x * w - pw / 2;
      const y = this.box.y + p.y * hh - size / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, pw, size, pw * 0.16);
      if (s?.link) {
        ctx.fillStyle = cssFloor(f.rgb, 26);
        ctx.fill();
      }
      ctx.lineWidth = (seat === this.selected ? 2.5 : 1) * dpr;
      ctx.strokeStyle = seat === this.selected ? '#ffb000' : s?.link ? 'rgba(242,234,216,0.25)' : 'rgba(242,234,216,0.5)';
      ctx.setLineDash(s?.link ? [] : [3 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = s?.link && luma(f.rgb) > 140 ? '#0e0d0b' : '#f2ead8';
      ctx.font = `600 ${Math.max(9 * dpr, size * 0.3)}px "Archivo Variable", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(seat + 1), x + pw / 2, y + size / 2);
    }
  }
}
