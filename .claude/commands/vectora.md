You are handling a `/vectora $ARGUMENTS` command. This command is part of the vectora skill — follow the full skill protocol.

**Entry sequence (required before any keyword logic):**
1. Check `.vectora/dirty` — if present, run `npx vectora diff` to reload the graph, then delete the file.
2. Confirm the graph is current.

**Then act on the keyword in $ARGUMENTS:**

**No argument or "init"**
- Output: `↺ vectora: rebuilding graph...`
- Run `npx vectora init` and wait for completion — output its lines verbatim
- Note: next task brief will show a "↺ graph refreshed" row

**"diff"**
Run `npx vectora diff` — fast incremental update. Output result verbatim.

**"status"**
Run `npx vectora status` — output result verbatim. Append session total from working memory.

**"watch"**
Run `npx vectora watch` in the background. Confirm it started.

**"why <filepath>"**
Run `npx vectora why <filepath>` — output result verbatim.

**"prompt <task>"**
The recommended pairing pattern. Extract everything after "prompt" as the task.
Run `npx vectora brief "<task>"`. Emit banner verbatim. Load files. Execute. Show savings.

**Unknown keyword**
List available: `init`, `diff`, `status`, `watch`, `why <filepath>`, `prompt <task>`, `help`.
