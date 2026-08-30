# AGENTS.md

Operating guide for AI coding agents working in this repository.
`README.md` is the user-facing manual — install, configuration, feature tour.
This file is the working contract: how to build it, what the invariants are, and
which mistakes have already been made here.

Read this before your first edit. Read `README.md` before answering a question
about *what the panel does*.

---

## 1. What this is

A single-machine realtime control panel. One Node process, run by systemd,
that supervises PM2 apps, reports system metrics, clones GitHub repositories,
talks to user databases, and manages Cloudflare Tunnels/DNS.

It is not multi-tenant, not clustered, and not a SaaS. Every design decision
assumes **one server, a handful of trusted operators, one PM2 daemon**.

Access to the panel is equivalent to shell access on the box. Treat every change
that touches auth, path handling or process spawning as security-relevant.

---

## 2. Stack and hard constraints

| Layer | Choice | Constraint |
|---|---|---|
| Framework | SvelteKit 2.70, Svelte 5 **runes** | No stores, no `export let`. `$state`/`$derived`/`$props`/`$effect`. |
| Adapter | `@sveltejs/adapter-node` | No WebSocket upgrade. Realtime is **SSE only**. |
| Runtime | Node ≥22, developed on 24 | `node:sqlite` must exist. |
| Panel DB | Drizzle ORM over `sqlite-proxy` | Drizzle ships no `node:sqlite` driver; the proxy adapter in `store/index.js` bridges it. |
| Auth | Better Auth 1.7 + `admin` plugin | Owns `user`/`session`/`account`/`verification`. Do not model those in Drizzle. |
| UI | shadcn-svelte 1.5 on Tailwind **v4** | `@theme inline`, not `tailwind.config.js`. |
| Icons | `@lucide/svelte` | One import per icon path. |

### The zero-native-modules rule

**Nothing in `dependencies` may require a compile step.** This is the reason the
panel installs in seconds on a fresh box and survives Node upgrades without a
rebuild. `better-sqlite3` was removed for exactly this reason — no prebuilt
binary existed for the Node 24 ABI.

Before adding a dependency, check it has no `install`/`postinstall` gyp step.
If you need SQLite, use `node:sqlite`'s `DatabaseSync`.

### Realtime is SSE, not WebSockets

`adapter-node` does not expose the HTTP upgrade path, so there is no WS server.
The whole app shares **one** `EventSource` at `/api/stream`, owned by
`src/lib/live.svelte.js`. Never open a second one. Never poll a `/api/` route on
a timer from a component — add an event to the broadcast in
`server/realtime.js` instead.

---

## 3. Commands

```bash
npm install
npm run dev            # vite dev, port 5173
npm run build          # vite build -> build/
npm start              # node build/index.js
npm run db:generate    # after ANY edit to store/schema.js
npm run db:studio
npm run db:check
```

There is **no test suite and no linter configured**. Verification is: build
cleanly, then exercise the affected routes against the running service. A build
that emits Rollup warnings about missing exports is a failure, not a warning —
that class of warning has shipped a runtime crash here before (§8).

### The live service

The panel runs on this machine as a **systemd user service**:

```bash
systemctl --user status control-panel
systemctl --user restart control-panel
journalctl --user -u control-panel -f
```

Unit template: `deploy/control-panel.service`. Installed copy:
`~/.config/systemd/user/control-panel.service`.

**Never manage the panel with PM2.** It supervises PM2; if PM2 supervised it,
`pm2 kill`, a daemon crash, or the panel's own "stop all" would take the panel
down with no route back. This is a deliberate architectural boundary, not a
preference.

---

## 4. Layout and where things belong

```
src/
  hooks.server.js         boot sequence + auth guard. Everything starts here.
  app.css                 the entire design system (tokens + 6 component classes)
  lib/
    live.svelte.js        shared EventSource, toasts, api()/apiGet()/streamPost()
    format.js             bytes/duration/relTime/num/pct/cell
    stacks.js             12 deploy presets for the new-app wizard
    utils.js              cn()
    components/
      ui/                 shadcn-svelte primitives — treat as vendored
      *.svelte            our components (PageHeader, StatCard, ConfirmDialog, …)
    server/
      store/              the panel's OWN state (Drizzle)
      db/                 USER-managed database drivers — different thing
      cloudflare/         v4 API client, tunnels, dns
      auth.js pm2.js metrics.js repos.js logs.js
      exec.js realtime.js sse.js cache.js
  routes/
    api/                  json + sse endpoints
    apps/ network/ settings/ login/ setup/    the pages that exist
```

**`server/store/` vs `server/db/` is the distinction people get wrong.**
`store/` is the panel's own SQLite state — settings, connections, tunnels, audit
log — managed by Drizzle. `db/` is the drivers for *the user's* databases that
the panel connects to. They share nothing.

### Import alias

`$srv` → `src/lib/server`. Use it: `import * as pm2 from '$srv/pm2.js'`.

---

## 5. Boot sequence

`hooks.server.js` runs a single promise at module load, and every request awaits
it. Order matters:

1. `runStoreMigrations()` — Drizzle migrations
2. `runAuthMigrations()` — Better Auth's own migrator
3. `loadSettings()` — primes the sync `settings()` accessor
4. `ensureProjectsDir()`
5. `startRealtime({ intervalMs: 2000 })`

`settings()` is **synchronous and throws if called before boot**. That is
intentional — it makes settings usable everywhere without threading `await`
through every call site. If you add a module that reads settings at import time,
you will break boot.

---

## 6. Conventions

### Code style: no comments

The source carries **zero explanatory comments**, by explicit instruction. Names
and structure carry intent; anything needing prose goes in `README.md` or this
file. Two functional exceptions survive: `<!-- svelte-ignore -->` directives and
shell shebangs.

Do not add comments back. If a block needs one, that is a signal to rename or
extract, or to document it here.

### Svelte 5

- `$props()` with destructuring, `$state`, `$derived`, `$effect`.
- **An `$effect` must never read state it also writes** — it re-triggers itself.
  Load data in `onMount`. This bug has been introduced twice in this repo (§8).
- `$derived` for anything computable; do not mirror props into `$state`.

### API routes

- Return `json(...)` — and `await` first. `json(promise)` serializes to `{}`,
  which has shipped here.
- `error(400, 'Sentence with a period.')` for client faults, `error(500, …)` for
  server faults. Messages are user-visible; write them as sentences.
- POST bodies: `await request.json().catch(() => ({}))`.
- Action-style endpoints dispatch on `body.action` against a lookup object
  (see `api/apps/+server.js`). Follow that shape.
- Unauthenticated requests to `/api/*` get `401 JSON`, never a redirect — the
  guard in `hooks.server.js` handles this. Do not re-implement it per route.

### Client transport

Use `api()`, `apiGet()`, `streamPost()` from `live.svelte.js`. They parse errors
consistently and raise a toast. Raw `fetch` in a component means the error path
is now inconsistent with the rest of the app.

### UI

- **Only shadcn-svelte components.** No hand-rolled buttons, inputs or modals.
- **Confirmations are `ConfirmDialog`, never `window.confirm`.** State what will
  actually happen — which directory gets deleted, what stops being reachable.
  It `preventDefault()`s so it stays open until the action settles.
- Icons: `import RotateCw from '@lucide/svelte/icons/rotate-cw'` — one per path,
  so only what is used is bundled. Lucide **dropped brand icons**: there is no
  `github`; `loader-2` is now `loader-circle`; there is no `history`.
- Stack logos are inlined simple-icons paths in `TechLogo.svelte` — a deliberate
  20 KB of paths instead of a dependency.
- The word is **apps**, not processes. User-facing copy says "app" everywhere.

### Design system

`src/app.css` is the whole thing. Tokens in `:root` / `.dark`, then six
composable classes: `.panel`, `.panel-raised`, `.accent-fill`, `.accent-wash`,
`.eyebrow`, `.dot`.

Reach for those before writing utility soup. `Card` already *is* `.panel` — do
not re-apply background or ring to a Card.

**Light mode is an undesigned flat fallback** (`--field: none; --glow: none`).
It is honest, not finished. Do not present it as designed.

---

## 7. Security invariants

Break any of these and the panel becomes a remote shell for the internet.

- **Argv arrays, never shell strings.** `exec.js` spawns with `shell: false`.
  There is no code path in this repo that interpolates user input into a shell
  command, and there must not be one.
- **`safeRepoPath()` gates every filesystem path** derived from a request. It
  refuses `..` traversal and absolute paths, and confines everything to the
  projects directory.
- **Secrets are AES-256-GCM encrypted** before hitting SQLite. The key lives in
  `data/secret.key` (0600), *beside* the database rather than inside it, so a
  copied `panel.db` is not sufficient. Tokens are never returned to the browser
  after saving, and are redacted from streamed command output.
- **Sign-in is rate limited per IP.** The real socket address is stamped onto
  every `/api/auth` request by the route handler, overwriting any
  client-supplied header. Do not trust `x-forwarded-for` here.
- **Never commit `.env` or `data/`.** Both are gitignored; `!.env.example` is
  the one exception. Never put a real path, host or token in a UI placeholder —
  a `/home/lou/...` placeholder leaked once already.
- Consequential actions go through `audit.record()`.

---

## 8. Hard-won gotchas

Every one of these cost real debugging time here. They are ordered by how much.

**Never spread `process.env` into a PM2 app's env.** When the panel itself runs
under PM2, `process.env` carries PM2's control variables (`pm_exec_path`,
`pm_cwd`, `pm_id`, `name`). Forwarding them makes PM2's fork container adopt the
panel's identity and **relaunch the panel instead of the app**, binding the
app's port. `sanitizeEnv()` in `pm2.js` strips them — but explicitly allows
`PM2_SERVE_*` through, since those configure PM2's static server. Blocking those
broke static deploys on the first fix attempt.

**The PM2 client does not fail loudly when its daemon dies.** After `pm2 kill`,
calls neither resolve nor reject — they hang forever. Every call in `pm2.js` is
bounded by a 10 s timeout, and a failure resets the client and retries once.

**SIGTERM must call `process.exit(0)` explicitly.** The PM2 socket keeps the
event loop alive, so a handler that cleans up but returns leaves systemd waiting
90 s for a SIGKILL. There is a 3 s bail-out timer. Restart time went 90 s → 0 s.

**Migration SQL is read from disk at runtime**, and `adapter-node` does not copy
`.sql` into `build/`. Resolving via `import.meta.url` works in dev and breaks in
the build. `store/index.js` resolves from `process.cwd()`, with
`PM2D_MIGRATIONS_DIR` as an override. Keep the source tree beside the build.

**`script: 'npm'` or `'npx'` is wrong for PM2.** It supervises the package
manager, not the app: signals don't propagate, and reload/memory limits hit the
wrapper. Use the real binary — `node_modules/next/dist/bin/next` — or PM2's
built-in static server for a folder of files. `stacks.js` encodes this per stack.

**GitHub: listing a repo needs Metadata, cloning needs Contents.** A fine-grained
token with Metadata alone lists repositories fine and then fails the clone with
the misleading *"Write access to repository not granted"* — GitHub is **not**
asking for write. `assertCloneAccess()` probes `git/refs/heads` explicitly and
says so plainly. The token goes in the **username** position of the clone URL;
the `x-access-token` username is the GitHub *App installation* convention, not
the PAT one.

**A `$effect` that reads the state it writes re-triggers itself.** Introduced
once, fixed, then reintroduced verbatim in another page. Load in `onMount`.

**`json(promise)` silently serializes to `{}`.** When a store function becomes
async, every call site must be audited for a missing `await`.

**Drizzle wraps driver errors.** A SQLite unique-violation code is on
`err.cause`, not the top-level error.

**"Unused" component audits must check cross-component deps.** `separator` was
deleted as unused because no *route* imported it — `select` imports it
internally. Grep the whole tree, `ui/` included.

**A Rollup "not exported" warning is a runtime crash in waiting.** `disconnect`
was called by `realtime.js` but not exported from `pm2.js`; the build succeeded
and shutdown would have thrown.

**`si.networkStats()` with no argument returns only the default interface.**
Pass `'*'` for all of them. The interfaces table silently showed exactly one row
until this was found. Filter loopback (`/^lo\d*$/`) out of the aggregate totals
or `lo` traffic inflates them.

**`si.networkConnections()` reports no PID for processes owned by other users.**
The panel does not run as root, so system daemons come back with `pid: null` and
an empty process name. The UI says "another user" rather than pretending.

**shadcn's dark active-tab style is invisible in this palette**
(`bg-input/30` over `bg-muted`). `tabs-trigger.svelte` overrides it.

---

## 9. Known incomplete work

Do not treat these as bugs to discover — they are known and deferred.

- **Deployed Next.js apps crash-loop.** The wizard declares a build command but
  never runs it, so `next start` dies with *"Could not find a production build
  in the '.next' directory"* and PM2 retries 30×. The fix is to execute the
  build step before the first start, plus `min_uptime`/`max_restarts` guards.
  **This is the top outstanding item.**
- **Light mode is undesigned** (§6).
- **System / Repos / Databases / Tunnels / DNS pages were removed**, but their
  API routes and `server/` modules remain. Repos/DBs/Tunnels/DNS are to be
  folded into Apps, not deleted. System is gone for good — its panels were
  split across Overview (compute, storage, processes), Network (interfaces and
  throughput) and Settings' System tab (the static machine/toolchain readout).
  Overview is a long scrolling page now, not a viewport-height dashboard.
- **Network is where ingress belongs.** When Tunnels and DNS come back, they go
  on this page, not on pages of their own — a route and the interface it exits
  through are the same question.
- Deploy-wizard inner steps beyond the stack tiles are not fully restyled.
- Connection state is no longer surfaced anywhere in the UI. `live.connected`
  still tracks it and reconnects; a dropped stream shows as stale numbers with
  no indicator.

---

## 10. Working agreements

- **Do the whole task.** If part is blocked, finish everything else and say
  explicitly what was left and why.
- **Verify before reporting.** Build, hit the routes, read the journal. Do not
  report a change as working because the edit applied — a string-replace that
  silently failed to match once left a "shipped" feature that never rendered.
- **Report failures plainly.** If a test fails or a step was skipped, say so
  with the output.
- **Ask before destructive or outward-facing actions** — deleting directories,
  pushing, changing the running service.
- Commit messages: imperative subject, body explaining *why*.
