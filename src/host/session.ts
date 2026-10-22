// The host's view of the room: who is connected, which seat (and blink id) each phone
// holds, where it physically is, and what program it should be running.
import { MAX_IDS } from '../core/blinkcode';
import type { Program } from '../core/effects';
import { applyHomography, floorPlan } from '../core/homography';
import { normalize, type Point, type Room } from '../core/layout';
import { clamp01 } from '../core/math';
import { parsePhoneMsg, type HostMsg } from '../core/protocol';
import { randomId, type HostEnd, type Link, type Transport } from '../net/transport';
import { forget, loadJson, saveJson } from '../storage';

export type Source = 'camera' | 'grid' | 'manual';

export interface Seat {
  seat: number;
  token: string;
  link: Link | null;
  raw: Point | null;
  source: Source | null;
  sim?: Point;
  /** The phone's own estimate of its clock error (ms); Infinity until it has synced. */
  sync: number;
  lastTap: number;
}

/**
 * 'source': raw positions are camera or seat-grid coordinates, stretched to fill the room.
 * 'room': positions were edited by hand and are used exactly as placed.
 */
type Frame = 'source' | 'room';

/** Four corners of the seating area in the camera image, and its real size, to undo perspective. */
export interface Perspective {
  corners: Point[];
  width: number;
  depth: number;
}

interface Saved {
  perspective?: Perspective | null;
  room: string;
  mirror: boolean;
  frame?: Frame;
  sourceAspect?: number;
  roomAspect?: number;
  seats: { seat: number; token: string; raw: Point | null; source: Source | null }[];
}

const STORE = 'swarm-host';

const ROOM_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class HostSession {
  readonly seats = new Map<number, Seat>();
  /** Row/seat numbers typed in on phones while the no-camera seat grid is up. */
  readonly gridEntries = new Map<number, { row: number; seat: number }>();
  layout: Room = { positions: new Map(), aspect: 1 };
  mirror = false;
  /** Aspect ratio of the source the raw positions came from (camera frame). */
  sourceAspect = 4 / 3;
  perspective: Perspective | null = null;
  private frame: Frame = 'source';
  private roomAspect = 1;
  onTap: (seat: number) => void = () => {};
  private programFor: (seat: number) => Program = () => ({ kind: 'lobby' });
  private listeners = new Set<() => void>();
  private end: HostEnd | null = null;

  constructor(
    readonly transport: Transport,
    readonly room: string,
    readonly now: () => number = () => performance.now(),
  ) {}

  static restore(transport: Transport, fresh: boolean): HostSession {
    const saved = fresh ? null : loadJson<Saved>(STORE);
    const s = new HostSession(transport, saved?.room ?? randomId(4, ROOM_CODE));
    if (saved) {
      s.mirror = saved.mirror;
      s.frame = saved.frame ?? 'source';
      s.sourceAspect = saved.sourceAspect ?? s.sourceAspect;
      s.roomAspect = saved.roomAspect ?? 1;
      s.perspective = saved.perspective ?? null;
      for (const x of saved.seats) s.seats.set(x.seat, { ...x, link: null, sync: Infinity, lastTap: 0 });
      s.relayout(false);
    }
    return s;
  }

  /** Drop the saved room, so the next host page starts a new one. */
  static forget(): void {
    forget(STORE);
  }

  async open(): Promise<void> {
    this.end = await this.transport.host(this.room);
    this.end.onLink((link) => this.accept(link));
  }

  close(): void {
    this.end?.close();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get online(): Seat[] {
    return [...this.seats.values()].filter((s) => s.link);
  }

  /** The room as games should see it: only phones that are here and placed. */
  playRoom(): Room {
    const positions = new Map<number, Point>();
    for (const s of this.online) {
      const p = this.layout.positions.get(s.seat);
      if (p) positions.set(s.seat, p);
    }
    return { positions, aspect: this.layout.aspect };
  }

  /** Worst clock error among connected phones (ms). */
  get worstSync(): number {
    return Math.max(0, ...this.online.map((s) => s.sync));
  }

  setProgram(p: Program | ((seat: number) => Program)): void {
    this.programFor = typeof p === 'function' ? p : () => p;
    // Programs change many times a second (live screen, games); they are not roster changes,
    // so no persistence or listener churn here. The stage reads programOf() every frame.
    for (const s of this.online) this.sendTo(s, { t: 'program', program: this.programFor(s.seat) });
  }

  /** The program a seat is running (for the host's live mirror of the crowd). */
  programOf(seat: number): Program {
    return this.programFor(seat);
  }

  /** New positions from the camera or the seat grid (both measured in a source frame). */
  setRaw(updates: Map<number, Point | null>, source: Exclude<Source, 'manual'>): void {
    this.frame = 'source';
    this.applyRaw(updates, source);
  }

  private applyRaw(updates: Map<number, Point | null>, source: Source): void {
    for (const [seat, p] of updates) {
      const s = this.seats.get(seat);
      if (!s) continue;
      s.raw = p;
      s.source = p ? source : null;
    }
    this.relayout(true);
  }

  /**
   * Drop a phone at a point in room space by hand. Everyone's raw position is first
   * rebased onto the current room layout so nobody else jumps.
   */
  placeManually(seat: number, p: Point): void {
    if (this.frame === 'source') {
      // Freeze the current layout so that moving one phone never rescales the others.
      for (const s of this.seats.values()) {
        s.raw = this.layout.positions.get(s.seat) ?? null;
        // Frozen positions are room coordinates now, not camera ones: never mix them with a rescan.
        s.source = s.raw ? 'manual' : null;
      }
      this.roomAspect = this.layout.positions.size > 1 ? this.layout.aspect : 16 / 9;
      this.frame = 'room';
      this.mirror = false;
    }
    this.applyRaw(new Map([[seat, { x: clamp01(p.x), y: clamp01(p.y) }]]), 'manual');
  }

  /** Whether a saved perspective correction is actually shaping the map right now. */
  get perspectiveActive(): boolean {
    return this.frame === 'source' && !!this.perspective && [...this.seats.values()].some((s) => s.raw && s.source === 'camera') && this.allFromCamera();
  }

  setPerspective(p: Perspective | null): void {
    this.perspective = p;
    this.relayout(true);
  }

  setMirror(on: boolean): void {
    this.mirror = on;
    this.relayout(true);
  }

  forgetOffline(): void {
    for (const [seat, s] of this.seats) if (!s.link) this.seats.delete(seat);
    this.relayout(true);
  }

  private relayout(broadcast: boolean): void {
    const raw = new Map<number, Point>();
    for (const s of this.seats.values()) if (s.raw) raw.set(s.seat, s.raw);
    const H = this.perspective && floorPlan(this.perspective.corners);
    if (this.frame === 'room') this.layout = { positions: raw, aspect: this.roomAspect };
    else if (H && this.perspective && this.allFromCamera()) {
      const floor = new Map<number, Point>();
      for (const [seat, p] of raw) {
        const q = applyHomography(H, p);
        if (q) floor.set(seat, q);
      }
      this.layout = normalize(floor, { mirror: this.mirror, sourceAspect: this.perspective.width / this.perspective.depth });
    } else this.layout = normalize(raw, { mirror: this.mirror, sourceAspect: this.sourceAspect });
    if (broadcast) for (const s of this.online) this.sendPos(s);
    this.changed();
  }

  /** Every placed phone was placed by the camera (so a perspective correction applies to all of them). */
  private allFromCamera(): boolean {
    return [...this.seats.values()].every((s) => !s.raw || s.source === 'camera');
  }

  private sendPos(s: Seat): void {
    this.sendTo(s, { t: 'pos', pos: this.layout.positions.get(s.seat) ?? null, aspect: this.layout.aspect });
  }

  private sendTo(s: Seat, m: HostMsg): void {
    s.link?.send(m);
  }

  private accept(link: Link): void {
    let me: Seat | null = null;
    link.onMessage((raw) => {
      const m = parsePhoneMsg(raw);
      if (!m) return;
      if (m.t === 'ping') {
        const h1 = this.now();
        link.send({ t: 'pong', c0: m.c0, h1, h2: this.now() } satisfies HostMsg);
        if (me && m.u !== undefined) me.sync = m.u;
        return;
      }
      if (m.t === 'hello') {
        // One seat per connection, so a single client can't fill the room.
        if (me) return;
        me = this.claim(m.token, link);
        if (!me) {
          link.send({ t: 'full' } satisfies HostMsg);
          return;
        }
        if (m.sim) me.sim = m.sim;
        this.sendTo(me, { t: 'welcome', seat: me.seat, room: this.room });
        this.sendPos(me);
        this.sendTo(me, { t: 'program', program: this.programFor(me.seat) });
        this.changed();
        return;
      }
      if (!me) return;
      if (m.t === 'tap') {
        const now = this.now();
        if (now - me.lastTap < 40) return;
        me.lastTap = now;
        this.onTap(me.seat);
      } else {
        this.gridEntries.set(me.seat, { row: m.row, seat: m.seat });
        this.changed();
      }
    });
    link.onClose(() => {
      if (me && me.link === link) {
        me.link = null;
        this.changed();
      }
    });
  }

  private claim(token: string, link: Link): Seat | null {
    for (const s of this.seats.values())
      if (s.token === token) {
        if (s.link && s.link !== link) {
          // The same phone opened the room again (new tab); the newest wins and the old one stands down.
          const old = s.link;
          old.send({ t: 'replaced' } satisfies HostMsg);
          // Give the message time to arrive: WebRTC drops queued data on an immediate close.
          setTimeout(() => old.close(), 400);
        }
        s.link = link;
        s.sync = Infinity;
        return s;
      }
    for (let seat = 0; seat < MAX_IDS; seat++)
      if (!this.seats.has(seat)) {
        const s: Seat = { seat, token, link, raw: null, source: null, sync: Infinity, lastTap: 0 };
        this.seats.set(seat, s);
        return s;
      }
    return null;
  }

  private changed(): void {
    // If storage is unavailable the room still works, it just won't survive a refresh.
    saveJson(STORE, {
      room: this.room,
      mirror: this.mirror,
      frame: this.frame,
      sourceAspect: this.sourceAspect,
      roomAspect: this.roomAspect,
      perspective: this.perspective,
      seats: [...this.seats.values()].map(({ seat, token, raw, source }) => ({ seat, token, raw, source })),
    } satisfies Saved);
    for (const cb of this.listeners) cb();
  }
}
