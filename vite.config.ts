import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Trägt nach dem Build die Liste aller ausgelieferten Dateien samt Versions-Hash
 * in dist/sw.js ein, damit der Service Worker die komplette App vorab cachen kann.
 */
function swManifest(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'sw-manifest',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      const files = walk(outDir)
        .filter((p) => p !== swPath)
        .sort();
      const hash = createHash('sha1');
      for (const p of files) hash.update(p).update(readFileSync(p));
      const list = files.map((p) => relative(outDir, p).replace(/\\/g, '/'));
      const manifest = [hash.digest('hex').slice(0, 10), ...list].join('|');
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes('__PRECACHE_MANIFEST__')) {
        throw new Error('sw.js enthält den Platzhalter __PRECACHE_MANIFEST__ nicht.');
      }
      writeFileSync(swPath, sw.replace('__PRECACHE_MANIFEST__', manifest));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [swManifest()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
