# vectora

[![npm version](https://img.shields.io/npm/v/vectora)](https://www.npmjs.com/package/vectora)
[![CI](https://github.com/terranicgerald/vectora/actions/workflows/ci.yml/badge.svg)](https://github.com/terranicgerald/vectora/actions/workflows/ci.yml)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/7ed43ef4-3eb1-4c8e-a5f6-66e286b97e21" />

**Your AI agent loads everything. vectora fixes that.**

Instead of dumping your whole project into context every turn, vectora gives the agent only the files, rules, and co-change signals it actually needs — targeted to the task at hand. Patterns you establish get learned automatically. Rules you set manually persist across every session.

Works with Claude Code, Cursor, Windsurf, Codex, Kiro, OpenCode, and Gemini CLI.

---

## Why it matters

```
Without vectora                     With vectora
─────────────────────────────────   ─────────────────────────────────
Agent loads 247 files every turn    Agent loads 11 files — this task
All rules in context, always        Only rules that touch these files
Agent guesses what's related        Co-change graph shows what is
Patterns forgotten next session     Auto-learned, survives sessions
Re-explain conventions every time   /vectora learn once, done forever
```

---

## Install in 30 seconds

```bash
npx vectora@latest          # detects your agent, installs the skill
```

Then inside your agent, once:

```
/vectora init
```

That's it. No LLM, no network, no config required. vectora parses your AST and git history locally, then builds the map.

> **Tip:** commit `.vectora/graph.json` so teammates get the map on day one.

---

## How it works

```
You type a task
      │
      ▼
┌─────────────────────────────────────────┐
│  vectora map                            │
│                                         │
│  1. Decomposes prompt into subtasks     │
│  2. Seeds each subtask from keywords    │
│  3. Expands via import graph            │
│  4. Pulls co-change partners (git+sess) │
│  5. Surfaces only rules for these files │
└─────────────────────┬───────────────────┘
                      │
                      ▼
        ┌─────────────────────────┐
        │  Agent receives         │
        │  • 11 files (not 247)   │
        │  • 2 rules (not 40)     │
        │  • Co-change warnings   │
        └─────────┬───────────────┘
                  │
                  ▼
           Agent edits code
                  │
                  ▼
        ┌─────────────────────────┐
        │  vectora check          │
        │  • Arity breaks    (✗)  │
        │  • Co-change misses (⚠) │
        │  • Stale tests      (⚠) │
        └─────────────────────────┘
```

---

## The three things vectora does

### 1. Targeted loading — only what this task needs

```
You: fix the parseConfig function and update its tests

╭─ FILES ─────────── 4 loaded · 247 considered · 1 seeded ──╮
│  config/parser.ts               [recently edited]          │
│  config/parser.test.ts                                     │
│  config/validator.ts            [co-change peer]           │
│  billing/charge.ts                                         │
╰────────────────────────────────────────────────────────────╯

╭─ VECTORA MAP ──────────────────────────────────────────────╮
│  Domains → config, billing                                 │
│  Routing → SINGLE                                          │
│  Signal  → NORMAL                                          │
╰────────────────────────────────────────────────────────────╯
```

The agent loads 4 files, not 247. Every figure is a fact — never invented.

---

### 2. Cross-session memory — patterns learned, rules that stick

vectora watches what you do and generalizes. Edit `parser.ts` and `validator.ts` together three times? It remembers. Next session, it surfaces them as co-change partners automatically.

You can also teach it explicitly:

```
/vectora learn "parser changes always need a migration note in CHANGELOG"
```

vectora asks for confirmation, then writes it to `decisions.json`. It will surface that rule on every future task that touches `parser.ts` — and only then.

Remove a rule just as easily:

```
/vectora unlearn "parser changes always need a migration note in CHANGELOG"
```

**Rules are file-scoped.** A rule about `auth/` won't appear when you're editing `billing/`.

```
decisions.json  (committed, shared with your team)
┌────────────────────────────────────────────────────────┐
│  global:                                               │
│    • Use dayjs, never moment.js                        │
│                                                        │
│  domains:                                              │
│    auth:    JWT expiry is 15 min for compliance        │
│    parser:  changes need a migration note in CHANGELOG │
│    billing: no breaking changes — mobile app 2-week lag│
└────────────────────────────────────────────────────────┘
         ↓ task touches auth/session.ts
         surfaces only the auth rule — nothing else
```

Fresh session? vectora loads the relevant slice of `decisions.json` automatically. No re-explaining, no re-prompting.

---

### 3. Co-change signals — the "did you forget a partner?" safety net

git knows which files get edited together. vectora surfaces that signal before the agent starts, and confirms it after.

```
CO-CHANGE (before editing)
  config/validator.ts ↔ config/parser.ts    git 8× · sessions 2×
  billing/charge.ts   ↔ config/parser.ts    git 3×
```

After edits, `vectora check` closes the loop:

```
✓ config/validator.ts co-changes with config/parser.ts — you edited both.

⚠ billing/charge.ts co-changes with config/parser.ts (git 3×) but wasn't edited.
  Worth a look?

✗ billing/charge.ts calls parseConfig() with 2 args — it now requires 3.
  Fix this before finishing.
```

| Symbol | Meaning |
|--------|---------|
| `✓` | vectora linked these; you got both |
| `⚠` | probable miss — investigate |
| `✗` | confirmed arity break from live AST — fix it |

---

## Quick reference

| Command | What it does |
|---------|-------------|
| `/vectora <task>` | Full loop: map → edit → check |
| `/vectora check` | Post-edit receipt: breaks, misses, stale tests |
| `/vectora learn "<rule>"` | Teach a rule (asks before writing) |
| `/vectora unlearn "<rule>"` | Remove a rule |
| `/vectora init` | Build the graph (offline, 0 tokens, run once) |
| `/vectora diff` | Incremental graph update after many file changes |
| `/vectora why <file>` | Centrality, blast radius, importers, co-change peers |
| `/vectora impact <file>` | What breaks if you change this? |
| `/vectora overview` | Architecture map: domains, entry points, orphans |
| `/vectora preflight` | Before a risky session: staleness, danger zones |
| `/vectora manifest` | PR receipt: why each file changed |

---

## Danger zone annotations

Pin warnings to the code they guard — the agent sees them the moment the file enters scope:

```ts
// @vectora danger: called by mobile app v2.x — no breaking changes (2-week deploy lag)
// @vectora danger: changing this signature requires a DB migration — see ADR-42
```

Works in any language. vectora surfaces these at map time, before the agent opens the file.

---

## Configuration (optional)

```js
// vectora.config.js
module.exports = {
  pivotThreshold:      0.15,   // top N% by centrality flagged as pivots
  coChangeMaxFiles:    15,     // ignore "reformat everything" commits
  refreshAfterHours:   24,
  tsConfigPath:        null,   // e.g. 'tsconfig.app.json' for monorepos
  exclude:             [],     // globs to skip
  domains:             null,   // explicit domain map
};
```

TypeScript path aliases (`@/*`, `~/`), `jsconfig.json` baseUrl, and monorepo workspaces resolve automatically — no config needed for most projects.

---

## Language support

| Language | Import edges | Exports |
|----------|-------------|---------|
| JavaScript / JSX | ESM + CJS | ✅ |
| TypeScript / TSX | ESM + CJS, path aliases | ✅ |
| Python | `import` / `from` | `def` / `class` |
| Go | `import` blocks | exported symbols |
| Rust | `use` / `mod` | `pub` items |
| Ruby | `require_relative` | `def` / `class` |

---

## Privacy

Fully offline. Reads your source and git history locally. Nothing leaves your machine — no telemetry, no API calls, no LLM in the indexing path.
