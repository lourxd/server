import { listRepoPaths, githubStatus } from '$srv/repos.js';

export async function load() {
  const [repos, github] = await Promise.all([listRepoPaths(), githubStatus()]);
  return { repos, github };
}
