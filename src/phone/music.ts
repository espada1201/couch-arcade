// This phone's part in the Party Speaker: download the host's song, decode it, and play
// it so that it leaves the speaker exactly when the shared timeline says. The schedule
// is re-checked every couple of seconds, because the audio clock drifts against the
// system clock (and the clock-offset estimate moves); the decision itself is pure, in
// core/speaker.ts.
import { audioClock, channelFor, clockTime, PAUSED, playingAt, positionAt, reconcile, startPoint, type AudioClock, type Channel, type Segment, type SpeakerProgram, type Track } from '../core/speaker';
import { Reassembler, type ChunkMsg } from '../net/chunks';
import { h, setText } from '../ui/dom';
import { stop, type Speaker } from './audio';
import type { PhoneClient } from './client';

/** Audio changes are scheduled at least this far ahead of now (plus output latency). */
const MARGIN_MS = 100;
/** How often to compare where the track is with where it should be. */
const CHECK_MS = 2000;

/** One scheduled stretch of the song on this phone's audio clock. */
interface Voice {
  node: AudioBufferSourceNode;
  /** Audio-clock time the node starts, and the track offset (s) it starts from. */
  ctxFrom: number;
  offset: number;
  seg: Segment;
  /** Drift checks in a row this voice has been out of tolerance. */
  strikes: number;
}

type Load = 'loading' | 'decoding' | 'ready' | 'error';

/** Host time now, and the mapping to this phone's audio clock, sampled once. */
type Clocks = AudioClock & { hostNow: number };

export class PartySpeaker {
  readonly el: HTMLElement;
  private track: Track | null = null;
  private asm: Reassembler | null = null;
  private buffer: AudioBuffer | null = null;
  private load: Load = 'loading';
  private voices: Voice[] = [];
  private applied = '';
  private ackedJoins = 0;
  private lastCheck = 0;
  private master: GainNode | null = null;
  private input: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private channel: Channel | null = null;
  private volume = -1;
  private readonly title = h('p.np-title');
  private readonly fill = h('div.np-fill');
  private readonly bar = h('div.np-bar', { role: 'progressbar', 'aria-label': 'Song position', 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.fill);
  private readonly time = h('p.np-time');
  private readonly state = h('p.np-state', { role: 'status' });

  constructor(
    private readonly client: PhoneClient,
    private readonly speaker: Speaker,
  ) {
    this.el = h('section.nowplaying', { hidden: true, 'aria-label': 'Now playing' }, h('p.np-eyebrow', {}, 'Party speaker'), this.title, this.bar, this.time, this.state);
    setInterval(() => this.tick(), 250);
  }

  private get program(): SpeakerProgram | null {
    const p = this.client.program;
    return p.kind === 'speaker' ? p : null;
  }

  /** The client changed (new program, an offer, a reconnect): pick up a new song, and ack it or a rejoin, which resumes a download. */
  sync(): void {
    // The song playing, or the one the host has offered: phones fetch it in the background before Play.
    const t = this.program?.track ?? this.client.offer;
    const fresh = t && t.id !== this.track?.id;
    if (fresh) {
      this.silence();
      this.track = t;
      this.asm = new Reassembler(t.n);
      this.buffer = null;
      this.load = 'loading';
    }
    if (t && (fresh || this.client.joins !== this.ackedJoins)) this.ack();
    this.tick();
  }

  chunk(m: ChunkMsg): void {
    const asm = this.asm;
    if (!asm || m.id !== this.track?.id) return;
    asm.add(m.i, m.d);
    if (!asm.done) return this.ack();
    // Joined, then let go of, before the decode: the song is held once, not twice, while it unpacks.
    this.asm = null;
    void this.decode(asm.bytes());
  }

  private async decode(bytes: Uint8Array): Promise<void> {
    const track = this.track!;
    this.load = 'decoding';
    this.ack();
    const ctx = this.speaker.context;
    try {
      if (!ctx) throw new Error('No audio on this phone');
      const buffer = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
      if (this.track !== track) return;
      this.buffer = buffer;
      this.load = 'ready';
    } catch {
      if (this.track !== track) return;
      this.load = 'error';
    }
    this.ack();
    this.tick();
  }

  private ack(): void {
    const t = this.track;
    if (!t) return;
    this.ackedJoins = this.client.joins;
    const asm = this.asm;
    this.client.have({
      t: 'have',
      id: t.id,
      next: asm ? asm.next : t.n,
      got: asm ? asm.got : t.n,
      state: this.load === 'ready' ? 'ready' : this.load === 'error' ? 'error' : undefined,
    });
  }

  private clocks(ctx: AudioContext): Clocks {
    const perfNow = performance.now();
    const hostNow = this.client.hostNow();
    const clock = audioClock({
      stamp: ctx.getOutputTimestamp?.(),
      currentTime: ctx.currentTime,
      perfNow,
      latency: this.speaker.latency(),
      hostOffset: hostNow - perfNow,
    });
    return { ...clock, hostNow };
  }

  /** Host time at which position 0 of the track is heard, judging by the voice's real schedule. */
  private anchorOf(v: Voice, c: Clocks): number {
    return c.toHost(v.ctxFrom) - v.offset * 1000;
  }

  /** Re-plans when the timeline or the song changes (silence() clears `applied`), and checks drift every CHECK_MS. */
  private tick(): void {
    const p = this.program;
    const ctx = this.speaker.context;
    const ok = p && this.buffer && p.track?.id === this.track?.id;
    // A suspended context (a call, a locked phone) stops its clock, so its sources would resume late: start afresh instead.
    if (!ok || !ctx || ctx.state !== 'running') this.silence();
    else {
      this.route(ctx, p);
      const key = JSON.stringify(p.tl);
      const now = performance.now();
      if (key !== this.applied || now - this.lastCheck > CHECK_MS) {
        this.applied = key;
        this.lastCheck = now;
        this.schedule(ctx, p, this.buffer!);
      }
    }
    this.render();
  }

  private schedule(ctx: AudioContext, p: SpeakerProgram, buffer: AudioBuffer): void {
    const c = this.clocks(ctx);
    const at = c.hostNow + MARGIN_MS + this.speaker.latency() * 1000;
    this.voices = this.voices.filter((v) => v.seg.until > c.hostNow);
    const sounding = this.voices.find((v) => v.seg.from <= at && at < v.seg.until) ?? null;
    const d = reconcile(p.tl, buffer.duration, at, sounding && { planned: sounding.seg.anchor, anchor: this.anchorOf(sounding, c), strikes: sounding.strikes });
    const kept = d.keep ? sounding : null;
    for (const v of this.voices) if (v !== kept) stop(v.node, c.toCtx(at));
    this.voices = [];
    if (kept && d.keep) {
      kept.seg = d.keep;
      kept.strikes = d.strikes;
      stop(kept.node, c.toCtx(d.keep.until));
      this.voices.push(kept);
    }
    for (const seg of d.start) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.input!);
      const { when, offset } = startPoint(c.toCtx(seg.from), (seg.from - seg.anchor) / 1000, ctx.currentTime);
      node.start(when, offset);
      stop(node, c.toCtx(seg.until));
      this.voices.push({ node, ctxFrom: when, offset, seg, strikes: 0 });
    }
  }

  /** Volume and which channel this phone plays; rewired only when they change. */
  private route(ctx: AudioContext, p: SpeakerProgram): void {
    if (!this.master || !this.input) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      // Always two channels in, so a mono song still feeds both sides of the split.
      this.input = ctx.createGain();
      this.input.channelCount = 2;
      this.input.channelCountMode = 'explicit';
      this.input.channelInterpretation = 'speakers';
    }
    const master = this.master;
    if (p.volume !== this.volume) {
      this.volume = p.volume;
      master.gain.setTargetAtTime(p.volume, ctx.currentTime, 0.05);
    }
    const ch = channelFor(this.client.pos, p.spread);
    if (ch === this.channel) return;
    this.channel = ch;
    this.input.disconnect();
    this.splitter?.disconnect();
    this.splitter = null;
    // Mono: fold both channels into one, which the speaker then plays on both sides.
    master.channelCount = ch === 'mono' ? 1 : 2;
    master.channelCountMode = ch === 'mono' ? 'explicit' : 'max';
    if (ch === 'left' || ch === 'right') {
      this.splitter = ctx.createChannelSplitter(2);
      this.input.connect(this.splitter);
      this.splitter.connect(master, ch === 'left' ? 0 : 1);
    } else this.input.connect(master);
  }

  private silence(): void {
    for (const v of this.voices) stop(v.node, 0);
    this.voices = [];
    this.applied = '';
  }

  /** The card shows only while the host plays to the room, but its state is kept up to date for the download in the background. */
  private render(): void {
    const p = this.program;
    this.el.hidden = !p;
    const t = this.track;
    const tl = p?.tl ?? PAUSED;
    const ctx = this.speaker.context;
    const hostNow = this.client.hostNow();
    let state: string;
    let text: string;
    if (!t) [state, text] = ['waiting', 'Waiting for the host to pick a song'];
    else if (this.load === 'loading') [state, text] = ['loading', `Downloading the song… ${Math.floor(((this.asm?.got ?? 0) / t.n) * 100)}%`];
    else if (this.load === 'decoding') [state, text] = ['decoding', 'Getting the song ready…'];
    else if (this.load === 'error') [state, text] = ['error', 'This phone can’t play this file.'];
    else if (!ctx || ctx.state !== 'running') [state, text] = ['muted', 'Tap the screen to turn the sound on'];
    else if (playingAt(tl, hostNow, t.duration)) [state, text] = ['playing', `Playing${{ left: ' · left channel', right: ' · right channel', mono: '', stereo: '' }[this.channel ?? 'stereo']}`];
    else [state, text] = ['ready', positionAt(tl, hostNow, t.duration) > 0 ? 'Paused' : 'Ready. Keep this page open with the sound up.'];
    setText(this.title, t?.name ?? '');
    setText(this.state, text);
    this.el.dataset.state = state;
    const pos = t ? positionAt(tl, hostNow, t.duration) : 0;
    const pct = t && t.duration > 0 ? (pos / t.duration) * 100 : 0;
    this.fill.style.width = `${pct}%`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    setText(this.time, t ? `${clockTime(pos)} / ${clockTime(t.duration)}` : '');
    // For tests and debugging: where this phone's audio really is, in shared host time.
    const sounding = ctx && this.voices.find((v) => v.seg.from <= hostNow && hostNow < v.seg.until);
    if (sounding) {
      const c = this.clocks(ctx);
      this.el.dataset.anchor = this.anchorOf(sounding, c).toFixed(1);
      this.el.dataset.pos = ((c.hostNow - this.anchorOf(sounding, c)) / 1000).toFixed(3);
    } else {
      delete this.el.dataset.anchor;
      delete this.el.dataset.pos;
    }
  }
}
