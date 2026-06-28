# vectora Roadmap

---

## V2

**Symbol-level graph**
Function-to-function call chains. Agents rarely need a whole file — sometimes they only need one function and its callers. The graph will track which symbols each function calls and which functions call it, enabling surgical context loading at the function level rather than the file level.

**Architectural decision memory**
`decisions.json` persisting choices across sessions. Schema: decision, evidence, alternatives, constraints, outcome. The skill injects a domain-relevant slice at session start, giving agents awareness of prior architectural choices without re-deriving them from the code.

**Parallel sub-task execution**
For chained tasks where sub-tasks are provably independent — no shared pivots, no output of one feeding the input of another — execute them in parallel rather than sequentially. Dependency analysis runs at decomposition time.

**`// @vectora exclude` and `// @vectora domain:<name>`**
Additional inline annotations for file exclusion and domain override. A file annotated with `exclude` is never indexed. A file annotated with `domain:<name>` is assigned to that domain regardless of folder structure.

**`npx vectora why <filepath>`**
Transparency command: prints centrality score, in-degree, out-degree, pivot classification, manual pivot status, and the full list of files that import it and that it imports. Lets developers understand exactly why a file was or was not classified as a pivot.

---

## V3

**CommonJS support**
`require()` and `module.exports` resolution. Handles mixed ESM/CJS codebases.

**Path alias resolution**
Support for TypeScript `paths`, webpack `resolve.alias`, and Vite `resolve.alias` configurations. Resolves `@/components/Button` to `src/components/Button.tsx` during graph construction.

**Monorepo workspace awareness**
Treats packages within a monorepo as distinct domains with cross-package import edges. Supports npm/yarn/pnpm workspaces.

**Runtime relationship inference**
Detects structural patterns that imply runtime relationships: Express router registration, NestJS module declarations, Prisma model references, inversify/tsyringe injection tokens. Adds inferred edges to the graph with an `inferred: true` flag.

---

## V4

**Multi-language support**
Python (import graph via AST), Go (package imports), Rust (mod/use graph). Each language gets its own parser module. The graph schema and skill protocol remain unchanged — only the indexing layer changes per language.
