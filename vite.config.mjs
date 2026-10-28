import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSiteUrl, cardMetaHtml } from './site.config.mjs';

const root = import.meta.dirname;

/** Injects the share-card meta tags and the shared game markup into every HTML entry. */
function sitePages(site, env) {
  const partial = resolve(root, 'src/game.html');
  return {
    name: 'site-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace('<!-- card-meta -->', cardMetaHtml(site, env)).replace('<!-- game -->', readFileSync(partial, 'utf8').trim());
      },
    },
    configureServer(server) {
      server.watcher.add(partial);
      server.watcher.on('change', (file) => file === partial && server.ws.send({ type: 'full-reload' }));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, root, '') };
  const site = resolveSiteUrl(env);
  if (mode === 'production' && site.source === 'placeholder') {
    console.warn(`\n[site] VITE_SITE_URL is not set; share-card URLs use the placeholder ${site.url}. Set it before deploying.\n`);
  }
  return {
    define: { __SITE_URL__: JSON.stringify(site.url) },
    plugins: [sitePages(site.url, env)],
    server: { host: '127.0.0.1', port: 41730, strictPort: true },
    preview: { host: '127.0.0.1', port: 41731 },
    build: {
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        input: { main: resolve(root, 'index.html'), embed: resolve(root, 'embed/index.html') },
      },
    },
  };
});
