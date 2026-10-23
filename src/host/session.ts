// The host's view of the room: who is connected, which seat (and blink id) each phone
// holds, where it physically is, and what program it should be running.
import { MAX_IDS } from '../core/blinkcode';
import type { Program } from '../core/effects';
import type { Track } from '../core/speaker';
import { applyHomography, floorPlan } from '../core/homography';
import { normalize, type Point, type Room } from '../core/layout';
import { clamp01 } from '../core/math';
import { TAP_MS, fits, messageBytes, parsePhoneMsg, type HostMsg, type PhoneMsg } from '../core/protocol';
import { PHONE_LIMIT, PHONE_MESSAGE_BYTES, tokenBucket } from '../net/limits.js';
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
  /** When the frame in flight went. */
  sentAt: number;
  /** Smoothed time from sending a frame to its ack (ms); 0 until measured. */
  ackRtt: number;
  /** The frame the watchdog stopped waiting for, until its ack comes: that ack still tells the round trip. */
  late: { n: number; at: number } | null;
  /** When the phone's link last closed (0 if never, or before a reload). */
  left: number;
  /** Width / height of the phone's screen as it last said; not saved with the room. */
  screen: number | null;
}

type ProgramMsg = Extract<HostMsg, { t: 'program' }>;

/** A seat as it starts out, or comes back from a saved room: no link, nothing in flight. */
function blankSeat(x: Pick<Seat, 'seat' | 'token' | 'raw' | 'source'>, link: Link | null = null): Seat {
  return { ...x, link, sync: Infinity, lastTap: 0, awaiting: 0, held: null, sentAt: 0, ackRtt: 0, late: null, left: 0, screen: null };
}

interface Conn {
  link: Link;
  opened: number;
  heard: number;
  /** Said hello: seated, or told the room is full. */
  greeted: boolean;
  seat: Seat | null;
}

/**
 * A seated phone the host hasn't heard from for this long has gone (a Wi-Fi dead spot, a dead
 * battery), on a transport whose server doesn't notice that itself.
 */
const SILENT_MS = 15_000;
/** Shortest wait for a frame's ack before the next frame goes anyway; slow phones get eight round trips. */
const ACK_WAIT_MS = 2000;
/** A link without a seat this long after it opened never gets one (a phone says hello at once). */
const HELLO_MS = 10_000;
/** Links open at once that have not said hello; past this a new one waits its turn. */
const MAX_UNGREETED = 32;
/** A link that has waited longer than this for its hello makes room for a new one; a younger one is not shoved out. */
const SQUATTER_MS = 1500;

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
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private closed = false;
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
      for (const x of saved.seats) s.seats.set(x.seat, blankSeat(x));
      s.relayout(false);
    }
    return s;
  }

  /** Drop the saved room, so the next host page starts a new one. */
  static forget(): void {
    forget(STORE);
  }

  async open(): Promise<void> {
    const end = await this.transport.host(this.room);
    // Closed while the transport was still opening the room: let it go again at once.
    if (this.closed) return end.close();
    this.end = end;
    this.sweeper = setInterval(() => this.sweep(), 1000);
    this.end.onLink((link) => this.accept(link));
    this.end.onServer((state) => {
      this.server = state;
      this.changed();
    });
    // Saved now, not at the first join, so reloading an empty new room keeps its code.
    this.save();
  }

  /** Stop sweeping and give the room up: its links close and the room server is let go. */
  close(): void {
    this.closed = true;
    clearInterval(this.sweeper);
    this.sweeper = undefined;
    for (const c of [...this.conns]) c.link.close();
    this.end?.close();
    this.end = null;
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

  /** Screen shape (width / height) of every phone that has said, for laying a picture over them. */
  screens(): Map<number, number> {
    return new Map([...this.seats.values()].flatMap((s) => (s.screen === null ? [] : [[s.seat, s.screen] as const])));
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
      if (ack) {
        s.awaiting = ack;
        s.sentAt = this.now();
      }
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
    // An ack that took longer than the wait: the phone is slower than the watchdog thought, so learn it.
    if (s.late?.n === n) {
      this.learnRtt(s, this.now() - s.late.at);
      s.late = null;
      return;
    }
    if (n < s.awaiting) return;
    if (n === s.awaiting) this.learnRtt(s, this.now() - s.sentAt);
    this.release(s);
  }

  private learnRtt(s: Seat, rtt: number): void {
    s.ackRtt = s.ackRtt ? 0.75 * s.ackRtt + 0.25 * rtt : rtt;
  }

  /** Stop waiting for the frame in flight and send the newest held one. */
  private release(s: Seat): void {
    const next = s.held;
    s.held = null;
    s.awaiting = next?.ack ?? 0;
    s.sentAt = this.now();
    if (next) this.sendTo(s, next);
  }

  /** Send one phone a message of its own (file chunks); false when it is offline or the message too big. */
  send(seat: number, m: HostMsg): boolean {
    const link = this.seats.get(seat)?.link;
    return !!link && this.deliver(link, m);
  }

  /**
   * Close links that went quiet (a phone pings every 2 s) where the server can't tell, and links
   * still without a seat HELLO_MS after they opened, whatever they sent since.
   */
  sweep(): void {
    const now = this.now();
    const silent = this.end?.heartbeat ? Infinity : SILENT_MS;
    for (const c of this.conns) if (c.seat ? now - c.heard > silent : now - c.opened > HELLO_MS) c.link.close();
    // A frame whose ack never came (a lost message, a phone that forgot) must not freeze that phone's picture.
    for (const s of this.online) {
      if (!s.awaiting || now - s.sentAt <= Math.max(ACK_WAIT_MS, 8 * s.ackRtt)) continue;
      s.late = { n: s.awaiting, at: s.sentAt };
      this.release(s);
    }
  }

  private accept(link: Link): void {
    // Links say hello at once, so a pile that hasn't is someone opening sockets to fill the room:
    // the oldest goes, so the squatter can't lock a real phone out. Unless it is still young: a
    // flood of fresh sockets must not push out a phone that is about to say hello, so the new link waits.
    const waiting = [...this.conns].filter((c) => !c.greeted);
    if (waiting.length >= MAX_UNGREETED) {
      if (this.now() - waiting[0].opened <= SQUATTER_MS) return link.close();
      waiting[0].link.close();
    }
    const conn: Conn = { link, opened: this.now(), heard: this.now(), greeted: false, seat: null };
    this.conns.add(conn);
    let me: Seat | null = null;
    const wall = tokenBucket(PHONE_LIMIT, this.now());
    link.onMessage((raw) => {
      // Phones are untrusted: past the size or rate limit the link closes, on every transport (the relay also checks).
      if (!wall.take(this.now()) || messageBytes(raw) > PHONE_MESSAGE_BYTES) return link.close();
      conn.heard = this.now();
      const m = parsePhoneMsg(raw);
      if (!m) return;
      if (m.t === 'hello') {
        // One seat per connection, so a single client can't fill the room.
        if (me) return;
        conn.greeted = true;
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
      // A link whose seat a newer link took (the same phone in a new tab, or back before the old one
      // closed) speaks for nobody: its late acks would be taken for the new link's.
      if (!me || me.link !== link) return;
      if (m.t === 'ping') {
        const h1 = this.now();
        this.deliver(link, { t: 'pong', c0: m.c0, h1, h2: this.now() });
        if (m.u !== undefined) me.sync = m.u;
      } else if (m.t === 'tap') {
        const now = this.now();
        if (now - me.lastTap < TAP_MS) return;
        me.lastTap = now;
        this.heard(me.seat, m);
      } else if (m.t === 'ack') this.acked(me, m.n);
      else if (m.t === 'screen') this.setScreen(me, m.aspect);
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

  private setScreen(s: Seat, aspect: number): void {
    if (s.screen === aspect) return;
    s.screen = aspect;
    this.notify();
  }

  /** A phone typed its row and seat: kept only while the seat grid is asking, and only inside its size. */
  private enterSeat(me: Seat, row: number, seat: number): void {
    const grid = this.programFor(me.seat);
    if (grid.kind !== 'grid') return;
    const entry = { row: Math.round(row), seat: Math.round(seat) };
    // Out of range is a typo or a forged message, not the nearest edge seat.
    if (entry.row < 1 || entry.row > grid.rows || entry.seat < 1 || entry.seat > grid.seats) return;
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
        s.ackRtt = 0;
        s.late = null;
        return s;
      }
    const seat = this.freeSeat();
    if (seat === null) return null;
    this.gridEntries.delete(seat);
    const s = blankSeat({ seat, token, raw: null, source: null }, link);
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
    this.notify();
  }

  private notify(): void {
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
