'use strict';

// Runs entirely offline — no network calls, no telemetry, no analytics.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
]);

// Directories that are scaffolding/fixtures, not the source the agent navigates.
// Excluded by default so they don't pollute domains or get classified as pivots.
const DEFAULT_EXCLUDE_DIRS = new Set([
  'example-repo', 'examples', 'fixtures', '__fixtures__',
  '__tests__', '__mocks__', '__snapshots__', 'test', 'tests',
]);

// Test/story files are skipped by default for the same reason.
const TEST_FILE_RE = /\.(test|spec|stories)\.(js|jsx|ts|tsx)$/;

// Matches a line whose entire content is the pivot annotation comment.
// Anchored to line boundaries so a mention inside a string or another comment
// (e.g. raw.includes(...) in this very file) is NOT treated as a manual pivot.
const MANUAL_PIVOT_RE = /^[ \t]*\/\/[ \t]*@vectora[ \t]+pivot[ \t]*$/m;

const VALID_CONFIG_FIELDS = new Set([
  'pivotThreshold', 'refreshAfterHours', 'refreshAfterChanges',
  'forcePivots', 'exclude', 'domains',
]);

const SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx)$/;

const SKILL_SRC = path.join(__dirname, '..', 'skill', 'SKILL.src.md');

/** Parses argv and dispatches to the matching subcommand. */
function main() {
  const args = process.argv.slice(2);
  const subcmd = args[0];

  if (subcmd === 'install') {
    runInstall();
  } else if (subcmd === 'watch') {
    runWatch();
  } else if (subcmd === 'init' || subcmd === '--reset' || !subcmd) {
    if (!runInit()) process.exit(1);
  } else if (subcmd === 'brief') {
    const task = args.slice(1).join(' ');
    if (!task) { console.error('vectora brief: provide a task description'); process.exit(1); }
    runBrief(task);
  } else if (subcmd === '--help' || subcmd === '-h') {
    printHelp();
  } else {
    console.error(`vectora: unknown command "${subcmd}". Run vectora --help.`);
    process.exit(1);
  }
}

/** Prints usage to stdout. */
function printHelp() {
  console.log(`
vectora — structural codebase navigation for AI coding agents

Commands:
  vectora init             Scan this project and build .vectora/graph.json
  vectora brief "<task>"   Generate a context brief for sub-agent injection
  vectora watch            Watch for file changes and rebuild the graph automatically
  vectora install          Install the skill into detected AI agent(s)
  vectora --reset          Force a full rescan (alias for init)
  vectora --help           Show this message

Inside Claude Code, type /vectora to rebuild the graph without leaving the chat.
Keywords: /vectora init · /vectora status · /vectora watch · /vectora why <file>
`.trim());
}

/**
 * Copies the skill into each detected agent's config directory.
 * Falls back to Claude Code when no agent harnesses are found in the project.
 */
function runInstall() {
  const root = process.cwd();

  if (!fs.existsSync(SKILL_SRC)) {
    console.error('vectora: skill source not found at', SKILL_SRC);
    console.error('vectora: ensure you are running via npx vectora install');
    process.exit(1);
  }

  const skillContent = fs.readFileSync(SKILL_SRC, 'utf8');
  const skillBody = stripFrontmatter(skillContent);

  const detected = detectAgents(root);

  if (detected.length === 0) {
    detected.push('claude');
    console.log('vectora: no agent harness detected — installing for Claude Code by default');
  }

  let installed = 0;

  for (const agent of detected) {
    if (agent === 'claude') {
      const skillDest = path.join(root, '.claude', 'skills', 'vectora', 'SKILL.md');
      fs.mkdirSync(path.dirname(skillDest), { recursive: true });
      fs.writeFileSync(skillDest, skillContent, 'utf8');
      console.log(`✓ vectora: installed for Claude Code → .claude/skills/vectora/SKILL.md`);

      const cmdDest = path.join(root, '.claude', 'commands', 'vectora.md');
      fs.mkdirSync(path.dirname(cmdDest), { recursive: true });
      fs.writeFileSync(cmdDest, buildClaudeCommand(), 'utf8');
      console.log(`✓ vectora: registered slash command → .claude/commands/vectora.md`);

      installed++;
    }

    if (agent === 'cursor') {
      const dest = path.join(root, '.cursor', 'rules', 'vectora.mdc');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildCursorVariant(skillBody), 'utf8');
      console.log(`✓ vectora: installed for Cursor → .cursor/rules/vectora.mdc`);
      installed++;
    }

    if (agent === 'codex') {
      const dest = path.join(root, 'AGENTS.md');
      writeOrMergeSection(dest, '<!-- vectora -->', buildAgentsMdSection(skillBody));
      console.log(`✓ vectora: installed for Codex → AGENTS.md`);
      installed++;
    }

    if (agent === 'windsurf') {
      const dest = path.join(root, '.windsurfrules');
      writeOrMergeSection(dest, '<!-- vectora -->', buildWindsurfSection(skillBody));
      console.log(`✓ vectora: installed for Windsurf → .windsurfrules`);
      installed++;
    }

    if (agent === 'kiro') {
      const dest = path.join(root, '.kiro', 'rules', 'vectora.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildKiroVariant(skillBody), 'utf8');
      console.log(`✓ vectora: installed for Kiro → .kiro/rules/vectora.md`);
      installed++;
    }

    if (agent === 'opencode') {
      const dest = path.join(root, '.opencode', 'rules', 'vectora.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildOpenCodeVariant(skillBody), 'utf8');
      console.log(`✓ vectora: installed for OpenCode → .opencode/rules/vectora.md`);
      installed++;
    }

    if (agent === 'gemini') {
      const dest = path.join(root, '.gemini', 'skills', 'vectora', 'SKILL.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildGeminiVariant(skillBody), 'utf8');
      console.log(`✓ vectora: installed for Gemini CLI → .gemini/skills/vectora/SKILL.md`);
      installed++;
    }
  }

  console.log('');
  console.log(`✓ vectora: skill installed for ${installed} agent(s)`);
  console.log(`✓ vectora: run 'npx vectora init' to build the structural graph`);
}

/**
 * Checks which AI agent config directories exist in the project root.
 * Returns a list of agent names — used to decide which skill formats to write.
 */
function detectAgents(root) {
  const agents = [];
  if (
    fs.existsSync(path.join(root, '.claude')) ||
    fs.existsSync(path.join(root, 'CLAUDE.md'))
  ) agents.push('claude');
  if (fs.existsSync(path.join(root, '.cursor'))) agents.push('cursor');
  if (fs.existsSync(path.join(root, '.codex'))) agents.push('codex');
  if (fs.existsSync(path.join(root, '.windsurfrules'))) agents.push('windsurf');
  if (fs.existsSync(path.join(root, '.kiro'))) agents.push('kiro');
  if (fs.existsSync(path.join(root, '.opencode'))) agents.push('opencode');
  if (fs.existsSync(path.join(root, '.gemini'))) agents.push('gemini');
  return agents;
}

/** Strips the YAML frontmatter block from a markdown file. */
function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n/, '').trimStart();
}

/** Wraps the skill body in Cursor's .mdc frontmatter format. */
function buildCursorVariant(body) {
  return `---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ["**/*"]
alwaysApply: true
---

${body}`;
}

/** Wraps the skill body in a fenced markdown section suitable for AGENTS.md. */
function buildAgentsMdSection(body) {
  return `<!-- vectora -->
# vectora — Structural Navigation Instructions

${body}
<!-- /vectora -->`;
}

/** Wraps the skill body in a fenced section for .windsurfrules. */
function buildWindsurfSection(body) {
  return `<!-- vectora -->
# vectora — Structural Navigation Instructions

${body}
<!-- /vectora -->`;
}

/** Wraps the skill body in Kiro's .md rule format. */
function buildKiroVariant(body) {
  return `---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ""
alwaysApply: false
---

${body}`;
}

/** Wraps the skill body in OpenCode's rule format (identical shape to Kiro). */
function buildOpenCodeVariant(body) {
  return `---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ""
alwaysApply: false
---

${body}`;
}

/** Returns the skill body as plain markdown for Gemini CLI (no frontmatter needed). */
function buildGeminiVariant(body) {
  return body;
}

/**
 * Returns the content for the Claude Code custom slash command file.
 * The command wires into the vectora skill protocol — it does not bypass it.
 * Supports keywords: init (default), status, watch, why <filepath>.
 */
function buildClaudeCommand() {
  return `You are handling a \`/vectora $ARGUMENTS\` command. This command is part of the vectora skill — follow the full skill protocol, do not shortcut it.

**Entry sequence (required before any keyword logic):**
1. Run the PER-TASK REFRESH CHECK: attempt to read \`.vectora/dirty\`. If present, reload \`.vectora/graph.json\` and delete the file. If absent, proceed with the graph already in memory.
2. Confirm \`.vectora/graph.json\` is in working memory. If it was cleared, read it now.

**Then act on the keyword in $ARGUMENTS:**

**No argument or "init"**
Follow the \`/vectora init\` protocol from the vectora skill:
- Output: \`↺ vectora: rebuilding graph...\`
- Run \`npx vectora init\` and wait for completion
- Output the CLI lines exactly as printed
- Reload \`.vectora/graph.json\` using your file-reading tool
- Output: \`Graph refreshed. Session context updated. Ready.\`
- Set postUpdateBanner = true for the next task
- Append to \`.vectora/session.log\`: \`<timestamp> /vectora init: graph rebuilt\`

**"status"**
Follow the \`/vectora status\` protocol from the vectora skill:
- Output the status banner (files, pivots, domains, built timestamp, git hash, stale flag)
- Do not rebuild
- Append to \`.vectora/session.log\`: \`<timestamp> /vectora status\`

**"watch"**
Follow the \`/vectora watch\` protocol from the vectora skill:
- Run \`npx vectora watch\` in the background
- Confirm it started and explain the dirty-flag mechanism
- Append to \`.vectora/session.log\`: \`<timestamp> /vectora watch: watcher started\`

**"why <filepath>"**
Follow the \`/vectora why\` protocol from the vectora skill:
- Find the file in \`.vectora/graph.json\` (partial path match is fine)
- Output the why banner (centrality score, in/out degree, pivot reason, import relationships)
- Append to \`.vectora/session.log\`: \`<timestamp> /vectora why: <filepath>\`

**Unknown keyword**
List the available keywords: \`init\`, \`status\`, \`watch\`, \`why <filepath>\`.
`;
}

/**
 * Writes a named section into a file, replacing any prior section with the same marker.
 * Safe to call repeatedly — existing content outside the section is preserved.
 */
function writeOrMergeSection(filepath, marker, section) {
  const endMarker = marker.replace('<!--', '<!--/').replace(' -->', ' -->');
  let existing = '';
  if (fs.existsSync(filepath)) {
    existing = fs.readFileSync(filepath, 'utf8');
  }

  const startIdx = existing.indexOf(marker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    existing = existing.slice(0, startIdx) + existing.slice(endIdx + endMarker.length).trimStart();
  }

  const final = existing.trimEnd() + (existing.trimEnd() ? '\n\n' : '') + section + '\n';
  fs.writeFileSync(filepath, final, 'utf8');
}

/**
 * Watches the project for source file changes and rebuilds graph.json automatically.
 * Attaches fs.watch listeners to every source directory at startup (cross-platform,
 * no extra dependencies). Debounces rapid bursts to a single rebuild per 500ms.
 * Writes .vectora/dirty after each rebuild so the skill picks it up before the next task.
 */
function runWatch() {
  const root = process.cwd();
  const graphPath = path.join(root, '.vectora', 'graph.json');

  if (!fs.existsSync(graphPath)) {
    console.log('vectora: no graph found — run `npx vectora init` first, then `npx vectora watch`');
    process.exit(1);
  }

  let debounceTimer = null;
  let rebuilding = false;

  const scheduleRebuild = (changedFile) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (rebuilding) return;
      rebuilding = true;
      process.stdout.write(`vectora: ${changedFile} — rebuilding... `);
      const ok = runInit({ silent: true, root });
      if (ok) {
        fs.writeFileSync(path.join(root, '.vectora', 'dirty'), '', 'utf8');
        process.stdout.write('done\n');
      } else {
        process.stdout.write('failed (check for syntax errors)\n');
      }
      rebuilding = false;
    }, 500);
  };

  // Attach a watcher to a single directory (non-recursive — handles Linux compatibility).
  const attachWatcher = (dir) => {
    try {
      fs.watch(dir, (event, filename) => {
        if (!filename) return;
        if (!SOURCE_EXTENSIONS.test(filename)) return;
        const rel = path.relative(root, path.join(dir, filename));
        if (rel.startsWith('node_modules') || rel.startsWith('.')) return;
        scheduleRebuild(rel);
      });
    } catch {
      // Directory may have been deleted — ignore.
    }
  };

  // Walk all source directories and attach a watcher to each one.
  const watchTree = (dir) => {
    attachWatcher(dir);
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          watchTree(path.join(dir, entry.name));
        }
      }
    } catch {}
  };

  watchTree(root);
  console.log('vectora: watching for file changes (ctrl+c to stop)');

  // Keep the process alive.
  process.stdin.resume();
}

/**
 * Walks the project, parses every JS/TS source file, scores files by centrality,
 * classifies the top 15% as pivots, maps domain vocabulary, and writes .vectora/graph.json.
 *
 * Accepts an options object for use by the watcher:
 *   silent: suppress console output
 *   root:   override process.cwd() (used internally)
 *
 * Returns true on success, false on failure — never calls process.exit() directly
 * so the watcher can call it safely in a loop.
 */
function runInit({ silent = false, root = process.cwd() } = {}) {
  const config = mergeConfig(loadConfig(root));
  const filePaths = walkDir(root, root, config);

  if (filePaths.length === 0) {
    if (!silent) console.log('vectora: no source files found. Are you in the right directory?');
    return false;
  }

  const parsed = [];
  let totalLines = 0;

  for (const fullPath of filePaths) {
    const result = parseFile(fullPath);
    if (!result) continue;
    const relative = path.relative(root, fullPath);
    totalLines += result.lineCount;
    parsed.push({ fullPath, path: relative, ...result });
  }

  if (parsed.length === 0) {
    if (!silent) console.log('vectora: all files failed to parse. Check for syntax errors.');
    return false;
  }

  const { inDegree, outDegree } = computeCentrality(parsed);

  const pivotCount = Math.ceil(parsed.length * config.pivotThreshold);
  const forcePivotSet = new Set(
    (config.forcePivots || []).map(p => path.resolve(root, p))
  );

  const scored = parsed.map(f => ({
    ...f,
    centralityScore: (inDegree.get(f.fullPath) ?? 0) * 2 + (outDegree.get(f.fullPath) ?? 0),
  }));

  const sorted = [...scored].sort((a, b) => b.centralityScore - a.centralityScore);
  const topPaths = new Set(sorted.slice(0, pivotCount).map(f => f.fullPath));

  const domainMap = new Map();
  for (const f of scored) {
    domainMap.set(f.fullPath, inferDomain(f.path, config.domains));
  }

  const domainFiles = new Map();
  for (const f of scored) {
    const domain = domainMap.get(f.fullPath);
    if (!domainFiles.has(domain)) domainFiles.set(domain, []);
    domainFiles.get(domain).push(f);
  }

  const avgLinesPerFile = Math.round(totalLines / parsed.length);

  const files = scored.map(f => ({
    path: f.path,
    domain: domainMap.get(f.fullPath),
    isPivot: topPaths.has(f.fullPath) || f.manualPivot || forcePivotSet.has(f.fullPath),
    manualPivot: f.manualPivot || forcePivotSet.has(f.fullPath),
    centralityScore: f.centralityScore,
    lineCount: f.lineCount,
    charCount: f.charCount,
    exports: f.exports,
    imports: f.imports,
  }));

  const domains = {};
  for (const [domainName, domainFileList] of domainFiles) {
    domains[domainName] = {
      pivots: domainFileList
        .filter(f => files.find(o => o.path === f.path)?.isPivot)
        .map(f => f.path),
      vocabulary: buildVocabulary(domainFileList),
    };
  }

  const totalPivots = files.filter(f => f.isPivot).length;
  const domainCount = Object.keys(domains).length;

  // Warn when the graph looks degenerate: almost all files have zero centrality.
  // This typically means only CJS files were found and the previous ESM-only
  // pass produced no edges. A degenerate graph is written (for partial value)
  // but the user is warned so they know navigation quality is reduced.
  const nonZero = scored.filter(f => f.centralityScore > 0).length;
  if (!silent && nonZero === 0 && scored.length > 1) {
    console.warn(`vectora: ⚠ all ${scored.length} files scored zero centrality — imports may not have resolved.`);
    console.warn(`vectora: check for unsupported patterns (path aliases, dynamic imports).`);
  } else if (!silent && nonZero < scored.length * 0.1 && scored.length > 5) {
    console.warn(`vectora: ⚠ only ${nonZero}/${scored.length} files have import edges — graph may be partial.`);
  }

  const graph = {
    generated: new Date().toISOString(),
    gitHash: getGitHash(root),
    avgLinesPerFile,
    files,
    domains,
  };

  fs.mkdirSync(path.join(root, '.vectora'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.vectora', 'graph.json'),
    JSON.stringify(graph, null, 2),
    'utf8'
  );

  if (!silent) {
    console.log(`✓ vectora: ${files.length} files indexed, ${totalPivots} pivots found, ${domainCount} domains mapped`);
    console.log(`✓ graph written to .vectora/graph.json`);
    console.log(`✓ graph ready — type /vectora help in your AI agent to get started`);
  }

  return true;
}

/**
 * Reads vectora.config.js from the project root, silently ignoring unknown fields.
 * Returns an empty object when no config file is present.
 */
function loadConfig(root) {
  const configPath = path.join(root, 'vectora.config.js');
  let raw;
  try {
    raw = require(configPath);
  } catch {
    return {};
  }

  const config = {};
  for (const key of Object.keys(raw)) {
    if (!VALID_CONFIG_FIELDS.has(key)) {
      console.warn(`vectora: unknown config field "${key}" — ignored`);
      continue;
    }
    config[key] = raw[key];
  }
  return config;
}

/** Merges user config with defaults. All fields are optional. */
function mergeConfig(userConfig) {
  return {
    pivotThreshold: userConfig.pivotThreshold ?? 0.15,
    refreshAfterHours: userConfig.refreshAfterHours ?? 24,
    refreshAfterChanges: userConfig.refreshAfterChanges ?? 10,
    forcePivots: userConfig.forcePivots ?? [],
    exclude: userConfig.exclude ?? [],
    domains: userConfig.domains ?? null,
  };
}

/**
 * Recursively collects JS/TS source files under a directory.
 * Skips build output, hidden directories, and any paths matching exclude globs.
 */
function walkDir(dir, root, config, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || DEFAULT_EXCLUDE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      walkDir(fullPath, root, config, results);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
      if (TEST_FILE_RE.test(entry.name)) continue;
      if (isExcluded(relative, config.exclude)) continue;
      results.push(fullPath);
    }
  }
  return results;
}

/** Returns true if the relative path matches any configured exclude glob. */
function isExcluded(relative, patterns) {
  if (!patterns || patterns.length === 0) return false;
  try {
    const { minimatch } = require('minimatch');
    return patterns.some(p => minimatch(relative, p, { matchBase: true }));
  } catch {
    return false;
  }
}

/**
 * Depth-first AST visitor. Calls fn(node) for every node in the tree.
 * Used so CJS patterns nested inside function bodies are still detected.
 */
function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAst(c, fn);
    } else if (child && typeof child === 'object' && child.type) {
      walkAst(child, fn);
    }
  }
}

/**
 * Parses a single source file via Babel's AST.
 * Returns the import sources, exported names, line count, and whether
 * the file carries a manual pivot annotation. Returns null on parse failure.
 */
function parseFile(filepath) {
  let raw;
  try {
    raw = fs.readFileSync(filepath, 'utf8');
  } catch {
    console.warn(`vectora: could not read ${filepath} — skipped`);
    return null;
  }

  const manualPivot = MANUAL_PIVOT_RE.test(raw);
  const lineCount = raw.split('\n').length;

  let ast;
  try {
    const parser = require('@babel/parser');
    ast = parser.parse(raw, {
      sourceType: 'module',
      strictMode: false,
      plugins: [
        'typescript',
        ['jsx', { throwIfNamespace: false }],
        'importAssertions',
        'decorators-legacy',
      ],
    });
  } catch {
    console.warn(`vectora: parse error in ${path.basename(filepath)} — skipped`);
    return null;
  }

  const imports = [];
  const exports = [];

  // Walk the full AST to catch both ESM and CommonJS patterns.
  walkAst(ast.program, (node) => {
    // ESM: import 'source'
    if (node.type === 'ImportDeclaration') {
      imports.push(node.source.value);
      return;
    }

    // ESM: export { a, b } or export function/class/const
    if (node.type === 'ExportNamedDeclaration') {
      for (const spec of node.specifiers ?? []) {
        const name = spec.exported?.name;
        if (name) exports.push(name);
      }
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.id?.name) exports.push(decl.id.name);
        for (const d of decl.declarations ?? []) {
          if (d.id?.name) exports.push(d.id.name);
        }
      }
      return;
    }

    // ESM: export default
    if (node.type === 'ExportDefaultDeclaration') {
      exports.push(node.declaration?.id?.name || 'default');
      return;
    }

    // CJS: require('source') — anywhere in the tree
    if (
      node.type === 'CallExpression' &&
      node.callee?.name === 'require' &&
      node.arguments?.[0]?.type === 'StringLiteral'
    ) {
      imports.push(node.arguments[0].value);
      return;
    }

    // CJS: module.exports = { a, b } or module.exports.name = ...
    if (
      node.type === 'AssignmentExpression' &&
      node.left?.type === 'MemberExpression'
    ) {
      const obj = node.left.object;
      const prop = node.left.property;

      // module.exports.name = value  →  export 'name'
      if (
        obj?.type === 'MemberExpression' &&
        obj.object?.name === 'module' &&
        obj.property?.name === 'exports' &&
        prop?.name
      ) {
        exports.push(prop.name);
        return;
      }

      // module.exports = { key: val, ... }
      if (
        obj?.name === 'module' &&
        prop?.name === 'exports' &&
        node.right?.type === 'ObjectExpression'
      ) {
        for (const p of node.right.properties ?? []) {
          const key = p.key?.name || p.key?.value;
          if (key) exports.push(key);
        }
        return;
      }

      // exports.name = value
      if (obj?.name === 'exports' && prop?.name) {
        exports.push(prop.name);
      }
    }
  });

  return { manualPivot, lineCount, charCount: raw.length, imports, exports };
}

/**
 * Resolves a relative import specifier to an absolute path within the project.
 * Tries common extensions and index file variants. Returns null for external packages
 * or imports that don't resolve to a known project file.
 */
function resolveImport(importer, importSource, allPaths) {
  if (!importSource.startsWith('.')) return null;
  const dir = path.dirname(importer);
  const resolved = path.resolve(dir, importSource);

  // Exact match first — handles CJS require('./foo.js') with explicit extension.
  if (allPaths.has(resolved)) return resolved;

  // Try appending extensions (ESM bare specifiers, TypeScript imports).
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = resolved + ext;
    if (allPaths.has(candidate)) return candidate;
  }

  // Try index file variants (directory imports).
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = path.join(resolved, 'index') + ext;
    if (allPaths.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Computes in-degree and out-degree for every file in the project.
 * in-degree: how many files import this one.
 * out-degree: how many project files this one imports.
 * These two numbers feed the centrality score used for pivot classification.
 */
function computeCentrality(parsedFiles) {
  const allPaths = new Set(parsedFiles.map(f => f.fullPath));
  const inDegree = new Map();
  const outDegree = new Map();

  for (const f of parsedFiles) {
    if (!inDegree.has(f.fullPath)) inDegree.set(f.fullPath, 0);
    if (!outDegree.has(f.fullPath)) outDegree.set(f.fullPath, 0);
  }

  for (const f of parsedFiles) {
    const visited = new Set();
    for (const imp of f.imports) {
      const resolved = resolveImport(f.fullPath, imp, allPaths);
      if (!resolved || visited.has(resolved)) continue;
      visited.add(resolved);
      outDegree.set(f.fullPath, (outDegree.get(f.fullPath) ?? 0) + 1);
      inDegree.set(resolved, (inDegree.get(resolved) ?? 0) + 1);
    }
  }

  return { inDegree, outDegree };
}

/**
 * Derives a domain label for a file from folder structure or config globs.
 * src/auth/login.ts → "auth", src/payments/charge.ts → "payments".
 * Falls back to the first path segment when no config mapping matches.
 */
function inferDomain(relative, configDomains) {
  if (configDomains) {
    try {
      const { minimatch } = require('minimatch');
      for (const [domainName, pattern] of Object.entries(configDomains)) {
        if (minimatch(relative, pattern, { matchBase: true })) return domainName;
      }
    } catch {}
    return 'root';
  }

  const parts = relative.split(path.sep);
  if (parts[0] === 'src' && parts.length > 1) return parts[1];
  return parts[0] || 'root';
}

/**
 * Builds a vocabulary term list for a domain from file stem names and export identifiers.
 * The skill uses these terms to match task prompts against the right domain at runtime.
 */
function buildVocabulary(files) {
  const terms = new Set();
  for (const file of files) {
    const stem = path.basename(file.path, path.extname(file.path)).toLowerCase();
    if (stem.length >= 3) terms.add(stem);
    for (const exp of file.exports) {
      const lower = exp.toLowerCase();
      if (lower.length >= 3) terms.add(lower);
    }
  }
  return Array.from(terms);
}

/**
 * Splits a free-text string into lowercase tokens for domain vocabulary matching.
 * Handles camelCase, PascalCase, snake_case, kebab-case, and whitespace/punctuation.
 * Tokens under 3 characters are discarded (matches skill-side tokenization rules).
 */
function tokenize(str) {
  const decamel = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  const deseparated = decamel.replace(/[_\-]/g, ' ');
  return deseparated
    .toLowerCase()
    .split(/[\s/\\.,:;'"!?()[\]{}]+/)
    .filter(t => t.length >= 3);
}

/**
 * Reads .vectora/graph.json, matches the task description against domain vocabulary,
 * and prints a context brief to stdout. The brief is designed to be injected verbatim
 * into the prompt of any sub-agent handling the task — it tells the agent which files
 * to load in full (pivots) and which to treat as 3-line skeletons.
 */
function runBrief(task) {
  const root = process.cwd();
  const graphPath = path.join(root, '.vectora', 'graph.json');

  if (!fs.existsSync(graphPath)) {
    console.error('vectora brief: no graph found — run `npx vectora init` first');
    process.exit(1);
  }

  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch {
    console.error('vectora brief: failed to parse graph.json');
    process.exit(1);
  }

  const { domains = {}, files = [] } = graph;
  const taskTokens = new Set(tokenize(task));

  // Score each domain by vocabulary overlap: matches / vocab size
  const scores = {};
  for (const [name, data] of Object.entries(domains)) {
    const vocab = data.vocabulary || [];
    if (vocab.length === 0) { scores[name] = 0; continue; }
    let matches = 0;
    for (const term of vocab) {
      if (taskTokens.has(term)) matches++;
    }
    scores[name] = matches / vocab.length;
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = entries[0]?.[1] ?? 0;

  let matchedDomains;
  let isFallback = false;

  if (best < 0.1) {
    matchedDomains = Object.keys(domains);
    isFallback = true;
  } else {
    matchedDomains = entries.filter(([, s]) => s >= best - 0.05).map(([n]) => n);
  }

  const matchedFiles = files.filter(f => matchedDomains.includes(f.domain));
  const pivots = matchedFiles.filter(f => f.isPivot);
  const skeletons = matchedFiles.filter(f => !f.isPivot);

  const PIVOT_CAP = 20;
  const SKELETON_CAP = 40;
  const cappedPivots = pivots.slice(0, PIVOT_CAP);
  const cappedSkeletons = skeletons.slice(0, SKELETON_CAP);

  const domainLabel = isFallback
    ? 'fallback (all pivots — no specific domain matched)'
    : matchedDomains.join(', ');

  const lines = [];
  lines.push('[VECTORA CONTEXT BRIEF]');
  lines.push(`task: ${task}`);
  lines.push(`domain: ${domainLabel}`);
  lines.push('');
  lines.push('LOAD IN FULL — pivot files:');
  if (cappedPivots.length === 0) {
    lines.push('  (none — load files by best judgment)');
  } else {
    for (const f of cappedPivots) lines.push(`  ${f.path}`);
    if (pivots.length > PIVOT_CAP) {
      lines.push(`  [truncated — ${pivots.length - PIVOT_CAP} more pivot(s) not shown]`);
    }
  }
  lines.push('');
  lines.push('SKELETON ONLY — do not open these files, use the summary lines:');
  if (cappedSkeletons.length === 0) {
    lines.push('  (none)');
  } else {
    for (const f of cappedSkeletons) {
      const exps = f.exports?.length ? f.exports.join(', ') : 'none';
      const imps = (f.imports || []).filter(i => !i.startsWith('.')).slice(0, 5).join(', ') || 'none';
      lines.push(`  // ${f.path} [${f.lineCount} lines] — Exports: ${exps} — Imports: ${imps}`);
    }
    if (skeletons.length > SKELETON_CAP) {
      lines.push(`  [truncated — ${skeletons.length - SKELETON_CAP} more file(s) not shown]`);
    }
  }
  lines.push('');
  lines.push('PROPAGATION: If you spawn sub-agents for coding tasks, prepend this brief to their prompts.');
  lines.push('[END VECTORA CONTEXT BRIEF]');

  console.log(lines.join('\n'));
}

/**
 * Returns the current git HEAD hash. Returns null when git is unavailable or the
 * directory is not a repository — the skill falls back to timestamp-based staleness checks.
 */
function getGitHash(root) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).toString().trim();
  } catch {
    return null;
  }
}

// Exported for tests and for bin/vectora.js. The CLI only auto-runs when this
// file is the program entry point — requiring it (tests, bin shim) does not.
module.exports = {
  main,
  runInit,
  runBrief,
  tokenize,
  parseFile,
  computeCentrality,
  inferDomain,
  buildVocabulary,
  resolveImport,
  walkDir,
  mergeConfig,
  buildKiroVariant,
  buildOpenCodeVariant,
  buildGeminiVariant,
  buildCursorVariant,
  buildAgentsMdSection,
  buildWindsurfSection,
  stripFrontmatter,
  detectAgents,
};

if (require.main === module) main();
