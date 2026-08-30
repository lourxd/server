# CLAUDE.md

**The guide for this repository is [`AGENTS.md`](./AGENTS.md). Read it before
your first edit.**

It covers the stack and its hard constraints, the build and service commands,
where code belongs, the conventions this codebase actually follows, the security
invariants, and a list of gotchas that have each already cost a debugging
session here.

`README.md` is the user-facing manual — install, configuration, feature tour.
Read that to answer a question about what the panel does.

Three things worth knowing before you open either:

- **No native modules.** Nothing in `dependencies` may require a compile step.
- **Realtime is SSE, never WebSockets.** `adapter-node` has no upgrade path.
- **The source carries no comments**, by instruction. Document in `AGENTS.md`.
