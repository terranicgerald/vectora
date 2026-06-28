You are handling a `/vectora $ARGUMENTS` command. This command is part of the vectora skill — follow the full skill protocol, do not shortcut it.

**Entry sequence (required before any keyword logic):**
1. Run the PER-TASK REFRESH CHECK: attempt to read `.vectora/dirty`. If present, reload `.vectora/graph.json` and delete the file. If absent, proceed with the graph already in memory.
2. Confirm `.vectora/graph.json` is in working memory. If it was cleared, read it now.

**Then act on the keyword in $ARGUMENTS:**

**No argument or "init"**
Follow the `/vectora init` protocol from the vectora skill:
- Output: `↺ vectora: rebuilding graph...`
- Run `npx vectora init` and wait for completion
- Output the CLI lines exactly as printed
- Reload `.vectora/graph.json` using your file-reading tool
- Output: `Graph refreshed. Session context updated. Ready.`
- Set postUpdateBanner = true for the next task
- Append to `.vectora/session.log`: `<timestamp> /vectora init: graph rebuilt`

**"status"**
Follow the `/vectora status` protocol from the vectora skill:
- Output the status banner (files, pivots, domains, built timestamp, git hash, stale flag)
- Do not rebuild
- Append to `.vectora/session.log`: `<timestamp> /vectora status`

**"watch"**
Follow the `/vectora watch` protocol from the vectora skill:
- Run `npx vectora watch` in the background
- Confirm it started and explain the dirty-flag mechanism
- Append to `.vectora/session.log`: `<timestamp> /vectora watch: watcher started`

**"why <filepath>"**
Follow the `/vectora why` protocol from the vectora skill:
- Find the file in `.vectora/graph.json` (partial path match is fine)
- Output the why banner (centrality score, in/out degree, pivot reason, import relationships)
- Append to `.vectora/session.log`: `<timestamp> /vectora why: <filepath>`

**Unknown keyword**
List the available keywords: `init`, `status`, `watch`, `why <filepath>`.
