// `npm start`: serves the built app and a tiny WebSocket relay so phones on the same
// Wi-Fi can join with no internet connection. One host per room; phones talk only to it.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 4321;
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.png': 'image/png',
};

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
  if (path === '/relay.json') {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ lanUrl }));
  }
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('Build missing: run `npm start` (it builds first).');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const MAX_ROOMS = 64;
const MAX_PHONES = 200;
const ROOM = /^[A-Z0-9]{3,12}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * room -> { host: WebSocket, key: string, phones: Map<id, Phone> }; exists only while a host is attached.
 * Phone: { ws, written, since }: messages written to the phone's socket, and chars since the last `drain`.
 */
const rooms = new Map();
let nextId = 1;
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

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
  const status = admit(room, role, key);
  if (status) return refuse(socket, status);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => (ws.missed = false));
    // Re-check: the room may have changed while the handshake completed.
    if (admit(room, role, key)) return ws.close(1013, 'refused');
    if (role === 'host') attachHost(ws, room, key);
    else attachPhone(ws, rooms.get(room));
  });
});

/** Returns an HTTP status line if the connection must be refused. */
function admit(room, role, key) {
  if (!ROOM.test(room)) return '400 Bad Request';
  const r = rooms.get(room);
  if (role === 'host') {
    if (!KEY.test(key)) return '400 Bad Request';
    if (r) return r.key === key ? null : '409 Conflict';
    return rooms.size >= MAX_ROOMS ? '503 Service Unavailable' : null;
  }
  if (!r) return '404 Not Found';
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

/** Chars written to a phone between two `drain` reports to its host. */
const REPORT_CHARS = 4096;

/**
 * Write `s` to a phone and, once enough has gone out, tell the host how many messages the phone's
 * socket has taken: that is how the host sees each phone's own backlog through its one socket.
 */
function forward(r, id, p, data) {
  p.ws.send(data, { binary: false }, () => {
    p.written++;
    p.since += data.length;
    if (p.since < REPORT_CHARS) return;
    p.since = 0;
    r.host.send(JSON.stringify({ t: 'drain', id, n: p.written }));
  });
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
    for (const p of r.phones.values()) p.ws.close(1012, 'host moved');
    r.phones.clear();
  } else rooms.set(room, (r = { host: ws, key, phones: new Map() }));
  r.host = ws;
  ws.on('message', (raw) => {
    const env = envelope(String(raw));
    if (!env) return;
    // One copy from the host, the same bytes to every phone it names.
    const data = env.data === undefined ? null : Buffer.from(env.data);
    for (const id of env.ids) {
      const p = r.phones.get(id);
      if (!p) continue;
      if (data) forward(r, id, p, data);
      else p.ws.close(1000);
    }
  });
  ws.on('close', () => {
    if (r.host !== ws) return;
    for (const p of r.phones.values()) p.ws.close(1001, 'host left');
    rooms.delete(room);
  });
}

function attachPhone(ws, r) {
  const id = String(nextId++);
  r.phones.set(id, { ws, written: 0, since: 0 });
  r.host.send(JSON.stringify({ t: 'open', id }));
  ws.on('message', (raw) => {
    const data = parse(raw);
    if (data === undefined || r.phones.get(id)?.ws !== ws) return;
    r.host.send(JSON.stringify({ t: 'msg', id, data }));
  });
  ws.on('close', () => {
    // Already gone when its host moved: the new host never knew this phone.
    if (r.phones.get(id)?.ws !== ws) return;
    r.phones.delete(id);
    r.host.send(JSON.stringify({ t: 'close', id }));
  });
}

// A phone that walked out of Wi-Fi range leaves its socket open with nobody behind it. Ping every
// socket; one that hasn't answered the last ping by the next is gone, and closing it lets the host
// (or the phones, if it was the host) know.
const HEARTBEAT_MS = Number(process.env.RELAY_HEARTBEAT_MS) || 15_000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.missed) ws.terminate();
    else {
      ws.missed = true;
      ws.ping();
    }
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  console.log(`\n  Swarm Screen is running.\n`);
  console.log(`  Open on this computer:  http://localhost:${PORT}/`);
  console.log(`  Phones on the same Wi-Fi join via the QR code (${lanUrl})\n`);
});
