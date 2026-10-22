// The built app, served from a folder: a file by its path, the app shell for anything else.
import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.png': 'image/png',
};

/** Whether `file` is there to read now. One stat, so a file that goes between two looks is simply not there. */
function readable(file) {
  try {
    return !statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Answers `res` with the file `path` names under `root` (which ends in a slash). */
export function serveStatic(res, root, path) {
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  if (!readable(file)) file = join(root, 'index.html');
  if (!readable(file)) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('Build missing: run `npm start` (it builds first).');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  // A file that fails to read (gone mid-request, not a plain file) ends this response, not the relay.
  pipeline(createReadStream(file), res, () => {});
}
