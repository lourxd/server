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

`npm test` runs the suite (`node --test`, no dependencies — it must stay that
way). It covers the logic worth trusting: environment splitting and `.env`
round-tripping, status mapping, port probing, connection-string parsing and
building, PM2 env sanitising and filtering, stack integrity, activity tracking,
build logs and path safety.

**Server modules import by relative path, never `$lib`.** The alias is Vite's,
so a server module using it cannot be imported by `node --test`; `appenv.js` and
`cloudflare/dns.js` both hit this. Components may use `$lib` freely.

**Shared display and matching logic lives in `src/lib`, not in two components.**
`net.js` matches a tunnel route to an app's port, `format.js` renders a
connection endpoint, `ZoneHint.svelte` states the zone requirement. Each existed
twice before, and the port match was a regex built inline in both places — which
would have matched `:30000` for port `3000` had either been written slightly
differently.

**A page load should send what the page reads, and no more.** The app detail
load shipped the process's whole PM2 environment — 28 keys, more than half the
payload — that nothing on the client used.

**Testable logic does not belong in a route.** `+server.js` files cannot be
imported outside Vite, so anything in one is unreachable from a test. That is
why `appenv.js` exists, and why `ports.js` takes the app list as an argument
instead of importing `pm2.js` — reaching for the PM2 client opened a daemon
connection that never closed, and hung the test run.

Beyond `npm test`, verification is: build cleanly, then exercise the affected
routes against the running service. A build
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
    apps/ repos/ databases/ tunnels/ dns/ network/ settings/ login/ setup/
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

- **Argv arrays, never shell strings.** `exec.js` spawns with `shell: false`,
  and there is no `sh -c` left in the tree: `which()` scans `PATH` in Node and
  refuses anything that is not a bare binary name, so even binary lookups avoid
  a shell. No code path interpolates user input into a shell command, and none
  should.
- **`safeRepoPath()` gates every filesystem path** derived from a request. It
  refuses `..` traversal and absolute paths, and confines everything to the
  projects directory.
- **Secrets are AES-256-GCM encrypted** before hitting SQLite. The key lives in
  `data/secret.key` (0600), *beside* the database rather than inside it, so a
  copied `panel.db` is not sufficient. Tokens are never returned to the browser
  after saving, and are redacted from streamed command output.
- **There is no way to reopen sign-ups.** The first account becomes the admin;
  every later `sign-up/email` is refused in a Better Auth `databaseHooks.user`
  hook, with no setting behind it. A panel that can start processes and read
  databases should never have a self-service registration switch a stray click
  can flip.
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

**The build does not check identifiers used in markup.** A name referenced in a
template but never imported compiles cleanly and throws `ReferenceError` at
render — the page 500s and nothing before that says a word. `test/markup.test.js`
walks every component, collects what the script declares (imports, `$props`
destructuring, `{#each}` bindings, `{@const}`, snippets, arrow parameters) and
fails on anything the markup references that is not there. It found a dangling
`appTargets` in the quick-tunnel dialog that would have crashed that dialog.

**Deleting a module-scope function leaves no trace until it is called.** A
helper removed as "unused" that another function in the same file still calls
builds cleanly and throws at runtime — Rollup treats the missing name as a
global. Deleting an internal function means grepping the file for it, not
trusting an export audit: `createRecord` and `updateRecord` looked unreferenced
from outside while `upsertRecord` depended on both, and removing them would have
broken every tunnel route.

**A Rollup "not exported" warning is a runtime crash in waiting.** `disconnect`
was called by `realtime.js` but not exported from `pm2.js`; the build succeeded
and shutdown would have thrown.

**Probe a port by binding it, not by reading the listener list.** A bind test
catches processes owned by other users, which `networkConnections()` reports
without a PID. Test hosts **sequentially** — binding `0.0.0.0` and `127.0.0.1`
in parallel makes the second collide with the first and reports every free port
as taken. `ports.js` does this and names the holder by matching its PID against
the PM2 list.

**`~/.local/bin` is not on a systemd unit's PATH either.** Installing
`cloudflared` there worked and the panel then reported it as not installed, so
the button appeared to do nothing. `exec.js` adds both the Node bin directory
and `~/.local/bin` to every child's PATH and to `which()`, which is where the
panel puts anything it installs without sudo.

**Cloudflare returns an empty list, not an error, for anything a token cannot
see.** `/accounts` and `/zones` both answer 200 with `result: []` and no
`errors`, so absence never distinguishes "you have none" from "this token
cannot see them". Say which it is: no zones visible at all is a token-scope
problem, while zones visible but none matching is a wrong hostname — the route
error names the zones it can see.

**Listing Cloudflare accounts needs `Account · Account Settings · Read`, which
`Cloudflare Tunnel · Edit` does not include.** An empty `/accounts` therefore
says nothing about whether a token can create a tunnel — never reject one on
that basis, which briefly meant a good token was refused and the revoked one
stayed. Resolve the account id from `/accounts`, fall back to any zone's
`account.id`, and fall back again to an Account ID the user pastes; store the
token whenever `/user/tokens/verify` passes. The account id is required — a
tunnel is created under an account — so Settings asks for it plainly rather
than explaining the permission quirk that made it necessary.

**Cloudflare setup lives in Settings and nowhere else.** Network and an app's
Network tab detect what is missing and link to `/settings?tab=cloudflare`; they
do not carry their own installer. One place to get it right.

**A systemd unit's PATH has no nvm directory.** The unit starts the panel with
an absolute path to node, so the panel itself runs — but every spawned `npm`,
`npx`, `pnpm` or `yarn` fails with `spawn npm ENOENT`, and only after a clone
has already succeeded (git lives in /usr/bin). `exec.js` prepends
`dirname(process.execPath)` to `PATH` for every child, so builds use the same
toolchain that runs the panel regardless of how it was launched; the unit sets
`PATH` too.

**An app inherits the environment of whoever started the PM2 daemon, and of the
client that started the app.** Both leak. When the panel spawned the daemon, the
daemon carried the panel's `HOST`, `PORT=8088`, `NODE_ENV` and `PM2D_*`, and
every app inherited them — an app that did not set `PORT` would have picked up
the panel's. `pm2 save` then bakes the leak into `dump.pm2`, so `resurrect`
restores it even after the daemon is clean. Two conditions keep it clean:
`pm2.service` owns the daemon with only `PM2_HOME` and `PATH` set, and the panel
passes an explicit `env`. Starting an app with the `pm2` CLI from a normal shell
reintroduces it — the CLI ships its own `process.env` with the app config.

**Set only what an app cannot run without, and make it visible.** Presets fill
`PORT` (protective: without it the app inherits the daemon's) and
`NODE_ENV=production`. `HOST` belongs only to stacks whose server binds
localhost by default — Astro's node adapter — not as a blanket default.
Everything a preset sets shows up in the environment editor, where it can be
removed.

**PM2's process env is mostly the machine's, not the app's.** It carries
whatever the daemon inherited — `SSH_AUTH_SOCK`, `GPG_AGENT_INFO`,
`MANAGERPIDFDID`, XDG and systemd keys — so a denylist never keeps up. On start
the panel stamps `SCP_ENV_KEYS` with the keys it set, and `appEnv()` returns
exactly those; the denylist is only the fallback for apps started outside the
panel.

**Changing an app's environment means delete + start, not restart.** PM2's
`restart` with `updateEnv: true` rebuilds the child env from the PANEL's
`process.env` (`Common.safeExtend({}, process.env)` when `PM2_PROGRAMMATIC` is
set) — the same leak that once made PM2 relaunch the panel instead of the app.
`updateEnv` is off the table. `update-env` in `api/apps` reconstructs the
options from `describe`, deletes, and starts again through the hardened
`startProcess` path, rolling back to the previous env if the new start fails.
The pm_id changes, so the client follows the redirect.

**Never write an SVG path from memory.** The five database marks added to
`TechLogo.svelte` were invented and looked wrong on screen — PostgreSQL's real
path is 5091 characters, the fabricated one was 1243. The thirteen original
marks were sourced properly and verified correct. To add one: `npm i
simple-icons` in a scratch directory, read `si<Name>.path`, paste it, verify the
string matches, and delete the scratch install.

**Never put a secret in PM2's environment.** `pm2 save` serialises every
process's env into `~/.pm2/dump.pm2`, which PM2 creates **0664** inside a **0775**
directory — world-readable to every local account. Secrets go into a `.env` file
written 0600 in the project directory, and the panel adds `.env` to that repo's
`.gitignore`. Node entry points get `--env-file-if-exists=.env` as an interpreter
arg; the frameworks (Next, Vite, Astro, Nuxt) read `.env` themselves. Only
non-secret config is handed to PM2.

**systemd's default `KillMode=control-group` killed every deployed app.** The
panel called `pm2.connect()`, which spawns a PM2 daemon when none exists — as a
child of the panel, so inside the panel's cgroup. Every `systemctl restart
control-panel` then SIGKILLed the whole cgroup: daemon, apps, everything, with
no error anywhere. Apps simply vanished from `pm2 list`. Two fixes, both needed:
`KillMode=process` on the panel's unit, and a separate `pm2.service` that owns
the daemon and runs `pm2 resurrect` so apps also come back after a reboot.
`pm2.disconnect()` is innocent — it only closes the RPC and bus sockets.

**`NODE_ENV=production` leaks into every child process.** `exec.js` spreads
`process.env`, and the panel's unit sets `NODE_ENV=production` for itself. `npm
install` then omits devDependencies, so a Next/Vite/TS project installs a tree
that cannot build — `Cannot find module '@tailwindcss/postcss'` and friends. The
install action now unsets `NODE_ENV` for the child (pass `null` in `env` and
`childEnv()` deletes the key) and passes `--include=dev` for npm.

**A failed Next.js build poisons the next one, and leaves a directory that
looks like a build.** Turbopack writes partial chunks into `.next` before
failing, so the retry fails identically AND `fs.existsSync('.next')` says the
build is fine. Checking the output directory is not enough: stacks declare a
`buildMarker` — the file only a finished build produces (`.next/BUILD_ID`,
`build/index.js`, `.output/server/index.mjs`, `dist/server/entry.mjs`) — and the
start guard checks that. The build step deletes an output directory that exists
without its marker before rebuilding, which is safe because it is provably not a
build; it never deletes anything else, and the path is confined to the project.

**Never run `npm run build` against a live panel — use `npm run build:safe`.**
`vite build` rewrites `build/` in place, deleting and re-emitting hashed chunks,
which breaks the running process two ways: sirv caches its file manifest at boot
and a request for a removed asset makes a ReadStream emit an unhandled `ENOENT`
that kills the process, and a half-written `build/` leaves the server importing
chunk names that no longer exist (`Cannot find module .../nodes/0.js-XXXX.js`,
500 on every route). Both have happened here. `scripts/build.sh` builds into
`.build-staging` via `SCP_BUILD_OUT` and renames it into place, so the live
build is never partial and a failed build leaves the previous one untouched.
It does NOT remove the need to restart afterwards: the running process still
holds the old manifest, so the sequence is `npm run build:safe && systemctl
--user restart control-panel`.

**`si.networkStats()` with no argument returns only the default interface.**
Pass `'*'` for all of them. The interfaces table silently showed exactly one row
until this was found. Filter loopback (`/^lo\d*$/`) out of the aggregate totals
or `lo` traffic inflates them.

**`si.networkConnections()` reports no PID for processes owned by other users.**
The panel does not run as root, so system daemons come back with `pid: null` and
an empty process name. The UI says "another user" rather than pretending.

**bits-ui renders `data-state="active"`, not `data-active`.** The vendored
shadcn `tabs-trigger.svelte` styled the active tab with `data-active:` variants,
which Tailwind compiles to `[data-active]` — an attribute bits-ui never sets. It
generated valid CSS that matched nothing, so no tab ever looked selected on any
page, and the earlier "fix" for the Settings tabs changed colours on a selector
that could not match. Use `data-[state=active]:`. When a shadcn component's
state styling silently does nothing, check the attribute the primitive actually
emits before touching the colours.

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
  folded into Apps, not deleted. Repositories is back as its own page. System is gone for good — its panels were
  split across Overview (compute, storage, processes), Network (interfaces and
  throughput) and Settings' System tab (the static machine/toolchain readout).
  Overview is a long scrolling page now, not a viewport-height dashboard.
- **DNS record management is Cloudflare-only; resolution is not.** `resolve()`
  uses `node:dns` against 1.1.1.1 and 8.8.8.8 and needs no account, so the
  Lookup tool works with no token. Managing records elsewhere means a provider
  interface with Cloudflare as one driver — the shape to aim for if this grows.
  Running an authoritative nameserver on the box is not viable: port 53 is
  EACCES for the panel's user, `systemd-resolved` already holds 127.0.0.53:53,
  and the machine is behind NAT (192.168.50.227 vs 85.246.175.66).
- **A clustered app is many PM2 processes and one app.** `instances: "max"` in
  an ecosystem file means one process per core — 16 on this machine — and the
  list showed 16 rows, which reads as 16 apps appearing from one click.
  `live-group.js` groups by name: one entry carrying the instance count, summed
  cpu and memory, and the worst instance's status so a single failure stays
  visible. Actions on a grouped app target the NAME, since a pm_id only reaches
  one instance. Starting from an ecosystem file now says how many processes it
  will create first, read by requiring the file in a child process rather than
  in the panel.
- **A tunnel connector is a PM2 process, and must not read as an app.**
  `shapeProcess` sets `kind` from `SCP_KIND`, falling back to a `tunnel-` name
  prefix for ones started before the marker existed. `live.apps` filters them
  out; `live.all` is the unfiltered list and `live.connectors` the tunnels.
  `listTunnels()` matches by `pm2Name` against `pm2.list()` and is unaffected.
- **Never put a secret in a PM2 process's argv.** `ps` shows argv to every user
  on the machine, and the panel sent `args` to the browser. The connector takes
  its run token through `TUNNEL_TOKEN` now, and `shapeProcess` blanks `args` for
  a managed process so a token in an older one is not served to a page.
- **`shapeProcess` is the only place app metadata gets read out of PM2's env.**
  `list()` drops the raw env, so anything the UI needs — `stack`, `port`,
  `dbId`, `dbVar` — has to be lifted there. A component reaching for
  `app.env?.PORT` silently gets `undefined`, which is how the route dialog's app
  shortcuts never once appeared.
- **An app's Network tab is a shortcut into the Network page, not a second
  implementation.** It finds routes whose service matches this app's `PORT` and
  adds one through the same `/api/tunnels` actions. Installing `cloudflared` and
  creating a tunnel stay on the Network page; the tab links there rather than
  duplicating them.
- **DNS reads, it never writes — that is what makes it provider-free.**
  `server/dns.js` uses `node:dns` and an HTTP probe only: no account anywhere.
  A domain is "serving" when it resolves AND answers, which is the only check
  that survives a proxy — a proxied Cloudflare record resolves to anycast IPs,
  so comparing against an expected CNAME or the server's own IP reports a
  working domain as broken. Cloudflare zone access stays where it is genuinely
  needed: creating a tunnel route writes the CNAME for you.
- **Cloudflare refuses to delete a tunnel that still has open connections.**
  Stopping the connector does not close them immediately — a healthy tunnel here
  holds four — so a delete issued straight afterwards fails. `deleteTunnel`
  calls the connections cleanup endpoint and polls until they drop before
  deleting, and if the delete still fails it re-reads the tunnel: gone or
  `deleted_at` counts as success, anything else throws and the local record is
  KEPT. Swallowing that error is what leaves a tunnel in the account with
  nothing in the panel pointing at it.
- **Tunnels and DNS are pages of their own.** They were tabs on Network for a
  while; ingress is used far more than interface telemetry and buried badly
  there. Network is machine networking again — throughput, interfaces, listening
  ports. Setup still lives only in Settings; Tunnels and DNS link there.
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
