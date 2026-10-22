// The host's view of the room: who is connected, which seat (and blink id) each phone
// holds, where it physically is, and what program it should be running.
import { MAX_IDS } from '../core/blinkcode';
import type { Program } from '../core/effects';
import type { Track } from '../core/speaker';
import { applyHomography, floorPlan } from '../core/homography';
import { normalize, type Point, type Room } from '../core/layout';
import { clamp01 } from '../core/math';
import { fits, parsePhoneMsg, type HostMsg, type PhoneMsg } from '../core/protocol';
import { randomId, type HostEnd, type Link, type ServerState, type Transport } from '../net/transport';
import { forget, loadJson, saveJson } from '../storage';

export type Source = 'camera' | 'grid' | 'manual';

/** What a phone sends that a running feature acts on (taps, votes, file acks). */
export type PhoneInput = Extract<PhoneMsg, { t: 'tap' | 'vote' | 'have' }>;
export type InputHandlers = { [K in PhoneInput['t']]?: (seat: number, m: Extract<PhoneInput, { t: K }>) => void };

export interface Seat {
  seat: number;
  token: string;
  link: Link | null;
  raw: Point | null;
  source: Source | null;
  /** The phone's own estimate of its clock error (ms); Infinity until it has synced. */
  sync: number;
  lastTap: number;
  /** The `ack` of the frame this phone hasn't confirmed yet (0: none in flight). */
  awaiting: number;
  /** The newest frame, held until the phone confirms the one in flight. */
  held: ProgramMsg | null;
  /** When the phone's link last closed (0 if never, or before a reload). */
  left: number;
}

type ProgramMsg = Extract<HostMsg, { t: 'program' }>;

interface Conn {
  link: Link;
  heard: number;
  seat: Seat | null;
}

/** A seated phone the host hasn't heard from for this long has gone (a Wi-Fi dead spot, a dead battery). */
const SILENT_MS = 15_000;
/** A link that hasn't said hello by now never will. */
const HELLO_MS = 10_000;
/** Links open at once without a seat yet; more than this are refused. */
const MAX_UNSEATED = 32;

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

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
  private inputs = new Set<InputHandlers>();
  private offered: Track | null = null;
  private programFor: (seat: number) => Program = () => ({ kind: 'lobby' });
  private listeners = new Set<() => void>();
  private end: HostEnd | null = null;
  /** Every open link, seated or not, with when the host last heard from it. */
  private conns = new Set<Conn>();
  /** Numbers frames for their acks. */
  private frames = 0;
  /** Phones can reach the room only while the room server is 'up'. */
  server: ServerState = 'up';

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
      for (const x of saved.seats) s.seats.set(x.seat, { ...x, link: null, sync: Infinity, lastTap: 0, awaiting: 0, held: null, left: 0 });
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
    setInterval(() => this.sweep(), 1000);
    this.end.onLink((link) => this.accept(link));
    this.end.onServer((state) => {
      this.server = state;
      this.changed();
    });
    // Saved now, not at the first join, so reloading an empty new room keeps its code.
    this.save();
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

  /**
   * Set what every phone runs. `frame`: a picture frame, one of a stream each replacing the last.
   * A phone gets the next frame only once it confirms the one before, so on a slow link it skips
   * to the newest instead of falling further behind, however much the network buffers.
   * Nothing changes when the program is too big for one message.
   */
  setProgram(p: Program | ((seat: number) => Program), { frame = false } = {}): void {
    if (typeof p !== 'function' && !fits({ t: 'program', program: p, ack: 0 })) return;
    this.programFor = typeof p === 'function' ? p : () => p;
    // Programs change many times a second (live screen, games); they are not roster changes,
    // so no persistence or listener churn here. The stage reads programOf() every frame.
    const ack = frame ? ++this.frames : undefined;
    const msgFor = (seat: number): ProgramMsg => ({ t: 'program', program: this.programFor(seat), ack });
    const ready: Seat[] = [];
    for (const s of this.online) {
      s.held = ack && s.awaiting ? msgFor(s.seat) : null;
      if (s.held) continue;
      if (ack) s.awaiting = ack;
      ready.push(s);
    }
    if (typeof p === 'function') for (const s of ready) this.sendTo(s, msgFor(s.seat));
    else this.end?.broadcast(ready.map((s) => s.link!), msgFor(0));
  }

  /** Offer every phone, late joiners too, a song to fetch in the background. */
  offer(track: Track | null): void {
    this.offered = track;
    for (const s of this.online) this.sendTo(s, { t: 'offer', track });
  }

  /** Hear phone input until the returned function is called. */
  input(handlers: InputHandlers): () => void {
    this.inputs.add(handlers);
    return () => this.inputs.delete(handlers);
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
    if (s.link) this.deliver(s.link, m);
  }

  /**
   * Every message to a phone passes here or through the size check in setProgram: one too big
   * for the transport (the relay's 64 KB, a data channel's limit) is dropped, never sent to fail.
   */
  private deliver(link: Link, m: HostMsg): boolean {
    if (!fits(m)) return false;
    link.send(m);
    return true;
  }

  /** The phone confirmed frame `n`: the newest held one goes now. */
  private acked(s: Seat, n: number): void {
    if (n < s.awaiting) return;
    const next = s.held;
    s.held = null;
    s.awaiting = next?.ack ?? 0;
    if (next) this.sendTo(s, next);
  }

  /** Send one phone a message of its own (file chunks); false when it is offline or the message too big. */
  send(seat: number, m: HostMsg): boolean {
    const link = this.seats.get(seat)?.link;
    return !!link && this.deliver(link, m);
  }

  /** Close links that went quiet: a phone pings every 2 s, and a new link says hello at once. */
  sweep(): void {
    const now = this.now();
    for (const c of this.conns) if (now - c.heard > (c.seat ? SILENT_MS : HELLO_MS)) c.link.close();
  }

  private accept(link: Link): void {
    // Links say hello at once, so a pile of unseated ones is someone opening sockets to fill the room.
    if ([...this.conns].filter((c) => !c.seat).length >= MAX_UNSEATED) return link.close();
    const conn: Conn = { link, heard: this.now(), seat: null };
    this.conns.add(conn);
    let me: Seat | null = null;
    link.onMessage((raw) => {
      conn.heard = this.now();
      const m = parsePhoneMsg(raw);
      if (!m) return;
      if (m.t === 'hello') {
        // One seat per connection, so a single client can't fill the room.
        if (me) return;
        me = conn.seat = this.claim(m.token, link);
        if (!me) {
          this.deliver(link, { t: 'full' });
          return;
        }
        this.sendTo(me, { t: 'welcome', seat: me.seat, room: this.room });
        this.sendPos(me);
        this.sendTo(me, { t: 'program', program: this.programFor(me.seat) });
        // Always, even none: a phone still holding an offer from before the host page reloaded drops it.
        this.sendTo(me, { t: 'offer', track: this.offered });
        this.changed();
        return;
      }
      // Pongs only to a seated phone: one the host doesn't know goes quiet, times out and says hello again.
      if (!me) return;
      if (m.t === 'ping') {
        const h1 = this.now();
        this.deliver(link, { t: 'pong', c0: m.c0, h1, h2: this.now() });
        if (m.u !== undefined) me.sync = m.u;
      } else if (m.t === 'tap') {
        const now = this.now();
        if (now - me.lastTap < 40) return;
        me.lastTap = now;
        this.heard(me.seat, m);
      } else if (m.t === 'ack') this.acked(me, m.n);
      else if (m.t === 'vote' || m.t === 'have') this.heard(me.seat, m);
      else this.enterSeat(me, m.row, m.seat);
    });
    link.onClose(() => {
      this.conns.delete(conn);
      if (me && me.link === link) {
        me.link = null;
        me.left = this.now();
        this.changed();
      }
    });
  }

  /** A phone typed its row and seat: kept only while the seat grid is asking, inside its size. */
  private enterSeat(me: Seat, row: number, seat: number): void {
    const grid = this.programFor(me.seat);
    if (grid.kind !== 'grid') return;
    const entry = { row: clampInt(row, 1, grid.rows), seat: clampInt(seat, 1, grid.seats) };
    const was = this.gridEntries.get(me.seat);
    if (was?.row === entry.row && was.seat === entry.seat) return;
    this.gridEntries.set(me.seat, entry);
    this.changed();
  }

  private heard(seat: number, m: PhoneInput): void {
    for (const h of this.inputs) (h[m.t] as ((seat: number, m: PhoneInput) => void) | undefined)?.(seat, m);
  }

  private claim(token: string, link: Link): Seat | null {
    for (const s of this.seats.values())
      if (s.token === token) {
        if (s.link && s.link !== link) {
          // The same phone opened the room again (new tab); the newest wins and the old one stands down.
          const old = s.link;
          this.deliver(old, { t: 'replaced' });
          // Give the message time to arrive: WebRTC drops queued data on an immediate close.
          setTimeout(() => old.close(), 400);
        }
        s.link = link;
        s.sync = Infinity;
        // Frames in flight on the old link are gone with it; the hello sends the current program.
        s.awaiting = 0;
        s.held = null;
        return s;
      }
    const seat = this.freeSeat();
    if (seat === null) return null;
    this.gridEntries.delete(seat);
    const s: Seat = { seat, token, link, raw: null, source: null, sync: Infinity, lastTap: 0, awaiting: 0, held: null, left: 0 };
    this.seats.set(seat, s);
    return s;
  }

  /**
   * A seat for a new phone: an unused one, or once all are taken (a long evening of phones coming
   * and going), the one held longest by a phone that left without ever being placed.
   */
  private freeSeat(): number | null {
    for (let seat = 0; seat < MAX_IDS; seat++) if (!this.seats.has(seat)) return seat;
    let oldest: Seat | null = null;
    for (const s of this.seats.values()) if (!s.link && !s.raw && (!oldest || s.left < oldest.left)) oldest = s;
    return oldest?.seat ?? null;
  }

  private changed(): void {
    this.save();
    for (const cb of this.listeners) cb();
  }

  private save(): void {
    saveJson(STORE, {
      room: this.room,
      mirror: this.mirror,
      frame: this.frame,
      sourceAspect: this.sourceAspect,
      roomAspect: this.roomAspect,
      perspective: this.perspective,
      seats: [...this.seats.values()].map(({ seat, token, raw, source }) => ({ seat, token, raw, source })),
    } satisfies Saved);
  }
}
