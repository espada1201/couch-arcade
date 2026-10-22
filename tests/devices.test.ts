import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { deviceKey, deviceLedger } from '../server/devices.mjs';

describe('deviceKey', () => {
  it('keys an IPv6 device by its /64, however the address is written', () => {
    const key = deviceKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(deviceKey('2001:db8:1:2::1')).toBe(key);
    expect(deviceKey('2001:0db8:0001:0002:0000:0000:0000:0042')).toBe(key);
    expect(deviceKey('2001:db8:1:3::1')).not.toBe(key);
  });

  it('expands :: at the start, middle and end, and drops a zone id', () => {
    expect(deviceKey('::1')).toBe('0:0:0:0::/64');
    expect(deviceKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(deviceKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(deviceKey('1:2:3:4:5:6:7:8')).toBe('1:2:3:4::/64');
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

  it('counts the addresses of one IPv6 /64 as one device', () => {
    const ledger = deviceLedger(2);
    ledger.track(socket(), '2001:db8:1:2::a', 'phone');
    ledger.track(socket(), '2001:db8:1:2::b', 'phone');
    expect(ledger.crowded('2001:db8:1:2::c', 'phone')).toBe(true);
    expect(ledger.crowded('2001:db8:1:9::c', 'phone')).toBe(false);
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
