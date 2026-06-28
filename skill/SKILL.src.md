---
name: vectora
version: 1.0.0
license: MIT
description: Structural codebase navigation. Reads a pre-built AST dependency graph before every task. Handles single tasks, multi-domain tasks, and chained prompts. Detects follow-ups. Active every session, unconditionally.
---

# ACTIVATION

Active on every task in every session, without exception. No slash command, keyword, or trigger required — responds to any message that describes work to be done: a change, a bug report, a question about the codebase, or a new feature.

---

# CONSTRAINT

Do not open, read, or reference any source file until:
  (a) `.vectora/graph.json` has been read, AND
  (b) the task decomposition and coordination plan have been written to `.vectora/session.log`.

Both conditions must be satisfied before loading any source file.

Skipping this step is the failure mode vectora is designed to eliminate: loading files you don't need, burning tokens on orientation, losing the thread mid-task when a prompt crosses domain boundaries.

---

# BOOTSTRAP MODE (graph absent)

Before anything else, attempt to open `.vectora/graph.json`. If the file doesn't exist:

**Case A — No source files present** (new or empty project):
Output this banner and proceed normally. No graph is needed for greenfield work.
```
╔─ vectora ─────────────────────────────────────────────╗
│ mode:      planning (no source files yet)             │
│ tip:       run `npx vectora init` after first files   │
╚───────────────────────────────────────────────────────╝
```
After generating the initial files, remind the user: "Run `npx vectora init` to activate structural navigation."

**Case B — Source files exist but graph is absent**:
List the top-level project directory. If `.js`, `.ts`, `.jsx`, or `.tsx` files are present anywhere, output:
```
╔─ vectora ─────────────────────────────────────────────╗
│ ⚠ no graph — run `npx vectora init` to activate      │
│ mode:      degraded (folder-structure inference only) │
╚───────────────────────────────────────────────────────╝
```
Then do a lightweight bootstrap:
1. List top-level directories to identify approximate domain folders (`src/auth`, `src/payments`, etc.)
2. Read `package.json` if present for project context
3. Use folder names as approximate domain labels
4. Proceed — rough domain awareness is better than none
5. After completing the task, remind: "Run `npx vectora init` to unlock full structural navigation."

Do not stop if `graph.json` is absent. Degrade gracefully.

---

# SLASH COMMAND: /vectora update

When the user types `/vectora update`:

1. Output: `↺ vectora: rebuilding graph...`
2. Run: `npx vectora init --reset` (synchronously — wait for full completion)
3. Use your file-reading tool to reload `.vectora/graph.json`.
4. Output the three CLI confirmation lines exactly as printed.
5. Output: `Graph refreshed. Session context updated. Ready.`
6. Set internal flag: `postUpdateBanner = true` — the next task uses the post-update banner format.
7. Resume normal operation.

---

# ON SESSION START

Run once at the beginning of every session, before handling any task.

**Step 1** — Use your file-reading tool to open `.vectora/graph.json`.
- File absent → enter BOOTSTRAP MODE above. Do not continue with the normal protocol.
- File present → continue.

**Step 2** — Read from `graph.json`:
- `generated` (ISO timestamp)
- `gitHash` (SHA or null)
- `avgLinesPerFile` (used in the token estimate formula)
- Load the full `domains` object and all `files` entries into working memory.

**Step 3** — Load config overrides from `vectora.config.js` if present:
- `refreshAfterHours` (default: 24)
- `refreshAfterChanges` (default: 10)
- If the file is absent or a field is missing, use the defaults.

**Step 4** — Staleness check:
- If `generated` is older than `refreshAfterHours`: run `npx vectora init` silently (no output to user). Reload `graph.json`.
- If `gitHash` differs from current HEAD AND the changed file count exceeds `refreshAfterChanges`: run `npx vectora init` silently. Reload `graph.json`.
- If git is unavailable: timestamp check only.
- If neither condition is met: proceed with the existing `graph.json`.

**Step 5** — Do not load any source files. Working memory now holds the graph — session start is complete.

---

# FOLLOW-UP DETECTION

Before running the full execution protocol on any task, check whether the prompt is a follow-up to prior work in this session.

A prompt is a **follow-up** if ALL of the following are true:
- It contains 3 or fewer tokens that match any domain vocabulary in `graph.json`.
- It contains at least one deictic or correction reference: "it", "that", "this", "the same", "instead", "actually", "also", "just", "rather", "not that", "make it", "change it to", "do the same".
- It does NOT introduce a new domain (no vocabulary match score above 0.1 for a domain different from the session's current active domain).
- `.vectora/session.log` contains at least one prior task entry in this session.

If a prompt qualifies as a follow-up:
1. Read `.vectora/session.log` to identify the most recent task entry and its domain, pivots, and sub-task index.
2. Output the follow-up banner (see banner formats below).
3. Reuse already-loaded pivots. Do not reload. Do not re-inject skeletons already in context.
4. Execute the follow-up using inherited context.
5. Append to `.vectora/session.log`: `<timestamp> follow-up: inherited from [turn N] domain=<name>`

If the follow-up introduces a new domain (vocabulary match > 0.1 for a different domain than active), exit follow-up mode and run the standard execution protocol as a new task.

---

# ON EVERY TASK — FULL EXECUTION PROTOCOL

Run this protocol on every task that is not classified as a follow-up.

## PHASE 1: CHAIN DETECTION

Scan the full prompt for chaining signals. A prompt is chained only when it contains **distinct verb phrases targeting distinct objects** — not "and" joining noun phrases within a single action.

**Single task — do NOT split:**
- "add X and Y to Z" — one action, two objects of the same verb
- "fix the login error and the session timeout" — two bugs, one domain
- "update the user's name and email" — one update operation, two fields

**Chained task — DO split:**
1. Distinct imperative verbs after sentence boundaries, each with its own object in a different part of the system: "Refactor auth. Update payments. Fix dashboard."
2. Numbered or bulleted lists where each item begins with an imperative verb targeting a different system.
3. Coordination conjunctions between clearly distinct action-object pairs: "Refactor the auth module AND update the payments validator AND fix the dashboard display."
4. Explicit temporal sequence markers between distinct actions: "after that", "once done", "following that", "then update", "next fix".

**Before splitting, ask:** Would this require touching files in more than one domain? If no → single task.

If no chaining signals detected → treat as a single task. Skip to PHASE 3.
If chaining signals detected → proceed to PHASE 2.

## PHASE 2: MULTI-TASK DECOMPOSITION (chained prompts only)

For each sub-task identified:

**a. Token extraction**
Split the sub-task description on: whitespace, camelCase boundaries (`addRateLimit` → `add`, `rate`, `limit`), snake_case underscores (`rate_limit` → `rate`, `limit`), and punctuation.
Lowercase all tokens. Discard tokens under 3 characters.

**b. Domain scoring**
For each domain in `graph.json`:
  `score = (count of tokens matching domain vocabulary) / (domain vocabulary size)`

**c. Graph expansion**
From each matched domain's pivot files, traverse import edges outward to depth 2.
Include additional domains that contain any of the traversed files.

**d. Tie handling**
If two or more domains score within 0.05 of each other, include all of them.

**e. Fallback**
If no domain scores above 0.1, include all domains. Mark as fallback. Use the fallback banner row for this sub-task.

**f. Record per sub-task:**
- Index (1-based)
- Description (verb phrase + object)
- Matched domain(s)
- Pivot files for those domains (from `graph.json` where `isPivot: true`)
- Estimated skeleton count: total files in matched domains minus pivot count

**Shared pivot deduplication:**
Collect all pivot files across all sub-tasks.
Files appearing in 2 or more sub-tasks → mark as shared pivots.
Shared pivots load exactly once before any sub-task begins. Never reloaded.

**Write a coordination plan to `.vectora/session.log` before any execution begins:**
```
<timestamp> chain: <N> sub-tasks detected
<timestamp> chain[1]: domain=<name> pivots=[<files>] skeletons≈<N>
<timestamp> chain[2]: domain=<name> pivots=[<files>] skeletons≈<N>
(repeat for each sub-task)
<timestamp> chain: shared=[<files>] — loaded once before execution
<timestamp> chain: execution locked — beginning sub-task 1
```

Output the **chained task banner** (see below). Output the full banner before loading any files or beginning any sub-task.

## PHASE 3: DOMAIN MATCHING (single task)

**a.** Extract tokens from the full prompt (same camelCase/snake_case split as Phase 2a).
**b.** Score all domains by vocabulary overlap.
**c.** Expand via graph traversal to depth 2 from matched domain pivots.
**d.** Apply tie handling (within 0.05 → include both).
**e.** Apply fallback if no domain scores above 0.1.
**f.** Identify pivot files for matched domain(s) — files where `isPivot: true` in `graph.json`.
**g.** Identify skeleton files: all files in matched domain(s) where `isPivot: false`.

Write to `.vectora/session.log`:
```
<timestamp> single task: domain=<name> pivots=[<files>] skeletons≈<N>
```

Output the **single-task banner** (see below).

## PHASE 4: EXECUTION

**Single task:**
1. Load pivot files in full using your file-reading tool.
2. Inject skeletons for non-pivot files in the matched domain (see SKELETON FORMAT — synthesized from graph.json data, not by opening the files).
3. Execute the task completely.
4. Append to `.vectora/session.log`: `<timestamp> single task: complete`

**Chained task:**
1. Load all shared pivots in full. Do not load any sub-task-specific pivots yet.
2. For each sub-task in order (1 → N):
   a. Load this sub-task's domain-specific pivots in full. Skip any already loaded as shared pivots.
   b. Inject skeletons for non-pivots in this sub-task's domain (synthesized from graph.json — do not open files).
   c. Complete this sub-task fully before starting the next.
   d. Append to `.vectora/session.log`: `<timestamp> chain[<N>]: complete`
   e. Do not reload files already in context when moving between sub-tasks.
3. After all sub-tasks complete:
   Append to `.vectora/session.log`: `<timestamp> chain: all <N> sub-tasks complete`

**Full-load requests (any task type):**
If you determine you need the full source of a skeletonized file:
- Open it using your file-reading tool.
- Append to `.vectora/session.log`:
  `<timestamp> full-load: <filepath> — <one-sentence reason> [sub-task <N> or single]`

**Context reorientation:**
If at any point during chained execution you lose track of which sub-task is active or which files are in scope: re-read `.vectora/session.log`. The log is the source of truth.

---

# BANNER FORMATS

The activation banner is the **first output** of every response to a task — before any code, before any explanation. It is not optional.

## Single-task banner (standard):
```
╔─ vectora ─────────────────────────────────────────────╗
│ domain:    <matched domain(s)>                        │
│ pivots:    <filenames, ✦ if manualPivot>              │
│ skipped:   <N> files → skeletonized                   │
│ est. save: ~<calculated> tokens vs unguided           │
╚───────────────────────────────────────────────────────╝
```

## Single-task banner (fallback — no domain matched):
```
╔─ vectora ─────────────────────────────────────────────╗
│ domain:    fallback (all pivots loaded)               │
│ pivots:    <all pivot filenames across all domains>   │
│ skipped:   <N> files → skeletonized                   │
│ est. save: ~<calculated> tokens vs unguided           │
╚───────────────────────────────────────────────────────╝
```

## Chained task banner (one row per sub-task):
```
╔─ vectora ───────────────────────────────────────────────╗
│ chained tasks: <N>                                      │
│ shared pivots: <filenames, ✦ if manualPivot> → once     │
│                                                         │
│ [1/<N>] domain: <name>                                  │
│         pivots: <domain-specific filenames>             │
│         skipped: <N> files → skeletonized               │
│                                                         │
│ [2/<N>] domain: <name>                                  │
│         pivots: <domain-specific filenames>             │
│         skipped: <N> files → skeletonized               │
│                                                         │
│ (repeat per sub-task)                                   │
│                                                         │
│ est. save: ~<total tokens across all sub-tasks>         │
╚─────────────────────────────────────────────────────────╝
```

## Post-update banner (first task after /vectora update only):
```
╔─ vectora ─────────────────────────────────────────────╗
│ ↺ graph refreshed — <N> files, <P> pivots, <D> domains│
│ domain:    <matched domain(s)>                        │
│ pivots:    <filenames, ✦ if manualPivot>              │
│ skipped:   <N> files → skeletonized                   │
│ est. save: ~<calculated> tokens vs unguided           │
╚───────────────────────────────────────────────────────╝
```

## Follow-up banner:
```
╔─ vectora ─────────────────────────────────────────────╗
│ ↩ follow-up to: <domain> [turn <N>]                  │
│ context:  inherited — no reload needed                │
│ pivots:   <previously loaded pivot filenames>         │
│ est. save: ~<tokens saved vs full reload>             │
╚───────────────────────────────────────────────────────╝
```

**Manual pivot footnote:**
When any pivot shown in the banner has `manualPivot: true` in `graph.json`, append immediately below the closing banner line:
```
  ✦ manually declared via @vectora pivot
```

---

# SKELETON FORMAT

Every non-pivot file in the matched domain is represented in this format. Three lines. No file opened.

```
// <filepath> [<N> lines — skeleton only]
// Exports: <comma-separated export names>
// Imports: <comma-separated import sources>
```

Skeletons are synthesized directly from the `exports` and `imports` arrays already stored in `graph.json`. Do not open the source file to generate a skeleton — the data is already in the graph. Opening the file defeats the purpose and wastes the tokens you are trying to save.

Use `lineCount` from `graph.json` for the line count in the skeleton header.

If you need the full source during execution: open it and log the reason in `session.log`.

---

# TOKEN ESTIMATE FORMULA

For each sub-task (or the single task):
```
est_save = skeletonized_count × (avgLinesPerFile - 3) × 4
```

`avgLinesPerFile` comes from `graph.json`. Each skeletonized file costs 3 lines instead of `avgLinesPerFile` lines. Multiply by 4 chars/token. Sum across all sub-tasks for the chained banner total.

---

# ON SESSION END

As the final line of the final response in the session, append:

```
// vectora: <P> pivots in full, <S> skeletonized, <R> full-loads, <C> sub-tasks executed
```

For single-task sessions: `<C>` = 1. For follow-up sessions: include follow-ups in the sub-task count.

---

# REFERENCE: graph.json STRUCTURE

```json
{
  "generated": "<ISO 8601 timestamp>",
  "gitHash": "<SHA or null>",
  "avgLinesPerFile": <number>,
  "files": [
    {
      "path": "<relative path>",
      "domain": "<domain name>",
      "isPivot": true | false,
      "manualPivot": true | false,
      "centralityScore": <number>,
      "lineCount": <number>,
      "exports": ["<name>", ...],
      "imports": ["<source>", ...]
    }
  ],
  "domains": {
    "<name>": {
      "pivots": ["<filepath>", ...],
      "vocabulary": ["<term>", ...]
    }
  }
}
```

- `isPivot: true` → load full source at task start
- `isPivot: false` → synthesize a 3-line skeleton from `exports` and `imports` (never open the file)
- `manualPivot: true` → file was annotated with `// @vectora pivot` → always load in full, always show ✦ in banner
- `avgLinesPerFile` → used in the token estimate formula
- `domains[name].vocabulary` → term list used for domain matching against task prompt tokens
