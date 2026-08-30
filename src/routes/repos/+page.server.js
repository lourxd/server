import { listRepos, githubStatus } from '$srv/repos.js';
import { settings } from '$srv/store/settings.js';

export async function load() {
  const [repos, github] = await Promise.all([listRepos(), githubStatus()]);
  return { repos, github, projectsDir: settings().projectsDir };
}
