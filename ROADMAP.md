# vectora Roadmap

Items marked ✅ are shipped.

---

## 2.5 — the scoped CLAUDE.md replacement ✅

✅ **Task decomposition in `map`** — a prompt is split into discrete tasks; each gets its own minimal scope so the agent loads only its slice.

✅ **Routing** — tasks classified single / chained-sequential / independent-parallel; the agent is told when parallel sub-agents keep each context small.

✅ **Scoped institutional memory** — only the rules a task touches are surfaced, replacing the static always-on CLAUDE.md blob.

✅ **Honest involvement banner** — every prompt closes with a facts-only summary (scope ratios, rules applied, links surfaced). No token number.

🔜 **`check --by-task`** — reconcile completeness per task using the per-task scopes already persisted in `last-map.json`.

---

## 2.0 — the Cartographer rebuild ✅

✅ **Map / navigate / check loop** — `vectora map` surfaces seeds + graph neighborhood + co-change; the agent navigates by its own judgment; `vectora check` proves which co-change links the edits used.

✅ **Honest receipt** — replaces invented "tokens saved" with edit-recall against git co-change, verifiable on the user's own repo.

✅ **Zero-token offline init** — no LLM in the indexing path.

✅ **Co-change noise filter** (`coChangeMaxFiles`) — drops mega-commits that would create false links.

✅ **TS ESM import resolution** — `./x.js` resolves to `x.ts`.

---

## 2.1 — useful without git history ✅

✅ **Caller / consumer recall** — `check` flags importers that reference an exported symbol you changed but weren't edited. Static, history-free.

✅ **Test pairing** — `check` flags source you changed whose colocated test you left untouched.

✅ **Session-observed coupling ledger** — `check` learns the files you edit together; merged with git co-change (with provenance) and carries the signal on repos with no history.

✅ **Blast radius + `vectora impact`** — "what breaks if I change this?" surfaced in `map`/`why` and as a direct command.

✅ **`vectora overview` / `vectora trace`** — architecture onboarding and symbol-level navigation.

---

## 2.2 — the completeness guardrail ✅

✅ **Confirmed arity breaks** — `check` re-parses edited JS/TS files and their importers live, flags `✗ BROKEN` when a call site passes fewer args than the function now requires. Proven structural inconsistency, not a guess.

✅ **`exportSignatures` at init** — arity captured for every exported symbol at graph-build time; zero overhead at `check` time when no callers are found.

✅ **`check` decoupled from `map`** — co-change misses computed from the graph for all edited files, not only from `last-map.json`. Guardrail fires reliably even without a prior map.

✅ **Honest ledger + `vectora receipts`** — `.vectora/ledger.json` accumulates every non-zero check event; `receipts` command shows lifetime totals and recent history. Only "flagged" counts, never invented savings.

✅ **`map` reordered** — CO-CHANGE leads (the unique signal); NEIGHBORHOOD capped to 6 lines.

---

## 2.3 — provenance, danger zones, and coupling memory ✅

✅ **`@vectora danger:` annotations** — co-locate constraints with code; surfaced at `map` time for any file in the task scope.

✅ **`vectora preflight`** — pre-session situational awareness (graph staleness, open misses, danger inventory, cycles).

✅ **`vectora manifest`** — causal PR receipt: directly targeted vs. structurally forced vs. flagged-but-unedited.

✅ **`vectora history <file>`** — cross-session coupling memory; proposes `learn` when a miss recurs 3+ times.

✅ **`vectora impact-report`** — 30-day shareable summary of what vectora caught.

✅ **`vectora overview --debt`** — coupling debt scores by file pair.

✅ **Regression pattern detection in `check`** — surfaces `learn` proposals for recurring missed co-change pairs.

---

## V2.4

**Symbol-level co-change**
Track which *functions* change together across commits, not just files, so the agent navigates to the exact function.

**Weighted co-change by recency**
Decay shared-commit counts (git) and session-ledger counts by age — last week's co-change is stronger than three years ago.

**`vectora check --strict`**
Exit non-zero in CI when an edit leaves a high-confidence co-change peer or confirmed arity break unresolved — turning the receipt into a mandatory pre-commit / PR guard.

---

## V3

**Path alias resolution**
Support TypeScript `paths`, webpack `resolve.alias`, and Vite `resolve.alias`. Resolves `@/components/Button` during graph construction; today those edges are dropped (co-change is unaffected).

**Monorepo workspace awareness**
Treat packages within a monorepo as distinct domains with cross-package import edges. npm/yarn/pnpm workspaces.

**Runtime relationship inference**
Detect structural patterns implying runtime edges (Express router registration, NestJS modules, Prisma model references, DI tokens) and add them with an `inferred: true` flag — without hardcoded per-framework rule tables.
