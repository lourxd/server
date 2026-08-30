import adapter from '@sveltejs/adapter-node';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ out: 'build' }),
    alias: { $srv: 'src/lib/server' },
    // Surfaced by /api/health so a deployment can be identified.
    version: { name: pkg.version },
  },
};
