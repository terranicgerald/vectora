# Changelog

## [2.6.0] — 2026-06-30

**Spec-file scoping + prompt-embedded rule capture.** Closes two gaps a real session exposed: a named doc/spec file never entered scope, and a constraint stated inside the prompt was never captured.

### Added
- **Forced spec-file seeds in `map`.** When a prompt names a `.md`/`.txt`/`.rst` file that exists on disk (e.g. "read `DESIGN.md` and …"), `findSpecSeeds` injects it as a top-ranked seed in the `START HERE` block, even though it lives outside the import graph. The file is the authority for the task; previously `findSeeds` could never surface it. Resolved against the repo root and verified to exist — non-existent references are never hallucinated into scope.
- **Candidate-rule detection in `map`.** `findPromptConstraint` scans the verbatim prompt for embedded permissions ("you may", "feel free to"), bounds ("but only", "only slightly", "no more than"), and conventions ("we never", "we prefer"), and emits a `⚑ CANDIDATE RULE` line in the map block. Because the agent emits the block verbatim, the constraint is guaranteed visible for proposal via `/vectora learn` after the receipt. Deterministic and offline; still user-in-the-loop — no rule is written silently.
- **Fourth background-capture question** in the skill — "did the prompt itself state a constraint, permission, or preference about *how* to execute?" — paired with the `⚑ CANDIDATE RULE` signal. The `[ARCHITECTURAL SIGNAL]` reference now spans questions 1–4.

## [2.5.1] — 2026-06-30

**Cross-session memory hardening.** Fixes a contamination bug the v2.5 multi-task work introduced, adds recency decay, and makes the rulebook shareable.

### Fixed
- **Independent tasks no longer cross-contaminate session co-change.** `check` now records session-observed pairs *within each task's scope* instead of pairing every file edited in a prompt. Multi-task prompts deliberately bundle independent, disjoint-scope tasks; previously `recordObserved` linked their files, writing false couplings into `observed.json`. `map` now persists per-task `taskScopes` in `last-map.json`, and a new `groupEditedByTask` confines recording to task boundaries (falls back to the whole edit set when there was no prior map).

### Added
- **Recency decay on `observed.json`** — a parallel `seen` timestamp map; `observedPeersMap` drops pairs not seen within `observedDecayDays` (default 90; configurable in `vectora.config.js`). Legacy pairs with no timestamp are always kept; counts stay integer so the `sessions M×` label remains truthful.
- **Committed, team-shared rulebook** — `init` writes `.vectora/.gitignore` that tracks only `decisions.json` (the CLAUDE.md replacement) and ignores the per-developer graph, session coupling, and ledger. Commit `decisions.json` to share one rulebook across the team.

## [2.5.0] — 2026-06-30

**The scoped replacement for CLAUDE.md: per-task routing, lean context, honest involvement.** The headline shifts from "proves your edit is complete" (arity breaks, demoted to a secondary safety net) to the value users actually feel every prompt — vectora hands the agent the minimal relevant files and only the rules a task touches, instead of a static CLAUDE.md bloating context every turn.

### Added
- **Task decomposition in `map`** — `splitTasks` splits a prompt into discrete tasks (list markers, connectives like "then"/"and also", imperative-verb boundaries; verb-less fragments fold back; <2 verbs ⇒ one task). Each task gets its own scoped seed set + neighborhood.
- **Routing classification** — `classifyRouting` labels tasks single / chained-sequential (shared scope) / independent-parallel (disjoint scope) from their file sets. The `ROUTING:` line tells the agent when parallel sub-agents keep each context small. The agent decides.
- **Per-task `emitMultiMap`** — one compact block per task: `relevant: N`, scoped `RULES`, `CO-CHANGE`, and a single `FILES` line. The agent reports `loaded: K/relevant` per task.
- **Honest involvement banner** — `vectora check` now closes every prompt with a facts-only box: tasks, files scoped-to of total indexed, rules applied, co-change links surfaced, breaks/callers caught. **No invented token number.** Reconciled from `last-map.json` + the real `git diff`.
- **Scoped institutional memory** — `collectDecisions` returns only the rules whose domain a task touches; `map` surfaces them inline. The CLAUDE.md upgrade: relevant rules per task, not the whole rulebook every turn.

### Changed
- **`emitMap` rewritten lean** — boxed banner and verbose NEIGHBORHOOD dump removed; neighbors fold into one `FILES` line; co-change capped to top 3. Materially fewer tokens per map.
- **First-init `[VECTORA SEED]`** reframed to drive CLAUDE.md/README rule extraction into vectora's scoped memory (graph build stays 0 tokens; rule seeding is the intentional LLM step).
- **SKILL / README / package description** repositioned around scoping + routing + the CLAUDE.md replacement; arity/`check` demoted to a post-edit safety net.

## [2.4.1] — 2026-06-30

**UX hardening: guaranteed-trigger prompt command, self-reporting diff, and context visibility.**

### Added
- **`/vectora prompt <task>`** — guaranteed-trigger form of the map→navigate→check loop. Bypasses activation checks and follow-up detection entirely. Use when you want vectora to run unconditionally regardless of prompt length or phrasing. The skill `## /vectora prompt` section is placed above the standard `/vectora <task>` section so it takes priority.
- **Context line in every map** — `[VECTORA MAP]` now emits `context: N files indexed · M in task scope (S seeds + N neighbors)` immediately after the banner. Agents and users can see at a glance how much of the codebase is indexed and how many files are in scope for this task.
- **`vectora diff` always reports graph state** — previously `diff` silently returned when the graph was already current. Now it always prints a summary: `vectora: graph is current — nothing to update\n  247 files · 3 domains · built 2h ago`. Whether or not anything changed, you see the state of the graph.

### Changed
- `skill/SKILL.src.md` version bumped to 2.4.1; `/vectora diff` section updated to describe the new always-emit summary.
- README rewritten: leads with `✗ BROKEN` proof as primary selling point, adds "In 30 seconds" terminal example at the top, splits commands table into Core / Exploration / Memory tiers, removes outdated TS alias limitation note (fixed in 2.4.0).

## [2.4.0] — 2026-06-30

**Fix the import graph for the repos that matter most.** TypeScript path aliases (`@/`, `~/`, `#lib/`), `jsconfig.json` `baseUrl`, and monorepo workspace cross-package imports now resolve to real files. Plus: seamless institutional memory capture — LLM-driven rule seeding on first init, architectural signal detection in `check`, and zero-arg `migrate` that auto-discovers CLAUDE.md, README, and convention files.

### Added
- **TypeScript path alias resolution** — `resolveImport` previously returned `null` for any import not starting with `.`, silently breaking the graph for every Next.js, Vite-TS, and CRA project. Now `loadTsConfig` reads `tsconfig.json` (or `jsconfig.json`), strips JSONC comments and trailing commas, follows one level of local `extends`, and extracts `baseUrl` + `paths`. Aliases like `@/*` → `src/*` resolve to the actual source file through shared `probeExtensions` logic. The `init` output now shows `aliases: N path aliases · M workspace pkgs` when detected.
- **Monorepo workspace cross-package imports** — `loadWorkspacePackages` reads root `package.json` `workspaces` (array or `{ packages: [] }` form), expands `packages/*`/`apps/*`/`libs/*` globs, and reads each member's `package.json` for `name` + entry point. `import '@myorg/shared'` and sub-path imports (`@myorg/shared/utils/helpers`) now resolve to the actual source file.
- **`tsConfigPath` config option** — users can set `tsConfigPath: 'tsconfig.app.json'` in `vectora.config.js` to point to a non-standard tsconfig (Angular, multi-config setups).
- **LLM-driven rule seeding on first init** — when `init` builds the graph for the first time, it appends a `[VECTORA SEED]` block instructing the agent to run `overview` + `why` on pivot files, synthesize 3–7 architectural rules using LLM judgment, and propose each to the user. This is where LLM reasoning adds value that zero-token init cannot provide.
- **`[ARCHITECTURAL SIGNAL]` in `check`** — `detectSignificantEvent` fires when ≥2 new source files were created or ≥4 structural peers (co-change + caller) were flagged, signaling that the task likely established an architectural pattern worth capturing with `/vectora learn`.
- **`vectora migrate`** — auto-discovers `CLAUDE.md`, `README.md`, `.cursorrules`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, and any `RULES.md`/`DECISIONS.md`/`CONVENTIONS.md` in the repo (no filepath arg needed). Outputs a structured `[VECTORA MIGRATE]` block with file contents, lists existing `decisions.json` rules as a dedup skip-list, and instructs the agent to extract and propose architectural rules for user confirmation.

### Changed
- `resolveImport` refactored: extension-probing logic extracted to shared `probeExtensions(absBase, allPaths)`; non-relative imports now route through `resolveAlias` before returning null.
- `computeCentrality` accepts `aliases` param forwarded from `runInit`/`runDiff`.
- `runInit` and `runDiff` both load tsconfig + workspace aliases before computing centrality.
- `skill/SKILL.src.md` updated: `## After first init` seeding protocol, enhanced `## Background capture` with conversational/semantic triggers, new `## /vectora migrate` section.

## [2.3.0] — 2026-06-30

**Provenance, institutional memory, and coupling visibility.** Six new capabilities that give agents and developers what no amount of context-window size can compute: cross-session pattern memory, causal PR receipts, co-located danger constraints, coupling debt metrics, and a shareable monthly impact summary.

### Added
- **`@vectora danger:` annotations** — co-locate critical constraints with the code they guard (`// @vectora danger: mobile app dependency — no breaking changes`). At `map` time, vectora surfaces all danger annotations on files in the task scope before anything else. Works in JS/TS (`//`), Python (`#`), Go (`//`), Rust (`//`), and Ruby (`#`). Stored in `graph.json` per file.
- **`vectora preflight`** — pre-session situational awareness: graph staleness, open co-change misses from the last session, danger zone inventory, global rule count, cycle presence. Run this before any large or risky session — surfaces unresolved business from the previous session that agents start cold and cannot know about.
- **`vectora manifest`** — causal PR receipt generated offline from the graph + ledger + git diff. Categorizes every changed file as: directly targeted, changed because of structural coupling (confirmed break or co-change), or flagged-but-not-edited. Paste into the PR description to explain *why* each file changed, not just *what* changed.
- **`vectora history <file>`** — cross-session coupling memory: how many times this file changed in the last 30 days, which files were co-edited in each session, and which co-change partners were flagged but never resolved. If a partner appears flagged 3+ times without being edited, `history` proposes a `/vectora learn` rule to bake it in permanently.
- **`vectora impact-report`** — 30-day aggregate summary: confirmed breaks caught, co-change links used vs. missed, callers warned, stale tests flagged, highest-risk file, coupling debt trend. Designed to be pasted into retrospectives or shared with teammates.
- **`vectora overview --debt`** — coupling debt scores for all tracked file pairs: `(coChangeCount × 3) + (sharedImports × 2) − (testCoverageLinks × 5)`. Surfaces the highest-debt pairs with no test safety net — the ones most likely to produce silent bugs.
- **Regression pattern detection in `check`** — after `check` completes, `detectRegressionPatterns` scans the 30-day ledger. If a co-change pair has been flagged 3+ times without being co-edited, `check` surfaces a `learn` proposal so the pattern becomes a persistent rule.

### Changed
- `check` now reads `lastMapTask` from `last-map.json` and surfaces danger annotations on files actually edited (not only map-scope files).
- `runCheck` passes `task` + `editedFiles` to `recordLedger`, so the history is task-attributed and queryable by file.

## [2.2.0] — 2026-06-30

**The completeness guardrail.** `check` graduates from a nag to a real bug-catcher: confirmed arity breaks are now proven inconsistencies, not guesses; the co-change guardrail fires even without a prior `map`; and an honest lifetime ledger accumulates every incomplete edit flagged. `map` is sharpened to lead with co-change (the only signal the agent can't compute itself).

### Added
- **Confirmed arity breaks in `check`** — `✗ BROKEN: billing.js calls parseConfig() with 2 args but it now requires 3.` On every `check`, vectora re-parses the live source of edited JS/TS files *and* their importers from disk and proves the inconsistency from AST call-site argument counts vs. the current function signature. These are not guesses — they are structural inconsistencies that will fail at runtime. Fix every `✗` line before declaring a task done. Python/Go/Rust remain at `⚠ verify?` (planned for 2.3).
- **`check` decoupled from `map`** — Previously, co-change misses were only emitted when `map` had run beforehand (its co-change list was stored in `last-map.json`). Now `check` computes misses directly from the graph and session ledger for every edited file, so the guardrail fires reliably regardless of whether `map` was used. Map-derived pairs and graph-derived pairs are merged and deduplicated.
- **`exportSignatures` captured at init** — `parseBabel` now stores `{ required, max, hasRest }` for every exported function/arrow/method. Used at `check` time to confirm arity breaks; zero cost when `check` finds no callers.
- **Honest ledger + `vectora receipts`** — Every non-zero `check` run appends an event to `.vectora/ledger.json` (per-developer, not committed). `vectora receipts` shows lifetime totals: total incomplete edits flagged, confirmed breaks, co-change misses, caller warnings, stale tests, recent task history. Wording is always "flagged" — never "saved." `vectora status` now includes a one-line receipts summary.

### Changed
- `map` output reordered: **CO-CHANGE leads** (the signal the agent cannot compute itself), followed by a compact START HERE and a capped NEIGHBORHOOD (max 6 lines, with overflow note). No behavior change to seed matching.
- `check` receipt now groups: `✗ BROKEN` first (must fix), then co-change misses, then caller warnings (deduped against confirmed-break importers), then stale tests.
- `buildClaudeCommand` updated to teach the agent the `✗`/`⚠` distinction and the `receipts` command.

## [2.1.0] — 2026-06-30

**Useful from commit #1 — no git history required.** v2.0's "you forgot this file" magic came entirely from git co-change, so it went silent on new or shallow repos. 2.1 adds static, history-free coupling signals so vectora earns its keep on day one.

### Added
- **Caller / consumer recall in `check`** — flags files that import what you changed *and* reference one of its exported symbols, but that you didn't touch (`⚠ retry.ts imports errors.ts (uses RetryError) but wasn't edited — verify?`). Pure static graph; no git history needed. (Signature-aware escalation is the next phase.)
- **Test-pairing in `check`** — `⚠ charge.ts changed but charge.test.ts wasn't — update the test?`. Colocated tests are indexed for pairing but kept out of the centrality graph, so pivots are unaffected.
- **Session-observed coupling ledger** (`.vectora/observed.json`) — `check` remembers the files you edit together; `map` surfaces that coupling on future tasks. Merges with git co-change (each link shows provenance: `git 5× · sessions 2×`) and stands in for it entirely on a repo with no history.
- **`vectora impact <file|symbol>`** — "what breaks if I change this?": direct + transitive dependents for a file, or the consumers of an exported symbol.
- **`vectora overview`** — architecture summary (most-depended-on files, domains, entry points, orphans, circular imports). The best first action on an unfamiliar or brand-new repo.
- **`vectora trace <symbol>`** — where a symbol is defined, who calls it, what its file depends on.
- **Blast-radius surfacing** — `map` warns when a seed's changes ripple to many files; `why` now leads with the blast radius.

### Changed
- `check` now detects untracked/new files (via `git status --porcelain`), not just tracked diffs — so it works on a freshly created file.
- `why` uses the precise resolved reverse-dependency graph instead of a name-matching heuristic.
- Skill rewritten to describe the three `check` signals and the new commands.

## [2.0.0] — 2026-06-30

**The Router → Cartographer rebuild.** vectora no longer decides which files your agent loads — it gives the agent the structural map it can't compute (import graph + git co-change history) and proves its worth with an honest post-task receipt.

### Why
v1.x "skeletonized" files and reported invented "tokens saved" numbers. Measured on a real task (`sindresorhus/got`), it cost ~3× more tokens than the baseline and buried the actual edit targets in its skeleton bucket. The headline savings figure was not real.

### Added
- `vectora map "<task>"` — emits a `[VECTORA MAP]` block: keyword-matched **seeds** (each with the reason it matched), the graph **neighborhood** (forward imports, reverse importers, centrality), and **co-change** pairs from git history. Nothing is hidden or skeletonized; the agent navigates by its own judgment.
- `vectora check` — the honest receipt. Compares `git diff` against the co-change links vectora surfaced; reports the links you used (`✓`) and flags predicted-but-unedited peers (`⚠ worth a look?`). This is the value-proof, verifiable on your own repo.
- `coChangeMaxFiles` config (default 15) — commits touching more than N source files are ignored, so "reformat everything" commits don't create false co-change links.
- TS ESM import resolution: `import './x.js'` now correctly resolves to `x.ts`/`x.tsx`.
- Tests for `findSeeds`, `expandNeighborhood`, `resolveImport`, and `runCheck` (end-to-end co-change recall on a real git fixture).

### Changed
- `vectora init` is now single-pass, fully offline, and **costs zero tokens** — no in-session LLM enrichment.
- Skill rewritten for the map → navigate → check loop across all 7 agents.
- README rewritten around the cartographer pitch and the receipt.

### Removed
- The `PACKAGE_DOMAIN_SIGNALS` table, `SKELETON_VERB_MAP`, `isFrameworkForcedPivot`, and all hardcoded rule tables.
- The Phase-B LLM enrichment in `init` (`enrich`, `init --step`, `--get-pivots`).
- The static `scoreFile`/`selectFiles` scorer and skeleton bucketing.
- `vectora brief` (replaced by `map`; the old name still dispatches to `map` for compatibility).
- Every "tokens saved" claim.

## [1.3.3] — 2026-06-29

### Added
- Tests for `scoreFile`, `selectFiles`, `buildVocabulary`, `detectChain`, and `tokenize` — the core brief algorithm is now covered
- GitHub Actions CI across Node.js 18, 20, and 22
- `scoreFile`, `selectFiles`, and `detectChain` exported from `cli/index.js` for testability
- Language support table in README (JS/TS/Python/Go/Rust/Ruby)
- `vectora.config.js` options documented in README
- TypeScript path alias limitation documented in README
- Badge row in README (npm version, CI status, Node.js version, license)
- CHANGELOG (this file)

### Changed
- ROADMAP: marked shipped V2 items (`decisions.json`, `vectora why`, `@vectora exclude`, chained tasks)
- ROADMAP: moved "CommonJS support" out of V3 (already shipped via Babel parser)
- README: added Ruby to language list in "How It Works"

## [1.3.2] — prior

See git log for earlier history.
