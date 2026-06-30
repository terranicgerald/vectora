You are handling a `/vectora $ARGUMENTS` command, part of the vectora skill. vectora gives you the structural map of the codebase — the import graph and git co-change history — that you cannot compute yourself. It does NOT decide which files to load; you do.

**Entry sequence (required first):**
1. Check `.vectora/dirty` — if present, run `npx vectora diff`, then delete the file.

**Then act on the keyword in $ARGUMENTS:**

**"init"**
Run `npx vectora init` and output its lines verbatim. This is offline and costs no tokens.

**"diff"**
Run `npx vectora diff` — fast incremental update. Output result verbatim.

**"status"**
Run `npx vectora status` — output result verbatim.

**"watch"**
Run `npx vectora watch` in the background. Confirm it started.

**"why <filepath>"**
Run `npx vectora why <filepath>` — output result verbatim.

**"impact <file|symbol>"**
Run `npx vectora impact <target>` — what breaks if this changes (dependents / symbol consumers). Output verbatim.

**"overview"**
Run `npx vectora overview` — architecture summary (central files, domains, cycles, orphans). Ideal first action on an unfamiliar or new repo. Output verbatim.

**"trace <symbol>"**
Run `npx vectora trace <symbol>` — where it's defined, who calls it, what it depends on. Output verbatim.

**"receipts"**
Run `npx vectora receipts` — show the lifetime count of incomplete edits vectora has flagged in this repo: confirmed breaks, forgotten co-change files, callers to verify, stale tests. An honest number — every entry is a real inspectable event, never an invented percentage.

**"preflight"**
Run `npx vectora preflight` — situational awareness before a session: graph staleness, open misses from the last session, danger zone inventory, cycle presence. Output verbatim before beginning any large task.

**"manifest"**
Run `npx vectora manifest` — causal receipt of the current session: which files were directly targeted, which changed because of structural coupling (arity breaks / co-change), which were flagged but not edited. Paste the output into your PR description.

**"history <filepath>"**
Run `npx vectora history <filepath>` — cross-session coupling memory for a file: how often it changed, which files were co-edited, which co-change partners were flagged but skipped. If a file appears flagged 3+ times without being edited, propose `/vectora learn` to bake it in.

**"impact-report"**
Run `npx vectora impact-report` — 30-day aggregate summary: confirmed breaks caught, co-change links used/missed, highest-risk file, coupling debt trend. Share this in retrospectives.

**"overview --debt"**
Run `npx vectora overview --debt` — coupling debt scores for all file pairs: co-change frequency × weight + shared imports × weight − test coverage. Surfaces the highest-risk pairs that have no test safety net.

**"check"**
Run `npx vectora check` and output the receipt verbatim. It works even if you skipped map. It reports four things:
1. **✗ BROKEN** — confirmed arity mismatches: you changed a function's signature and a live call site now passes the wrong number of args. **Fix these before finishing — they are proven inconsistencies, not guesses.**
2. **⚠ co-change misses** — files that historically change with what you edited but weren't touched.
3. **⚠ caller warnings** — importers that reference an exported symbol from a file you changed (verify they still compile/work).
4. **⚠ stale tests** — colocated tests for source files you changed.
Investigate every line. For ✗ BROKEN: fix immediately. For ⚠: open the flagged file and decide if it needs updating before you finish.

**A task description (anything else — the default)**
Treat the entire `$ARGUMENTS` as the task.
1. Run `npx vectora map "<task>"` and emit the `[VECTORA MAP]` block verbatim as the first lines of your response.
2. Navigate from the seeds using your own judgment. Open the files YOU decide are relevant — nothing is hidden or off-limits.
3. Pay attention to the CO-CHANGE section: those files are edited together in git history and grep cannot reveal them. Check whether they need changing too.
4. Execute the task completely.
5. When done, run `npx vectora check` and show its receipt as the final lines.
