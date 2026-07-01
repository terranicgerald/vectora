---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ""
alwaysApply: false
---

# WHAT VECTORA IS

vectora is a **direct, intelligent upgrade to CLAUDE.md**. CLAUDE.md is a static blob loaded into context every turn until it bloats every prompt. vectora makes project knowledge **dynamic and scoped**: for each task it hands you only the relevant files and only the rules that task touches — nothing loaded that the task doesn't need. Same knowledge, a fraction of the context.

It does **not** decide which files you load — you do that better. It gives you what you cannot reliably compute by reading code in your context window, scoped to the task at hand:

1. **Per-task relevant file set** — the prompt is decomposed into one or more tasks; each task gets its own minimal scope so you (and any sub-agent) load only its slice.
2. **Routing** — vectora classifies the tasks (single / chained-sequential / independent-parallel) and tells you when parallel sub-agents would keep each agent's context small. You make the call.
3. **Scoped institutional memory** — the learned architectural rules that apply to *this* task's files, surfaced inline (the CLAUDE.md replacement). Not the whole rulebook every turn.
4. **The import graph** — reverse dependencies, centrality, **blast radius** (what breaks if you change a file), and symbol consumers.
5. **Git + session co-change** — files repeatedly edited *together* in real commits, plus files *you* edit together across sessions. grep and semantic search cannot see this. The session signal stands in for git on a repo with no history, so vectora is useful from commit #1.

You stay in control of every decision — which files to load, whether to spawn agents. vectora never hides a file, never skeletonizes, never says "don't open this." It hands you the scoped map and gets out of the way.

There is **no token-savings claim** anywhere in vectora. The involvement banner reports *facts only* — files indexed, files scoped-to, tasks detected, rules applied, co-change links surfaced — never an invented token number.

---

# ACTIVATION

Active when a task involves reading or modifying source code: bug fixes, features, refactors, "how does X work" questions. **Not** active for: commit messages, prose, conceptual questions, pure CLI/ops tasks.

---

# ON A CODING TASK (not a follow-up)

`map` runs **internally** behind the slash command — the user never invokes it directly. Before you start opening files at random:

1. Run: `npx vectora map "<full prompt, verbatim>"`. vectora decomposes the prompt into one or more tasks and emits a lean, per-task scope.
2. **Emit the entire `[VECTORA MAP] … [END VECTORA MAP]` block verbatim** as the first lines of your response. It is terse by design — do not trim it.
3. **Read the `ROUTING` line.** For tasks marked **independent (disjoint scope)**, spawn one sub-agent per task, each prepended with only that task's scope block (see BEFORE SPAWNING SUB-AGENTS) — this keeps every agent's context small. For **chained / shared-scope** tasks, run them in order and reuse context.
4. **Per task, load only the `FILES` you judge relevant** — they are suggestions, nothing is hidden, open anything else you need. **State `loaded: K/relevant`** for each task so the user sees how tightly scoped it was. Files tagged `[recently edited]` were touched in the previous map session — prioritize reading those regions.
5. **Honor the scoped `RULES`** surfaced for each task — they are this project's institutional memory, the same rules CLAUDE.md would carry, but only the ones this task touches.
6. **Read the `CO-CHANGE` section.** Those files are edited together across real commits; if you change one, consider whether its partner needs the change too — the bug grep would let you ship. If the map emitted `[GRAPH SIGNAL: WEAK]`, skip this step — the graph has no meaningful signal for this file set.
7. Execute the task(s) completely.
8. When done, run `npx vectora check`. Show its receipt **and the involvement banner** as the final lines of your response — every prompt closes with that honest summary of what vectora did.

If `npx vectora map` fails or the graph is absent, see BOOTSTRAP MODE below.

---

# /vectora prompt \<task\>

**The guaranteed-trigger form.** Use this when you want vectora to run unconditionally — no activation check, no follow-up detection, no heuristics. Even if the prompt is short, looks like a follow-up, or seems non-coding: run the full protocol.

Protocol: exactly the steps in "ON A CODING TASK" above.

Examples:
- `/vectora prompt fix the bug`
- `/vectora prompt also update the test`
- `/vectora prompt refactor this`

---

# /vectora \<task\>

The explicit invocation. Everything after `/vectora` is the task (unless it is a reserved keyword below).

Examples:
- `/vectora Fix the login timeout bug`
- `/vectora Add rate limiting to the payments API`
- `/vectora make the client throw a specific error when all retries are exhausted`

Protocol: exactly the steps in "ON A CODING TASK" above.

---

# THE RECEIPT (`npx vectora check`)

`check` is the **post-edit safety net** and the carrier of the **involvement banner** — the honest, facts-only summary printed at the end of every prompt (tasks, files scoped-to of total indexed, rules applied, co-change links surfaced, breaks/callers caught). No token number, ever. Show it verbatim.

**`check` works even if you skipped `map`.** It computes co-change misses directly from the graph for every file you edited.

Alongside the banner, `vectora check` reports up to four signals — signals 2–4 need **no git history**:

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

A prompt is a **follow-up** when it is short (≤15 words), contains a deictic reference ("it", "that", "this", "instead", "also", "just", "actually"), and names no new file/feature/domain — **and a `[VECTORA MAP]` block from the current session exists in context and has not been invalidated**.

**Two conditions force a full `map` run regardless of follow-up signals:**
1. **No `[VECTORA MAP]` in context** — this is a fresh session (new session or after `/clear`). Run map unconditionally so `decisions.json` rules are loaded before any work begins.
2. **A `/vectora learn` or `/vectora unlearn` was executed after the last map** — the map in context predates the rule change and is stale. Run map again so the new rule is in scope.

If follow-up (map in context, no rule changes since last map):
- Do **not** re-run `npx vectora map`. Reuse the map and files already in context.
- Execute using inherited context.
- You may run `npx vectora check` again at the end if you made further edits.

---

# SLASH COMMANDS

## /vectora init
Run `npx vectora init` and output its lines verbatim. This is **fully offline, deterministic, and costs zero tokens** — it shells out to Node, parses the AST, builds the import graph and co-change history, and writes `.vectora/graph.json`. No LLM, no network. The user runs this once to activate vectora and re-runs it after large refactors.

TypeScript path aliases (`@/`, `~/`, `#lib/`), `jsconfig.json` `baseUrl`, and npm/yarn/pnpm workspace cross-package imports are resolved automatically — no configuration needed. The init output line `aliases: N path aliases · M workspace pkgs` confirms what was detected. If aliases are not resolving, users can set `tsConfigPath: 'tsconfig.app.json'` in `vectora.config.js` to point to a non-standard tsconfig.

### After first init — seed vectora as the CLAUDE.md replacement

When init output contains a `[VECTORA SEED]` block, this is the first time the graph was built on this repo. The graph build was **zero tokens**; this rule-seeding step is the one place LLM reasoning is needed and worth spending tokens on. The goal: move this project's conventions out of a static CLAUDE.md and into vectora's **scoped** memory, where each rule is tagged with the domain it governs and surfaces only on tasks that touch it.

**Protocol:**
1. Run `/vectora migrate` — auto-discovers CLAUDE.md, README.md, .cursorrules, CONTRIBUTING.md, and other convention files; extract the architectural rules from them.
2. Run `npx vectora overview`, then `npx vectora why <file>` on the top 3 pivot files — add any coupling invariants or patterns the graph reveals.
3. Synthesize the rules. **Tag each with its domain** so it surfaces per-task: `npx vectora learn "<rule>" --domain <domain>` (omit `--domain` only for truly global rules).
4. Propose each rule to the user before writing: *"I noticed `<rule>`. Add it to vectora's scoped memory?"*
5. After seeding, tell the user: *"vectora now carries these as scoped rules — surfaced only on tasks that touch the relevant files, instead of CLAUDE.md loading all of them every turn. You can slim CLAUDE.md to a pointer."* Never delete CLAUDE.md yourself — offer.

Do **not** invent rules the graph doesn't support. Every proposed rule should be traceable to the overview, why, or migrate output.

## /vectora check
Run `npx vectora check` — output the receipt verbatim (see THE RECEIPT above). Works even without a prior `map`.

## /vectora learn \<rule\>
1. Decide if the rule is global or domain-specific.
2. **Ask the user:** *"You asked to learn: `<rule>`. Should I write this to vectora's memory?"*
3. On approval: `npx vectora learn "<rule>" --domain <domain>` (omit `--domain` if global).
4. **Mark the current map stale.** Any `[VECTORA MAP]` already in context predates this rule. The next coding task — even if it looks like a follow-up — must re-run `npx vectora map` so the new rule surfaces in scope.

## /vectora unlearn \<rule\>
1. Ask the user to confirm.
2. On approval: `npx vectora unlearn "<rule>"`.
3. **Mark the current map stale** — same as after `learn`; re-run map on the next coding task.

For the full command catalog, run `/vectora help` in the terminal.

---

# INSTITUTIONAL MEMORY ( user-driven)

vectora can persist architectural rules to `.vectora/decisions.json`; the map surfaces only the rules whose domain the current task touches — scoped, not dumped. This is **always user-in-the-loop** — never write a rule silently.

`.vectora/decisions.json` is the **committed, team-shared rulebook** — the real replacement for CLAUDE.md. `init` writes a `.vectora/.gitignore` that tracks `decisions.json` and ignores everything else (`graph.json`, `observed.json` session coupling, and the `ledger.json` are per-developer). Commit `decisions.json` so your whole team shares one rulebook. (If you previously added `.vectora/` to your *root* `.gitignore`, narrow it — a fully-ignored directory can't un-ignore its children.)

## /vectora migrate
Run `npx vectora migrate` and output the block verbatim. The command auto-discovers CLAUDE.md, README.md, .cursorrules, CONTRIBUTING.md, docs/ARCHITECTURE.md, and any RULES.md / DECISIONS.md / CONVENTIONS.md files in the repo — no filepath arg needed.

After outputting the block, extract architectural constraints from the discovered content. Skip: style preferences, tooling setup, CI instructions, one-off workarounds. For each extracted rule, propose it to the user. On approval: `npx vectora learn "<rule>" [--domain <domain>]`. Never write rules silently.

The user can trigger this with `/vectora migrate`, or naturally: "extract rules from CLAUDE.md", "migrate my readme rules into vectora", "seed decisions from existing files."

## Background capture — when to propose `/vectora learn`

After any task completes, ask yourself four questions before emitting the final receipt:

1. **Did the user correct an architectural assumption I made?** ("don't do X, we use Y here", "no, that pattern doesn't apply in this codebase")
2. **Did the user choose between two approaches with a stated reason?** (option A vs. B, where they named a constraint or preference)
3. **Did the check reveal a structural invariant that should always hold?** (a co-change miss that was real, an arity break that exposed an undocumented contract, a coupling that "must always move together")
4. **Did the prompt itself state a constraint, permission, or preference about *how* to execute the task?** ("you may do X but only slightly", "feel free to Y", "we never Z in this codebase"). The map's `⚑ CANDIDATE RULE` line flags these for you when it can — but check the prompt yourself too, since a phrasing it didn't match can still encode a durable rule.

If yes to any: *"I noticed a constraint: `<rule>`. Add it to vectora's memory?"* On approval: `npx vectora learn "<rule>"`.

**Do NOT propose for:** style choices, naming preferences, one-off workarounds, pure bug fixes with no generalizable pattern, anything the user has already said is intentional.

**`[ARCHITECTURAL SIGNAL]` from check:** When `npx vectora check` output contains an `[ARCHITECTURAL SIGNAL]` block, it means the task had structural breadth: multiple new files created, or many co-change/caller peers flagged. This is a stronger hint that an architectural decision was made. Re-read the task and ask yourself questions 1–4 above with extra attention. If a rule emerges, propose it.

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
- Run `npx vectora decisions` and emit its block verbatim — this surfaces all global `decisions.json` rules in a compact, low-token form so institutional memory is never silently skipped even without a graph.
- Proceed with the task by your own best judgment (folder-structure inference).
- After finishing, remind the user: *"Run `npx vectora init` to build the graph — it's offline and instant, and unlocks the co-change receipt."*

For a brand-new project with no source files yet: just build the files, then give the same reminder.

---

# BEFORE SPAWNING SUB-AGENTS

For any sub-agent that will read or modify source files:
1. Run `npx vectora map "<sub-task description>"` and capture stdout.
2. Prepend that map verbatim before the sub-agent's instructions.
3. If it fails, prepend: `Note: vectora graph unavailable — navigate by best judgment.`
