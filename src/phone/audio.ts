// Each phone is one speaker in the array. Sound is scheduled ahead on the Web Audio
// clock at the exact host-time instant the wave front reaches this phone, so a sweep
// physically travels across the room instead of everyone beeping at once.
import { arrivals, travel, noteFor, type Program, type Voice } from '../core/effects';
import type { Point } from '../core/layout';

const LOOKAHEAD_MS = 1200;

export class Speaker {
  private ctx: AudioContext | null = null;
  private scheduledUntil = 0;
  private lastProgram: Program | null = null;

  /** Must be called from a user gesture (the join tap) or browsers keep audio muted. */
  unlock(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Call every ~200 ms with the current program; schedules notes inside the look-ahead window. */
  pump(prog: Program, pos: Point | null, aspect: number, hostNow: number): void {
    const ctx = this.ctx;
    if (prog !== this.lastProgram) {
      this.lastProgram = prog;
      this.scheduledUntil = hostNow;
    }
    if (!ctx || prog.kind !== 'wave' || prog.voice === 'off' || !pos) return;
    const from = Math.max(this.scheduledUntil, hostNow);
    const to = hostNow + LOOKAHEAD_MS;
    const u = travel(prog, pos, aspect);
    for (const t of arrivals(prog, u, from, to)) this.note(prog.voice, noteFor(pos), ctx.currentTime + (t - hostNow) / 1000);
    this.scheduledUntil = to;
  }

  /** Short feedback sound for game taps. */
  blip(kind: 'tap' | 'catch' | 'burn' | 'win'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    if (kind === 'burn') return this.noise(t, 0.5);
    const voice: Voice = kind === 'tap' ? 'drum' : 'bell';
    this.note(voice, kind === 'win' ? 81 : kind === 'catch' ? 74 : 45, t);
  }

  private note(voice: Voice, midi: number, at: number): void {
    const ctx = this.ctx!;
    if (at < ctx.currentTime) return;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const env = out.gain;
    env.setValueAtTime(0.0001, at);
    if (voice === 'drum') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 2, at);
      o.frequency.exponentialRampToValueAtTime(f / 2, at + 0.18);
      env.exponentialRampToValueAtTime(0.9, at + 0.005);
      env.exponentialRampToValueAtTime(0.0001, at + 0.35);
      o.connect(out);
      o.start(at);
      o.stop(at + 0.4);
      return;
    }
    const partials = voice === 'bell' ? [1, 2.76, 5.4] : [1, 2];
    const decay = voice === 'bell' ? 1.6 : 0.45;
    env.exponentialRampToValueAtTime(0.5, at + 0.006);
    env.exponentialRampToValueAtTime(0.0001, at + decay);
    partials.forEach((k, i) => {
      const o = ctx.createOscillator();
      o.type = voice === 'pluck' ? 'triangle' : 'sine';
      o.frequency.value = f * k;
      const g = ctx.createGain();
      g.gain.value = 1 / (i + 1) ** 1.5;
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + decay + 0.05);
    });
  }

  private noise(at: number, dur: number): void {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.4;
    src.connect(g).connect(ctx.destination);
    src.start(at);
  }
}
