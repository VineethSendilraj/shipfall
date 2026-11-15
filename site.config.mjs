// Build-time site settings shared by vite.config.mjs and scripts/check-card.mjs.
//
// SITE_URL is the public origin the share card points at (absolute URLs are required by the X crawler).
// Set VITE_SITE_URL (or SITE_URL) when building, e.g. `VITE_SITE_URL=https://booster.example.com npm run build`.
// Without it, Vercel and Cloudflare Pages builds fall back to the URL the platform provides.

export const PLACEHOLDER_SITE_URL = 'https://shipfall.example';

export const CARD = {
  title: 'ShipFall',
  description: 'Try to catch Starship',
  imageAlt: "A stainless rocket ship caught in a launch tower's arms, sparks flying",
  site: '@VineethSendil',
  // X shows this image in place of the frame until the game loads, so it has the frame's square shape.
  playerImage: '/player.jpg',
  // Bump when the card images change: X caches a card image by its URL, so a new query makes it fetch the new one.
  imageVersion: 5,
  playerImageSize: 1080,
  player: '/embed/',
  playerWidth: 480,
  playerHeight: 480,
  // og:image, for sites that show a wide link preview.
  image: '/share.jpg',
  imageWidth: 1200,
  imageHeight: 630,
};

export function resolveSiteUrl(env = process.env) {
  const explicit = env.VITE_SITE_URL || env.SITE_URL;
  let source = 'VITE_SITE_URL';
  let raw = explicit;
  if (!raw && env.VERCEL_PROJECT_PRODUCTION_URL) {
    raw = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
    source = 'VERCEL_PROJECT_PRODUCTION_URL';
  } else if (!raw && env.CF_PAGES_URL) {
    raw = env.CF_PAGES_URL;
    source = 'CF_PAGES_URL';
  } else if (!raw) {
    raw = PLACEHOLDER_SITE_URL;
    source = 'placeholder';
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SITE_URL "${raw}" is not a valid absolute URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`SITE_URL must use https:// (X only fetches cards over HTTPS), got "${raw}"`);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`SITE_URL must be a bare origin without a path, got "${raw}"`);
  return { url: url.origin, source };
}

/** All share-card meta tags, as [attribute, key, value] triples, in output order. */
export function cardMeta(site, env = process.env) {
  const abs = (p) => site + p;
  const handle = env.VITE_TWITTER_SITE || CARD.site;
  return [
    ['name', 'twitter:card', 'player'],
    ['name', 'twitter:site', handle.startsWith('@') ? handle : `@${handle}`],
    ['name', 'twitter:title', CARD.title],
    ['name', 'twitter:description', CARD.description],
    ['name', 'twitter:image', `${abs(CARD.playerImage)}?v=${CARD.imageVersion}`],
    ['name', 'twitter:image:alt', CARD.imageAlt],
    ['name', 'twitter:player', abs(CARD.player)],
    ['name', 'twitter:player:width', String(CARD.playerWidth)],
    ['name', 'twitter:player:height', String(CARD.playerHeight)],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', CARD.title],
    ['property', 'og:title', CARD.title],
    ['property', 'og:description', CARD.description],
    ['property', 'og:url', abs('/')],
    ['property', 'og:image', `${abs(CARD.image)}?v=${CARD.imageVersion}`],
    ['property', 'og:image:type', 'image/jpeg'],
    ['property', 'og:image:width', String(CARD.imageWidth)],
    ['property', 'og:image:height', String(CARD.imageHeight)],
    ['property', 'og:image:alt', CARD.imageAlt],
  ];
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function cardMetaHtml(site, env = process.env) {
  const lines = cardMeta(site, env).map(([attr, key, value]) => `<meta ${attr}="${key}" content="${esc(value)}" />`);
  lines.push(`<link rel="canonical" href="${site}/" />`);
  return lines.join('\n    ');
}
