# vectora Roadmap

Items marked ✅ are shipped.

---

## V2

**Symbol-level graph**
Function-to-function call chains. Agents rarely need a whole file — sometimes they only need one function and its callers. The graph will track which symbols each function calls and which functions call it, enabling surgical context loading at the function level rather than the file level.

✅ **Architectural decision memory**
`decisions.json` persisting choices across sessions. The skill injects a domain-relevant slice at session start, giving agents awareness of prior architectural choices without re-deriving them from the code.

✅ **Chained task execution**
For tasks expressed as ", then …" or "and then …", vectora decomposes them into per-sub-task briefs with shared pivot deduplication.

✅ **`// @vectora exclude` and `// @vectora domain:<name>`**
Inline annotations for file exclusion and domain override.

✅ **`npx vectora why <filepath>`**
Transparency command: prints centrality score, in-degree, out-degree, pivot classification, and the full list of files that import it and that it imports.

---

## V3

**Path alias resolution**
Support for TypeScript `paths`, webpack `resolve.alias`, and Vite `resolve.alias` configurations. Resolves `@/components/Button` to `src/components/Button.tsx` during graph construction. Until then, import edges through aliases are silently dropped — see the README note.

**Monorepo workspace awareness**
Treats packages within a monorepo as distinct domains with cross-package import edges. Supports npm/yarn/pnpm workspaces.

**Runtime relationship inference**
Detects structural patterns that imply runtime relationships: Express router registration, NestJS module declarations, Prisma model references, inversify/tsyringe injection tokens. Adds inferred edges to the graph with an `inferred: true` flag.

---

## V4

**Reproducible benchmark harness**
A public script that measures token usage before/after vectora on canonical open-source repos using the Claude API, with methodology documented and results published.
