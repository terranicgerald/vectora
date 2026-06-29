---
name: vectora
version: 2.0.0
license: MIT
description: CLI-driven structural navigation. Calls npx vectora brief before every coding task. Embeds the start banner in brief output — agent emits it verbatim. Tracks session savings in working memory.
---

# WHEN A VECTORA BRIEF IS PRESENT IN YOUR PROMPT

If your prompt contains a `[VECTORA BRIEF]` block (injected by a parent agent or the CLI):

1. Emit the banner block (the `╔─...─╝` section) verbatim as the **first lines** of your response.
2. Load every file listed under `LOAD IN FULL` using your file-reading tool.
3. For every line under `SKELETON ONLY`: inject it verbatim into context — do **not** open the file unless the skeleton is insufficient to complete the task.
4. Read the `skeleton_pool:` value. Use it to compute task savings at the end.
5. If the brief contains an `INSTITUTIONAL MEMORY (Must follow):` section, you MUST adhere to all listed rules during the task.
6. Do not open files not listed in the brief without logging the reason.
7. For sub-agents on coding tasks: propagate this brief (or a task-scoped subset) to their prompts.

---

# ACTIVATION

Active when a task involves reading or modifying source code: bug fixes, features, refactors, questions about how code works. **Not** active for: commit messages, answering conceptual questions, writing prose, pure CLI tasks.

**On first activation in a session:** set `session_total = 0` in working memory.

---

# ON EVERY CODING TASK (not a follow-up)

Before opening any source file or writing any code:

1. Run: `npx vectora brief "<full task description>"`
2. **Emit the banner block (the `╔─...─╝` section) from the brief output verbatim as the first lines of your response.** Do not reformat or paraphrase it.
3. Load every file listed under `LOAD IN FULL` using your file-reading tool.
4. Inject every `SKELETON ONLY` line verbatim into your context — do **not** open those files.
5. Execute the task completely.
6. If a skeleton file proves insufficient: open it, note the reason inline, and subtract its saved-token value (shown in the skeleton line) from the `skeleton_pool` value before computing savings.
7. Compute: `task_savings = skeleton_pool_value − tokens_of_any_opened_skeletons`
8. Update: `session_total += task_savings`
9. Output as the **final line** of your response:
   `─ vectora: ~<task_savings> tokens saved this task · session: ~<session_total> tokens saved ─`

If `npx vectora brief` fails or the graph is absent: see BOOTSTRAP MODE below.

---

# /vectora prompt \<task\>

**The recommended explicit invocation.** Everything after `prompt` is the task description. The start banner confirms vectora is actively navigating.

Examples:
- `/vectora prompt Fix the login timeout bug`
- `/vectora prompt Add rate limiting to the payments API`
- `/vectora prompt Refactor auth, then update the dashboard`

Protocol:
1. Extract everything after `/vectora prompt ` as the task.
2. Run `npx vectora brief "<task>"`.
3. Emit the banner block from the brief verbatim as the **first lines** of your response.
4. Load `LOAD IN FULL` files. Inject `SKELETON ONLY` lines. Execute completely.
5. Compute savings from `skeleton_pool`. Update `session_total`.
6. Output the end savings line as the final line.

---

# FOLLOW-UP DETECTION

A prompt is a **follow-up** when it is short (≤15 words), contains a deictic reference ("it", "that", "this", "instead", "also", "just", "actually", "rather", "the same"), and does not name a new file, feature area, or different domain by name.

If follow-up:
- Do **not** call `npx vectora brief`. Reuse files already in context.
- First line of response: `─ vectora: follow-up (context reused) ─`
- Execute using inherited context.
- Final line: `─ vectora: follow-up · session: ~<session_total> tokens saved ─`

---

# SLASH COMMANDS

## /vectora init
Rebuilds the semantic substrate using a multi-step Agent/CLI handshake.
**Phase A: Math, Domain Naming, & Semantic Edges**
1. Run `npx vectora init --step math` — wait for completion. The CLI will output raw file clusters.
2. Evaluate those raw clusters using your semantic understanding. 
3. Deduce a clear business domain name for each cluster (e.g., `auth`, `checkout`, `dashboard`).
4. Look for **implicit semantic connections** between files in those clusters (e.g., Pub/Sub, Dependency Injection, implicit ORM relations) that AST parsers miss.
5. Feed your findings back to the CLI: 
   - `npx vectora enrich domains "{ \"Cluster 1\": \"auth\" }"`
   - `npx vectora enrich edges "{ \"src/auth/login.js\": [\"src/events/emitter.js\"] }"`

**Phase B: Dynamic Pivot Analysis & Knowledge Bootstrap**
1. Request the central files: `npx vectora init --get-pivots`.
2. Read the top pivot file(s) for each major domain using your file reader (up to your token budget).
3. Deduce the architectural conventions, framework constraints, and unwritten rules.
4. Run `npx vectora learn "<rule>" --domain <name>` for each deduced rule. *(Exception to the Universal Mandate: Do not prompt the user for confirmation during this initial bootstrap phase).*
5. Output: `✓ vectora: semantic substrate enriched and ready. Try /vectora prompt <task>.`

## /vectora status
1. Run `npx vectora status` — output its result verbatim.
2. Append below it: `  session: ~<session_total> tokens saved this session`

## /vectora watch
Run `npx vectora watch` in the background.
Output: `↺ vectora: watcher started — graph rebuilds automatically on file changes.`

## /vectora diff
Run `npx vectora diff` — incremental graph update (faster than full init). Output result verbatim.

## /vectora why \<filepath\>
Run `npx vectora why <filepath>` — output result verbatim.

## /vectora help  or  /vectora \<unknown keyword\>
Output:
```
╔─ vectora help ─────────────────────────────────────────────────╗
│                                                                │
│  /vectora prompt <task>   navigate & execute explicitly       │
│  /vectora init            rebuild graph (after big refactors) │
│  /vectora diff            fast incremental graph update       │
│  /vectora status          graph state + session savings       │
│  /vectora watch           auto-rebuild on file changes        │
│  /vectora why <file>      explain why a file is/isn't a pivot │
│  /vectora learn <rule>    teach vectora an architectural rule │
│  /vectora migrate         extract rules from CLAUDE.md/README │
│  /vectora help            show this message                   │
│                                                                │
╚────────────────────────────────────────────────────────────────╝
```

---

# UNIVERSAL USER-IN-THE-LOOP MANDATE

You must **NEVER** silently write to `.vectora/decisions.json`. 
Whether a rule is generated via background reflection, `/vectora learn`, or `/vectora migrate`, you must **ALWAYS** pause, present the proposed rule(s) to the user, and ask for explicit confirmation: *"Should I write this rule to vectora's institutional memory?"*
You may only execute `npx vectora learn` AFTER the user explicitly approves.

---

# INSTITUTIONAL MEMORY (LEARNING)

## 1. Explicit `/vectora learn <rule>`
When the user types this:
1. Evaluate if the rule applies globally or to a specific domain.
2. **PROMPT THE USER:** *"You asked to learn: `<rule>` for domain `[X]`. Should I write this?"*
3. If the user approves, run: `npx vectora learn "<rule>" --domain <domain>` (omit `--domain` if global).

## 2. Background Knowledge Capture
At the end of every coding task, silently self-reflect: *Did I discover a project-specific constraint that future agents need to know?*
**Anti-Bloat Criteria:**
- ❌ Was it a standard bug fix, typo, localized logic error, or standard framework feature? **Ignore.**
- ❌ Is the rule already in the `INSTITUTIONAL MEMORY` block of the brief? **Ignore.**
- ✅ Did the user explicitly correct an architectural choice or pattern? **Capture.**
- ✅ Did a test fail because of an undocumented project-specific invariant? **Capture.**
**Execution:**
If criteria are met, DO NOT run the command automatically. Append a message before ending your turn:
*"I noticed a new architectural constraint during this task: `<rule>`. Should I add this to vectora's institutional memory so I remember it next time?"*

## 3. Legacy Migration (`/vectora migrate` or User Request)
1. Proactively read `CLAUDE.md`, `.windsurfrules`, or `README.md` if they exist.
2. Parse out the behavioral and architectural rules.
3. **PROMPT THE USER:** Present a compiled list: *"I found the following rules in your CLAUDE.md. Should I migrate them into vectora?"*
4. Upon approval, run `npx vectora learn` for each approved rule.

---

# BOOTSTRAP MODE (graph absent)

When `npx vectora brief` exits with an error or returns a degraded banner:

**No source files yet (new project):**
```
╔─ vectora ─────────────────────────────────────────────╗
│ mode:      planning (no source files yet)             │
│ tip:       run `npx vectora init` after first files   │
╚───────────────────────────────────────────────────────╝
```
Generate the initial files, then remind the user: "Run `npx vectora init` to activate structural navigation."

**Source files exist but graph is absent:**
The brief output will contain a degraded banner — emit it verbatim. Proceed by best judgment (folder structure inference). After task completion, remind: "Run `npx vectora init` to unlock full navigation."

---

# BEFORE SPAWNING SUB-AGENTS

For any sub-agent whose task involves reading or modifying source files:
1. Run `npx vectora brief "<sub-task description>"` — capture the full stdout.
2. Prepend the captured output verbatim before the sub-agent's prompt instructions.
3. If `npx vectora brief` fails: prepend `Note: vectora graph unavailable — load files by best judgment.`

---

# END SAVINGS LINE — FORMATS

Always the **last line** of your response, after all code and explanation:

| Task type | Format |
|---|---|
| Single task | `─ vectora: ~N tokens saved this task · session: ~M tokens saved ─` |
| Chained task | `─ vectora: ~N tokens saved this task (K sub-tasks) · session: ~M tokens saved ─` |
| Follow-up | `─ vectora: follow-up (context reused) · session: ~M tokens saved ─` |
| All skeletons opened | `─ vectora: 0 tokens saved this task · session: ~M tokens saved ─` |

N = `skeleton_pool` value from brief minus any skeleton tokens spent on files you opened.
M = running `session_total` from working memory.
