# Server Control Panel

A realtime web panel for one machine: apps, system resources, git/GitHub
repositories, databases, Cloudflare Tunnels and DNS — all from one place.

> Working on the code? Read [`AGENTS.md`](./AGENTS.md) first — conventions,
> invariants and the gotchas that already cost someone a day.

## Stack

| Layer | Choice |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes), `adapter-node` |
| Runtime | Node 24 |
| Panel data | **Drizzle ORM** over `node:sqlite`, versioned migrations |
| Auth | Better Auth 1.7 (email + password, `admin` plugin) |
| Realtime | Server-Sent Events — one shared `EventSource` for the whole app |
| Apps | `pm2` programmatic API + `launchBus` for live logs |
| Metrics | `systeminformation`, tiered 2s / 10s polling |
| Managed databases | `pg`, `mysql2`, `mongodb`, `redis`, `node:sqlite` |
| Ingress | Cloudflare Tunnel (`cloudflared`) + Cloudflare DNS API |
| UI | shadcn-svelte on Tailwind CSS v4, `@lucide/svelte` icons |

**No native modules.** `node:sqlite` is built into Node 24, so nothing compiles on
install or upgrade. (Drizzle has no `node:sqlite` driver yet, so it runs on
`sqlite-proxy` with a thin adapter in `store/index.js`.)

## Data model

Everything the panel knows lives in one file, `data/panel.db`:

- **Drizzle-managed** (`src/lib/server/store/schema.js`) — `settings`,
  `db_connections`, `tunnels`, `tunnel_routes`, `audit_log`. Change the schema,
  run `npm run db:generate`, and the migration applies on next boot.
- **Better Auth-managed** — `user`, `session`, `account`, `verification`.

Those four tables are deliberately *not* modelled in Drizzle. Better Auth owns
that schema and migrates it itself; duplicating it would mean inheriting
responsibility for its future migrations, and its column affinities are its own
business. Sharing the file still gives one backup unit.

```bash
npm run db:generate   # after editing schema.js
npm run db:studio     # browse the panel's own tables
npm run db:check      # validate migrations
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/lourxd/server/main/install.sh | sudo bash
```

The installer is idempotent — **re-run it to upgrade**. It keeps your data,
`.env` and secrets, so sessions and stored credentials survive.

It will: install `git`, `curl`, Node 22+ and PM2 if missing; clone to
`/opt/server-control-panel`; `npm ci && npm run build`; generate `.env` with
fresh secrets; install and start a systemd service; then wait for
`/api/health` before reporting success.

### Options

Pass as environment variables (use `sudo -E` so they survive):

| Variable | Default | Purpose |
|---|---|---|
| `SCP_USER` | `$SUDO_USER` | User the panel runs as, and whose PM2 apps it manages |
| `SCP_PORT` | `8088` | Listen port |
| `SCP_HOST` | `0.0.0.0` | Bind address — `127.0.0.1` to expose only via a proxy |
| `SCP_INSTALL_DIR` | `/opt/server-control-panel` | Install location |
| `SCP_REPO_URL` / `SCP_BRANCH` | this repo / `main` | Source to install from |

```bash
SCP_PORT=9000 SCP_HOST=127.0.0.1 \
  curl -fsSL https://raw.githubusercontent.com/lourxd/server/main/install.sh | sudo -E bash
```

**Why it runs as your user, not root or a service account:** the panel drives
*your* PM2 daemon. Running it elsewhere would give it a different `PM2_HOME`,
so it would manage a daemon nothing else uses.

### Managing it

```bash
systemctl status control-panel
systemctl restart control-panel
journalctl -u control-panel -f

/opt/server-control-panel/uninstall.sh            # remove service, keep data
/opt/server-control-panel/uninstall.sh --purge    # remove everything
```

Uninstalling leaves your deployed apps running under PM2 — removing the panel
should not take sites offline.

## Running from source

```bash
npm install
npm run build:safe
npm start
```

`build:safe` builds into a staging directory and renames it into place. Use it
over `npm run build` whenever the panel is running: an in-place build replaces
hashed chunks under the live process, which then 500s on every route until it
restarts.

Open `http://<host>:8088`. On first run every route redirects to `/setup`, where
you create the owner account. That account becomes an **admin**, and sign-ups
close immediately afterwards.

`GET /api/health` needs no auth and reports `{ ok, status, version, uptimeSec }`,
where `status` is `setup-required` until the first account exists.

### Configuration

The service reads `.env` in the install directory (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8088` | Bind address |
| `PM2D_PROJECTS_DIR` | `~/projects` | Where repositories are cloned |
| `PM2_HOME` | `~/.pm2` | Which PM2 daemon to manage |
| `PM2D_DATA_DIR` | `<install>/data` | Database and keys |
| `PM2D_SECRET_KEY` | `data/secret.key` | Encrypts stored credentials |
| `BETTER_AUTH_SECRET` | `data/auth.secret` | Session signing |
| `BETTER_AUTH_URL` | derived from request | Set if behind a fixed domain |
| `PM2D_SECURE_COOKIES` | `false` | Set `true` when serving over HTTPS |
| `PM2D_MIGRATIONS_DIR` | `<install>/src/lib/server/store/migrations` | Override if the source tree moves |

> **Keep `.env` and `data/` together when backing up.** `PM2D_SECRET_KEY`
> decrypts credentials stored in `panel.db`; losing one makes the other useless.

> Migration SQL is read from disk at runtime and `adapter-node` does **not** copy
> it into `build/`, so keep the source tree beside the build.

### Two systemd units

`pm2.service` owns the PM2 daemon; `control-panel.service` is the panel. They
are separate on purpose: if the panel spawns the daemon itself, the daemon lands
in the panel's cgroup and systemd's default `KillMode=control-group` takes every
deployed app down on each panel restart. The panel's unit also sets
`KillMode=process` so it can only ever kill itself.

`pm2.service` runs `pm2 resurrect` on boot, so whatever `pm2 save` last recorded
comes back after a reboot. Uninstalling the panel leaves `pm2.service` in place —
removing the panel should not take your sites offline.

### Not managed by PM2 — deliberately

The panel runs under **systemd**, never PM2. It manages PM2, so being supervised
by it would mean `pm2 kill`, a daemon crash, or the panel's own "stop all"
would take the panel down with no way back. Under systemd it survives all three
and reconnects to the daemon on its own.

## Pages

- **Overview** — Everything about the machine on one scrolling page: CPU,
  memory, disk and network vitals; app roll-up and recent lifecycle events;
  per-core load and temperatures; 4-minute history for processor, memory and
  disk I/O; all filesystems; and the top 25 OS processes.
- **Repositories** — Everything cloned into the projects directory: branch,
  ahead/behind, uncommitted count, last commit, and which apps run from it.
  Clone from your GitHub account or any git URL, pull, fetch, install
  dependencies, or deploy one as an app. Long operations stream output live.
- **Databases** — What this panel can reach, local or remote. **Create** makes
  a new one here: SQLite needs nothing and becomes a file; the server engines
  need one already running, and the dialog says what to install when none is.
  **Connect existing** takes the connection string a managed provider gives you
  — `postgres://`, `mysql://`, `mongodb+srv://`, `rediss://` — tests it, and
  saves it encrypted. Remote entries are marked as such in the list.
- **Network** — Inbound/outbound rates and totals, 4-minute throughput history,
  gateway and resolvers, per-interface addressing (IPv4, MAC, link speed, MTU)
  with error and drop counters, and every listening port joined back to the app
  that owns it.
- **Apps** — Live list; start, stop, restart, reload, delete, `pm2 save`. Per-app
  detail in tabs — Overview, Environment, Database, Logs — with a live log
  stream. Environment variables are editable there: saving rewrites the app's
  environment and restarts it. The deploy wizard checks the port is actually
  free before starting, and names whatever holds it.
- **Settings** — Projects directory, storage paths, the machine and
  CPU/toolchain readout, GitHub and Cloudflare tokens, password, users, and the
  audit log.

System, Repositories, Databases, Tunnels and DNS no longer have pages of their
own. System's panels all moved onto Overview. Repo
import now lives inside the Apps deploy wizard; the rest are being folded into
Apps. Their API routes and server modules are still in the tree and still work —
see `src/routes/api/` — they simply have no UI at the moment.

## Cloudflare setup

Create a token at **Cloudflare → My Profile → API Tokens** with:

- `Account → Cloudflare Tunnel → Edit`
- `Zone → DNS → Edit`
- `Zone → Zone → Read`

Then install `cloudflared` (downloads the static binary
into `~/.local/bin`, no sudo). Creating a route writes a proxied CNAME to
`<tunnel-id>.cfargotunnel.com` and pushes the ingress rule to Cloudflare; the
record is removed again when you delete the route.

**A tunnel makes a local service publicly reachable.** Quick tunnels have no
authentication at all — anyone with the URL gets in. Put access control in front
of anything that matters (Cloudflare Access, or auth in the app itself).

## Security notes

This panel starts apps, deletes directories, runs arbitrary SQL and can publish
services to the internet. Treat access to it as equivalent to a shell.

- Every route except `/login`, `/setup` and `/api/auth` requires a session; API
  routes return `401 JSON` rather than redirecting.
- Sign-ups close after the first account. The "open sign-up" toggle is off by
  default and warns when enabled.
- Sign-in is rate limited to 8 attempts per minute **per IP**. The real socket
  address is stamped onto every `/api/auth` request by the route handler,
  overwriting any client-supplied header so it cannot be spoofed.
- Repository and app actions resolve paths through `safeRepoPath()`, which
  refuses anything outside the projects directory, `..` traversal and absolute
  paths included.
- Shell commands are spawned with **argv arrays, never a shell string**.
- Secrets (database passwords, GitHub and Cloudflare tokens) are encrypted with
  AES-256-GCM before being stored. The key lives in `data/secret.key` (0600),
  *beside* the database rather than inside it, so a copied `panel.db` is not
  enough on its own. Tokens are never sent to the browser after saving, and are
  redacted from streamed command output.
- **Application secrets never reach PM2.** `pm2 save` writes every process's
  environment to `~/.pm2/dump.pm2`, which is world-readable (0664 in a 0775
  directory). Variables marked secret in the deploy wizard are written to a
  `.env` file in the project at mode 0600, added to that repo's `.gitignore`,
  and loaded by the app rather than injected by the process manager.
- Consequential actions are recorded in `audit_log` with user, target and IP.
- Responses carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`.

**Before exposing this beyond a trusted network**, put it behind TLS and set
`PM2D_SECURE_COOKIES=true`. It binds `0.0.0.0` by default.

### Known advisories

Both are accepted, not oversights:

- `cookie` (**low**) — transitive via `@sveltejs/kit`. The advised fix downgrades
  SvelteKit to `0.0.30`. Not reachable through any cookie this app sets.
- `esbuild` (**moderate**) — transitive via `drizzle-kit`, a *devDependency*.
  It affects a dev server only and is absent from `build/`.

### Contributing

Conventions, security invariants and the list of hard-won gotchas — the PM2 env
leak, the hanging PM2 client, the GitHub Contents-vs-Metadata trap, and the rest
— live in [`AGENTS.md`](./AGENTS.md). Read it before changing code.

Two rules that surprise people: the source carries **no comments** (document in
`AGENTS.md` instead), and **nothing in `dependencies` may need a compile step**.


## Layout

```
install.sh                 one-line installer (idempotent; re-run to upgrade)
uninstall.sh               removes the service; --purge also removes data
deploy/
  control-panel.service    systemd unit template
.env.example               documented configuration
src/
  hooks.server.js          auth guard, boot sequence
  app.css                  design tokens + the six composable panel classes
  lib/
    server/
      store/               ── the panel's own data (Drizzle)
        schema.js          tables
        index.js           node:sqlite + drizzle-proxy + migrations
        settings.js        typed settings, secret encryption
        connections.js     saved database connections
        audit.js           append-only action log
        migrations/        generated SQL, versioned
      cloudflare/          ── ingress
        api.js             v4 API client, token verification
        tunnels.js         create/run/route tunnels via PM2
        dns.js             zones, records, live resolution
      db/                  ── user-managed databases (drivers)
        index.js           pooling, driver registry, engine detection
        postgres|mysql|sqlite|redis|mongo.js
      auth.js              Better Auth instance + migrations
      pm2.js               PM2 API wrapper + event bus
      metrics.js           systeminformation collectors
      repos.js             git + GitHub
      exec.js              argv-array process spawning
      logs.js              PM2 log tailing, merged chronologically
      realtime.js          SSE broadcast hub
      sse.js               shared SSE framing
      cache.js             TTL memo for expensive lookups
    components/
      ui/                  shadcn-svelte primitives (button, dialog, table, …)
      ConfirmDialog        AlertDialog-based confirmation, used by every page
      PageHeader StatCard StatusBadge TechLogo RadialGauge SparkBars
      DataTable LogStream
    live.svelte.js         shared EventSource, toasts, HTTP transport
    stacks.js              deploy presets for the new-app wizard
    format.js              byte/duration/relative-time helpers
  routes/
    api/                   health, stream, apps, logs, repos, db, tunnels, dns, settings, auth
    apps/ repos/ databases/ network/ settings/ login/ setup/
```
