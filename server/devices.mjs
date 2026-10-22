// Which device on the Wi-Fi a socket comes from, and how many sockets each may hold.

const LOOPBACK = /^(::ffff:)?127\.|^::1$/;
const MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/**
 * One device, as one string: its address, with an IPv4-mapped address as the IPv4 one and an IPv6
 * zone id dropped. Not the IPv6 /64: every device on a home Wi-Fi shares that. A socket that reset
 * before its address was read has none, and is ''.
 */
export function deviceKey(addr = '') {
  return MAPPED.exec(addr)?.[1] ?? addr.split('%')[0];
}

/**
 * Phone sockets and hosted rooms one device may hold, so one guest can't fill the relay. The
 * computer running the relay is not capped: its own tabs, or a proxy in front of it.
 */
export function deviceLedger(limit) {
  /** device -> { phones, hosts } open from it now. */
  const open = new Map();
  const held = (device) => open.get(device) ?? { phones: 0, hosts: 0 };
  return {
    crowded: (addr, role) => !LOOPBACK.test(addr) && held(deviceKey(addr))[`${role}s`] >= limit,
    /** Count a socket from `addr` while it stays open. */
    track(ws, addr, role) {
      if (LOOPBACK.test(addr)) return;
      const device = deviceKey(addr);
      const k = `${role}s`;
      open.set(device, { ...held(device), [k]: held(device)[k] + 1 });
      ws.on('close', () => {
        const d = { ...held(device), [k]: held(device)[k] - 1 };
        if (d.phones || d.hosts) open.set(device, d);
        else open.delete(device);
      });
    },
  };
}
