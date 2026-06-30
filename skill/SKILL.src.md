---
name: vectora
version: 2.4.0
license: MIT
description: Gives your coding agent the codebase map it can't see — import graph, symbol consumers, blast radius, git+session co-change — and catches incomplete edits before you ship them. `check` now confirms arity breaks (✗ BROKEN) and fires even without a prior map.
---

# WHAT VECTORA IS

vectora is a **cartographer**, not a router. It does **not** decide which files you load — you do that better. It gives you the structural facts you cannot reliably compute by reading code in your context window:

1. **The import graph** — who imports whom, reverse dependencies, centrality, **blast radius** (what breaks if you change a file).
2. **Symbol consumers** — which files reference a given exported symbol. When you change `RetryError`, vectora knows the five files that use it.
3. **Git co-change history** — which files are repeatedly edited *together* in real commits. grep and semantic search cannot see this; only the commit history can.
4. **Session-observed coupling** — files *you* edit together, learned across sessions. This supplements git co-change and, on a repo with **no git history**, stands in for it — so vectora is useful from commit #1.

Signals 1–2 and 4 need **no git history**, so vectora helps on brand-new projects too, not just repos with a rich `git log`.

You stay in control of every file-loading decision. vectora never hides a file, never skeletonizes, never says "don't open this." It hands you the map and gets out of the way.

There is **no token-savings claim** anywhere in vectora. The numbers it reports are ones it can prove on your own repo: the co-change/caller links it surfaced that your edits actually used or missed (`vectora check`).

---

# ACTIVATION

Active when a task involves reading or modifying source code: bug fixes, features, refactors, "how does X work" questions. **Not** active for: commit messages, prose, conceptual questions, pure CLI/ops tasks.

---

# ON A CODING TASK (not a follow-up)

Before you start opening files at random:

1. Run: `npx vectora map "<full task description>"`
2. **Emit the entire `[VECTORA MAP] … [END VECTORA MAP]` block verbatim** as the first lines of your response. Do not paraphrase or trim it — the user wants to see the map.
3. **Navigate by your own judgment.** The `START HERE` files are *suggestions* matched by keyword, with the reason shown. Open the ones you judge relevant. Open anything else you need. Nothing is off-limits.
4. **Read the `CO-CHANGE` section carefully.** Those files are edited together across many real commits. If you change one, strongly consider whether its co-change partner also needs the change — this is the bug grep would let you ship.
5. Execute the task completely.
6. When done, run `npx vectora check` and show its receipt as the final lines of your response.

If `npx vectora map` fails or the graph is absent, see BOOTSTRAP MODE below.

---

# /vectora \<task\>

The explicit invocation. Everything after `/vectora` is the task (unless it is a reserved keyword below).

Examples:
- `/vectora Fix the login timeout bug`
- `/vectora Add rate limiting to the payments API`
- `/vectora make the client throw a specific error when all retries are exhausted`

Protocol: exactly the 6 steps in "ON A CODING TASK" above.

---

# THE RECEIPT (`npx vectora check`)

**`check` works even if you skipped `map`.** It computes co-change misses directly from the graph for every file you edited.

After you finish editing, `vectora check` reports up to four signals — signals 2–4 need **no git history**:

1. **✗ BROKEN — confirmed arity breaks** (JS/TS, history-free):
   `✗ billing.js calls parseConfig() with 2 args but it now requires 3 — fix this call.`
   These are **proven inconsistencies** — the call count and the current function signature both parsed from disk. **Fix every ✗ line before declaring the task done.** Do not treat these as warnings.

2. **Co-change recall** (git + your sessions):
   - `✓ A ↔ B (git N× · sessions M×) — vectora linked these; you edited both.` → proof it helped.
   - `⚠ X co-changes with Y (N×) but was not edited — worth a look?` → a possible miss.

3. **Caller recall** (static, history-free): `⚠ retry.ts imports errors.ts (uses RetryError) but wasn't edited — verify?` → a file that consumes a symbol you changed and may now be broken. These are softer than ✗ BROKEN — the arity couldn't be confirmed, but the importer does reference the symbol you changed.

4. **Test pairing** (static, history-free): `⚠ charge.ts changed but charge.test.ts wasn't — update the test?`

Every `⚠` is a prompt, not a command. **Investigate each one.** If the flagged file genuinely needs the change, make it before declaring the task done — that caught bug is the whole point. If not, ignore it.

Show the receipt verbatim.

---

# FOLLOW-UP DETECTION

A prompt is a **follow-up** when it is short (≤15 words), contains a deictic reference ("it", "that", "this", "instead", "also", "just", "actually"), and names no new file/feature/domain.

If follow-up:
- Do **not** re-run `npx vectora map`. Reuse the map and files already in context.
- Execute using inherited context.
- You may run `npx vectora check` again at the end if you made further edits.

---

# SLASH COMMANDS

## /vectora init
Run `npx vectora init` and output its lines verbatim. This is **fully offline, deterministic, and costs zero tokens** — it shells out to Node, parses the AST, builds the import graph and co-change history, and writes `.vectora/graph.json`. No LLM, no network. The user runs this once to activate vectora and re-runs it after large refactors.

TypeScript path aliases (`@/`, `~/`, `#lib/`), `jsconfig.json` `baseUrl`, and npm/yarn/pnpm workspace cross-package imports are resolved automatically — no configuration needed. The init output line `aliases: N path aliases · M workspace pkgs` confirms what was detected. If aliases are not resolving, users can set `tsConfigPath: 'tsconfig.app.json'` in `vectora.config.js` to point to a non-standard tsconfig.

### After first init — LLM-driven rule seeding

When init output contains a `[VECTORA SEED]` block, this is the first time the graph was built on this repo. This is a moment where LLM reasoning is specifically needed — `init` is zero-token by design and cannot infer project-specific architectural rules. You can.

**Protocol:**
1. Run `npx vectora overview` — read domains, pivot files, entry points.
2. Run `npx vectora why <file>` on each of the top 3 pivot files.
3. Also run `/vectora migrate` — this auto-discovers CLAUDE.md, README.md, .cursorrules, and other convention files and extracts rules from them.
4. From overview + why outputs + migrate results, synthesize 3–7 architectural rules: coupling invariants, patterns the graph reveals, constraints that would prevent bugs. Use your LLM judgment here — the static graph surfaces structure, you supply meaning.
5. Propose each rule to the user: *"I noticed `<rule>`. Add it to vectora's memory?"*
6. On approval: `npx vectora learn "<rule>" [--domain <domain>]`

Do **not** invent rules that the graph doesn't support. Every proposed rule should be traceable to something visible in the overview, why, or migrate output.

## /vectora check
Run `npx vectora check` — output the receipt verbatim (see THE RECEIPT above). Works even without a prior `map`.

## /vectora receipts
Run `npx vectora receipts` — show the lifetime count of incomplete edits vectora has flagged in this repo: confirmed breaks, forgotten co-change files, callers to verify, stale tests. An honest ledger — every entry is a real event, never invented. Output verbatim.

## /vectora status
Run `npx vectora status` — output its result verbatim.

## /vectora diff
Run `npx vectora diff` — fast incremental graph update after small changes. Output result verbatim.

## /vectora watch
Run `npx vectora watch` in the background. Output: `↺ vectora: watcher started — graph rebuilds automatically on file changes.`

## /vectora why \<filepath\>
Run `npx vectora why <filepath>` — explains a file's centrality, blast radius, importers, and co-change peers. Output verbatim.

## /vectora impact \<file|symbol\>
Run `npx vectora impact <target>` — "what breaks if I change this?" For a file: direct + transitive dependents. For a symbol: the files that consume it. History-free. Output verbatim.

## /vectora overview
Run `npx vectora overview` — architecture summary: most-depended-on files, domains, entry points, orphans (possible dead code), and circular imports. The best first action when you land in an unfamiliar or brand-new repo. Output verbatim.

## /vectora trace \<symbol\>
Run `npx vectora trace <symbol>` — where the symbol is defined, who calls it, and what its file depends on. Output verbatim.

## /vectora preflight
Run `npx vectora preflight` and output verbatim. Use this before starting any large or risky session. Reports: graph staleness, open co-change misses from the last session, danger zone inventory (all `@vectora danger` annotations on files in your task scope), global rule count from `decisions.json`, and cycle presence.

## /vectora manifest
Run `npx vectora manifest` and output verbatim. Use this after finishing a session to produce a causal receipt: which files were directly targeted, which changed because of structural coupling, which were flagged but left unedited, and lifetime ledger totals. Paste the output into the PR description — it explains *why* each file changed, not just *what* changed.

## /vectora history \<filepath\>
Run `npx vectora history <filepath>` and output verbatim. Shows cross-session coupling memory for a file: how many times it was changed, which files were co-edited in those sessions, and which co-change partners were flagged but never resolved. If a partner appears flagged 3+ times without being edited, propose capturing it with `/vectora learn`.

## /vectora impact-report
Run `npx vectora impact-report` and output verbatim. 30-day aggregate summary of what vectora caught: confirmed arity breaks, co-change links used/missed, callers warned, stale tests flagged, highest-risk file, coupling debt trend. Share in retrospectives or paste in team channels.

## /vectora overview --debt
Run `npx vectora overview --debt` and output verbatim. Coupling debt scores for every tracked file pair: co-change frequency, shared imports, test coverage penalty. The highest-debt pairs with no test coverage are the ones most likely to produce silent bugs.

## /vectora help  or  /vectora \<unknown keyword\>
Output:
```
╔─ vectora help ─────────────────────────────────────────────────────╗
│                                                                    │
│  /vectora <task>            map the task, navigate, then check    │
│  /vectora check             receipt: breaks, co-change, callers   │
│  /vectora preflight         situational awareness before a task   │
│  /vectora manifest          causal PR receipt after a session     │
│  /vectora history <file>    cross-session coupling memory         │
│  /vectora impact-report     30-day summary — shareable            │
│  /vectora overview --debt   coupling debt scores by file pair     │
│  /vectora init              build the graph (offline, 0 tokens)   │
│  /vectora impact <x>        what breaks if I change this?         │
│  /vectora overview          architecture summary (great on new)   │
│  /vectora trace <sym>       where a symbol is defined & used      │
│  /vectora why <file>        explain a file's graph position       │
│  /vectora diff              fast incremental graph update         │
│  /vectora status            graph state                           │
│  /vectora watch             auto-rebuild on file changes          │
│  /vectora learn <rule>      teach vectora an architectural rule   │
│  /vectora migrate           extract rules from CLAUDE.md, README  │
│  /vectora help              show this message                     │
│                                                                    │
╚────────────────────────────────────────────────────────────────────╝
```

---

# INSTITUTIONAL MEMORY (optional, user-driven)

vectora can persist architectural rules to `.vectora/decisions.json`; the map surfaces the relevant ones at the top of the task. This is **always user-in-the-loop** — never write a rule silently.

## /vectora learn \<rule\>
1. Decide if the rule is global or domain-specific.
2. **Ask the user:** *"You asked to learn: `<rule>`. Should I write this to vectora's memory?"*
3. On approval: `npx vectora learn "<rule>" --domain <domain>` (omit `--domain` if global).

## /vectora unlearn \<rule\>
1. Ask the user to confirm.
2. On approval: `npx vectora unlearn "<rule>"`.

## /vectora migrate
Run `npx vectora migrate` and output the block verbatim. The command auto-discovers CLAUDE.md, README.md, .cursorrules, CONTRIBUTING.md, docs/ARCHITECTURE.md, and any RULES.md / DECISIONS.md / CONVENTIONS.md files in the repo — no filepath arg needed.

After outputting the block, extract architectural constraints from the discovered content. Skip: style preferences, tooling setup, CI instructions, one-off workarounds. For each extracted rule, propose it to the user. On approval: `npx vectora learn "<rule>" [--domain <domain>]`. Never write rules silently.

The user can trigger this with `/vectora migrate`, or naturally: "extract rules from CLAUDE.md", "migrate my readme rules into vectora", "seed decisions from existing files."

## Background capture — when to propose `/vectora learn`

After any task completes, ask yourself three questions before emitting the final receipt:

1. **Did the user correct an architectural assumption I made?** ("don't do X, we use Y here", "no, that pattern doesn't apply in this codebase")
2. **Did the user choose between two approaches with a stated reason?** (option A vs. B, where they named a constraint or preference)
3. **Did the check reveal a structural invariant that should always hold?** (a co-change miss that was real, an arity break that exposed an undocumented contract, a coupling that "must always move together")

If yes to any: *"I noticed a constraint: `<rule>`. Add it to vectora's memory?"* On approval: `npx vectora learn "<rule>"`.

**Do NOT propose for:** style choices, naming preferences, one-off workarounds, pure bug fixes with no generalizable pattern, anything the user has already said is intentional.

**`[ARCHITECTURAL SIGNAL]` from check:** When `npx vectora check` output contains an `[ARCHITECTURAL SIGNAL]` block, it means the task had structural breadth: multiple new files created, or many co-change/caller peers flagged. This is a stronger hint that an architectural decision was made. Re-read the task and ask yourself question 1–3 above with extra attention. If a rule emerges, propose it.

---

# DANGER ZONE ANNOTATIONS

Developers can annotate any source file with `@vectora danger:` comments (JS/TS `//`, Python `#`, etc.):

```ts
// @vectora danger: changing this signature requires a DB migration — see ADR-42
// @vectora danger: called by mobile app v2.x with 2-week deploy lag — no breaking changes
```

```python
# @vectora danger: JWT secret rotation required if auth flow changes here
```

At `map` time, if any seed or co-change partner carries a danger annotation, vectora surfaces it first:

```
⚠ DANGER ZONES — constraints on files in your edit scope:
  auth/session.ts: "called by mobile app v2.x with 2-week deploy lag — no breaking changes"
  config/parser.ts: "changing this signature requires a DB migration — see ADR-42"
```

**When you see a DANGER ZONE:** read the annotation before touching the file. The constraint was co-located with the code intentionally. If the constraint no longer applies, remove the annotation; if it does, honor it.

---

# BOOTSTRAP MODE (graph absent)

When `npx vectora map` reports no graph:
- It will emit a degraded `[VECTORA MAP]` banner — emit it verbatim.
- Proceed with the task by your own best judgment (folder-structure inference).
- After finishing, remind the user: *"Run `npx vectora init` to build the graph — it's offline and instant, and unlocks the co-change receipt."*

For a brand-new project with no source files yet: just build the files, then give the same reminder.

---

# BEFORE SPAWNING SUB-AGENTS

For any sub-agent that will read or modify source files:
1. Run `npx vectora map "<sub-task description>"` and capture stdout.
2. Prepend that map verbatim before the sub-agent's instructions.
3. If it fails, prepend: `Note: vectora graph unavailable — navigate by best judgment.`
