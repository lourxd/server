import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { run, runStreaming } from './exec.js';
import { settings } from './store/settings.js';
import { cached, invalidate } from './cache.js';

const SEP = '\u001f';
const FMT = ['%H', '%h', '%s', '%an', '%aI'].join('%x1f');

export function safeRepoPath(rel) {
  const base = path.resolve(settings().projectsDir);
  const target = path.resolve(base, rel || '');
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path is outside the configured projects directory.');
  }
  return target;
}

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/bin/echo',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
};

async function isGitRepo(dir) {
  try {
    const st = await fs.stat(path.join(dir, '.git'));
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

async function findRepos(base, depth = 2) {
  const found = [];
  async function walk(dir, level) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (await isGitRepo(full)) {
        found.push(full);
        continue;
      }
      if (level < depth) await walk(full, level + 1);
    }
  }
  await walk(base, 1);
  return found;
}

async function readPackageJson(dir) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    return {
      name: pkg.name || null,
      version: pkg.version || null,
      scripts: Object.keys(pkg.scripts || {}),
      main: pkg.main || null,
      packageManager: pkg.packageManager || null,
      hasDeps: !!(pkg.dependencies || pkg.devDependencies),
      dependencies: Object.keys(pkg.dependencies ?? {}),
      devDependencies: Object.keys(pkg.devDependencies ?? {}),
    };
  } catch {
    return null;
  }
}

function detectPackageManager(dir) {
  if (fss.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fss.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fss.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  if (fss.existsSync(path.join(dir, 'package.json'))) return 'npm';
  return null;
}

function findEcosystemFile(dir) {
  for (const f of ['ecosystem.config.js', 'ecosystem.config.cjs', 'ecosystem.config.json', 'pm2.config.js']) {
    if (fss.existsSync(path.join(dir, f))) return f;
  }
  return null;
}

async function dirSize(dir) {
  const r = await run('du', ['-sb', '--exclude=node_modules', '--exclude=.git', dir], { timeout: 15_000 });
  return r.ok ? Number(r.stdout.split(/\s+/)[0]) || 0 : 0;
}

function parseCommits(stdout) {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, short, subject, author, date] = line.split(SEP);
      return { hash, short, subject, author, date };
    });
}

export async function repoInfo(dir, { detailed = false } = {}) {
  const git = (args, timeout = 20_000) => run('git', ['-C', dir, ...args], { timeout, env: GIT_ENV });

  const [branch, remote, statusRes, lastCommit, upstream] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['remote', 'get-url', 'origin']),
    git(['status', '--porcelain=v1']),
    git(['log', '-1', `--pretty=format:${FMT}`]),
    git(['rev-parse', '--abbrev-ref', '@{upstream}']),
  ]);

  const dirtyFiles = statusRes.ok && statusRes.stdout ? statusRes.stdout.split('\n').filter(Boolean) : [];

  let ahead = 0;
  let behind = 0;
  if (upstream.ok) {
    const counts = await git(['rev-list', '--left-right', '--count', `${upstream.stdout}...HEAD`]);
    if (counts.ok) {
      const [b, a] = counts.stdout.split(/\s+/).map(Number);
      behind = b || 0;
      ahead = a || 0;
    }
  }

  const commits = lastCommit.ok ? parseCommits(lastCommit.stdout) : [];

  const info = {
    name: path.basename(dir),
    path: dir,
    relPath: path.relative(path.resolve(settings().projectsDir), dir) || path.basename(dir),
    branch: branch.ok ? branch.stdout : 'unknown',
    remote: remote.ok ? remote.stdout : null,
    remoteWeb: remote.ok ? toWebUrl(remote.stdout) : null,
    upstream: upstream.ok ? upstream.stdout : null,
    ahead,
    behind,
    dirty: dirtyFiles.length,
    dirtyFiles: dirtyFiles.slice(0, 200),
    lastCommit: commits[0] || null,
    pkg: await readPackageJson(dir),
    packageManager: detectPackageManager(dir),
    ecosystemFile: findEcosystemFile(dir),
    hasNodeModules: fss.existsSync(path.join(dir, 'node_modules')),
  };

  if (detailed) {
    const [branches, log, size, remotes] = await Promise.all([
      git(['branch', '-a', '--format=%(refname:short)%09%(committerdate:relative)']),
      git(['log', '-30', `--pretty=format:${FMT}`]),
      dirSize(dir),
      git(['remote', '-v']),
    ]);
    info.branches = branches.ok
      ? branches.stdout
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [name, when] = l.split('\t');
            return { name, when, remote: name.startsWith('remotes/') || name.startsWith('origin/') };
          })
      : [];
    info.log = log.ok ? parseCommits(log.stdout) : [];
    info.size = size;
    info.remotes = remotes.ok ? remotes.stdout : '';
  }
  return info;
}

function toWebUrl(remote) {
  if (!remote) return null;
  const u = remote.replace(/\.git$/, '');
  const ssh = u.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return u.startsWith('http') ? u : null;
}

export async function listRepoPaths() {
  const base = path.resolve(settings().projectsDir);
  return cached('repos:paths', 5_000, async () => {
    const dirs = await findRepos(base, 2);
    return Promise.all(
      dirs.map(async (dir) => ({
        name: path.basename(dir),
        relPath: path.relative(base, dir),
        ecosystemFile: findEcosystemFile(dir),
        hasNodeModules: fss.existsSync(path.join(dir, 'node_modules')),
        pkg: await readPackageJson(dir),
      })),
    );
  });
}

export function listRepos() {
  return cached('repos:list', 5_000, listReposUncached);
}

async function listReposUncached() {
  const base = path.resolve(settings().projectsDir);
  const dirs = await findRepos(base, 2);
  const repos = await Promise.all(
    dirs.map((d) =>
      repoInfo(d).catch((e) => ({
        name: path.basename(d),
        path: d,
        relPath: path.relative(base, d),
        error: e.message,
      })),
    ),
  );
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

function authedUrl(url, token) {
  if (!token) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return url;
    u.username = encodeURIComponent(token);
    u.password = '';
    return u.toString();
  } catch {
    return url;
  }
}

function parseGithubSlug(url) {
  const m = String(url).match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function assertCloneAccess(url, token) {
  const slug = parseGithubSlug(url);
  if (!slug || !/^https:\/\/(www\.)?github\.com/i.test(url)) return;

  try {
    await gh('/user', { token });
  } catch (err) {
    throw new Error(
      err.status === 401
        ? 'The stored GitHub token is invalid or expired. Paste a current one under Settings → GitHub.'
        : `GitHub rejected the stored token: ${err.message}`,
    );
  }

  const full = `${slug.owner}/${slug.repo}`;

  try {
    await gh(`/repos/${full}`, { token });
  } catch (err) {
    if (err.status === 404) {
      throw new Error(
        `The token cannot see ${full}. For a fine-grained token, set Repository access to include it ` +
          '(All repositories, or select this one) — an unreachable repo returns 404.',
      );
    }
    throw err;
  }

  try {
    await gh(`/repos/${full}/git/refs/heads`, { token });
  } catch (err) {
    if (err.status === 403) {
      throw new Error(
        `The token can see ${full} but cannot read its code. Add the "Contents: Read-only" permission ` +
          'to the token (Permissions → Repository permissions → Contents). Repository access alone is not ' +
          'enough — GitHub reports this as "Write access to repository not granted", but no write is needed.',
      );
    }
    if (err.status !== 409) throw err;
  }
}

const redactor = (token) => (line) => (token ? line.split(token).join('***') : line);

export async function cloneRepo({ url, name, branch }, onLine = () => {}) {
  if (!url || typeof url !== 'string') throw new Error('A repository URL is required.');
  const clean = url.trim();
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(clean)) {
    throw new Error('Only https:// and git@ (SSH) URLs are supported.');
  }

  const inferred = (name || clean.split('/').pop() || 'repo').replace(/\.git$/, '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(inferred)) throw new Error('Invalid target directory name.');

  const target = safeRepoPath(inferred);
  if (fss.existsSync(target)) throw new Error(`"${inferred}" already exists in the projects directory.`);

  const token = settings().githubToken;
  const redact = redactor(token);

  if (token && /^https:\/\//i.test(clean)) {
    onLine({ stream: 'out', line: 'Checking token access…' });
    await assertCloneAccess(clean, token);
  }

  const args = ['clone', '--progress'];
  if (branch) args.push('--branch', branch);
  args.push(authedUrl(clean, token), target);

  onLine({ stream: 'out', line: `$ git clone ${branch ? `-b ${branch} ` : ''}${clean} ${inferred}` });
  const res = await runStreaming('git', args, { cwd: settings().projectsDir, env: GIT_ENV, timeout: 600_000 }, (l) =>
    onLine({ stream: l.stream, line: redact(l.line) }),
  );

  if (res.ok && token) {
    await run('git', ['-C', target, 'remote', 'set-url', 'origin', clean], { env: GIT_ENV });
  }
  return { ...res, path: target, name: inferred };
}

export async function gitAction(relPath, action, payload = {}, onLine = () => {}) {
  const dir = safeRepoPath(relPath);
  if (!(await isGitRepo(dir))) throw new Error('Not a git repository.');
  const redact = redactor(settings().githubToken);
  const opts = { cwd: dir, env: GIT_ENV, timeout: 300_000 };
  const emit = (l) => onLine({ stream: l.stream, line: redact(l.line) });

  switch (action) {
    case 'pull':
      emit({ stream: 'out', line: '$ git pull --ff-only' });
      return runStreaming('git', ['-C', dir, 'pull', '--ff-only', '--progress'], opts, emit);

    case 'fetch':
      emit({ stream: 'out', line: '$ git fetch --all --prune' });
      return runStreaming('git', ['-C', dir, 'fetch', '--all', '--prune', '--progress'], opts, emit);

    case 'checkout': {
      const raw = String(payload.branch || '').trim();
      if (!raw || !/^[A-Za-z0-9._\-/]+$/.test(raw)) throw new Error('Invalid branch name.');
      const branch = raw.replace(/^remotes\//, '').replace(/^origin\//, '');
      emit({ stream: 'out', line: `$ git checkout ${branch}` });
      return runStreaming('git', ['-C', dir, 'checkout', branch], opts, emit);
    }

    case 'reset-hard': {
      emit({ stream: 'out', line: '$ git reset --hard && git clean -fd' });
      const r1 = await runStreaming('git', ['-C', dir, 'reset', '--hard'], opts, emit);
      if (!r1.ok) return r1;
      return runStreaming('git', ['-C', dir, 'clean', '-fd'], opts, emit);
    }

    case 'stash':
      emit({ stream: 'out', line: '$ git stash push -u' });
      return runStreaming('git', ['-C', dir, 'stash', 'push', '-u'], opts, emit);

    case 'install': {
      const pm = detectPackageManager(dir);
      if (!pm) throw new Error('No package.json found in this repository.');
      emit({ stream: 'out', line: `$ ${pm} install` });
      return runStreaming(pm, ['install'], { ...opts, timeout: 900_000 }, emit);
    }

    case 'run-script': {
      const script = String(payload.script || '').trim();
      if (!script || !/^[A-Za-z0-9:._-]+$/.test(script)) throw new Error('Invalid script name.');
      const pm = detectPackageManager(dir) || 'npm';
      emit({ stream: 'out', line: `$ ${pm} run ${script}` });
      return runStreaming(pm, ['run', script], { ...opts, timeout: 900_000 }, emit);
    }

    default:
      throw new Error(`Unknown repository action: ${action}`);
  }
}

export async function deleteRepo(relPath) {
  const dir = safeRepoPath(relPath);
  if (path.resolve(dir) === path.resolve(settings().projectsDir)) {
    throw new Error('Refusing to delete the projects directory itself.');
  }
  if (!(await isGitRepo(dir))) throw new Error('Refusing to delete: not a git repository.');
  await fs.rm(dir, { recursive: true, force: true });
  invalidate('repos:');
  return { ok: true };
}

async function gh(pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'server-control-panel',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.message || `GitHub API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function probeGithubToken(token) {
  if (!token) return { connected: false, reason: 'No GitHub token configured.' };
  try {
    const user = await gh('/user', { token });
    const visible = await ghAllRepos(token).catch(() => []);
    const visiblePrivate = visible.filter((r) => r.private).length;

    return {
      connected: true,
      login: user.login,
      name: user.name,
      avatar: user.avatar_url,
      publicRepos: user.public_repos,
      privateRepos: user.total_private_repos ?? 0,
      fineGrained: token.startsWith('github_pat_'),
      tokenTail: token.slice(-6),
      visibleRepos: visible.length,
      visiblePrivate,
      visiblePublic: visible.length - visiblePrivate,
      privateBlocked: token.startsWith('github_pat_') && visiblePrivate === 0,
    };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

export function githubStatus() {
  const token = settings().githubToken;
  if (!token) return Promise.resolve({ connected: false, reason: 'No GitHub token configured.' });
  return cached('github:status', 60_000, () => probeGithubToken(token));
}

async function ghAllRepos(token, max = 500) {
  const out = [];
  for (let page = 1; out.length < max; page += 1) {
    const batch = await gh(
      `/user/repos?per_page=100&page=${page}&sort=updated&visibility=all&affiliation=owner,collaborator,organization_member`,
      { token },
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.slice(0, max);
}

export async function githubRepos({ q = '' } = {}) {
  const token = settings().githubToken;
  if (!token) throw new Error('Add a GitHub personal access token under Settings to list your repositories.');
  const list = await ghAllRepos(token);
  const mapped = list.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    description: r.description,
    cloneUrl: r.clone_url,
    sshUrl: r.ssh_url,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    language: r.language,
    stars: r.stargazers_count,
    updatedAt: r.updated_at,
    size: r.size * 1024,
  }));
  if (!q) return mapped;
  const needle = q.toLowerCase();
  return mapped.filter(
    (r) => r.fullName.toLowerCase().includes(needle) || (r.description || '').toLowerCase().includes(needle),
  );
}
