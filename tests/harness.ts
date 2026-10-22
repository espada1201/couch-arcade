import { vi } from 'vitest';
import type { Program } from '../src/core/effects';
import type { HostMsg, PhoneMsg } from '../src/core/protocol';
import { Director } from '../src/host/director';
import { HostSession } from '../src/host/session';
import { BasicLink, type HostEnd, type Link, type Transport } from '../src/net/transport';

/** A real HostSession over an in-memory transport, with phones placed across one row. */
export async function room(xs: number[]) {
  let accept: (l: Link) => void = () => {};
  const transport: Transport = {
    name: 'test',
    host: async (): Promise<HostEnd> => ({ onLink: (cb) => (accept = cb), close: () => {} }),
    join: async () => {
      throw new Error('unused');
    },
  };
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
  const director = new Director(session, { onPick: null });
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
