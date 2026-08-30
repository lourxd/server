import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: { host: '0.0.0.0', port: 5173 },
  // These are native/heavy server-only deps: never let Vite try to bundle them.
  ssr: { external: ['pm2', 'systeminformation', 'pg', 'mysql2', 'mongodb', 'redis'] },
});
