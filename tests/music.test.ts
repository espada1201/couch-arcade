import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneMsg } from '../src/core/protocol';
import { PAUSED, schedule, type SpeakerProgram, type Track } from '../src/core/speaker';
import { toBase64 } from '../src/net/chunks';
import type { Speaker } from '../src/phone/audio';
import type { PhoneClient } from '../src/phone/client';
import { PartySpeaker } from '../src/phone/music';
import { fakeDocument } from './harness';

const TRACK: Track = { id: 'song', name: 'Song', size: 4, n: 1, duration: 100 };

/** A running audio context that records every source it is asked to play. */
function fakeContext() {
  const node = () => ({ connect: (x: unknown) => x, disconnect: () => {}, gain: { setTargetAtTime: () => {} }, channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' });
  const sources: { start: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    state: 'running',
    currentTime: 10,
    destination: {},
    getOutputTimestamp: () => ({ contextTime: ctx.currentTime, performanceTime: performance.now() }),
    createGain: node,
    createChannelSplitter: node,
    createBufferSource: () => {
      const s = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() };
      sources.push(s);
      return s;
    },
    decodeAudioData: async () => ({ duration: TRACK.duration }),
  };
  return { ctx, sources };
}

function phone() {
  const acks: PhoneMsg[] = [];
  let offset = 50_000;
  const client = {
    program: { kind: 'lobby' } as PhoneClient['program'],
    offer: null as Track | null,
    pos: null,
    joins: 0,
    hostNow: () => performance.now() + offset,
    have: (m: PhoneMsg) => acks.push(m),
  };
  const { ctx, sources } = fakeContext();
  const speaker = { context: ctx, latency: () => 0 } as unknown as Speaker;
  const party = new PartySpeaker(client as unknown as PhoneClient, speaker);
  return { client, party, acks, sources, moveOffset: (ms: number) => (offset += ms) };
}

beforeEach(() => {
  vi.stubGlobal('document', fakeDocument().document);
  vi.stubGlobal('setInterval', () => 0);
});

afterEach(() => vi.unstubAllGlobals());

describe('the party speaker on a phone', () => {
  it('acks a new song, a rejoin and each chunk, not every program the host resends', async () => {
    const p = phone();
    p.client.offer = TRACK;
    p.party.sync();
    expect(p.acks).toEqual([{ t: 'have', id: 'song', next: 0, got: 0, state: undefined }]);
    for (let i = 0; i < 5; i++) p.party.sync();
    expect(p.acks).toHaveLength(1);
    // Reconnected: the host needs to hear where the download stands.
    p.client.joins++;
    p.party.sync();
    expect(p.acks).toHaveLength(2);
    p.party.chunk({ t: 'chunk', id: 'song', i: 0, n: 1, d: toBase64(new Uint8Array([1, 2, 3, 4])) });
    await vi.waitFor(() => expect(p.acks.at(-1)).toMatchObject({ next: 1, got: 1, state: 'ready' }));
  });

  it('lets go of a song the host withdraws, so offering it again starts a fresh download', async () => {
    const p = phone();
    p.client.offer = TRACK;
    p.party.sync();
    p.party.chunk({ t: 'chunk', id: 'song', i: 0, n: 1, d: toBase64(new Uint8Array([1, 2, 3, 4])) });
    await vi.waitFor(() => expect(p.acks.at(-1)).toMatchObject({ state: 'ready' }));
    p.client.offer = null;
    p.party.sync();
    p.client.offer = TRACK;
    p.party.sync();
    expect(p.acks.at(-1)).toEqual({ t: 'have', id: 'song', next: 0, got: 0, state: undefined });
  });

  it('a resent program is not a drift check: it does not count toward re-scheduling the song', async () => {
    const p = phone();
    const program: SpeakerProgram = { kind: 'speaker', track: TRACK, tl: schedule(PAUSED, p.client.hostNow(), 0, TRACK.duration, 'play'), volume: 1, spread: false };
    p.client.program = program;
    p.party.sync();
    p.party.chunk({ t: 'chunk', id: 'song', i: 0, n: 1, d: toBase64(new Uint8Array([1, 2, 3, 4])) });
    await vi.waitFor(() => expect(p.sources).toHaveLength(1));
    // One noisy reading's worth of error, then the host resends the same program twice.
    p.moveOffset(25);
    p.client.program = { ...program };
    p.party.sync();
    p.party.sync();
    expect(p.sources).toHaveLength(1);
  });
});
