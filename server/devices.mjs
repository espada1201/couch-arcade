// Which device on the Wi-Fi a socket comes from, and how many sockets each may hold.

const LOOPBACK = /^(::ffff:)?127\.|^::1$/;
const MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/**
 * One device, as one string. An IPv6 device holds a whole /64 of addresses (and rotates among them
 * for privacy), so it is keyed by the /64; an IPv4-mapped address is the IPv4 one.
 */
export function deviceKey(addr) {
  const mapped = MAPPED.exec(addr);
  if (mapped) return mapped[1];
  if (!addr.includes(':')) return addr;
  const [head, tail] = addr.split('%')[0].split('::');
  const groups = (s) => (s ? s.split(':') : []);
  const first = groups(head);
  const last = groups(tail);
  const all = tail === undefined ? first : [...first, ...Array(8 - first.length - last.length).fill('0'), ...last];
  return `${all.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
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
