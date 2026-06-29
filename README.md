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

## Skeletonization

Non-pivot files are never opened. Instead, vectora synthesizes a 3-line skeleton from the pre-built graph and injects it directly into the agent's context:

```
// src/utils/formatters.js [142 lines — skeleton only]
// Exports: formatDate, formatCurrency, formatPhone
// Imports: dayjs, lodash
```

That 142-line file costs 3 lines of context instead of 142. The agent knows what it exports, what it depends on, and where to find it — without reading it.

For a task touching one domain in a 50-file codebase:
- 3 pivot files loaded in full: 412 lines
- 12 non-pivot files skeletonized: 36 lines (instead of 1,800)
- Lines saved: **1,764** — shown at the end of every task response

If a skeleton turns out to be insufficient, the agent opens the file and logs why. Skeletons are a starting point, not a prohibition.

---

## What you see — single task

```
╔─ vectora ─────────────────────────────────────────────╗
│ domain:    auth                                       │
│ loaded:    2 pivots (412 lines)                       │
│ skipped:   9 files → skeletonized (2,847 lines saved) │
╚───────────────────────────────────────────────────────╝
```

At the end of the response:
```
─ vectora: 2,847 lines saved this task · session: 2,847 lines saved ─
```

Line counts come directly from `lineCount` in `graph.json` — exact values, not estimates.

---

## What you see — chained tasks

```
╔─ vectora ───────────────────────────────────────────────╗
│ chained tasks: 3                                        │
│ shared pivots: env.ts, rateLimit.ts ✦ → once           │
│                                                         │
│ [1/3] domain: auth                                      │
│        loaded:  2 pivots (280 lines)                    │
│        skipped: 5 files → skeletonized (1,240 lines saved) │
│                                                         │
│ [2/3] domain: payments                                  │
│        loaded:  1 pivot (132 lines)                     │
│        skipped: 4 files → skeletonized (890 lines saved)│
│                                                         │
│ [3/3] domain: dashboard                                 │
│        loaded:  1 pivot (98 lines)                      │
│        skipped: 3 files → skeletonized (620 lines saved)│
│                                                         │
╚─────────────────────────────────────────────────────────╝
  ✦ manually declared via @vectora pivot
```

```
─ vectora: 2,750 lines saved this task · session: 5,597 lines saved ─
```

When a prompt spans multiple domains, vectora decomposes it, loads each domain's context separately, and executes in order — without flooding context or losing the thread mid-task.

---

## What changes

The agent navigates to the right files immediately instead of reading the whole codebase for orientation. Files outside the relevant domain cost 3 lines instead of their full source. Chained prompts execute cleanly across domains without context bleeding between them. The graph stays current via git hash comparison. The exact number of lines saved is shown at the end of every response — pulled directly from the graph, not estimated. `/vectora status` shows the cumulative total for the session.

---

## Optional controls

None of these are required.

**`/vectora`** (Claude Code only)
Registered as a native slash command during `npx vectora install`. Type `/vectora` in the Claude Code chat to rebuild the graph and reload it — without leaving the session. Shows up in the command palette with tab-completion.

**`/vectora update`**
Skill-level command (works in all agents). Forces a full graph rebuild and reloads the session context.

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
