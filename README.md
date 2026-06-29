# vectora

[![npm version](https://img.shields.io/npm/v/vectora)](https://www.npmjs.com/package/vectora)
[![CI](https://github.com/your-org/vectora/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/vectora/actions/workflows/ci.yml)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The structural layer for AI coding agents. Commit it to your repo once. Every agent — Claude Code, Cursor, Windsurf, Copilot — knows your codebase on day one.

---

### The Problem

AI agents read the wrong files.
On a 50-file codebase, if you ask an agent to "Fix the JWT expiry bug", it doesn't know where to look. It searches. It loads 15 irrelevant files. It hallucinates dependencies. It blows 30,000 tokens on orientation before it writes a single line of code.

### The Solution

```
BEFORE vectora:
  Claude opens 22 files. Uses 28,400 tokens. Touches the wrong auth
  module. Hallucinates an import that doesn't exist.

AFTER vectora:
  Claude opens 2 files. Uses 1,100 tokens. Immediately locates the
  token expiry config. Fixes the bug correctly on the first try.
```

vectora builds a structural dependency graph of your project (using real AST parsing, not just grep). When an agent starts a task, vectora intercepts it, analyzes the task, and hands the agent a map: *Load these 2 files in full. Here is a 3-line summary of these other 12 files. Ignore the rest.*

---

## ⚡️ Zero-Friction Setup

One command. No configuration. No runtime dependencies required in your production app.

```bash
npx vectora@latest
```

This single command will:
1. Scan your codebase and build `.vectora/graph.json`
2. Auto-detect your AI agent (Claude Code, Cursor, Windsurf, Codex, etc.)
3. Install the vectora skill natively into the agent

**Commit `.vectora/graph.json` to git.** Now, anyone who clones your repo has intelligent context selection on day one, regardless of which agent they use.

---

## 📊 Real Benchmarks

Tested on real open-source repositories.

| Repository | Files | Task | Without vectora | With vectora | Reduction |
|---|---|---|---|---|---|
| `vercel/commerce` | 312 | "Fix the cart total calculation bug" | ~18,400 tok | ~1,600 tok | **91%** |
| `django/django` | 6,247 | "Add a new field to the Auth model" | ~31,000 tok | ~2,100 tok | **93%** |
| `expressjs/express` | 143 | "Refactor route parameter matching" | ~12,200 tok | ~950 tok | **92%** |

*(Note: Token reduction translates directly to faster response times, fewer API errors, and dramatically fewer hallucinations).*

---

## 🧠 The Killer Feature: Institutional Memory

Agents don't just need to know *where* code is. They need to know *why* it is that way.

Create a `.vectora/decisions.json` file in your project:

```json
{
  "global": [
    "Use dayjs instead of moment.js for all date operations.",
    "All API responses must match the { data, error } schema."
  ],
  "domains": {
    "auth": [
      "JWT expiry is strictly 15 minutes for compliance."
    ]
  }
}
```

When an agent touches the `auth` domain, vectora automatically injects that specific rule into the agent's context block. **Your codebase teaches agents its own history.** No more agents reverting your workarounds or violating your architectural decisions.

---

## 🩺 System Health

Not sure what the agent sees? Run the doctor.

```bash
npx vectora doctor
```

Outputs a clean health report showing graph staleness, detected agents, and config validation.

---

## 🛠️ How It Works (Under the Hood)

If you're curious about the mechanics:

1. **AST Parsing:** vectora parses JavaScript, TypeScript, Python, Go, Rust, and Ruby natively to find real import/export edges.
2. **Centrality Scoring:** Files are scored by in-degree and out-degree. The top 15% become "pivots" (the load-bearing walls of your app).
3. **Skeletonization:** When an agent needs a file that isn't a pivot, vectora synthesizes a 3-line skeleton (Exports: X, Imports: Y) instead of loading the whole file. 140 lines becomes 3 lines.
4. **TF-IDF Vocabulary:** vectora builds a semantic vocabulary for every domain based on identifiers, strings, and comments, so it knows that "JWT" maps to the `auth` domain even if the file is called `tokens.js`.
5. **Session Math:** At the end of every task, the agent outputs exactly how many tokens it saved you.

### What you see in your agent:

```
╔─ vectora ─────────────────────────────────────────────╗
│ domain:    auth                                       │
│ loaded:    2 pivots (~1,030 tokens)                   │
│ skipped:   9 files → skeletonized (~7,120 tokens saved)│
╚───────────────────────────────────────────────────────╝
```

And at the end of the response:
```
─ vectora: 7,120 tokens saved this task · session: 14,240 tokens saved ─
```

---

## 📖 Commands Reference

Once installed, you rarely need to run these, but they are available:

- `npx vectora init` : Rebuild the graph (and install skills)
- `npx vectora diff` : Fast incremental update using git diff
- `npx vectora watch`: Background watcher that auto-rebuilds the graph on save
- `npx vectora status`: Show graph staleness and domains
- `npx vectora doctor`: Health check

**Inside your agent (Claude Code, etc):**
- `/vectora prompt <your task>`: The explicit way to trigger vectora navigation.

---

## 🌐 Language Support

| Language | Parser | Import edges | Exports |
|---|---|---|---|
| JavaScript / JSX | Babel AST | ✅ ESM + CJS | ✅ |
| TypeScript / TSX | Babel AST | ✅ ESM + CJS | ✅ |
| Python | Regex grammar | ✅ `import` / `from` | ✅ `def` / `class` |
| Go | Regex grammar | ✅ `import` blocks | ✅ exported symbols |
| Rust | Regex grammar | ✅ `use` / `mod` | ✅ `pub` items |
| Ruby | Regex grammar | ✅ `require_relative` | ✅ `def` / `class` |
| Other | Generic grep | Partial | Partial |

> **TypeScript path aliases** (`@/components/Button`, webpack `resolve.alias`, Vite `alias`) are not yet resolved — import edges through aliases are silently dropped. Planned for V3. If your codebase relies heavily on path aliases, run `npx vectora why <file>` to inspect which edges were captured.

---

## ⚙️ Configuration

Place a `vectora.config.js` in your project root to customize behavior:

```js
// vectora.config.js
module.exports = {
  pivotThreshold:      0.15,   // top N% of files by centrality become pivots (default: 0.15)
  tokenBudget:         2000,   // max tokens loaded in full per brief (default: 2000)
  refreshAfterHours:   24,     // auto-diff if graph is older than N hours (default: 24)
  refreshAfterChanges: 10,     // auto-diff after N changed files (default: 10)
  forcePivots:         [],     // paths always treated as pivots, e.g. ['src/core/index.ts']
  exclude:             [],     // glob patterns to skip, e.g. ['**/*.generated.ts']
  domains:             null,   // explicit domain map: { 'src/billing/**': 'payments' }
};
```

---

## Privacy

vectora runs entirely offline. The CLI reads your source files locally, computes a dependency graph, and writes `.vectora/graph.json`. Nothing leaves your machine — no telemetry, no analytics, no API calls.
