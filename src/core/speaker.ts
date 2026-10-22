// Party Speaker: the room's phones play one track together. Where the track should be is
// a pure function of a short timeline of keyframes on the shared host clock, so play,
// pause and seek all land on every phone at the same instant, and a phone that joins
// late (or whose audio clock drifts) can always work out where it ought to be.
import type { Point } from './layout';
import { clamp } from './math';

export interface Track {
  id: string;
  name: string;
  /** Bytes, and how many chunks they travel in. */
  size: number;
  n: number;
  /** Seconds. */
  duration: number;
}

/** From host time `at` on, the track is at `pos` seconds and running (or held). */
export interface Keyframe {
  at: number;
  pos: number;
  playing: boolean;
}

/** Keyframes in time order; the first one also covers everything before it. */
export type Timeline = Keyframe[];

export interface SpeakerProgram {
  kind: 'speaker';
  track: Track | null;
  tl: Timeline;
  /** 0..1, the same for the whole room. */
  volume: number;
  /** Left of the room plays the left channel, right plays the right. */
  spread: boolean;
}

export const PAUSED: Timeline = [{ at: 0, pos: 0, playing: false }];


function keyframeAt(tl: Timeline, t: number): Keyframe {
  let k = tl[0];
  for (const x of tl) if (x.at <= t) k = x;
  return k;
}

/** Track position (s) at host time t. */
export function positionAt(tl: Timeline, t: number, duration: number): number {
  const k = keyframeAt(tl, t);
  return clamp(k.playing && t > k.at ? k.pos + (t - k.at) / 1000 : k.pos, 0, duration);
}

/** Whether sound is coming out at host time t. */
export function playingAt(tl: Timeline, t: number, duration: number): boolean {
  return keyframeAt(tl, t).playing && positionAt(tl, t, duration) < duration;
}

export type Command = 'play' | 'pause' | { seek: number };

/**
 * Add a command that takes effect `lead` ms from `now` (never before an earlier command
 * that is still pending, so presses queue in the order they were made).
 */
export function schedule(tl: Timeline, now: number, lead: number, duration: number, cmd: Command): Timeline {
  const at = Math.max(now + lead, tl[tl.length - 1].at);
  const pos = positionAt(tl, at, duration);
  const playing = keyframeAt(tl, at).playing;
  const next: Keyframe =
    cmd === 'play'
      ? { at, pos: pos >= duration ? 0 : pos, playing: true }
      : cmd === 'pause'
        ? { at, pos, playing: false }
        : { at, pos: clamp(cmd.seek, 0, duration), playing };
  const out = [...tl, next];
  // Drop keyframes already superseded by now: the program stays a few dozen bytes.
  while (out.length > 1 && out[1].at <= now) out.shift();
  return out;
}

/**
 * A stretch of playback in host time: from `from` until `until` the track sounds with
 * position 0 falling at `anchor`, i.e. position(t) = (t - anchor) / 1000.
 */
export interface Segment {
  anchor: number;
  from: number;
  until: number;
}

/** The playing stretches of the timeline from host time `from` on. */
export function segments(tl: Timeline, duration: number, from: number): Segment[] {
  const out: Segment[] = [];
  tl.forEach((k, i) => {
    if (!k.playing) return;
    const anchor = k.at - k.pos * 1000;
    const start = Math.max(from, k.at);
    const until = Math.min(tl[i + 1]?.at ?? Infinity, anchor + duration * 1000);
    if (start < until) out.push({ anchor, from: start, until });
  });
  return out;
}

/** How far (ms) a source's anchor may stray before it is re-scheduled. */
export const DRIFT_TOLERANCE_MS = 20;

export interface Decision {
  /** Keep the sounding source for this stretch (stop it at `until`); null means stop it now. */
  keep: Segment | null;
  /** New sources to schedule. */
  start: Segment[];
}

/**
 * What a phone should do at host time `now`, given the anchor its sounding source really has
 * (measured through its own audio clock). Audio clocks drift against the system clock, and the
 * clock offset estimate moves too; once the error passes the tolerance the source is replaced.
 */
export function reconcile(tl: Timeline, duration: number, now: number, sounding: { anchor: number } | null): Decision {
  const segs = segments(tl, duration, now);
  const first = segs[0];
  if (sounding && first && first.from <= now && Math.abs(sounding.anchor - first.anchor) <= DRIFT_TOLERANCE_MS) return { keep: first, start: segs.slice(1) };
  return { keep: null, start: segs };
}

export type Channel = 'stereo' | 'left' | 'right' | 'mono';

/** Which part of the mix a phone plays. A lone placed phone sits at the centre and plays mono. */
export function channelFor(pos: Point | null, spread: boolean): Channel {
  if (!spread) return 'stereo';
  if (!pos || pos.x === 0.5) return 'mono';
  return pos.x < 0.5 ? 'left' : 'right';
}

/** 25 MB: a long song at high quality, and a sane amount to send to every phone over the room's own link. */
export const MAX_TRACK_BYTES = 25 * 1024 * 1024;

/**
 * Every phone holds the whole song decoded in memory, about 10 MB a minute (stereo, 32-bit
 * float at 44.1 kHz), however small the file. Past 12 minutes (about 120 MB) older phones
 * start to fail, so a longer track is refused, using the duration the host's probe reads.
 */
export const MAX_TRACK_SECONDS = 12 * 60;

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg)$/i;

/** Why a picked file can't be played, or null if it looks fine. */
export function audioFileProblem(name: string, type: string, size: number): string | null {
  if (!AUDIO_EXT.test(name) && !type.startsWith('audio/')) return 'Pick an audio file: MP3, M4A, WAV or OGG.';
  if (size === 0) return 'That file is empty.';
  if (size > MAX_TRACK_BYTES)
    return `That file is ${(size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB, so it reaches every phone quickly: try a lower-bitrate MP3.`;
  return null;
}

/** Why a track is too long to play on every phone, or null if it fits. */
export function durationProblem(seconds: number): string | null {
  if (seconds <= MAX_TRACK_SECONDS) return null;
  return `That track is ${clockTime(seconds)} long. The limit is ${MAX_TRACK_SECONDS / 60} minutes, because every phone holds the whole song unpacked in memory: pick one song rather than a mix.`;
}

/** 65 -> "1:05". */
export function clockTime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
