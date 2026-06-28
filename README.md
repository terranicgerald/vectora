AI agents read the wrong files. vectora gives them a map first.

Two commands to set up. Nothing to configure or learn after that.

---

## Install

```bash
# Build the structural graph for your project
npx vectora init

# Install the skill into your AI agent (auto-detects Claude Code, Cursor, Codex, Windsurf)
npx vectora install
```

---

## Supported Agents

| Agent | Installed to |
|---|---|
| Claude Code | `.claude/skills/vectora/SKILL.md` |
| Cursor | `.cursor/rules/vectora.mdc` |
| OpenAI Codex CLI | `AGENTS.md` |
| Windsurf | `.windsurfrules` |

`npx vectora install` detects which agents are present and writes the right format for each.

---

## How it works

`npx vectora init` scans your project once and builds a dependency graph from real AST parsing — actual import chains, actual export surfaces, actual module boundaries. It scores every file by weighted centrality and classifies the top 15% as pivot files. It clusters files into domains and builds a vocabulary per domain. The output is a single file: `.vectora/graph.json`.

The skill runs on every task without any command or keyword. Before your agent opens any source file, it reads the graph, decomposes the prompt into sub-tasks if needed, matches each sub-task to its domain, deduplicates shared pivots across sub-tasks, and executes each sub-task sequentially with its own clean context. Non-pivot files are never opened — they're represented as 3-line skeletons synthesized directly from the graph. The activation banner appears first on every response so you can see it ran.

The graph stores the current git HEAD hash. The skill checks for staleness at session start and triggers a silent refresh when the codebase has drifted. You don't need to run `init` again unless forcing a full reset.

---

## What you see — single task

```
╔─ vectora ─────────────────────────────────────────────╗
│ domain:    auth                                       │
│ pivots:    env.ts, rateLimit.ts ✦                   │
│ skipped:   9 files → skeletonized                    │
│ est. save: ~3,840 tokens vs unguided                 │
╚───────────────────────────────────────────────────────╝
  ✦ manually declared via @vectora pivot
```

Pivot files loaded in full. 9 files reduced to 3-line skeletons — synthesized from graph data, not opened. The agent navigates directly to the right place.

---

## What you see — chained tasks

```
╔─ vectora ───────────────────────────────────────────────╗
│ chained tasks: 3                                        │
│ shared pivots: env.ts, rateLimit.ts ✦ → once           │
│                                                         │
│ [1/3] domain: auth                                      │
│        pivots: login.ts, jwt.ts                         │
│        skipped: 5 files → skeletonized                  │
│                                                         │
│ [2/3] domain: payments                                  │
│        pivots: charge.ts                                │
│        skipped: 4 files → skeletonized                  │
│                                                         │
│ [3/3] domain: dashboard                                 │
│        pivots: overview.ts                              │
│        skipped: 3 files → skeletonized                  │
│                                                         │
│ est. save: ~7,680 tokens vs unguided                    │
╚─────────────────────────────────────────────────────────╝
  ✦ manually declared via @vectora pivot
```

When a prompt spans multiple domains, vectora decomposes it, loads each domain's context separately, and executes in order — without flooding context or losing the thread mid-task.

---

## What changes

The agent navigates to the right files immediately instead of reading the whole codebase for orientation. Files outside the relevant domain cost 3 lines instead of hundreds. Chained prompts execute cleanly across domains without context bleeding between them. The graph stays current via git hash comparison. The session summary at the end of every response shows exactly what loaded and what ran.

---

## Optional controls

None of these are required.

**`/vectora update`**
Force a full graph rebuild from inside your AI agent after a major refactor. The agent runs the CLI synchronously and resumes with a fresh graph.

**`vectora.config.js`** (never created automatically)
```js
module.exports = {
  pivotThreshold: 0.20,       // default: 0.15
  refreshAfterHours: 12,      // default: 24
  refreshAfterChanges: 5,     // default: 10
  forcePivots: [
    'src/core/engine.ts'
  ],
  exclude: [
    'src/generated/**',
    'src/migrations/**'
  ],
  domains: {
    'auth': 'src/auth/**',
    'payments': 'src/payments/**'
  }
}
```
All fields are optional. Unknown fields warn and are ignored. A bad config never crashes the CLI.

**`// @vectora pivot`**
Add this comment to any source file to permanently declare it a pivot regardless of centrality score. It appears with ✦ in every banner. Works even on files the parser can't handle — scanned from raw text before AST parsing.

---

## Supported in v1

- JavaScript (`.js`, `.jsx`) and TypeScript (`.ts`, `.tsx`)
- ES module syntax (`import`/`export`)
- Relative imports and local package resolution
- Single-package repositories
- Git optional (falls back to timestamp-based staleness check)

## Not supported in v1

- Path aliases (`@/components`, `~/utils`)
- CommonJS (`require`/`module.exports`)
- Monorepos with multiple `package.json` workspaces
- Dynamic imports (`import(variable)`)
- Runtime-only relationships (dependency injection, ORMs, routers)

See [ROADMAP.md](./ROADMAP.md) for what comes next.

---

## Privacy

vectora runs entirely offline. The CLI reads your source files locally, computes a dependency graph, and writes `.vectora/graph.json` to your project. Nothing leaves your machine — no telemetry, no analytics, no API calls. The only dependencies are `@babel/parser` and `minimatch`, both purely computational with no network access.
