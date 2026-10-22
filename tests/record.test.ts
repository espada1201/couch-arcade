import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recorder } from '../src/host/record';
import { fakeDocument, type FakeElement } from './harness';

const flush = () => new Promise((r) => setTimeout(r, 0));

let made: FakeElement[];
let failures: { construct: number; start: number };
let recorders: FakeRecorder[];

class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'video/webm';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    if (failures.construct-- > 0) throw new Error('This recorder cannot film');
    recorders.push(this);
  }
  start() {
    if (failures.start-- > 0) throw new Error('Recorder is busy');
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['frames']) });
    this.onstop?.();
  }
}

beforeEach(() => {
  const doc = fakeDocument();
  made = doc.made;
  recorders = [];
  failures = { construct: 0, start: 0 };
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', doc.document);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  const track = { readyState: 'live', stop: () => {} };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getVideoTracks: () => [track], getTracks: () => [track] }) } });
});

afterEach(() => vi.unstubAllGlobals());

/** A recorder with its box ticked, and its status line. */
async function ticked() {
  const rec = recorder()!;
  const [box, status] = made;
  box.checked = true;
  await box.fire('change');
  return { rec, status };
}

describe('the keepsake recorder', () => {
  it('a recorder that refuses to start says why, and the next moment still films', async () => {
    failures.start = 1;
    const { rec, status } = await ticked();
    rec.begin();
    await flush();
    expect(status.textContent).toMatch(/Couldn’t record: Recorder is busy/);
    rec.begin();
    await flush();
    expect(status.textContent).toBe('● Recording the moment…');
  });

  it('a recorder that cannot be made says why, and the next moment still films', async () => {
    failures.construct = 1;
    const { rec, status } = await ticked();
    rec.begin();
    await flush();
    expect(status.textContent).toMatch(/Couldn’t record: This recorder cannot film/);
    rec.begin();
    await flush();
    expect(status.textContent).toBe('● Recording the moment…');
  });

  it('a recording the browser stops on its own still leaves the keepsake, and the next moment films again', async () => {
    const { rec, status } = await ticked();
    rec.begin();
    await flush();
    recorders[0].stop();
    expect(status.textContent).toMatch(/^Recorded\./);
    rec.begin();
    await flush();
    expect(recorders).toHaveLength(2);
    expect(status.textContent).toBe('● Recording the moment…');
  });
});
