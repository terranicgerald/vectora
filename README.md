# vectora

[![npm version](https://img.shields.io/npm/v/vectora)](https://www.npmjs.com/package/vectora)
[![CI](https://github.com/terranicgerald/vectora/actions/workflows/ci.yml/badge.svg)](https://github.com/terranicgerald/vectora/actions/workflows/ci.yml)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**vectora is the scoped replacement for CLAUDE.md.**

CLAUDE.md is a static blob loaded into context every turn until it bloats every prompt. vectora makes project knowledge **dynamic and scoped** — for each task it hands your agent the **minimal relevant files** and **only the rules that task touches**, decomposes multi-step prompts, routes them (including parallel sub-agents), and closes every prompt with an **honest involvement banner**. Same knowledge, a fraction of the context.

Works with Claude Code, Cursor, Windsurf, Codex, Kiro, OpenCode, and Gemini CLI.

---

## In 30 seconds

```
You: /vectora add a userId param to parseConfig, then update its tests,
     and also add rate limiting to the payments API

vectora map:
  vectora · 3 tasks · 247 files indexed → 11 in scope
  ROUTING: tasks 1 & 2 share scope → run in order, reuse context.
           task 3 is independent (disjoint scope) → parallel sub-agent.

  ── TASK 1/3 · "add a userId param to parseConfig" · relevant: 5
     RULES:     parser changes need a migration note
     CO-CHANGE: parser.ts + validator.ts (git 8×)
     FILES:     config/parser.ts · config/validator.ts · billing/charge.ts · …
  ── TASK 2/3 · "update its tests" · relevant: 3
     FILES:     config/parser.test.ts · config/validator.ts · …
  ── TASK 3/3 · "add rate limiting to the payments API" · relevant: 4
     FILES:     payments/api.ts · payments/limiter.ts · …

Agent loads only each task's slice — loaded: 5/5, 3/3, 4/4 — and spawns a
sub-agent for task 3 so its context never bloats with tasks 1–2.

vectora check:
  ╭ vectora · this prompt ─────────────────────────────────────╮
  │ 3 tasks · scoped to 11 of 247 indexed files                │
  │ rules applied: 1  ·  co-change links surfaced: 1           │
  │ check: 0 callers to verify · 0 confirmed breaks            │
  │ vectora narrowed the field — each task saw only its slice  │
  ╰────────────────────────────────────────────────────────────╯
```

Every figure is a fact — files indexed, files scoped-to, rules applied, links surfaced. **No invented "tokens saved" number, ever.**

---

## What it gives you

- **Per-task relevant file set** — the prompt is decomposed into tasks; each gets its own minimal scope, so the agent (and any sub-agent) loads only its slice instead of bloating context.
- **Routing** — single / chained-sequential / independent-parallel, so the agent knows when parallel sub-agents keep each context small. The agent decides; vectora informs.
- **Scoped institutional memory** — the learned rules that apply to *this* task's files, surfaced inline. The CLAUDE.md upgrade: not the whole rulebook every turn.
- **Git + session co-change** — files real engineers edited together in real commits, plus files *you* edit together across sessions. The "did you forget a partner?" signal that lives only in `git log`. On a repo with no history, session coupling stands in from day one.
- **Honest involvement banner** — every prompt closes with a facts-only summary of what vectora did.
- **Post-edit safety net (`check`)** — confirmed arity breaks, co-change misses, symbol-consumer warnings, stale tests. Secondary to the scoping, but still there.

None of the indexing requires an LLM call. It's AST parsing + git log, fully offline.

---

## Setup

```bash
npx vectora@latest        # detects your agent(s), installs the skill
```

Then, once, inside your agent:

```
/vectora init
```

`init` is **fully offline, zero tokens** — it parses your AST, builds the import graph, reads git history, writes `.vectora/graph.json`. No LLM, no network, no telemetry.

**Commit `.vectora/graph.json`.** Everyone who clones gets the map on day one, in whatever agent they use.

### TypeScript / monorepo

Path aliases (`@/`, `~/`, `#lib/`) and monorepo workspace cross-package imports resolve automatically. The init output confirms: `aliases: 12 path aliases · 4 workspace pkgs`. If aliases don't resolve, set `tsConfigPath: 'tsconfig.app.json'` in `vectora.config.js`.

---

## The loop: map → navigate → check

**`/vectora <task>`** runs the full loop automatically:

| Step | What happens |
|---|---|
| `map` | Seeds the task by keyword match. Shows CO-CHANGE first (git + sessions), then START HERE files, then NEIGHBORHOOD. Also prints `context: N files indexed · M in scope`. |
| navigate | Agent opens files by its own judgment. Nothing is hidden. |
| `check` | Confirmed arity breaks (`✗`), co-change misses (`⚠`), symbol consumers, stale tests. |

**`/vectora prompt <task>`** is the guaranteed-trigger form — use it when you want vectora to run unconditionally, even for short or follow-up prompts. Same 6-step loop, no activation heuristics.

### The receipt (`vectora check`)

After every edit, `check` reports four things — signals 2–4 need no git history:

```
✗ BROKEN — fix before finishing:
✗ billing/charge.ts calls parseConfig() with 2 args but it now requires 3 — fix this call.

⚠ config/validator.ts co-changes with config/parser.ts (git 8× · sessions 2×) but wasn't edited.

⚠ retry.ts imports errors.ts (uses RetryError) but wasn't edited — verify?

⚠ charge.ts changed but charge.test.ts wasn't — update the test?
```

- `✗ BROKEN` = proven arity mismatch from the live AST. **Fix every one before declaring done.**
- `⚠` = probable miss. Investigate each. If it genuinely needs the change, make it.

`check` works even if you skipped `map` — it computes misses directly from the graph.

---

## Commands

**Core guardrails** — run these on every coding task:

| Command | What it does |
|---|---|
| `/vectora <task>` | Map → navigate → check (the full loop) |
| `/vectora prompt <task>` | Same loop, guaranteed trigger — no heuristics, no follow-up detection |
| `/vectora check` | Receipt: `✗` breaks, `⚠` co-change misses, caller warnings, stale tests |
| `/vectora preflight` | Before a risky session: graph staleness, danger zones, open misses, rule count |
| `/vectora manifest` | After a session: causal PR receipt — why each file changed. Paste into PR description. |

**Exploration** — understand the codebase:

| Command | What it does |
|---|---|
| `/vectora init` | Build the graph (offline, 0 tokens) |
| `/vectora diff` | Fast incremental graph update. Always shows current state: file count, domains, age. |
| `/vectora overview` | Architecture summary: pivots, domains, entry points, orphans, circular imports |
| `/vectora overview --debt` | Coupling debt scores — highest-risk pairs with no test coverage |
| `/vectora why <file>` | File's centrality, blast radius, importers, co-change peers |
| `/vectora impact <file\|sym>` | What breaks if you change this? Direct + transitive dependents. |
| `/vectora trace <symbol>` | Where defined, who calls it, what its file depends on |
| `/vectora history <file>` | Cross-session coupling memory for a file |
| `/vectora impact-report` | 30-day summary: breaks caught, co-change used/missed. Share in retrospectives. |
| `/vectora status` | Graph staleness + receipts summary |
| `/vectora watch` | Auto-rebuild on file changes |

**Institutional memory** — rules that persist across sessions:

| Command | What it does |
|---|---|
| `/vectora learn "<rule>"` | Teach vectora an architectural rule (always asks before writing) |
| `/vectora unlearn "<rule>"` | Remove a rule (asks to confirm) |
| `/vectora migrate` | Auto-discover CLAUDE.md, README, .cursorrules and extract rules from them |
| `/vectora receipts` | Lifetime count of incomplete edits flagged (honest, inspectable) |

---

## Why this is honest

vectora 1.x claimed to save tokens by "skeletonizing" files. Measured on a real task (`sindresorhus/got`), it cost **~3× more tokens** and buried the actual edit targets. The token-savings figure was invented.

2.0 deletes all of that. The only numbers vectora reports are ones it can prove on *your* repo:

- **`✗ BROKEN`** — call count and current signature both re-parsed from disk at `check` time. It's the live AST. Either the numbers match or they don't.
- **`vectora receipts`** — lifetime count of incomplete edits flagged, stored in `.vectora/ledger.json`. Every entry is a real, inspectable event. Wording is always "flagged" — not "caught" or "saved."
- **Nothing hidden from the agent.** No skeletons, no "don't open this."
- **Zero-token init.** No LLM in the indexing path.

---

## Danger zone annotations

Co-locate critical constraints with the code they guard so the agent sees them exactly when relevant:

```ts
// @vectora danger: changing this signature requires a DB migration — see ADR-42
// @vectora danger: called by mobile app v2.x with 2-week deploy lag — no breaking changes
```

```python
# @vectora danger: JWT secret rotation required if auth flow changes here
```

Works in any language (JS/TS `//`, Python/Ruby `#`, Go/Rust `//`). At `map` time, if a seed or co-change partner carries a danger annotation, vectora surfaces it first:

```
⚠ DANGER ZONES — constraints on files in your edit scope:
  auth/session.ts: "called by mobile app v2.x with 2-week deploy lag — no breaking changes"
  config/parser.ts: "changing this signature requires a DB migration — see ADR-42"
```

---

## Institutional memory

Architectural rules that the map surfaces when relevant. Create `.vectora/decisions.json`:

```json
{
  "global": ["Use dayjs, never moment.js."],
  "domains": { "auth": ["JWT expiry is 15 minutes for compliance."] }
}
```

Always user-in-the-loop — the agent proposes a rule and asks before writing it.

`decisions.json` is the **committed, team-shared rulebook** — the real replacement for CLAUDE.md. `init` writes a `.vectora/.gitignore` that tracks only `decisions.json`; the graph, session coupling, and ledger stay per-developer. Commit `decisions.json` so the whole team shares one rulebook, and each rule surfaces only on tasks that touch its domain.

**Auto-seeding on first init:** When `init` runs for the first time, it emits a `[VECTORA SEED]` block. The agent then runs `overview` + `why` on the top pivot files, optionally runs `migrate` to pull rules from your CLAUDE.md or README, and proposes 3–7 architectural rules for you to approve.

**Background capture:** After tasks that establish a new coupling invariant or architectural pattern, the agent asks: *"I noticed: `<rule>`. Add it to vectora's memory?"* On approval: `npx vectora learn "<rule>"`. Never written silently.

---

## Language support

| Language | Parser | Import edges | Exports |
|---|---|---|---|
| JavaScript / JSX | Babel AST | ESM + CJS | ✅ |
| TypeScript / TSX | Babel AST | ESM + CJS, `.js`→`.ts`, `@/` path aliases | ✅ |
| Python | grammar | `import` / `from` | `def` / `class` |
| Go | grammar | `import` blocks | exported symbols |
| Rust | grammar | `use` / `mod` | `pub` items |
| Ruby | grammar | `require_relative` | `def` / `class` |

TypeScript path aliases (`@/*`, `~/`, `#lib/`), `jsconfig.json` `baseUrl`, and monorepo workspace cross-package imports are all resolved — no configuration needed.

---

## Configuration

Optional `vectora.config.js` in your project root:

```js
module.exports = {
  pivotThreshold:      0.15,  // top N% by centrality flagged as pivots
  coChangeMaxFiles:    15,    // ignore commits touching more than N files ("format everything" noise filter)
  refreshAfterHours:   24,    // auto-diff if graph is older than N hours
  refreshAfterChanges: 10,    // auto-diff after N changed files
  tsConfigPath:        null,  // point to a non-standard tsconfig, e.g. 'tsconfig.app.json'
  forcePivots:         [],    // paths always treated as pivots
  exclude:             [],    // globs to skip, e.g. ['**/*.generated.ts']
  domains:             null,  // explicit domain map: { 'src/billing/**': 'payments' }
};
```

`coChangeMaxFiles` is the noise filter that makes co-change trustworthy: a "reformat the whole repo" commit would otherwise link every file to every other. vectora drops commits touching more than 15 source files.

---

## Privacy

vectora runs entirely offline. Reads your source and git history locally, builds the graph, writes `.vectora/graph.json`. Nothing leaves your machine — no telemetry, no analytics, no API calls, no LLM in the indexing path.
