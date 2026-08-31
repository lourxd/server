import { STACK_BY_ID, detectStack } from './stacks.js';

const UNSUPPORTED = [
  {
    id: 'workers',
    label: 'Cloudflare Workers',
    files: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'],
    reason: 'Runs on Cloudflare, not on this machine. Deploy it with wrangler.',
  },
  {
    id: 'static-host',
    label: 'Vercel / Netlify',
    files: ['vercel.json', 'netlify.toml'],
    reason: 'Configured for a hosting provider that builds and runs it for you.',
  },
];

const BY_FILE = [
  { file: 'next.config', stack: 'nextjs' },
  { file: 'nuxt.config', stack: 'nuxt' },
  { file: 'astro.config', stack: 'astro' },
  { file: 'nest-cli.json', stack: 'nestjs' },
  { file: 'svelte.config', stack: 'sveltekit' },
  { file: 'vite.config', stack: 'vite' },
  { file: 'go.mod', stack: 'go' },
  { file: 'requirements.txt', stack: 'python' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'manage.py', stack: 'python' },
];

export function frameworkFor({ pkg = null, files = [] } = {}) {
  const present = new Set(files);
  const has = (name) => [...present].some((f) => f === name || f.startsWith(`${name}.`));

  for (const entry of UNSUPPORTED) {
    if (entry.files.some((f) => present.has(f))) {
      return { id: entry.id, label: entry.label, deployable: false, reason: entry.reason };
    }
  }

  const byDeps = detectStack(pkg);
  const byFile = BY_FILE.find((e) => has(e.file))?.stack ?? null;
  const stack = byDeps ?? byFile;

  if (stack && STACK_BY_ID[stack]) {
    return {
      id: stack,
      label: STACK_BY_ID[stack].name,
      logo: STACK_BY_ID[stack].logo,
      deployable: true,
      via: byDeps ? 'dependencies' : 'config file',
    };
  }

  if (present.has('package.json')) {
    return { id: 'node', label: STACK_BY_ID.node.name, logo: STACK_BY_ID.node.logo, deployable: true, via: 'package.json' };
  }
  return null;
}
