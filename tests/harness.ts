import { vi } from 'vitest';
import type { Program } from '../src/core/effects';
import { normalize, type Point } from '../src/core/layout';
import type { HostMsg, PhoneMsg } from '../src/core/protocol';
import { Director } from '../src/host/director';
import { HostSession } from '../src/host/session';
import { BasicLink, type HostEnd, type Link, type Transport } from '../src/net/transport';

/** In-memory transport: `accept` hands the host a new link, `server` reports the relay up or down. */
export function testTransport() {
  let accept: (l: Link) => void = () => {};
  let server: (up: boolean) => void = () => {};
  const transport: Transport = {
    name: 'test',
    host: async (): Promise<HostEnd> => ({ onLink: (cb) => (accept = cb), onServer: (cb) => (server = cb), close: () => {} }),
    join: async () => {
      throw new Error('unused');
    },
  };
  return { transport, accept: (l: Link) => accept(l), server: (up: boolean) => server(up) };
}

/** A Map-backed stand-in for localStorage. */
export function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

/** Room space for phones at the given raw points, seated 0, 1, 2… in order. */
export function roomOf(points: [number, number][]) {
  return normalize(new Map(points.map(([x, y], i) => [i, { x, y } as Point])));
}

/** A real HostSession over an in-memory transport, with phones placed across one row. */
export async function room(xs: number[]) {
  const { transport, accept } = testTransport();
  let clock = 1000;
  const session = new HostSession(transport, 'TEST', () => clock);
  await session.open();
  const join = (token: string) => {
    const inbox: HostMsg[] = [];
    const link = new BasicLink((m) => inbox.push(m as HostMsg));
    accept(link);
    link.deliver({ t: 'hello', token });
    const say = (m: PhoneMsg) => link.deliver(m);
    return { inbox, say, tap: () => say({ t: 'tap' }), drop: () => link.ended() };
  };
  const phones = xs.map((_, i) => join(`p${i}`));
  session.setRaw(new Map(xs.map((x, i) => [i, { x, y: 0.5 }])), 'camera');
  const say = vi.fn();
  const director = new Director(session);
  vi.spyOn(director, 'run');
  return { session, phones, join, say, tick: (ms: number) => (clock += ms), director };
}

/** The last program of `kind` a phone was sent. */
export function lastProgram<K extends Program['kind']>(inbox: HostMsg[], kind: K): Extract<Program, { kind: K }> | null {
  for (let i = inbox.length - 1; i >= 0; i--) {
    const m = inbox[i];
    if (m.t === 'program' && m.program.kind === kind) return m.program as Extract<Program, { kind: K }>;
  }
  return null;
}

/** Just enough of an element for UI code under test: text, flags, attributes, listeners and children. */
function fakeElement() {
  const listeners = new Map<string, (() => unknown)[]>();
  const el = {
    className: '',
    textContent: '' as string | null,
    hidden: false,
    checked: false,
    href: '',
    download: '',
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    attrs: {} as Record<string, string>,
    kids: [] as unknown[],
    setAttribute: (k: string, v: string) => ((el.attrs[k] = v), k === 'hidden' && (el.hidden = true)),
    addEventListener: (type: string, cb: () => unknown) => listeners.set(type, [...(listeners.get(type) ?? []), cb]),
    append: (...kids: unknown[]) => el.kids.push(...kids),
    fire: async (type: string) => {
      for (const cb of listeners.get(type) ?? []) await cb();
    },
  };
  return el;
}
export type FakeElement = ReturnType<typeof fakeElement>;

/** A stand-in `document` whose createElement makes fake elements, kept in `made` in creation order. */
export function fakeDocument() {
  const made: FakeElement[] = [];
  return { made, document: { createElement: () => (made.push(fakeElement()), made.at(-1)) } };
}
