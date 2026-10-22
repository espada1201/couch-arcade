// `npm start`: serves the built app and a tiny WebSocket relay so phones on the same
// Wi-Fi can join with no internet connection. One host per room; phones talk only to it.
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { deviceLedger } from './devices.mjs';
import { serveStatic } from './static.mjs';
import { tombstones } from './tombs.mjs';
import { PHONE_LIMIT, PHONE_MESSAGE_BYTES, tokenBucket } from '../src/net/limits.js';

const PORT = Number(process.env.PORT) || 4321;
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));

// Prefer the Wi-Fi/Ethernet adapter (en0/en1 on a Mac) over VPN tunnels and bridges.
function lanAddress() {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address })),
  );
  const rank = (n) => (/^(en|eth|wl)/.test(n) ? 0 : /^(utun|tun|tap|bridge|vbox|docker|vmnet)/.test(n) ? 2 : 1);
  all.sort((a, b) => rank(a.name) - rank(b.name));
  return all[0]?.address ?? 'localhost';
}

const lanUrl = `http://${lanAddress()}:${PORT}/`;

function parseUrl(raw) {
  try {
    const url = new URL(raw ?? '/', 'http://x');
    return { url, path: decodeURIComponent(url.pathname) };
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const parsed = parseUrl(req.url);
  if (!parsed) {
    res.writeHead(400);
    return res.end();
  }
  const { path } = parsed;
  // The browser hides why a WebSocket was refused, so a host asks here: 204 means it would be let in.
  if (path === '/relay') {
    const q = parsed.url.searchParams;
    const status = admit(q.get('room') ?? '', q.get('role') === 'host' ? 'host' : 'phone', q.get('key') ?? '', req.socket.remoteAddress);
    res.writeHead(status ? Number(status.slice(0, 3)) : 204, { 'cache-control': 'no-store' });
    return res.end();
  }
  if (path === '/relay.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ lanUrl }));
  }
  serveStatic(res, ROOT, path);
});

const MAX_ROOMS = 64;
const MAX_PHONES = 200;
/** Per device on the Wi-Fi. 16 because one address can be many phones: double NAT, an extender, Docker or WSL, a family's tabs. */
const devices = deviceLedger(Number(process.env.RELAY_PER_DEVICE) || 16);
const ROOM = /^[A-Z0-9]{3,12}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * A host that dropped (a reload, a laptop asleep, a Wi-Fi blip) gets this long to come back for its
 * room before another host may take the code. A room that never had a phone and lasted under 5 s
 * is not held, and no more than MAX_ROOMS are, so churning room codes cannot grow the list.
 */
const tombs = tombstones({ max: MAX_ROOMS, holdMs: Number(process.env.RELAY_TOMB_MS) || 10 * 60_000, minLifeMs: 5000 });

/** room -> { host: WebSocket, key: string, born: ms, hadPhone: boolean, phones: Map<id, WebSocket> }; exists only while a host is attached. */
const rooms = new Map();
let nextId = 1;
// Hosts send frames and song chunks of up to 60 KB; phones send only small control messages.
const servers = { host: new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 }), phone: new WebSocketServer({ noServer: true, maxPayload: PHONE_MESSAGE_BYTES }) };

// Refusing before the upgrade makes the browser's WebSocket fail to open, so join() rejects instead of retrying.
function refuse(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  const url = parseUrl(req.url)?.url;
  if (url?.pathname !== '/relay') return refuse(socket, '404 Not Found');
  const q = url.searchParams;
  const room = q.get('room') ?? '';
  const role = q.get('role') === 'host' ? 'host' : 'phone';
  const key = q.get('key') ?? '';
  const addr = req.socket.remoteAddress;
  const status = admit(room, role, key, addr);
  if (status) return refuse(socket, status);
  servers[role].handleUpgrade(req, socket, head, (ws) => {
    ws.on('error', () => ws.terminate());
    ws.answered = Date.now();
    ws.on('pong', () => (ws.answered = Date.now()));
    // Re-check: the room may have changed while the handshake completed.
    if (admit(room, role, key, addr)) return ws.close(1013, 'refused');
    devices.track(ws, addr, role);
    if (role === 'host') attachHost(ws, room, key);
    else attachPhone(ws, rooms.get(room));
  });
});

/** Returns an HTTP status line if the connection from `addr` must be refused. */
function admit(room, role, key, addr) {
  if (!ROOM.test(room)) return '400 Bad Request';
  const r = rooms.get(room);
  const crowded = devices.crowded(addr, role);
  if (role === 'host') {
    if (!KEY.test(key)) return '400 Bad Request';
    if (r) return r.key === key ? null : '409 Conflict';
    const holder = tombs.heldFor(room);
    if (holder && holder !== key) return '409 Conflict';
    if (crowded) return '429 Too Many Requests';
    // A host back for the code held for it gets in even when the relay is full: the code was its own.
    return rooms.size >= MAX_ROOMS && !holder ? '503 Service Unavailable' : null;
  }
  if (!r) return '404 Not Found';
  if (crowded) return '429 Too Many Requests';
  return r.phones.size >= MAX_PHONES ? '503 Service Unavailable' : null;
}

const MSG = /^\{"t":"(msg|all)","(?:id|ids)":("[0-9]+"|\["[0-9]+"(?:,"[0-9]+")*\]),"data":/;

/**
 * A host message: the phones it names, and for `msg` and `all` the data as the raw JSON text the
 * host wrote, so a 60 KB song chunk or frame is passed on without being parsed and re-encoded.
 * `close` has no data. Anything else is dropped.
 */
function envelope(raw) {
  const m = MSG.exec(raw);
  if (m && raw.endsWith('}')) {
    const ids = JSON.parse(m[2]);
    return { ids: Array.isArray(ids) ? ids : [ids], data: raw.slice(m[0].length, -1) };
  }
  const c = parse(raw);
  return c?.t === 'close' && typeof c.id === 'string' ? { ids: [c.id] } : null;
}

/** JSON from a socket, or undefined when it does not parse (JSON itself has no undefined). */
function parse(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return undefined;
  }
}

function attachHost(ws, room, key) {
  let r = rooms.get(room);
  if (r) {
    // The same host page in a new tab (or back after a blip the relay missed). Its phones said
    // hello to the old tab, so 1012 sends them to reconnect and say hello to this one.
    r.host.close(1000, 'replaced');
    for (const p of r.phones.values()) p.close(1012, 'host moved');
    r.phones.clear();
  } else rooms.set(room, (r = { host: ws, key, born: Date.now(), hadPhone: false, phones: new Map() }));
  tombs.release(room);
  r.host = ws;
  ws.on('message', (raw) => {
    const env = envelope(String(raw));
    if (!env) return;
    // One copy from the host, the same bytes to every phone it names.
    const data = env.data === undefined ? null : Buffer.from(env.data);
    for (const id of env.ids) {
      const p = r.phones.get(id);
      if (!p) continue;
      if (data) p.send(data, { binary: false });
      else p.close(1000);
    }
  });
  ws.on('close', () => {
    if (r.host !== ws) return;
    for (const p of r.phones.values()) p.close(1001, 'host left');
    rooms.delete(room);
    tombs.hold(room, r.key, r);
  });
}

function attachPhone(ws, r) {
  const id = String(nextId++);
  r.phones.set(id, ws);
  r.hadPhone = true;
  r.host.send(JSON.stringify({ t: 'open', id }));
  // The outer wall: the host enforces the same limit on every transport.
  const wall = tokenBucket(PHONE_LIMIT, Date.now());
  ws.on('message', (raw) => {
    if (!wall.take(Date.now())) return ws.close(1008, 'too many messages');
    const data = parse(raw);
    if (data === undefined || r.phones.get(id) !== ws) return;
    r.host.send(JSON.stringify({ t: 'msg', id, data }));
  });
  ws.on('close', () => {
    // Already gone when its host moved: the new host never knew this phone.
    if (r.phones.get(id) !== ws) return;
    r.phones.delete(id);
    r.host.send(JSON.stringify({ t: 'close', id }));
  });
}

// A phone that walked out of Wi-Fi range leaves its socket open with nobody behind it. Ping every
// socket three times a window; one that hasn't answered for a whole window is gone, and closing it
// lets the host (or the phones, if it was the host) know. The host relies on this alone, so a locked
// phone, whose browser still answers pings, keeps its seat. A pong can queue behind a slow phone's
// song chunks, so the whole window decides, not one round.
const HEARTBEAT_MS = Number(process.env.RELAY_HEARTBEAT_MS) || 15_000;
setInterval(() => {
  tombs.sweep();
  for (const ws of [...servers.host.clients, ...servers.phone.clients]) {
    if (Date.now() - ws.answered > HEARTBEAT_MS) ws.terminate();
    else ws.ping();
  }
}, HEARTBEAT_MS / 3);

server.listen(PORT, () => {
  console.log(`\n  Swarm Screen is running.\n`);
  console.log(`  Open on this computer:  http://localhost:${PORT}/`);
  console.log(`  Phones on the same Wi-Fi join via the QR code (${lanUrl})\n`);
});
