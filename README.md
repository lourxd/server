# Server Control Panel

A realtime web panel for one machine: apps, system resources, git/GitHub
repositories, databases, Cloudflare Tunnels and DNS — all from one place.

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
npm run build
npm start
```

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

### Not managed by PM2 — deliberately

The panel runs under **systemd**, never PM2. It manages PM2, so being supervised
by it would mean `pm2 kill`, a daemon crash, or the panel's own "stop all"
would take the panel down with no way back. Under systemd it survives all three
and reconnects to the daemon on its own.

## Pages

- **Overview** — CPU, memory, disk, network with 4-minute sparklines; app roll-up
  and recent lifecycle events.
- **Apps** — Live list; start, stop, restart, reload, delete, `pm2 save`. Per-app
  detail with a live log stream, config and environment.
- **System** — Per-core load, temperatures, filesystems, interfaces, throughput
  history, top 25 OS processes.
- **Repositories** — Clone from any git URL or your GitHub account. Branch,
  ahead/behind, dirty count, last commit. Pull, fetch, install deps, run `build`,
  or launch into PM2. Long operations stream output live.
- **Databases** — Connect to PostgreSQL, MySQL/MariaDB, MongoDB, Redis or a
  SQLite file. Browse with sorting and paging, inspect schema, run SQL or
  Redis/Mongo commands. Detects locally installed engines and can control their
  services.
- **Tunnels** — Publish a local app to the internet with **no inbound port
  open**. Quick tunnels (`*.trycloudflare.com`, no account) or named tunnels
  bound to your own hostnames. Each connector runs as a supervised PM2 process.
- **DNS** — Manage Cloudflare records per zone: create, edit, delete, proxy
  toggle, and a **Check** button that resolves the name against 1.1.1.1/8.8.8.8
  so you see real propagation rather than just what Cloudflare stored.
- **Settings** — Projects directory, GitHub and Cloudflare tokens, password,
  users, and the audit log.

## Cloudflare setup

Create a token at **Cloudflare → My Profile → API Tokens** with:

- `Account → Cloudflare Tunnel → Edit`
- `Zone → DNS → Edit`
- `Zone → Zone → Read`

Then, on the Tunnels page, install `cloudflared` (downloads the static binary
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

### Hard-won gotchas

Bugs that cost real time here, kept so they are not rediscovered:

- **Never spread `process.env` into a PM2 app's env.** When this panel runs under
  PM2, `process.env` carries PM2's own control variables (`pm_exec_path`,
  `pm_cwd`, `pm_id`, `name`). Forwarding them makes PM2's fork container adopt
  the panel's identity and relaunch *the panel* instead of the app.
  `sanitizeEnv()` in `pm2.js` strips them — but lets `PM2_SERVE_*` through,
  since those configure PM2's static server.
- **`script: 'npm'` / `'npx'` is wrong for PM2.** It supervises the package
  manager, not your app: signals don't propagate and reload/memory limits hit
  the wrapper. Use the real binary (`node_modules/next/dist/bin/next`), or PM2's
  built-in static server for a folder of files.
- **The PM2 client does not fail loudly when its daemon dies.** Calls neither
  resolve nor reject — they hang. Every call is bounded by a timeout, and a
  failure resets the client and retries once.
- **Migration SQL is read from disk at runtime**, and `adapter-node` does not
  copy it into `build/`. Resolving it relative to `import.meta.url` works in dev
  and breaks in the build.
- **GitHub: listing a repo needs only Metadata, cloning needs Contents.** A
  token with Metadata alone lists fine and then fails the clone with the
  misleading *"Write access to repository not granted"*. `assertCloneAccess()`
  probes Contents explicitly and says so plainly.
- **A `$effect` that reads the state it writes re-triggers itself.** Load data in
  `onMount`, not an effect guarded by its own results.
- **shadcn's dark active-tab style is invisible in this palette** (`bg-input/30`
  over `bg-muted`). `tabs-trigger.svelte` overrides it with a solid background.

### Code style

The source carries **no comments**. Names and structure are expected to carry
the intent; anything that genuinely needs explaining belongs in this README,
above. Two exceptions remain in the tree because they are functional, not
explanatory: `<!-- svelte-ignore -->` directives and script shebangs.

### UI conventions

Every page is built from shadcn-svelte components. Two rules worth keeping:

- **Confirmations are dialogs, never `window.confirm`.** Anything destructive goes
  through `ConfirmDialog` (an `AlertDialog`), which states what will actually
  happen — which files are deleted, what stops being reachable — and keeps itself
  open until the action settles.
- **Icons come from `@lucide/svelte`, imported one per path**
  (`@lucide/svelte/icons/rotate-cw`) so only the icons used are bundled. Note that
  lucide has dropped brand icons: there is no `github`, and `loader-2` is now
  `loader-circle`.

## Layout

```
install.sh                 one-line installer (idempotent; re-run to upgrade)
uninstall.sh               removes the service; --purge also removes data
deploy/
  control-panel.service    systemd unit template
.env.example               documented configuration
src/
  hooks.server.js          auth guard, boot sequence
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
      PageHeader StatCard StatusBadge Sparkline DataTable LogStream
    live.svelte.js         shared EventSource, toasts, HTTP transport
    format.js              byte/duration/relative-time helpers
  routes/
    api/                   health, stream, apps, logs, repos, db, tunnels, dns, settings, auth
    apps/ system/ repos/ databases/ tunnels/ dns/ settings/ login/ setup/
```
