// Zero-dependency static server for the built site (dist/). It applies the rules in dist/_headers the
// same way Cloudflare Pages does, and redirects /dir to /dir/ like Vercel (trailingSlash: true), so local
// checks see the headers production will send. Usage: npm run build && node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(REPO, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** Parses a Cloudflare-style _headers file into [{ pattern: RegExp, headers: [[k, v]] }]. */
export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const re = new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      cur = { source: line.trim(), pattern: re, headers: [] };
      rules.push(cur);
    } else if (cur) {
      const i = line.indexOf(':');
      cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

/**
 * @param {object} opts
 * @param {Record<string, string>} [opts.routes] extra URL path -> absolute file path (test fixtures)
 */
export function startServer({ port = 41730, host = '127.0.0.1', quiet = false, root = DIST, routes = {} } = {}) {
  if (!existsSync(join(root, 'index.html'))) throw new Error(`${root}/index.html not found; run \`npm run build\` first`);
  const headersFile = join(root, '_headers');
  const rules = existsSync(headersFile) ? parseHeadersFile(readFileSync(headersFile, 'utf8')) : [];

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const extra = {};
    for (const r of rules) if (r.pattern.test(url.pathname)) for (const [k, v] of r.headers) extra[k] = v;
    let file = routes[url.pathname];
    if (!file) {
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (path.endsWith('/')) path += 'index.html';
      file = join(root, path);
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      res.writeHead(404, extra).end('not found');
      return;
    }
    if (st.isDirectory()) {
      res.writeHead(308, { ...extra, location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    extra['Cache-Control'] ??= 'no-cache';
    res.writeHead(200, { ...extra, 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': st.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((ok) =>
    server.listen(port, host, () => {
      const { port: p } = server.address();
      if (!quiet) console.log(`ShipFall → http://${host}:${p}/  (embed: /embed/, demo: /?demo=1)`);
      ok({ server, port: p, url: `http://${host}:${p}` });
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({ port: Number(process.argv[2]) || 41730, host: process.env.HOST || '127.0.0.1' });
}
