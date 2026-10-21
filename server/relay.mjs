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

function lanAddress() {
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return 'localhost';
}

const lanUrl = `http://${lanAddress()}:${PORT}/`;

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
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

/** room -> { host: WebSocket | null, phones: Map<id, WebSocket> } */
const rooms = new Map();
let nextId = 1;
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/relay') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, url.searchParams.get('room') ?? '', url.searchParams.get('role')));
});

function attach(ws, room, role) {
  if (!/^[A-Z0-9]{3,12}$/.test(room)) return ws.close(1008, 'bad room');
  if (!rooms.has(room)) rooms.set(room, { host: null, phones: new Map() });
  const r = rooms.get(room);
  if (role === 'host') {
    r.host?.close(1000, 'replaced');
    r.host = ws;
    for (const id of r.phones.keys()) ws.send(JSON.stringify({ t: 'open', id }));
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      const phone = r.phones.get(m.id);
      if (!phone) return;
      if (m.t === 'msg') phone.send(JSON.stringify(m.data));
      else if (m.t === 'close') phone.close(1000);
    });
    ws.on('close', () => {
      if (r.host !== ws) return;
      r.host = null;
      for (const p of r.phones.values()) p.close(1001, 'host left');
      rooms.delete(room);
    });
    return;
  }
  if (!r.host) return ws.close(1013, 'no host in this room');
  const id = String(nextId++);
  r.phones.set(id, ws);
  r.host.send(JSON.stringify({ t: 'open', id }));
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    r.host?.send(JSON.stringify({ t: 'msg', id, data }));
  });
  ws.on('close', () => {
    r.phones.delete(id);
    r.host?.send(JSON.stringify({ t: 'close', id }));
  });
}

server.listen(PORT, () => {
  console.log(`\n  Swarm Screen is running.\n`);
  console.log(`  Open on this computer:  http://localhost:${PORT}/`);
  console.log(`  Phones on the same Wi-Fi join via the QR code (${lanUrl})\n`);
});
