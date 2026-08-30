import { json, error } from '@sveltejs/kit';
import { listRepos, repoInfo, safeRepoPath, deleteRepo, githubRepos } from '$srv/repos.js';

export async function GET({ url }) {
  const rel = url.searchParams.get('path');
  const source = url.searchParams.get('source');
  try {
    if (source === 'github') {
      return json(await githubRepos({ q: url.searchParams.get('q') || '' }));
    }
    if (rel) return json(await repoInfo(safeRepoPath(rel), { detailed: true }));
    return json(await listRepos());
  } catch (err) {
    error(400, err.message);
  }
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'delete') {
      return json(await deleteRepo(body.path));
    }
    error(400, `Use the streaming endpoint for "${body.action}".`);
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message);
  }
}
