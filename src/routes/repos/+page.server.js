import { listRepos, githubStatus } from '$srv/repos.js';

export async function load() {
  const [repos, github] = await Promise.all([listRepos(), githubStatus()]);
  return { repos, github };
}
