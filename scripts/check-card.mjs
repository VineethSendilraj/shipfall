// Verifies the X player-card setup end to end: builds the site, serves dist/ locally (with the _headers
// rules applied), and checks meta tags, the card image, HTML size, header configs and the JS budget.
// Usage: npm run check:card   (honours VITE_SITE_URL / SITE_URL like the build does)
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CARD, resolveSiteUrl } from '../site.config.mjs';
import { startServer, parseHeadersFile, DIST } from './serve.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_ANCESTORS = "frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com";
const MAX_HTML = 2 * 1024 * 1024;
const MAX_JS_GZIP = 2.5 * 1024 * 1024;
const MIN_CARD_PX = 68_600;

const results = [];
const check = (ok, label, detail = '') => results.push({ ok: !!ok, label, detail });

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function metaTags(html) {
  const tags = new Map();
  for (const m of html.matchAll(/<meta\s+(name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)) tags.set(m[2], m[3].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  return tags;
}

function checkCsp(label, value) {
  check(value === FRAME_ANCESTORS, `${label}: Content-Security-Policy frame-ancestors`, value || '(missing)');
}

// 1. Build
const site = resolveSiteUrl(process.env);
console.log(`Building with SITE_URL=${site.url} (${site.source})…`);
const build = spawnSync(process.execPath, [join(REPO, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: REPO, stdio: 'inherit', env: process.env });
check(build.status === 0, 'vite build succeeds');
if (build.status !== 0) report();

// 2. Serve dist/ and fetch like a crawler (no redirect following)
const { server, url } = await startServer({ port: 0, quiet: true });
try {
  for (const path of ['/', '/embed/']) {
    const res = await fetch(url + path, { redirect: 'manual' });
    const html = await res.text();
    const bytes = Buffer.byteLength(html);
    check(res.status === 200, `GET ${path} returns 200 without redirect`, `status ${res.status}`);
    check(bytes < MAX_HTML, `${path} HTML under 2 MB`, `${(bytes / 1024).toFixed(1)} KB`);
    checkCsp(`GET ${path}`, res.headers.get('content-security-policy'));
    check(!res.headers.has('x-frame-options'), `GET ${path}: no X-Frame-Options`);
    const m = metaTags(html);
    const expect = {
      'twitter:card': 'player',
      'twitter:title': CARD.title,
      'twitter:player': `${site.url}${CARD.player}`,
      'twitter:player:width': String(CARD.playerWidth),
      'twitter:player:height': String(CARD.playerHeight),
      'twitter:image': `${site.url}${CARD.image}`,
      'og:title': CARD.title,
      'og:image': `${site.url}${CARD.image}`,
      'og:url': `${site.url}/`,
    };
    for (const [k, v] of Object.entries(expect)) check(m.get(k) === v, `${path} meta ${k}`, m.get(k) ?? '(missing)');
    for (const k of ['twitter:description', 'og:description']) {
      const d = m.get(k) || '';
      check(d.length > 0 && d.length <= 200, `${path} meta ${k} present (≤ 200 chars)`, `${d.length} chars`);
    }
    const urls = [...m.entries()].filter(([, v]) => /^https?:/.test(v));
    check(urls.every(([, v]) => v.startsWith('https://')), `${path} meta URLs are absolute https`, urls.map(([k]) => k).join(', '));
    const resources = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((r) => r[1]).filter((u) => !u.startsWith('data:'));
    const external = resources.filter((u) => /^(https?:)?\/\//.test(u) && !u.startsWith(site.url));
    check(external.length === 0, `${path} loads no external scripts, styles or fonts`, external.join(', ') || `${resources.length} local resources`);
    check(/fan-made, not affiliated with SpaceX/.test(html), `${path} shows the fan-made disclaimer`);
  }
  const embed = await (await fetch(`${url}/embed/`)).text();
  check(/<body class="embed">/.test(embed), '/embed/ is the game-only embed page');
  const anchors = [...embed.matchAll(/<a\b[^>]*>/g)].map((a) => a[0]);
  check(anchors.length > 0 && anchors.every((a) => /target="_blank"/.test(a) && /rel="noopener"/.test(a)), '/embed/ links open in a new tab', `${anchors.length} links`);

  const img = await fetch(`${url}${CARD.image}`, { redirect: 'manual' });
  const buf = Buffer.from(await img.arrayBuffer());
  const dim = jpegSize(buf);
  check(img.status === 200 && img.headers.get('content-type') === 'image/jpeg', `GET ${CARD.image} is a JPEG (200)`, `status ${img.status}, ${img.headers.get('content-type')}`);
  check(dim && dim.width >= 480 && dim.height >= 480, `${CARD.image} is at least 480x480`, dim ? `${dim.width}x${dim.height}` : 'unreadable');
  check(dim && dim.width * dim.height >= MIN_CARD_PX, `${CARD.image} has at least 68,600 px`, dim ? `${(dim.width * dim.height).toLocaleString('en-US')} px` : '');
  check(dim && dim.width === CARD.imageSize && dim.height === CARD.imageSize, `${CARD.image} matches og:image size ${CARD.imageSize}x${CARD.imageSize}`);
  check(buf.length < 5 * 1024 * 1024, `${CARD.image} under 5 MB`, `${(buf.length / 1024).toFixed(0)} KB`);
} finally {
  server.close();
}

// 3. Host header configs
const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8'));
check(vercel.trailingSlash === true, 'vercel.json trailingSlash: true (/embed/ is served directly, not 308)', String(vercel.trailingSlash));
const allRoutes = (vercel.headers || []).find((h) => h.source === '/(.*)');
checkCsp('vercel.json /(.*)', allRoutes?.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value);
check(!JSON.stringify(vercel).toLowerCase().includes('x-frame-options'), 'vercel.json sets no X-Frame-Options');
check(vercel.outputDirectory === 'dist', 'vercel.json outputDirectory is dist');
const headersText = readFileSync(join(DIST, '_headers'), 'utf8');
const rules = parseHeadersFile(headersText);
const all = rules.find((r) => r.source === '/*');
checkCsp('dist/_headers /*', all?.headers.find(([k]) => k.toLowerCase() === 'content-security-policy')?.[1]);
check(!rules.some((r) => r.headers.some(([k]) => k.toLowerCase() === 'x-frame-options')), 'dist/_headers sets no X-Frame-Options');

// 4. JS budget
const js = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
const gz = js.reduce((s, f) => s + gzipSync(readFileSync(join(DIST, 'assets', f))).length, 0);
const raw = js.reduce((s, f) => s + statSync(join(DIST, 'assets', f)).size, 0);
check(gz < MAX_JS_GZIP, 'total JS under 2.5 MB gzipped', `${(gz / 1024).toFixed(0)} KB gzipped (${(raw / 1024).toFixed(0)} KB raw, ${js.length} file${js.length === 1 ? '' : 's'})`);

report();

function report() {
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.label}${r.detail ? `  [${r.detail}]` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  if (site.source === 'placeholder') console.log(`\nnote: SITE_URL is the placeholder ${site.url}; set VITE_SITE_URL before deploying.`);
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
