import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { deviceKey, deviceLedger } from '../server/devices.mjs';

describe('deviceKey', () => {
  it('keys an IPv6 device by its own address, since every device on a home Wi-Fi shares one /64', () => {
    expect(deviceKey('2001:db8:1:2::a')).not.toBe(deviceKey('2001:db8:1:2::b'));
    expect(deviceKey('fe80::1%en0')).toBe('fe80::1');
  });

  it('keys a socket that has already gone, with no address, as nothing rather than throwing', () => {
    expect(deviceKey(undefined)).toBe('');
  });

  it('keys an IPv4 device, mapped or not, by its address', () => {
    expect(deviceKey('192.168.1.7')).toBe('192.168.1.7');
    expect(deviceKey('::ffff:192.168.1.7')).toBe('192.168.1.7');
  });
});

describe('deviceLedger', () => {
  const socket = () => new EventEmitter();

  it('counts phones and hosts apart, per device, and frees a socket when it closes', () => {
    const ledger = deviceLedger(2);
    const a = [socket(), socket()];
    for (const ws of a) ledger.track(ws, '192.168.1.7', 'phone');
    expect(ledger.crowded('192.168.1.7', 'phone')).toBe(true);
    expect(ledger.crowded('192.168.1.7', 'host')).toBe(false);
    expect(ledger.crowded('192.168.1.8', 'phone')).toBe(false);
    a[0].emit('close');
    expect(ledger.crowded('192.168.1.7', 'phone')).toBe(false);
  });

  it('lets twenty phones on one IPv6 home network in, one socket each', () => {
    const ledger = deviceLedger(16);
    for (let i = 1; i <= 20; i++) {
      expect(ledger.crowded(`2001:db8:1:2::${i.toString(16)}`, 'phone')).toBe(false);
      ledger.track(socket(), `2001:db8:1:2::${i.toString(16)}`, 'phone');
    }
  });

  it('does not throw for a socket that reset before its address was read', () => {
    const ledger = deviceLedger(1);
    expect(() => ledger.crowded(undefined, 'phone')).not.toThrow();
    expect(() => ledger.track(socket(), undefined, 'phone')).not.toThrow();
  });

  it('never caps the computer itself', () => {
    const ledger = deviceLedger(1);
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      ledger.track(socket(), addr, 'phone');
      ledger.track(socket(), addr, 'phone');
      expect(ledger.crowded(addr, 'phone')).toBe(false);
    }
  });
});
