'use strict';

// Runs entirely offline — no network calls, no telemetry, no analytics.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '__pycache__', '.venv', 'venv', 'env', 'target', 'vendor',
  '.cargo', 'pkg', '.pytest_cache', '.mypy_cache',
]);

const DEFAULT_EXCLUDE_DIRS = new Set([
  'example-repo', 'examples', 'fixtures', '__fixtures__',
  '__tests__', '__mocks__', '__snapshots__', 'test', 'tests',
]);

const TEST_FILE_RE = /\.(test|spec|stories)\.(js|jsx|ts|tsx|py|go|rs|rb)$/;

// Matches a line whose entire content is the pivot annotation comment.
const MANUAL_PIVOT_RE = /^[ \t]*\/\/[ \t]*@vectora[ \t]+pivot[ \t]*$/m;
const MANUAL_PIVOT_HASH_RE = /^[ \t]*#[ \t]*@vectora[ \t]+pivot[ \t]*$/m; // Python/Ruby

// Matches @vectora danger: <text> annotations (// or # comment styles).
// Co-located with the code they guard; surfaced at map time and in check.
const DANGER_ANNOTATION_RE = /^[ \t]*(?:\/\/|#)[ \t]*@vectora[ \t]+danger:[ \t]*(.+)$/gm;

const VALID_CONFIG_FIELDS = new Set([
  'pivotThreshold', 'refreshAfterHours', 'refreshAfterChanges',
  'forcePivots', 'exclude', 'domains', 'languages',
  'configDownweight', 'coChangeMaxFiles', 'tsConfigPath',
  'observedDecayDays',
]);

const SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|go|rs|rb)$/;

const SKILL_SRC = path.join(__dirname, '..', 'skill', 'SKILL.src.md');

// Disambiguating short name: last two path segments. `index.ts` alone is
// useless in repos with many `index.ts` files; `core/index.ts` is clear.
function shortPath(p) {
  if (!p) return '';
  const parts = p.split('/');
  return parts.length <= 2 ? p : parts.slice(-2).join('/');
}

// ─── Programming Stopwords ────────────────────────────────────────────────────
// Terms too generic to be domain signals. Excluded from vocabulary building.

const PROGRAMMING_STOPWORDS = new Set([
  // JS/TS keywords
  'function', 'return', 'const', 'let', 'variable', 'class', 'interface',
  'import', 'export', 'default', 'async', 'await', 'true', 'false',
  'null', 'undefined', 'void', 'string', 'number', 'boolean', 'object',
  'array', 'promise', 'error', 'console', 'process', 'module', 'require',
  'this', 'super', 'throw', 'catch', 'finally', 'static', 'private',
  // Python
  'self', 'none', 'pass', 'elif', 'except', 'lambda', 'yield',
  'global', 'nonlocal', 'assert',
  // Generic noise
  'index', 'length', 'value', 'result', 'data', 'item', 'args',
  'response', 'request', 'event', 'options', 'params', 'props', 'state',
  'context', 'next', 'callback', 'resolve', 'reject', 'then', 'each',
  'list', 'dict', 'type', 'name', 'file', 'path', 'with', 'from',
  'more', 'some', 'line', 'that', 'this', 'when', 'what', 'have',
  'read', 'write', 'open', 'close', 'init', 'main', 'apps', 'base',
  'util', 'utils', 'helper', 'helpers', 'common', 'shared', 'handler',
  'parse', 'build', 'make', 'create', 'update', 'delete', 'remove',
  'format', 'check', 'valid', 'test', 'mock', 'stub', 'fake', 'temp',
]);

// ─── Box Renderer ────────────────────────────────────────────────────────────

const BOX_WIDTH = 64;

/**
 * Render a bordered box as a string.
 * @param {string} title
 * @param {string[]} lines
 * @param {object} [opts]
 * @returns {string}
 */
function box(title, lines, opts = {}) {
  const useFancy = process.stdout.isTTY && !process.env.NO_COLOR;
  const tl = useFancy ? '╭' : '+';
  const tr = useFancy ? '╮' : '+';
  const bl = useFancy ? '╰' : '+';
  const br = useFancy ? '╯' : '+';
  const hz = useFancy ? '─' : '-';
  const vt = useFancy ? '│' : '|';
  const boldOn  = useFancy ? '\x1b[1m' : '';
  const boldOff = useFancy ? '\x1b[0m' : '';

  // Build top border: tl + hz + ' ' + title + ' ' + hz... + tr  (total BOX_WIDTH)
  const titleStr = `${boldOn}${title}${boldOff}`;
  // Visible length of title (without ANSI escapes)
  const titleVis = title.length;
  // Content between tl and tr must be BOX_WIDTH - 2 chars wide
  const inner = BOX_WIDTH - 2;
  // Pattern: hz + ' ' + title + ' ' + hz*(remaining)
  const prefix = hz + ' ' + titleStr + ' ';
  const prefixVis = 1 + 1 + titleVis + 1; // hz + space + title + space
  const remaining = Math.max(0, inner - prefixVis);
  const top = tl + hz + ' ' + titleStr + ' ' + hz.repeat(remaining) + tr;

  const bottom = bl + hz.repeat(inner) + br;

  const innerWidth = BOX_WIDTH - 4; // 2 for borders, 2 for padding
  const bodyLines = lines.map(l => {
    const padded = '  ' + l;
    const truncated = padded.length > innerWidth + 2
      ? padded.slice(0, innerWidth + 2 - 1) + '…'
      : padded;
    const padRight = ' '.repeat(Math.max(0, innerWidth - truncated.length + 2));
    return `${vt}${truncated}${padRight}${vt}`;
  });

  return [top, ...bodyLines, bottom].join('\n');
}

// ─── Main Dispatcher ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const subcmd = args[0];

  if (subcmd === 'install' || !subcmd) {
    runInstall({ silent: false });
  } else if (subcmd === 'watch') {
    runWatch();
  } else if (subcmd === 'init' || subcmd === '--reset') {
    if (!runInit()) process.exit(1);
  } else if (subcmd === 'diff') {
    if (!runDiff()) process.exit(1);
  } else if (subcmd === 'status') {
    runStatus();
  } else if (subcmd === 'doctor') {
    runDoctor();
  } else if (subcmd === 'learn') {
    let domain = null;
    let ruleText = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--domain' && args[i+1]) {
        domain = args[i+1];
        i++;
      } else {
        ruleText += (ruleText ? ' ' : '') + args[i];
      }
    }
    if (!ruleText) { console.error('vectora learn: provide a rule text'); process.exit(1); }
    runLearn(ruleText, domain);
  } else if (subcmd === 'migrate') {
    runMigrate();
  } else if (subcmd === 'unlearn') {
    let domain = null;
    let ruleText = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--domain' && args[i+1]) {
        domain = args[i+1];
        i++;
      } else {
        ruleText += (ruleText ? ' ' : '') + args[i];
      }
    }
    if (!ruleText) { console.error('vectora unlearn: provide a rule text to remove'); process.exit(1); }
    runUnlearn(ruleText, domain);
  } else if (subcmd === 'manifest') {
    runManifest();
  } else if (subcmd === 'history') {
    const filepath = args.slice(1).join(' ');
    if (!filepath) { console.error('vectora history: provide a file path'); process.exit(1); }
    runHistory(filepath);
  } else if (subcmd === 'preflight') {
    runPreflight();
  } else if (subcmd === 'impact-report') {
    runImpactReport();
  } else if (subcmd === 'map' || subcmd === 'brief') {
    const task = args.slice(1).join(' ');
    if (!task) { console.error('vectora map: provide a task description'); process.exit(1); }
    runMap(task);
  } else if (subcmd === 'check') {
    runCheck();
  } else if (subcmd === 'overview') {
    const flag = args[1];
    if (flag === '--debt') runOverviewDebt();
    else runOverview();
  } else if (subcmd === 'why') {
    const filepath = args.slice(1).join(' ');
    if (!filepath) { console.error('vectora why: provide a file path'); process.exit(1); }
    runWhy(filepath);
  } else if (subcmd === 'impact') {
    const target = args.slice(1).join(' ');
    if (!target) { console.error('vectora impact: provide a file path or exported symbol'); process.exit(1); }
    runImpact(target);
  } else if (subcmd === 'receipts') {
    runReceipts();
  } else if (subcmd === 'trace') {
    const symbol = args.slice(1).join(' ');
    if (!symbol) { console.error('vectora trace: provide a symbol name'); process.exit(1); }
    runTrace(symbol);
  } else if (subcmd === '--help' || subcmd === '-h') {
    printHelp();
  } else {
    console.error(`vectora: unknown command "${subcmd}". Run vectora --help.`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
vectora — the codebase map your AI coding agent can't see

Commands:
  vectora install              Install the skill into detected AI agent(s) (default)
  vectora init                 Build the dependency + co-change graph (offline, 0 tokens)
  vectora map "<task>"         Emit the structural map for a task (seeds + neighborhood + co-change)
  vectora check                Honest receipt: confirmed breaks, co-change misses, callers, stale tests
  vectora manifest             Causal manifest: why each file changed, what was missed, lifetime count
  vectora preflight            Pre-session check: open misses, graph staleness, danger zones
  vectora history <file>       Regression memory: how often this file was flagged and with whom
  vectora impact-report        30-day impact summary: what vectora caught, highest-risk files
  vectora diff                 Fast incremental graph update (git-based)
  vectora status               Show graph state and staleness
  vectora doctor               Run system health check and configuration validation
  vectora learn "<rule>"       Add an architectural rule to decisions.json
  vectora unlearn "<rule>"     Remove an architectural rule from decisions.json
  vectora migrate              Extract rules from CLAUDE.md, README, .cursorrules, etc.
  vectora why <filepath>       Explain a file's centrality and graph neighbors
  vectora impact <file|sym>    What breaks if I change this? (dependents / consumers)
  vectora overview             Architecture summary: central files, domains, cycles, orphans
  vectora overview --debt      Coupling debt scores: highest-risk file pairs, test coverage gaps
  vectora trace <symbol>       Where a symbol is defined, who calls it, what it calls
  vectora receipts             Lifetime count of incomplete edits vectora has flagged
  vectora watch                Watch for file changes, rebuild automatically
  vectora --reset              Force a full rescan (alias for init)
  vectora --help               Show this message

Annotations (in source code, always surfaced at map time):
  // @vectora danger: <text>   Guard a file/function with a constraint the agent must see
  // @vectora pivot             Force a file into the pivot set regardless of centrality

Use /vectora <task> inside your AI agent to navigate, then /vectora check when done.
`.trim());
}

// ─── Install ──────────────────────────────────────────────────────────────────

function runInstall({ silent = false, root = process.cwd() } = {}) {
  if (!fs.existsSync(SKILL_SRC)) {
    if (!silent) console.error('vectora: skill source not found at', SKILL_SRC);
    return false;
  }

  const skillContent = fs.readFileSync(SKILL_SRC, 'utf8');
  const skillBody = stripFrontmatter(skillContent);
  const detected = detectAgents(root);

  if (detected.length === 0) {
    detected.push('claude');
    if (!silent) console.log('vectora: no agent harness detected — installing for Claude Code by default');
  }

  let installed = 0;

  for (const agent of detected) {
    if (agent === 'claude') {
      const skillDest = path.join(root, '.claude', 'skills', 'vectora', 'SKILL.md');
      fs.mkdirSync(path.dirname(skillDest), { recursive: true });
      fs.writeFileSync(skillDest, skillContent, 'utf8');
      if (!silent) console.log(`✓ vectora: installed for Claude Code → .claude/skills/vectora/SKILL.md`);

      const cmdDest = path.join(root, '.claude', 'commands', 'vectora.md');
      fs.mkdirSync(path.dirname(cmdDest), { recursive: true });
      fs.writeFileSync(cmdDest, buildClaudeCommand(), 'utf8');
      if (!silent) console.log(`✓ vectora: registered slash command → .claude/commands/vectora.md`);
      installed++;
    }
    if (agent === 'cursor') {
      const dest = path.join(root, '.cursor', 'rules', 'vectora.mdc');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildCursorVariant(skillBody), 'utf8');
      if (!silent) console.log(`✓ vectora: installed for Cursor → .cursor/rules/vectora.mdc`);
      installed++;
    }
    if (agent === 'codex') {
      const dest = path.join(root, 'AGENTS.md');
      writeOrMergeSection(dest, '<!-- vectora -->', buildAgentsMdSection(skillBody));
      if (!silent) console.log(`✓ vectora: installed for Codex → AGENTS.md`);
      installed++;
    }
    if (agent === 'windsurf') {
      const dest = path.join(root, '.windsurfrules');
      writeOrMergeSection(dest, '<!-- vectora -->', buildWindsurfSection(skillBody));
      if (!silent) console.log(`✓ vectora: installed for Windsurf → .windsurfrules`);
      installed++;
    }
    if (agent === 'kiro') {
      const dest = path.join(root, '.kiro', 'rules', 'vectora.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildKiroVariant(skillBody), 'utf8');
      if (!silent) console.log(`✓ vectora: installed for Kiro → .kiro/rules/vectora.md`);
      installed++;
    }
    if (agent === 'opencode') {
      const dest = path.join(root, '.opencode', 'rules', 'vectora.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildOpenCodeVariant(skillBody), 'utf8');
      if (!silent) console.log(`✓ vectora: installed for OpenCode → .opencode/rules/vectora.md`);
      installed++;
    }
    if (agent === 'gemini') {
      const dest = path.join(root, '.gemini', 'skills', 'vectora', 'SKILL.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buildGeminiVariant(skillBody), 'utf8');
      if (!silent) console.log(`✓ vectora: installed for Gemini CLI → .gemini/skills/vectora/SKILL.md`);
      installed++;
    }
  }

  if (!silent) {
    console.log('');
    console.log(`✓ vectora: skill installed for ${installed} agent(s)`);
    console.log(`✓ vectora: open your agent and type '/vectora init' to build the graph (offline, 0 tokens)`);
  }
  return true;
}

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

/**
 * Detects the primary framework and language of a project from config files
 * and dependency manifests. Used to apply framework-specific pivot rules.
 */
function detectProjectType(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps.next) return { framework: 'nextjs', lang: 'ts', label: 'Next.js / TypeScript' };
  if (deps['@sveltejs/kit']) return { framework: 'sveltekit', lang: 'ts', label: 'SvelteKit' };
  if (deps.nuxt) return { framework: 'nuxt', lang: 'ts', label: 'Nuxt' };
  if (deps.express && !deps.next) return { framework: 'express', lang: 'ts', label: 'Express / Node' };
  if (deps.fastify) return { framework: 'fastify', lang: 'ts', label: 'Fastify / Node' };
  if (deps.react && !deps.next) return { framework: 'react', lang: 'ts', label: 'React' };
  if (deps.nestjs || deps['@nestjs/core']) return { framework: 'nestjs', lang: 'ts', label: 'NestJS' };
  if (Object.keys(deps).length > 0) return { framework: 'node', lang: 'ts', label: 'Node.js' };

  if (has('manage.py')) return { framework: 'django', lang: 'py', label: 'Django / Python' };
  if (has('app.py') || has('wsgi.py')) return { framework: 'flask', lang: 'py', label: 'Flask / Python' };
  if (has('pyproject.toml') || has('setup.py')) return { framework: 'python', lang: 'py', label: 'Python' };

  if (has('go.mod')) return { framework: 'go', lang: 'go', label: 'Go' };
  if (has('Cargo.toml')) return { framework: 'rust', lang: 'rs', label: 'Rust' };
  if (has('Gemfile')) return { framework: 'ruby', lang: 'rb', label: 'Ruby' };
  if (has('pom.xml') || has('build.gradle')) return { framework: 'java', lang: 'java', label: 'Java' };

  return { framework: 'unknown', lang: 'unknown', label: 'Unknown' };
}

// ─── Skill Variant Builders ──────────────────────────────────────────────────

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n/, '').trimStart();
}

function buildCursorVariant(body) {
  return `---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ["**/*"]
alwaysApply: true
---

${body}`;
}

function buildAgentsMdSection(body) {
  return `<!-- vectora -->
# vectora — Structural Navigation Instructions

${body}
<!-- /vectora -->`;
}

function buildWindsurfSection(body) {
  return `<!-- vectora -->
# vectora — Structural Navigation Instructions

${body}
<!-- /vectora -->`;
}

function buildKiroVariant(body) {
  return `---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ""
alwaysApply: false
---

${body}`;
}

function buildOpenCodeVariant(body) {
  return `---
description: Structural codebase navigation — vectora reads dependency graph before every task
globs: ""
alwaysApply: false
---

${body}`;
}

function buildGeminiVariant(body) {
  return body;
}

function buildClaudeCommand() {
  return `You are handling a \`/vectora $ARGUMENTS\` command, part of the vectora skill. vectora gives you the structural map of the codebase — the import graph and git co-change history — that you cannot compute yourself. It does NOT decide which files to load; you do.

**Entry sequence (required first):**
1. Check \`.vectora/dirty\` — if present, run \`npx vectora diff\`, then delete the file.

**Then act on the keyword in $ARGUMENTS:**

**"init"**
Run \`npx vectora init\` and output its lines verbatim. This is offline and costs no tokens.

**"diff"**
Run \`npx vectora diff\` — fast incremental update. Output result verbatim.

**"status"**
Run \`npx vectora status\` — output result verbatim.

**"watch"**
Run \`npx vectora watch\` in the background. Confirm it started.

**"why <filepath>"**
Run \`npx vectora why <filepath>\` — output result verbatim.

**"impact <file|symbol>"**
Run \`npx vectora impact <target>\` — what breaks if this changes (dependents / symbol consumers). Output verbatim.

**"overview"**
Run \`npx vectora overview\` — architecture summary (central files, domains, cycles, orphans). Ideal first action on an unfamiliar or new repo. Output verbatim.

**"trace <symbol>"**
Run \`npx vectora trace <symbol>\` — where it's defined, who calls it, what it depends on. Output verbatim.

**"receipts"**
Run \`npx vectora receipts\` — show the lifetime count of incomplete edits vectora has flagged in this repo: confirmed breaks, forgotten co-change files, callers to verify, stale tests. An honest number — every entry is a real inspectable event, never an invented percentage.

**"preflight"**
Run \`npx vectora preflight\` — situational awareness before a session: graph staleness, open misses from the last session, danger zone inventory, cycle presence. Output verbatim before beginning any large task.

**"manifest"**
Run \`npx vectora manifest\` — causal receipt of the current session: which files were directly targeted, which changed because of structural coupling (arity breaks / co-change), which were flagged but not edited. Paste the output into your PR description.

**"history <filepath>"**
Run \`npx vectora history <filepath>\` — cross-session coupling memory for a file: how often it changed, which files were co-edited, which co-change partners were flagged but skipped. If a file appears flagged 3+ times without being edited, propose \`/vectora learn\` to bake it in.

**"impact-report"**
Run \`npx vectora impact-report\` — 30-day aggregate summary: confirmed breaks caught, co-change links used/missed, highest-risk file, coupling debt trend. Share this in retrospectives.

**"overview --debt"**
Run \`npx vectora overview --debt\` — coupling debt scores for all file pairs: co-change frequency × weight + shared imports × weight − test coverage. Surfaces the highest-risk pairs that have no test safety net.

**"check"**
Run \`npx vectora check\` and output the receipt verbatim. It works even if you skipped map. It reports four things:
1. **✗ BROKEN** — confirmed arity mismatches: you changed a function's signature and a live call site now passes the wrong number of args. **Fix these before finishing — they are proven inconsistencies, not guesses.**
2. **⚠ co-change misses** — files that historically change with what you edited but weren't touched.
3. **⚠ caller warnings** — importers that reference an exported symbol from a file you changed (verify they still compile/work).
4. **⚠ stale tests** — colocated tests for source files you changed.
Investigate every line. For ✗ BROKEN: fix immediately. For ⚠: open the flagged file and decide if it needs updating before you finish.

**A task description (anything else — the default)**
Treat the entire \`$ARGUMENTS\` as the task.
1. Run \`npx vectora map "<task>"\` and emit the \`[VECTORA MAP]\` block verbatim as the first lines of your response.
2. Navigate from the seeds using your own judgment. Open the files YOU decide are relevant — nothing is hidden or off-limits.
3. Pay attention to the CO-CHANGE section: those files are edited together in git history and grep cannot reveal them. Check whether they need changing too.
4. Execute the task completely.
5. When done, run \`npx vectora check\` and show its receipt as the final lines.
`;
}

function writeOrMergeSection(filepath, marker, section) {
  const endMarker = marker.replace('<!--', '<!--/').replace(' -->', ' -->');
  let existing = '';
  if (fs.existsSync(filepath)) existing = fs.readFileSync(filepath, 'utf8');

  const startIdx = existing.indexOf(marker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    existing = existing.slice(0, startIdx) + existing.slice(endIdx + endMarker.length).trimStart();
  }

  const final = existing.trimEnd() + (existing.trimEnd() ? '\n\n' : '') + section + '\n';
  fs.writeFileSync(filepath, final, 'utf8');
}

// ─── Watch ────────────────────────────────────────────────────────────────────

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
      process.stdout.write(`vectora: ${changedFile} — updating... `);
      // Prefer diff (fast) over full init on watch
      const ok = runDiff({ silent: true, root });
      if (ok) {
        fs.writeFileSync(path.join(root, '.vectora', 'dirty'), '', 'utf8');
        process.stdout.write('done\n');
      } else {
        // Fallback to full init if diff fails
        const ok2 = runInit({ silent: true, root });
        if (ok2) {
          fs.writeFileSync(path.join(root, '.vectora', 'dirty'), '', 'utf8');
          process.stdout.write('done (full rebuild)\n');
        } else {
          process.stdout.write('failed (check for syntax errors)\n');
        }
      }
      rebuilding = false;
    }, 500);
  };

  const attachWatcher = (dir) => {
    try {
      fs.watch(dir, (event, filename) => {
        if (!filename) return;
        if (!SOURCE_EXTENSIONS.test(filename)) return;
        const rel = path.relative(root, path.join(dir, filename));
        if (rel.startsWith('node_modules') || rel.startsWith('.')) return;
        scheduleRebuild(rel);
      });
    } catch {}
  };

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
  process.stdin.resume();
}

// ─── Doctor ───────────────────────────────────────────────────────────────────

function runDoctor({ root = process.cwd() } = {}) {
  const pad = (s, n) => String(s).padEnd(n);
  const pass = '[\x1b[32mPASS\x1b[0m]';
  const warn = '[\x1b[33mWARN\x1b[0m]';
  const fail = '[\x1b[31mFAIL\x1b[0m]';

  console.log('╔─ vectora doctor ──────────────────────────────────────╗');
  console.log('│ Running system health check...                        │');
  console.log('╚───────────────────────────────────────────────────────╝\n');

  let hasErrors = false;

  // 1. Check Graph
  process.stdout.write(pad('Checking .vectora/graph.json...', 45));
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (fs.existsSync(graphPath)) {
    console.log(pass);
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    console.log(`  → Built: ${new Date(graph.generated).toLocaleString()}`);
    console.log(`  → Files: ${graph.files?.length || 0} (${graph.files?.filter(f => f.isPivot).length || 0} pivots)`);
  } else {
    console.log(fail);
    console.log('  → Graph missing. Run `npx vectora init`');
    hasErrors = true;
  }

  // 2. Check Agents
  process.stdout.write(pad('Checking agent integrations...', 45));
  const agents = detectAgents(root);
  if (agents.length > 0) {
    console.log(pass);
    console.log(`  → Detected: ${agents.join(', ')}`);
  } else {
    console.log(warn);
    console.log('  → No known agent configurations found in this directory.');
  }

  // 3. Check config
  process.stdout.write(pad('Checking vectora.config.js...', 45));
  const configPath = path.join(root, 'vectora.config.js');
  if (fs.existsSync(configPath)) {
    console.log(pass);
    try { require(configPath); } catch (e) {
      console.log(`  → ${warn} Config failed to load: ${e.message}`);
    }
  } else {
    console.log(pad('none (using defaults)', 15));
  }

  // 4. Check decisions
  process.stdout.write(pad('Checking .vectora/decisions.json...', 45));
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  if (fs.existsSync(decisionsPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
      console.log(pass);
      const globals = d.global?.length || 0;
      const domains = Object.keys(d.domains || {}).length;
      console.log(`  → ${globals} global decisions, ${domains} domain-specific configs`);
    } catch {
      console.log(fail);
      console.log('  → Invalid JSON format in decisions.json');
    }
  } else {
    console.log(pad('none (no institutional memory)', 15));
  }

  console.log('');
  if (hasErrors) {
    console.log('❌ Doctor found critical issues. Please resolve them to use vectora.');
  } else {
    console.log('✅ System is healthy and ready to guide your AI agents.');
  }
}

// ─── Learn ────────────────────────────────────────────────────────────────────

function runLearn(ruleText, domain, { root = process.cwd() } = {}) {
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });

  let d = { global: [], domains: {} };
  if (fs.existsSync(decisionsPath)) {
    try {
      d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
      if (!d.global) d.global = [];
      if (!d.domains) d.domains = {};
    } catch {
      console.warn('vectora learn: ⚠ decisions.json was invalid JSON. Starting fresh.');
      d = { global: [], domains: {} };
    }
  }

  // Remove surrounding quotes if the agent passed them explicitly
  ruleText = ruleText.replace(/^["'](.*)["']$/, '$1');

  if (domain) {
    if (!d.domains[domain]) d.domains[domain] = [];
    if (!d.domains[domain].includes(ruleText)) {
      d.domains[domain].push(ruleText);
    }
    console.log(`vectora learn: added rule to domain [${domain}]`);
  } else {
    if (!d.global.includes(ruleText)) {
      d.global.push(ruleText);
    }
    console.log(`vectora learn: added global rule`);
  }

  fs.writeFileSync(decisionsPath, JSON.stringify(d, null, 2), 'utf8');
}

// ─── Unlearn ──────────────────────────────────────────────────────────────────

function runUnlearn(ruleText, domain, { root = process.cwd() } = {}) {
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  if (!fs.existsSync(decisionsPath)) {
    console.log('vectora unlearn: no decisions.json found');
    return;
  }

  let d;
  try {
    d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  } catch {
    console.error('vectora unlearn: invalid JSON in decisions.json');
    return;
  }

  ruleText = ruleText.replace(/^["'](.*)["']$/, '$1');
  let removed = false;

  if (domain) {
    if (d.domains && d.domains[domain]) {
      const idx = d.domains[domain].indexOf(ruleText);
      if (idx !== -1) {
        d.domains[domain].splice(idx, 1);
        removed = true;
        console.log(`vectora unlearn: removed rule from domain [${domain}]`);
        if (d.domains[domain].length === 0) delete d.domains[domain];
      }
    }
  } else {
    if (d.global) {
      const idx = d.global.indexOf(ruleText);
      if (idx !== -1) {
        d.global.splice(idx, 1);
        removed = true;
        console.log(`vectora unlearn: removed global rule`);
      }
    }
  }

  if (!removed) {
    console.log(`vectora unlearn: rule not found`);
  } else {
    fs.writeFileSync(decisionsPath, JSON.stringify(d, null, 2), 'utf8');
  }
}

// ─── Migrate ──────────────────────────────────────────────────────────────────
// Auto-discovers existing rule/convention files in the repo (CLAUDE.md, README,
// .cursorrules, CONTRIBUTING.md, etc.) and prints a structured block for the
// agent to extract architectural rules from, with dedup against decisions.json.

function runMigrate({ root = process.cwd() } = {}) {
  const CANDIDATE_PATHS = [
    'CLAUDE.md', 'CLAUDE.local.md',
    'README.md', 'README.rst', 'README.txt',
    '.cursorrules', '.windsurfrules',
    'CONTRIBUTING.md', '.github/CONTRIBUTING.md',
    'docs/ARCHITECTURE.md', 'docs/CONTRIBUTING.md', 'docs/DECISIONS.md',
  ];
  const CANDIDATE_GLOBS = ['RULES.md', 'DECISIONS.md', 'CONVENTIONS.md', 'ARCHITECTURE.md'];

  // Collect fixed candidates that exist
  const found = [];
  for (const p of CANDIDATE_PATHS) {
    const full = path.join(root, p);
    if (fs.existsSync(full)) found.push({ rel: p, full });
  }

  // Walk up to 3 levels deep for glob candidates (exclude node_modules/.vectora/etc)
  const SKIP_DIRS = new Set(['node_modules', '.git', '.vectora', 'dist', 'build', 'coverage', '.next', 'vendor']);
  const walkForGlobs = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walkForGlobs(path.join(dir, e.name), depth + 1);
      } else if (CANDIDATE_GLOBS.includes(e.name)) {
        const full = path.join(dir, e.name);
        const rel = path.relative(root, full);
        if (!found.some(f => f.full === full)) found.push({ rel, full });
      }
    }
  };
  walkForGlobs(root, 0);

  if (found.length === 0) {
    console.log('[VECTORA MIGRATE]');
    console.log('No rule source files found (looked for CLAUDE.md, README.md, .cursorrules,');
    console.log('CONTRIBUTING.md, docs/ARCHITECTURE.md, RULES.md, DECISIONS.md, etc.).');
    console.log('Create one of these files with your project rules, then re-run /vectora migrate.');
    console.log('[END VECTORA MIGRATE]');
    return;
  }

  // Load existing decisions to report what will be skipped
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  let existing = [];
  if (fs.existsSync(decisionsPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
      if (d.global) existing = existing.concat(d.global);
      if (d.domains) for (const rules of Object.values(d.domains)) existing = existing.concat(rules);
    } catch {}
  }

  const MAX_CHARS_PER_FILE = 8000;
  console.log('[VECTORA MIGRATE]');
  console.log(`Found ${found.length} rule source file${found.length > 1 ? 's' : ''}: ${found.map(f => f.rel).join(', ')}`);
  console.log('');
  for (const { rel, full } of found) {
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (content.length > MAX_CHARS_PER_FILE) {
      content = content.slice(0, MAX_CHARS_PER_FILE) + `\n… [truncated — ${Math.ceil(content.length / MAX_CHARS_PER_FILE)}x original length]`;
    }
    console.log(`--- ${rel} ---`);
    console.log(content.trimEnd());
    console.log('');
  }
  if (existing.length > 0) {
    console.log(`Already in decisions.json (skip these — do not re-import):`);
    for (const r of existing) console.log(`  - ${r}`);
    console.log('');
  }
  console.log('Extract architectural constraints, invariants, and coupling rules from the files above.');
  console.log('Skip: style preferences, tooling setup, CI/CD instructions, one-off workarounds,');
  console.log('      anything already listed in "Already in decisions.json" above.');
  console.log('For each extracted rule, propose to the user:');
  console.log('  npx vectora learn "<rule>" [--domain <domain>]');
  console.log('Confirm with the user before writing each one. Never write rules silently.');
  console.log('[END VECTORA MIGRATE]');
}

// ─── Status ───────────────────────────────────────────────────────────────────

function runStatus({ root = process.cwd() } = {}) {
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.log('╔─ vectora status ──────────────────────────────────────╗');
    console.log('│ ⚠ no graph — run `npx vectora init` to activate      │');
    console.log('╚───────────────────────────────────────────────────────╝');
    return;
  }

  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch { console.error('vectora status: failed to read graph.json'); return; }

  const pivotCount = (graph.files || []).filter(f => f.isPivot).length;
  const fileCount  = (graph.files || []).length;
  const pivotPct   = fileCount > 0 ? Math.round((pivotCount / fileCount) * 100) : 0;
  const domains    = Object.keys(graph.domains || {}).join(', ') || '(none)';
  const built      = graph.generated ? new Date(graph.generated).toLocaleString() : 'unknown';
  const lang       = graph.projectMeta?.label || graph.language || 'unknown';
  const gitHash    = graph.gitHash ? graph.gitHash.slice(0, 8) : 'no git';

  // Staleness check
  let stale = 'no';
  const config = mergeConfig(loadConfig(root));
  if (graph.generated) {
    const ageHours = (Date.now() - new Date(graph.generated).getTime()) / 3600000;
    if (ageHours > config.refreshAfterHours) stale = 'yes (age)';
  }
  if (graph.gitHash && stale === 'no') {
    try {
      const current = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore','pipe','ignore'], timeout: 2000 }).toString().trim();
      if (current !== graph.gitHash) stale = 'yes (git)';
    } catch {}
  }

  const pad = (s, n) => String(s).padEnd(n);
  // Receipts summary (non-blocking if ledger absent)
  let receiptsLine = 'no receipts yet';
  try {
    const lp = path.join(root, '.vectora', 'ledger.json');
    if (fs.existsSync(lp)) {
      const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
      const evs = ld.events || [];
      const grand = evs.reduce((s, e) => s + (e.confirmedBreaks||0) + (e.coChangeMisses||0) + (e.callerWarnings||0) + (e.staleTests||0), 0);
      receiptsLine = `${grand} flagged across ${evs.length} task${evs.length !== 1 ? 's' : ''}`;
    }
  } catch {}

  console.log('╔─ vectora status ──────────────────────────────────────╗');
  console.log(`│ files:   ${pad(fileCount + '  ·  language: ' + lang, 44)}│`);
  console.log(`│ pivots:  ${pad(pivotCount + '   (' + pivotPct + '% of codebase)', 44)}│`);
  console.log(`│ domains: ${pad(domains.length > 44 ? domains.slice(0,41)+'...' : domains, 44)}│`);
  console.log(`│ built:   ${pad(built, 44)}│`);
  console.log(`│ git:     ${pad(gitHash + '  ·  stale: ' + stale, 44)}│`);
  console.log(`│ catches: ${pad(receiptsLine, 44)}│`);
  console.log('╚───────────────────────────────────────────────────────╝');
}

// ─── Why ──────────────────────────────────────────────────────────────────────

function runWhy(filepath, { root = process.cwd() } = {}) {
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.log('vectora why: no graph found — run `npx vectora init` first');
    return;
  }

  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch { console.error('vectora why: failed to read graph.json'); return; }

  const lower = filepath.toLowerCase();
  const f = (graph.files || []).find(f =>
    f.path.toLowerCase() === lower || f.path.toLowerCase().includes(lower)
  );

  if (!f) {
    console.log(`vectora why: "${filepath}" not found in graph — run \`npx vectora init\` to reindex`);
    return;
  }

  const reason = f.manualPivot
    ? 'manual @vectora pivot annotation'
    : f.isPivot
    ? `scored top ${Math.round((graph.pivotThreshold || 0.15) * 100)}% by centrality`
    : 'not a pivot (below centrality threshold)';

  // Precise reverse edges from the resolved import graph (not name-guessing).
  const directDeps = f.importedBy || [];
  const transitive = transitiveDependents(graph, f.path);
  const blast = `${directDeps.length} direct · ${transitive.size} total`;
  const importedBy = directDeps.slice(0, 4).join(', ') || 'none';

  const importsLocal = (f.importsResolved && f.importsResolved.length
    ? f.importsResolved
    : (f.imports || []).filter(i => i.startsWith('.')))
    .slice(0, 4)
    .join(', ') || 'none';

  const pad = (s, n) => String(s).padEnd(n);
  const header = `─ vectora why: ${f.path} `;
  console.log(`╔${header}${'─'.repeat(Math.max(0, 54 - header.length))}╗`);
  console.log(`│ centrality:  ${pad(f.centralityScore + '  (in: ' + (f.inDegree||0) + ', out: ' + (f.outDegree||0) + ')', 40)}│`);
  console.log(`│ blast:       ${pad(blast + (transitive.size >= 5 ? '  ⚠ ripples' : ''), 40)}│`);
  console.log(`│ pivot:       ${pad(f.isPivot ? 'yes' : 'no', 40)}│`);
  console.log(`│ reason:      ${pad(reason.length > 40 ? reason.slice(0,37)+'...' : reason, 40)}│`);
  console.log(`│ domain:      ${pad(f.domain || 'unknown', 40)}│`);
  console.log(`│ imported by: ${pad(importedBy.length > 40 ? importedBy.slice(0,37)+'...' : importedBy, 40)}│`);
  console.log(`│ imports:     ${pad(importsLocal.length > 40 ? importsLocal.slice(0,37)+'...' : importsLocal, 40)}│`);
  console.log(`╚${'─'.repeat(54)}╝`);
}

// Transitive reverse-dependency closure: every file that imports `startPath`,
// directly or through a chain. The "blast radius" of changing that file.
function transitiveDependents(graph, startPath) {
  const byPath = new Map((graph.files || []).map(f => [f.path, f]));
  const seen = new Set();
  const queue = [startPath];
  while (queue.length) {
    const cur = queue.shift();
    const f = byPath.get(cur);
    if (!f) continue;
    for (const imp of (f.importedBy || [])) {
      if (!seen.has(imp)) { seen.add(imp); queue.push(imp); }
    }
  }
  seen.delete(startPath);
  return seen;
}

// ─── Impact ─────────────────────────────────────────────────────────────────
// "What breaks if I change this?" — direct + transitive dependents for a file,
// or the consumers of an exported symbol. Pure static graph; no git history.

function runImpact(target, { root = process.cwd() } = {}) {
  const graph = loadGraphForTask(root, 'impact');
  if (!graph) return;
  const files = graph.files || [];
  const lower = target.toLowerCase();

  // File match first (path or path-suffix), like `why`.
  const file = files.find(f => f.path.toLowerCase() === lower || f.path.toLowerCase().includes(lower));

  console.log('[VECTORA IMPACT]');
  if (file) {
    const direct = file.importedBy || [];
    const transitive = transitiveDependents(graph, file.path);
    console.log(`  ${file.path}`);
    console.log(`  blast radius: ${direct.length} direct importer(s), ${transitive.size} total dependent(s).`);
    if (direct.length) {
      console.log('  direct importers:');
      for (const p of direct.slice(0, 12)) console.log(`    • ${p}`);
      if (direct.length > 12) console.log(`    …and ${direct.length - 12} more.`);
    }
    const indirect = [...transitive].filter(p => !direct.includes(p));
    if (indirect.length) {
      console.log(`  transitive (through a chain): ${indirect.slice(0, 10).join(', ')}${indirect.length > 10 ? ', …' : ''}`);
    }
    if (!direct.length && !transitive.size) {
      console.log('  nothing imports this file — changing it is structurally isolated (leaf/entry point).');
    }
    console.log('[END VECTORA IMPACT]');
    return;
  }

  // Otherwise treat the target as an exported symbol.
  const definers = files.filter(f => (f.exports || []).some(e => String(e).toLowerCase() === lower));
  if (definers.length === 0) {
    console.log(`  "${target}" is not a known file or exported symbol — run \`npx vectora init\` to reindex.`);
    console.log('[END VECTORA IMPACT]');
    return;
  }
  for (const def of definers) {
    const consumers = (def.importedBy || []).filter(p => {
      const imp = files.find(f => f.path === p);
      return imp && (imp.allIdentifiers || []).includes(lower);
    });
    console.log(`  symbol "${target}" defined in ${def.path}`);
    if (consumers.length) {
      console.log(`  consumed by ${consumers.length} file(s):`);
      for (const p of consumers.slice(0, 12)) console.log(`    • ${p}`);
      if (consumers.length > 12) console.log(`    …and ${consumers.length - 12} more.`);
      console.log('  → change its signature and every one of these is a candidate edit.');
    } else {
      console.log('  no importing file references this symbol by name — may be unused or accessed dynamically.');
    }
  }
  console.log('[END VECTORA IMPACT]');
}

// ─── Overview ───────────────────────────────────────────────────────────────
// "Explain this codebase." The highest-value first action on an unfamiliar or
// brand-new repo: central files, domains, entry points, cycles, orphans. All
// static — needs no git history.

function runOverview({ root = process.cwd() } = {}) {
  const graph = loadGraphForTask(root, 'overview');
  if (!graph) return;
  const files = graph.files || [];
  const real = files.filter(f => !f.isTest);
  const label = graph.projectMeta?.label || graph.language || 'codebase';

  console.log('[VECTORA OVERVIEW]');
  console.log(`  ${real.length} source files · ${label}`);

  const central = [...real].sort((a, b) => (b.inDegree || 0) - (a.inDegree || 0))
    .filter(f => (f.inDegree || 0) > 0).slice(0, 6);
  if (central.length) {
    console.log('');
    console.log('  most-depended-on (start reading here):');
    for (const f of central) console.log(`    • ${f.path}  (imported by ${f.inDegree})`);
  }

  const domains = Object.entries(graph.domains || {})
    .map(([d, v]) => ({ d, n: v.fileCount || 0 }))
    .filter(x => x.d && x.d !== 'root')
    .sort((a, b) => b.n - a.n).slice(0, 8);
  if (domains.length) {
    console.log('');
    console.log('  domains:');
    for (const { d, n } of domains) console.log(`    • ${d}  (${n} files)`);
  }

  const entries = real.filter(f => (f.inDegree || 0) === 0 && (f.outDegree || 0) > 0);
  if (entries.length) {
    console.log('');
    console.log(`  entry points (imported by nothing, import others): ${entries.slice(0, 6).map(f => f.path).join(', ')}${entries.length > 6 ? ', …' : ''}`);
  }

  const orphans = real.filter(f => (f.inDegree || 0) === 0 && (f.outDegree || 0) === 0 && !f.isConfig);
  if (orphans.length) {
    console.log('');
    console.log(`  orphans (no import edges either way — dead code?): ${orphans.slice(0, 6).map(f => f.path).join(', ')}${orphans.length > 6 ? ', …' : ''}`);
  }

  const cycles = detectCycles(graph);
  if (cycles.length) {
    console.log('');
    console.log('  ⚠ circular imports:');
    for (const cyc of cycles.slice(0, 4)) console.log(`    • ${cyc.map(shortPath).join(' → ')} → …`);
  }

  console.log('[END VECTORA OVERVIEW]');
}

// Finds circular import chains via DFS over resolved forward edges. Returns a
// few representative cycles (the chain of paths involved).
function detectCycles(graph) {
  const byPath = new Map((graph.files || []).map(f => [f.path, f]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...byPath.keys()].map(p => [p, WHITE]));
  const stack = [];
  const cycles = [];

  const dfs = (p) => {
    color.set(p, GRAY);
    stack.push(p);
    const f = byPath.get(p);
    for (const next of (f?.importsResolved || [])) {
      if (!byPath.has(next)) continue;
      if (color.get(next) === GRAY) {
        const idx = stack.indexOf(next);
        if (idx !== -1) cycles.push(stack.slice(idx));
      } else if (color.get(next) === WHITE) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(p, BLACK);
  };

  for (const p of byPath.keys()) {
    if (color.get(p) === WHITE && cycles.length < 10) dfs(p);
  }
  return cycles;
}

// ─── Trace ──────────────────────────────────────────────────────────────────
// Symbol-level navigation: where a symbol is defined, who references it, and
// what its defining file depends on.

function runTrace(symbol, { root = process.cwd() } = {}) {
  const graph = loadGraphForTask(root, 'trace');
  if (!graph) return;
  const files = graph.files || [];
  const lower = symbol.toLowerCase();

  const definers = files.filter(f => (f.exports || []).some(e => String(e).toLowerCase() === lower));
  console.log('[VECTORA TRACE]');
  if (definers.length === 0) {
    console.log(`  "${symbol}" is not an exported symbol in the graph — run \`npx vectora init\` to reindex.`);
    console.log('[END VECTORA TRACE]');
    return;
  }
  for (const def of definers) {
    console.log(`  defined in: ${def.path}`);
    const callers = (def.importedBy || []).filter(p => {
      const imp = files.find(f => f.path === p);
      return imp && (imp.allIdentifiers || []).includes(lower);
    });
    console.log(`  callers (${callers.length}): ${callers.slice(0, 10).join(', ') || 'none found'}`);
    const callees = (def.importsResolved || []).slice(0, 10);
    console.log(`  this file depends on: ${callees.join(', ') || 'nothing local'}`);
  }
  console.log('[END VECTORA TRACE]');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function runInit({ silent = false, root = process.cwd() } = {}) {
  const config = mergeConfig(loadConfig(root));
  const projectType = detectProjectType(root);
  const isFirstInit = !fs.existsSync(path.join(root, '.vectora', 'graph.json'));
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

  // Colocated test files (foo.test.ts next to foo.ts). Indexed for pairing only —
  // never parsed into the centrality graph, so pivots are unaffected.
  const testByStem = findColocatedTests(root, config);

  if (parsed.length === 0) {
    if (!silent) console.log('vectora: all files failed to parse. Check for syntax errors.');
    return false;
  }

  // Build co-change peers from git history (supplementary, non-blocking)
  const config0 = config;
  const { peerMap: coChangePeers, pairs: coChangePairs } =
    buildCoChangePeers(parsed, root, config0.coChangeMaxFiles);

  // Load path alias config (tsconfig/jsconfig paths + baseUrl) and workspace
  // package map so non-relative imports like `@/foo` and `@myorg/shared` resolve.
  const tsConfig = loadTsConfig(root, config.tsConfigPath);
  const workspacePackages = loadWorkspacePackages(root);
  const aliases = { ...tsConfig, workspacePackages };

  // Compute centrality and resolved forward/reverse edges from import statements
  const { inDegree, outDegree, imports: importsMap, importedBy: importedByMap } =
    computeCentrality(parsed, aliases);

  // fullPath → relative path, for translating resolved edges to graph paths
  const relOf = new Map(parsed.map(f => [f.fullPath, f.path]));
  const toRel = (fullPaths) => (fullPaths || []).map(fp => relOf.get(fp)).filter(Boolean);

  const scored = parsed.map(f => {
    const barrel = isBarrelFile(f);
    const configFile = isConfigFile(f);
    const rawScore = (inDegree.get(f.fullPath) ?? 0) * 2 + (outDegree.get(f.fullPath) ?? 0);
    // Downweight barrels and configs so they don't pollute pivot set
    const centralityScore = barrel ? 0 : configFile ? rawScore * 0.5 : rawScore;
    return {
      ...f,
      isBarrel: barrel,
      isConfig: configFile,
      centralityScore,
      inDegree: inDegree.get(f.fullPath) ?? 0,
      outDegree: outDegree.get(f.fullPath) ?? 0,
      importsResolved: toRel(importsMap.get(f.fullPath)),
      importedBy: toRel(importedByMap.get(f.fullPath)),
      coChangePeers: coChangePeers.get(f.path) || [],
    };
  });

  const pivotCount = Math.ceil(scored.length * config.pivotThreshold);
  const forcePivotSet = new Set(
    (config.forcePivots || []).map(p => path.resolve(root, p))
  );

  const sortedByScore = [...scored].sort((a, b) => b.centralityScore - a.centralityScore);
  const topPaths = new Set(sortedByScore.slice(0, pivotCount).map(f => f.fullPath));

  // Domain inference
  const domainMap = new Map();
  for (const f of scored) {
    domainMap.set(f.fullPath, inferDomain(f.path, config.domains, projectType.framework));
  }

  // Group files by domain
  const domainFiles = new Map();
  for (const f of scored) {
    const domain = domainMap.get(f.fullPath);
    if (!domainFiles.has(domain)) domainFiles.set(domain, []);
    domainFiles.get(domain).push(f);
  }

  // Co-change clustering fallback for flat repos where most files land in one domain
  const rootDomain = domainFiles.get('root') || domainFiles.get(scored[0]?.path);
  const rootFiles = [...domainFiles.entries()]
    .filter(([d]) => d === 'root' || (scored.length <= 3 && domainFiles.size === 1))
    .flatMap(([, files]) => files);
  if (rootFiles.length > scored.length * 0.5 && coChangePeers.size > 0) {
    // Assign co-change-based cluster labels to flat files
    const clusters = clusterByCoChange(rootFiles, coChangePeers);
    for (const [filePath, clusterLabel] of clusters) {
      const f = scored.find(sf => sf.path === filePath);
      if (f) domainMap.set(f.fullPath, clusterLabel);
    }
    // Rebuild domainFiles after clustering
    domainFiles.clear();
    for (const f of scored) {
      const domain = domainMap.get(f.fullPath);
      if (!domainFiles.has(domain)) domainFiles.set(domain, []);
      domainFiles.get(domain).push(f);
    }
  }

  const avgLinesPerFile = Math.round(totalLines / parsed.length);

  const files = scored.map(f => ({
    path: f.path,
    language: getFileLanguage(f.path),
    domain: domainMap.get(f.fullPath),
    isPivot: (topPaths.has(f.fullPath) || f.manualPivot || forcePivotSet.has(f.fullPath)) && !f.isBarrel,
    manualPivot: f.manualPivot || forcePivotSet.has(f.fullPath),
    isBarrel: f.isBarrel,
    isConfig: f.isConfig,
    centralityScore: f.centralityScore,
    inDegree: f.inDegree,
    outDegree: f.outDegree,
    lineCount: f.lineCount,
    charCount: f.charCount,
    exports: f.exports,
    exportSignatures: f.exportSignatures || {},
    imports: f.imports,
    importsResolved: f.importsResolved,
    importedBy: f.importedBy,
    allIdentifiers: f.allIdentifiers || [],
    stringLiterals: f.stringLiterals || [],
    commentTerms: f.commentTerms || [],
    coChangePeers: f.coChangePeers,
    testPath: testByStem.get(stemKey(f.path)) || null,
    dangerZones: f.dangerZones || [],
  }));

  // Build domain vocabulary using all 5 semantic signals + TF-IDF
  const allDomainFilesMap = {};
  for (const [domainName, domainFileList] of domainFiles) {
    allDomainFilesMap[domainName] = domainFileList.map(f =>
      files.find(o => o.path === f.path) || f
    );
  }

  const domains = {};
  for (const [domainName, domainFileList] of domainFiles) {
    const domainFilesMapped = allDomainFilesMap[domainName];
    domains[domainName] = {
      pivots: domainFilesMapped
        .filter(f => files.find(o => o.path === f.path)?.isPivot)
        .map(f => f.path),
      fileCount: domainFilesMapped.length,
      vocabulary: buildVocabulary(domainFilesMapped, allDomainFilesMap),
    };
  }

  const totalPivots = files.filter(f => f.isPivot).length;
  const domainCount = Object.keys(domains).length;

  // Warn on degenerate graph
  const nonZero = scored.filter(f => f.centralityScore > 0).length;
  if (!silent && nonZero === 0 && scored.length > 1) {
    console.warn(`vectora: ⚠ all ${scored.length} files scored zero centrality — imports may not have resolved.`);
    console.warn(`vectora: check for unsupported patterns (path aliases, dynamic imports, unknown language).`);
  } else if (!silent && nonZero < scored.length * 0.1 && scored.length > 5) {
    console.warn(`vectora: ⚠ only ${nonZero}/${scored.length} files have import edges — graph may be partial.`);
  }

  const graph = {
    generated: new Date().toISOString(),
    gitHash: getGitHash(root),
    language: projectType.lang,
    analysisMethod: 'ast+grammar',
    pivotThreshold: config.pivotThreshold,
    avgLinesPerFile,
    projectMeta: {
      framework: projectType.framework,
      lang: projectType.lang,
      label: projectType.label,
    },
    aliasConfig: {
      baseUrl: tsConfig.baseUrl,
      pathCount: Object.keys(tsConfig.paths).length,
      workspaceCount: workspacePackages.size,
    },
    files,
    domains,
    coChange: coChangePairs,
  };

  fs.mkdirSync(path.join(root, '.vectora'), { recursive: true });
  // Manage .vectora's own .gitignore: everything is per-developer EXCEPT
  // decisions.json — the shared, committable rulebook that replaces CLAUDE.md.
  const vIgnore = path.join(root, '.vectora', '.gitignore');
  if (!fs.existsSync(vIgnore)) {
    fs.writeFileSync(vIgnore, '*\n!.gitignore\n!decisions.json\n', 'utf8');
  }
  fs.writeFileSync(
    path.join(root, '.vectora', 'graph.json'),
    JSON.stringify(graph, null, 2),
    'utf8'
  );

  if (!silent) {
    const importEdges = files.reduce((s, f) => s + (f.importsResolved || []).length, 0);
    // Box inner width = 63 chars (between │ and │), total box = 65 chars
    const W = 63;
    const pad = (s) => String(s).padEnd(W);
    const aliasLine = (() => {
      const parts = [];
      if (Object.keys(tsConfig.paths).length > 0) parts.push(`${Object.keys(tsConfig.paths).length} path alias${Object.keys(tsConfig.paths).length > 1 ? 'es' : ''}`);
      else if (tsConfig.baseUrl) parts.push('baseUrl resolved');
      if (workspacePackages.size > 0) parts.push(`${workspacePackages.size} workspace pkg${workspacePackages.size > 1 ? 's' : ''}`);
      return parts.length ? parts.join('  ·  ') : null;
    })();
    console.log('╔─ vectora ─────────────────────────────────────────────────────╗');
    console.log(`│ ${pad('↺ graph built  ·  offline  ·  0 tokens')}│`);
    console.log(`│ ${pad('files:       ' + files.length + '  ·  ' + projectType.label)}│`);
    console.log(`│ ${pad('import edges: ' + importEdges)}│`);
    console.log(`│ ${pad('co-change:    ' + coChangePairs.length + ' file pairs (from git history)')}│`);
    if (aliasLine) console.log(`│ ${pad('aliases:      ' + aliasLine)}│`);
    console.log('╚───────────────────────────────────────────────────────────────╝');
    console.log('');
    console.log(`  Use /vectora <task> to navigate, then /vectora check when done.`);
    if (isFirstInit) {
      console.log('');
      console.log('[VECTORA SEED]');
      console.log('First graph built on this repo. vectora is now this project\'s scoped');
      console.log('replacement for CLAUDE.md: instead of one static file loaded into context');
      console.log('every turn, it surfaces only the rules a task actually touches. Seed that');
      console.log('memory now (the graph build was 0 tokens — this rule step is where LLM');
      console.log('reasoning earns its keep):');
      console.log('  1. Run /vectora migrate — auto-discovers CLAUDE.md, README.md,');
      console.log('     .cursorrules, CONTRIBUTING.md, and other convention files. Extract the');
      console.log('     architectural rules from them.');
      console.log('  2. Run /vectora overview, then /vectora why <file> on the top 3 pivots —');
      console.log('     add any invariants/coupling constraints the graph reveals.');
      console.log('  3. Tag each rule with the domain it governs so it surfaces per-task:');
      console.log('     npx vectora learn "<rule>" --domain <domain>   (omit --domain if global)');
      console.log('  4. Propose every rule to the user before writing it. Then tell them:');
      console.log('     vectora now carries these as scoped rules — surfaced only on tasks that');
      console.log('     touch the relevant files. CLAUDE.md can be slimmed to a pointer.');
      console.log('[END VECTORA SEED]');
    }
  }

  return true;
}

// ─── Diff (incremental graph update) ─────────────────────────────────────────

function runDiff({ silent = false, root = process.cwd() } = {}) {
  const graphPath = path.join(root, '.vectora', 'graph.json');

  if (!fs.existsSync(graphPath)) {
    // No existing graph — fall back to full init
    return runInit({ silent, root });
  }

  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch { return runInit({ silent, root }); }

  if (!graph.gitHash) {
    // No git hash stored — can't do incremental
    return runInit({ silent, root });
  }

  const printDiffSummary = (g, note) => {
    if (silent) return;
    const fileCount = (g.files || []).length;
    const domainCount = Object.keys(g.domains || {}).length;
    const domainPart = domainCount ? ` · ${domainCount} domain${domainCount > 1 ? 's' : ''}` : '';
    let agePart = '';
    if (g.generated) {
      const ageH = Math.round((Date.now() - new Date(g.generated).getTime()) / 3600000);
      agePart = ageH < 1 ? ' · built just now' : ` · built ${ageH}h ago`;
    }
    console.log(`${note}\n  ${fileCount} files${domainPart}${agePart}`);
  };

  const currentHash = getGitHash(root);
  if (!currentHash || currentHash === graph.gitHash) {
    // Check dirty flag
    const dirtyPath = path.join(root, '.vectora', 'dirty');
    if (!fs.existsSync(dirtyPath)) {
      printDiffSummary(graph, 'vectora: graph is current — nothing to update');
      return true;
    }
  }

  // Get list of files changed since last graph build
  let changedFiles = [];
  try {
    const out = execSync(`git diff --name-only ${graph.gitHash} HEAD`, {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    }).toString().trim();
    changedFiles = out ? out.split('\n').filter(f => SOURCE_EXTENSIONS.test(f)) : [];
  } catch {
    // Git diff failed — fall back to full init
    return runInit({ silent, root });
  }

  if (changedFiles.length === 0) {
    printDiffSummary(graph, 'vectora: graph is current — nothing to update');
    return true;
  }

  if (!silent) process.stdout.write(`vectora: updating ${changedFiles.length} changed file(s)... `);

  // Re-parse only changed files
  const config = mergeConfig(loadConfig(root));
  const updatedParsed = [];
  for (const rel of changedFiles) {
    const fullPath = path.join(root, rel);
    if (!fs.existsSync(fullPath)) continue; // deleted file
    const result = parseFile(fullPath);
    if (!result) continue;
    updatedParsed.push({ fullPath, path: rel, ...result });
  }

  // Merge: remove old entries for changed files, add updated entries
  const changedSet = new Set(changedFiles);
  const existingFiles = (graph.files || []).filter(f => !changedSet.has(f.path));
  const newParsedForCentrality = [
    ...existingFiles.map(f => ({ fullPath: path.join(root, f.path), path: f.path, imports: f.imports || [], exports: f.exports || [] })),
    ...updatedParsed,
  ];

  const diffAliases = { ...loadTsConfig(root, config.tsConfigPath), workspacePackages: loadWorkspacePackages(root) };
  const { inDegree, outDegree } = computeCentrality(newParsedForCentrality, diffAliases);
  const pivotCount = Math.ceil(newParsedForCentrality.length * config.pivotThreshold);
  const allScored = newParsedForCentrality.map(f => ({
    ...f,
    centralityScore: (inDegree.get(f.fullPath) ?? 0) * 2 + (outDegree.get(f.fullPath) ?? 0),
  }));
  const sorted = [...allScored].sort((a, b) => b.centralityScore - a.centralityScore);
  const topPaths = new Set(sorted.slice(0, pivotCount).map(f => f.fullPath));

  // Rebuild file entries
  const newFileEntries = allScored.map(f => {
    const existing = existingFiles.find(e => e.path === f.path);
    const updated = updatedParsed.find(u => u.path === f.path);
    const source = updated || existing || f;
    return {
      ...source,
      centralityScore: f.centralityScore,
      inDegree: inDegree.get(f.fullPath) ?? 0,
      outDegree: outDegree.get(f.fullPath) ?? 0,
      isPivot: topPaths.has(f.fullPath) || source.manualPivot || false,
      allIdentifiers: source.allIdentifiers || [],
      stringLiterals: source.stringLiterals || [],
      commentTerms: source.commentTerms || [],
    };
  });

  const updatedGraph = {
    ...graph,
    generated: new Date().toISOString(),
    gitHash: getGitHash(root),
    files: newFileEntries,
  };

  fs.writeFileSync(path.join(root, '.vectora', 'graph.json'), JSON.stringify(updatedGraph, null, 2), 'utf8');

  printDiffSummary(updatedGraph, `vectora: updated ${changedFiles.length} file${changedFiles.length > 1 ? 's' : ''}`);
  return true;
}

// ─── Map ──────────────────────────────────────────────────────────────────────
// vectora does not decide which files to load. It emits the structural map the
// agent cannot compute itself — seeds matched to the task, their graph
// neighborhood, and git co-change history — and lets the agent navigate.

function loadGraphForTask(root, cmd) {
  const graphPath = path.join(root, '.vectora', 'graph.json');

  // Auto-heal: reload on the dirty flag, then on a git HEAD change.
  const dirtyPath = path.join(root, '.vectora', 'dirty');
  if (fs.existsSync(dirtyPath)) {
    runDiff({ silent: true, root });
    try { fs.rmSync(dirtyPath, { force: true }); } catch {}
  }

  if (!fs.existsSync(graphPath)) {
    console.log('[VECTORA MAP]');
    console.log('╔─ vectora ─────────────────────────────────────────────╗');
    console.log('│ ⚠ no graph — run `npx vectora init` to activate       │');
    console.log('╚───────────────────────────────────────────────────────╝');
    console.log('Proceed by your own judgment, then run `npx vectora init`.');
    console.log('[END VECTORA MAP]');
    return null;
  }

  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch {
    console.error(`vectora ${cmd}: failed to parse graph.json — run \`npx vectora init\``);
    process.exit(1);
  }

  if (graph.gitHash) {
    try {
      const current = execSync('git rev-parse HEAD', {
        cwd: root, stdio: ['ignore','pipe','ignore'], timeout: 2000,
      }).toString().trim();
      if (current !== graph.gitHash) {
        runDiff({ silent: true, root });
        try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); } catch {}
      }
    } catch {}
  }
  return graph;
}

function runMap(task, { root = process.cwd() } = {}) {
  const graph = loadGraphForTask(root, 'map');
  if (!graph) return;

  const files = graph.files || [];
  const byPath = new Map(files.map(f => [f.path, f]));
  const decayDays = mergeConfig(loadConfig(root)).observedDecayDays;
  const observedPeers = observedPeersMap(loadObserved(root), decayDays);

  // Decompose the prompt into one or more tasks (offline heuristic, no LLM).
  // Each task gets its own scoped seed set + neighborhood so the agent loads
  // only the slice that task touches — the whole point is keeping context lean.
  const taskList = splitTasks(task);
  const scopes = taskList.map(t => {
    // A spec/doc file named in the prompt (e.g. "read DESIGN.md and …") is the
    // authority for the task but lives outside the import graph, so findSeeds
    // can never surface it. Force it into scope ahead of the graph seeds.
    const specSeeds = findSpecSeeds(t.text, root);
    const graphSeeds = findSeeds(files, t.text).filter(s => !specSeeds.some(sp => sp.path === s.path));
    const seeds = [...specSeeds, ...graphSeeds].slice(0, 6);
    const nb = expandNeighborhood(seeds, graph, observedPeers);
    return { text: t.text, verb: t.verb, seeds, nb };
  });

  const routing = classifyRouting(scopes);

  // ── Change 2: leaf-ratio / weak-signal detection ───────────────────────────
  // Collect the final scoped file paths across all tasks.
  const scopedFilePaths = [...new Set(scopes.flatMap(s => [
    ...s.seeds.map(x => x.path),
    ...s.nb.neighbors.slice(0, 6).map(n => n.path),
  ]))];
  const byPathForLeaf = new Map((files || []).map(f => [f.path, f]));
  const leafRatio = scopedFilePaths.length === 0 ? 0 :
    scopedFilePaths.filter(fp => {
      const node = byPathForLeaf.get(fp) || {};
      const inDeg = (node.importedBy || []).length;
      const outDeg = (node.importsResolved || []).length;
      return inDeg + outDeg <= 1;
    }).length / scopedFilePaths.length;
  const weakSignal = leafRatio >= 0.7;

  if (weakSignal) {
    console.log('[GRAPH SIGNAL: WEAK — ≥70% of task files are leaf nodes. Co-change and caller signals sparse. Skip graph-dependent protocol steps.]');
  }

  // ── Change 3: FILES provenance box and MAP SUMMARY box ────────────────────
  const filesConsidered = (graph.files || []).length;
  const filesLoaded = scopedFilePaths.length;
  const seedCount = [...new Set(scopes.flatMap(s => s.seeds.map(x => x.path)))].length;

  // Load last-map to detect recently-edited files.
  let prevMapFiles = new Set();
  const lastMapPathForBox = path.join(root, '.vectora', 'last-map.json');
  if (fs.existsSync(lastMapPathForBox)) {
    try {
      const prev = JSON.parse(fs.readFileSync(lastMapPathForBox, 'utf8'));
      (prev.seeds || []).forEach(f => prevMapFiles.add(f));
    } catch {}
  }

  // Load observed peers to detect co-change peers.
  const observedPeersForBox = observedPeersMap(loadObserved(root), mergeConfig(loadConfig(root)).observedDecayDays);

  const fileBoxLines = scopedFilePaths.map(fp => {
    let tag = '';
    if (prevMapFiles.has(fp)) tag = ' [recently edited]';
    else if (observedPeersForBox.has(fp) && (observedPeersForBox.get(fp) || []).length > 0) tag = ' [co-change peer]';
    return fp + tag;
  });

  const filesBoxTitle = `FILES ────────── ${filesLoaded} loaded · ${filesConsidered} considered · ${seedCount} seeded `;
  console.log(box(filesBoxTitle, fileBoxLines));

  // Determine domains and routing label for the summary box.
  const mapDomains = [...new Set(scopes.flatMap(s =>
    s.seeds.map(x => byPathForLeaf.get(x.path)?.domain).filter(Boolean)
  ))];
  const routingLabel = scopes.length <= 1 ? 'SINGLE' : (routing.independent.length >= 2 ? 'PARALLEL' : 'SEQUENTIAL');
  const signalLabel = weakSignal ? 'WEAK (leaf file set)' : 'NORMAL';
  const summaryLines = [
    `Domains → ${mapDomains.length ? mapDomains.join(', ') : '(none detected)'}`,
    `Routing → ${routingLabel}`,
    `Signal  → ${signalLabel}`,
  ];
  console.log(box('VECTORA MAP', summaryLines));

  if (scopes.length > 1) emitMultiMap(scopes, routing, graph, root, task);
  else emitMap(scopes[0].text, graph, scopes[0].seeds, scopes[0].nb, root);

  // Reconcile data for the honest receipt: union of every task's scope so
  // `vectora check` covers the whole prompt, plus the counts the involvement
  // banner reports back (facts only — never an invented token number).
  const unionSeeds = [...new Set(scopes.flatMap(s => s.seeds.map(x => x.path)))];
  const unionCoChange = dedupeCoChange(scopes.flatMap(s => s.nb.coChange));
  const scopedSet = new Set();
  scopes.forEach((s, i) => routing.fileSets[i].forEach(f => scopedSet.add(f)));
  const unionDomains = [...new Set(
    scopes.flatMap(s => s.seeds.map(x => byPath.get(x.path)?.domain)).filter(Boolean)
  )];
  const rulesApplied = collectDecisions(root, unionDomains).length;

  persistLastMap(root, {
    task,
    generatedAt: new Date().toISOString(),
    gitHash: graph.gitHash || null,
    seeds: unionSeeds,
    coChange: unionCoChange,
    taskCount: scopes.length,
    scopedFileCount: scopedSet.size,
    indexedFileCount: files.length,
    rulesApplied,
    // Per-task file scopes — let `check` record session co-change WITHIN a task
    // instead of pairing files across independent tasks bundled in one prompt.
    taskScopes: scopes.map((_, i) => [...routing.fileSets[i]]),
  });
}

// Group edited files by the task scope they fall into, so session co-change is
// only recorded among files that belong to the SAME task. Files from
// independent tasks (disjoint scopes) are never paired. Falls back to a single
// group when there were no task scopes (no prior map, or a single task) —
// preserving the original behavior.
function groupEditedByTask(edited, taskScopes) {
  if (!Array.isArray(taskScopes) || taskScopes.length === 0) return [edited];
  const scopeSets = taskScopes.map(s => new Set(s));
  const groups = scopeSets.map(() => []);
  const orphans = [];
  for (const f of edited) {
    let placed = false;
    scopeSets.forEach((set, i) => {
      if (set.has(f)) { groups[i].push(f); placed = true; }
    });
    if (!placed) orphans.push(f);
  }
  if (orphans.length) groups.push(orphans);
  return groups.filter(g => g.length);
}

// Split a prompt into discrete tasks. Offline, deterministic, no LLM. Splits on
// explicit list markers (1. / 2. / -), and on connectives that join imperative
// clauses ("then", "and then", "also", "after that", "; "). A fragment that
// carries no imperative verb is folded back into the previous task so a single
// rich sentence isn't shattered. < 2 verbs ⇒ treated as one task (status quo).
const IMPERATIVE_VERBS = /\b(fix|add|update|remove|delete|rename|refactor|implement|create|move|write|wire|test|change|make|support|handle|build|improve|optimi[sz]e|migrate|replace|integrate|expose|enable|disable|extract|split|merge|document|set\s?up|hook|patch)\b/i;

function splitTasks(prompt) {
  if (!prompt || !prompt.trim()) return [{ text: prompt || '', verb: null }];
  const trimmed = prompt.trim();

  let segments;
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const listLines = lines.filter(l => /^(\d+[.)]|[-*•])\s+/.test(l));
  if (listLines.length >= 2) {
    segments = listLines.map(l => l.replace(/^(\d+[.)]|[-*•])\s+/, '').trim());
  } else {
    segments = trimmed
      .split(/\s*;\s*|\s*\n\s*|\s*,?\s+\b(?:and then|then|after that|afterwards|and also|also|next|additionally)\b\s+/i)
      .map(s => s.trim())
      .filter(Boolean);
  }

  let tasks = segments.map(s => {
    const m = s.match(IMPERATIVE_VERBS);
    return { text: s, verb: m ? m[1].toLowerCase() : null };
  });

  // Fold verb-less fragments back into the preceding task.
  const folded = [];
  for (const t of tasks) {
    if (t.verb === null && folded.length) folded[folded.length - 1].text += ', ' + t.text;
    else folded.push(t);
  }
  tasks = folded;

  const withVerb = tasks.filter(t => t.verb);
  if (withVerb.length < 2) return [{ text: prompt, verb: tasks[0]?.verb || null }];
  return tasks.slice(0, 5);
}

// Classify how the tasks relate, from their scoped file sets. Independent tasks
// (disjoint scope) are parallel-agent candidates; overlapping tasks should run
// in order to share context. Pure information for the agent — it decides.
function classifyRouting(scopes) {
  const fileSets = scopes.map(s => new Set([
    ...s.seeds.map(x => x.path),
    ...s.nb.neighbors.slice(0, 6).map(n => n.path),
  ]));
  const overlaps = []; // [i, j, sharedCount]
  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      let shared = 0;
      for (const f of fileSets[i]) if (fileSets[j].has(f)) shared++;
      if (shared > 0) overlaps.push([i, j, shared]);
    }
  }
  const independent = [];
  for (let i = 0; i < scopes.length; i++) {
    if (!overlaps.some(o => o[0] === i || o[1] === i)) independent.push(i);
  }
  return { fileSets, overlaps, independent };
}

function buildRoutingLines(scopes, routing) {
  if (scopes.length <= 1) return ['single task'];
  const lines = [];
  for (const [i, j] of routing.overlaps) {
    lines.push(`tasks ${i + 1} & ${j + 1} share scope → run in order, reuse context.`);
  }
  if (routing.independent.length >= 2) {
    const nums = routing.independent.map(i => i + 1).join(' & ');
    lines.push(`tasks ${nums} are independent (disjoint scope) → parallel sub-agents keep context small.`);
  } else if (routing.independent.length === 1 && routing.overlaps.length) {
    lines.push(`task ${routing.independent[0] + 1} is independent → can run in parallel.`);
  }
  if (!lines.length) lines.push(`${scopes.length} tasks, scopes overlap → run in order, reuse context.`);
  return lines;
}

function dedupeCoChange(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = [c.a, c.b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Spec/doc files named in the prompt (.md/.txt/.rst). These are not in the
// import graph — the graph indexes parsed source only — but when the prompt
// says "read DESIGN.md and …" that file is the authority for the task and must
// be in scope. Resolved against the repo root and verified to exist on disk;
// no match if the file isn't there. Returns synthetic seeds ranked above graph
// seeds so they sort first.
function findSpecSeeds(task, root) {
  const out = [];
  const seen = new Set();
  const re = /(?:^|[\s"'`(=])([\w./-]+\.(?:md|txt|rst))\b/gi;
  let m;
  while ((m = re.exec(task)) !== null) {
    const rel = m[1].replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.resolve(root, rel);
    // Stay within the repo and require the file to actually exist.
    if (!abs.startsWith(path.resolve(root))) continue;
    try {
      if (!fs.statSync(abs).isFile()) continue;
    } catch { continue; }
    out.push({ path: rel, reasons: ['spec file named in task'], rank: 6, inDegree: 0 });
  }
  return out;
}

// Scan the verbatim prompt for an embedded execution constraint — a permission,
// a bound, or a stated convention. These are durable rules the user dropped into
// the prompt ("you may relax X but only slightly", "we never do Y here") that the
// post-task capture would otherwise miss. Returns the sentence carrying the first
// match (trimmed), or null. Deterministic, offline — the agent proposes it to the
// user after the receipt; vectora never writes a rule silently.
const CONSTRAINT_PHRASES = [
  'you may', 'feel free to', 'at your discretion', 'whenever you deem', "it's ok to", 'it is ok to',
  'but only', 'only slightly', 'no more than', 'at most', 'sparingly',
  'we always', 'we never', 'we prefer', 'our convention', 'by convention', 'always use', 'never use',
];
function findPromptConstraint(task) {
  const sentences = task.split(/(?<=[.!?])\s+|\n+/);
  for (const raw of sentences) {
    const s = raw.trim();
    const low = s.toLowerCase();
    if (CONSTRAINT_PHRASES.some(p => low.includes(p))) {
      return s.length > 160 ? s.slice(0, 157) + '…' : s;
    }
  }
  return null;
}

// Transparent seed matching: which files does the task text name directly?
// Every match carries a human-readable reason. No hidden weights, no rule tables.
function findSeeds(files, task) {
  const taskTokens = new Set(tokenize(task));
  const taskLower = task.toLowerCase();
  const out = [];

  for (const f of files) {
    const reasons = [];
    let rank = 0;
    const filename = path.basename(f.path);
    const stem = path.basename(f.path, path.extname(f.path));

    if (f.path.length > 3 && taskLower.includes(f.path.toLowerCase())) {
      reasons.push('path named in task'); rank += 5;
    } else if (stem.length > 2 && taskLower.includes(filename.toLowerCase())) {
      reasons.push('filename named in task'); rank += 4;
    }

    const stemHits = tokenize(stem).filter(t => taskTokens.has(t));
    if (stemHits.length) { reasons.push('filename match'); rank += 2 * stemHits.length; }

    const expHits = [];
    for (const exp of (f.exports || [])) {
      if (tokenize(exp).some(t => taskTokens.has(t))) expHits.push(exp);
    }
    if (expHits.length) { reasons.push('exports ' + expHits.slice(0, 3).join(', ')); rank += expHits.length; }

    let strHit = false;
    for (const s of (f.stringLiterals || [])) {
      if (tokenize(s).some(t => taskTokens.has(t))) { strHit = true; break; }
    }
    if (strHit) { reasons.push('string-literal match'); rank += 1; }

    if (reasons.length) {
      out.push({ path: f.path, reasons, rank, inDegree: f.inDegree || 0 });
    }
  }

  out.sort((a, b) => b.rank - a.rank || b.inDegree - a.inDegree);
  return out;
}

// For the seed set, pull the graph neighborhood: forward imports, reverse
// importers, and co-change peers. Co-change merges two independent signals —
// git history (graph.coChangePeers) and the session ledger (observedPeers) —
// into one list, each pair tagged with its provenance. Neither replaces the
// other: git carries it when the ledger is empty; the ledger carries it on a
// repo with no git history.
function expandNeighborhood(seeds, graph, observedPeers = new Map()) {
  const files = graph.files || [];
  const byPath = new Map(files.map(f => [f.path, f]));
  const seedSet = new Set(seeds.map(s => s.path));

  const neighbors = new Map(); // path -> { relations:Set, inDegree }
  const addNeighbor = (p, rel) => {
    if (!p || seedSet.has(p) || !byPath.has(p)) return;
    if (!neighbors.has(p)) {
      neighbors.set(p, { relations: new Set(), inDegree: byPath.get(p).inDegree || 0 });
    }
    neighbors.get(p).relations.add(rel);
  };

  // Merge git + session pairs keyed by the unordered pair.
  const pairMap = new Map(); // "a|b" -> { a, b, sharedCommits, sessionCommits }
  const addPair = (a, b, gitN, sessN, base) => {
    addNeighbor(b, `co-changes with ${base}`);
    const key = [a, b].sort().join('|');
    const e = pairMap.get(key) || { a, b, sharedCommits: 0, sessionCommits: 0 };
    if (gitN)  e.sharedCommits  = Math.max(e.sharedCommits, gitN);
    if (sessN) e.sessionCommits = Math.max(e.sessionCommits, sessN);
    pairMap.set(key, e);
  };

  for (const s of seeds) {
    const f = byPath.get(s.path);
    if (!f) continue;
    const base = path.basename(s.path);
    for (const p of (f.importsResolved || [])) addNeighbor(p, `imported by ${base}`);
    for (const p of (f.importedBy || []))     addNeighbor(p, `imports ${base}`);
    for (const peer of (f.coChangePeers || [])) addPair(s.path, peer.partner, peer.sharedCommits, 0, base);
    for (const peer of (observedPeers.get(s.path) || [])) {
      if (byPath.has(peer.partner)) addPair(s.path, peer.partner, 0, peer.sessionCommits, base);
    }
  }

  const list = [...neighbors.entries()]
    .map(([p, v]) => ({ path: p, relations: [...v.relations], inDegree: v.inDegree }))
    .sort((a, b) => b.inDegree - a.inDegree);

  const coChange = [...pairMap.values()]
    .sort((a, b) => (b.sharedCommits + b.sessionCommits) - (a.sharedCommits + a.sessionCommits));
  return { neighbors: list, coChange };
}

// ─── Session-observed coupling ledger ─────────────────────────────────────────
// `.vectora/observed.json` records pairs of files YOU edited together, tallied
// across sessions. It supplements git co-change and, on a repo with no history,
// stands in for it entirely. Per-developer signal (like the ledger) — not
// committed; only decisions.json (the shared rulebook) is. Recency-decayed.

function loadObserved(root) {
  const p = path.join(root, '.vectora', 'observed.json');
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d && typeof d.pairs === 'object') { d.seen = d.seen || {}; return d; }
    return { pairs: {}, seen: {} };
  } catch { return { pairs: {}, seen: {} }; }
}

// Build the per-file peer list. `decayDays` (optional) drops pairs not seen
// within the window — recency decay so a coupling from a year ago doesn't count
// like one from today. Legacy pairs with no `seen` timestamp are always kept
// (never silently discard pre-upgrade history). Counts stay integer, so the
// `sessions M×` label remains truthful.
function observedPeersMap(observed, decayDays = 0) {
  const map = new Map(); // path -> [{ partner, sessionCommits }]
  const seen = observed.seen || {};
  const cutoff = decayDays > 0 ? Date.now() - decayDays * 24 * 3600 * 1000 : 0;
  for (const [key, count] of Object.entries(observed.pairs || {})) {
    const [a, b] = key.split('|');
    if (!a || !b) continue;
    if (cutoff && seen[key]) {
      const t = new Date(seen[key]).getTime();
      if (!isNaN(t) && t < cutoff) continue; // stale — decayed out
    }
    if (!map.has(a)) map.set(a, []);
    if (!map.has(b)) map.set(b, []);
    map.get(a).push({ partner: b, sessionCommits: count });
    map.get(b).push({ partner: a, sessionCommits: count });
  }
  return map;
}

// Record the files edited together in this task. Mirrors the git co-change
// noise filter: a sprawling edit (> maxFiles) says nothing about real coupling.
function recordObserved(root, editedFiles, maxFiles = 15) {
  const files = [...new Set(editedFiles)].filter(f => SOURCE_EXTENSIONS.test(f));
  if (files.length < 2 || files.length > maxFiles) return;
  const observed = loadObserved(root);
  observed.pairs = observed.pairs || {};
  observed.seen = observed.seen || {};
  const now = new Date().toISOString();
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const key = [files[i], files[j]].sort().join('|');
      observed.pairs[key] = (observed.pairs[key] || 0) + 1;
      observed.seen[key] = now; // recency stamp for decay
    }
  }
  observed.updated = now;
  try {
    fs.mkdirSync(path.join(root, '.vectora'), { recursive: true });
    fs.writeFileSync(path.join(root, '.vectora', 'observed.json'), JSON.stringify(observed, null, 2), 'utf8');
  } catch {}
}

// Lean single-task map. Deliberately terse — the agent reads this every task,
// so every line must earn its tokens. No boxed banner, no verbose neighborhood
// dump; neighbors fold into one FILES line. Scoped RULES replace a CLAUDE.md
// blob: only the rules whose domain this task touches are surfaced.
function emitMap(task, graph, seeds, nb, root) {
  const files = graph.files || [];
  const byPath = new Map(files.map(f => [f.path, f]));

  console.log('[VECTORA MAP]');
  const scopeNeighbors = Math.min(nb.neighbors.length, 6);
  const scopeFiles = seeds.length + scopeNeighbors;
  console.log(`vectora · ${files.length} files indexed → ${scopeFiles} in scope for "${truncateTask(task, 50)}"`);

  // Scoped institutional memory (the CLAUDE.md replacement).
  const seedDomains = [...new Set(seeds.map(s => byPath.get(s.path)?.domain).filter(Boolean))];
  const rules = collectDecisions(root, seedDomains);
  if (rules.length) {
    console.log('RULES:     ' + rules.slice(0, 4).map(r => r.rule).join(' · '));
  }

  // CANDIDATE RULE — a constraint the user embedded in the prompt itself.
  const constraint = findPromptConstraint(task);
  if (constraint) {
    console.log(`⚑ CANDIDATE RULE: "${constraint}" — propose via /vectora learn after the receipt.`);
  }

  // DANGER ZONES — @vectora danger: annotations co-located with guarded code.
  const dangerPaths = new Set([...seeds.map(s => s.path), ...nb.coChange.flatMap(c => [c.a, c.b])]);
  for (const fp of dangerPaths) {
    const f = byPath.get(fp);
    if (f && f.dangerZones) for (const dz of f.dangerZones) console.log(`⚠ DANGER:  ${shortPath(fp)}: "${dz}"`);
  }

  // CO-CHANGE — the signal the agent cannot compute on its own (top 3).
  const cc = dedupeCoChange(nb.coChange).slice(0, 3);
  if (cc.length) {
    console.log('CO-CHANGE: ' + cc.map(c => `${shortPath(c.a)} + ${shortPath(c.b)} (${coChangeLabel(c)})`).join(' · '));
  }

  console.log('START HERE (open by your own judgment — nothing is hidden):');
  if (seeds.length) {
    for (const s of seeds) {
      const f = byPath.get(s.path);
      const meta = f ? `[${f.lineCount}L · in:${f.inDegree || 0}]` : '';
      const reach = f ? transitiveDependents(graph, s.path).size : 0;
      const blast = reach >= 5 ? `  ⚠ blast:${reach}` : '';
      console.log(`  ${s.path} ${meta} (${s.reasons.join('; ')})${blast}`);
    }
  } else {
    const central = [...files].sort((a, b) => (b.inDegree || 0) - (a.inDegree || 0)).slice(0, 5);
    for (const f of central) console.log(`  ${f.path} [in:${f.inDegree || 0}] (central)`);
  }

  // Neighbors folded into a single line — relevant, but not worth a block each.
  if (nb.neighbors.length) {
    const names = nb.neighbors.slice(0, 6).map(n => shortPath(n.path));
    const more = nb.neighbors.length > 6 ? ` …+${nb.neighbors.length - 6}` : '';
    console.log('FILES:     ' + names.join(' · ') + more);
  }

  console.log('When done, run `npx vectora check` — it catches incomplete edits even without this map.');
  console.log('[END VECTORA MAP]');
}

// Multi-task map: one compact block per detected task + a routing line. Same
// lean discipline as emitMap — the agent should be able to skim it and route.
function emitMultiMap(scopes, routing, graph, root, fullTask = '') {
  const files = graph.files || [];
  const byPath = new Map(files.map(f => [f.path, f]));
  const scopedSet = new Set();
  scopes.forEach((s, i) => routing.fileSets[i].forEach(f => scopedSet.add(f)));

  console.log('[VECTORA MAP]');
  console.log(`vectora · ${scopes.length} tasks · ${files.length} files indexed → ${scopedSet.size} in scope`);

  const routingLines = buildRoutingLines(scopes, routing);
  console.log('ROUTING: ' + routingLines[0]);
  for (const l of routingLines.slice(1)) console.log('         ' + l);

  // CANDIDATE RULE — a constraint embedded in the prompt. Scan the full verbatim
  // prompt, not the per-task slices, since splitTasks may drop a non-imperative
  // constraint sentence.
  const constraint = findPromptConstraint(fullTask || scopes.map(s => s.text).join('. '));
  if (constraint) {
    console.log(`⚑ CANDIDATE RULE: "${constraint}" — propose via /vectora learn after the receipt.`);
  }

  scopes.forEach((s, i) => {
    const relevant = routing.fileSets[i];
    console.log('');
    console.log(`── TASK ${i + 1}/${scopes.length} · "${truncateTask(s.text, 50)}" · relevant: ${relevant.size}`);

    const domains = [...new Set(s.seeds.map(x => byPath.get(x.path)?.domain).filter(Boolean))];
    const rules = collectDecisions(root, domains);
    if (rules.length) console.log('   RULES:     ' + rules.slice(0, 3).map(r => r.rule).join(' · '));

    for (const p of relevant) {
      const f = byPath.get(p);
      if (f && f.dangerZones) for (const dz of f.dangerZones) console.log(`   ⚠ DANGER:  ${shortPath(p)}: "${dz}"`);
    }

    const cc = dedupeCoChange(s.nb.coChange).slice(0, 3);
    if (cc.length) console.log('   CO-CHANGE: ' + cc.map(c => `${shortPath(c.a)} + ${shortPath(c.b)} (${coChangeLabel(c)})`).join(' · '));

    if (relevant.size) console.log('   FILES:     ' + [...relevant].map(shortPath).join(' · '));
    else console.log('   FILES:     (no keyword match — navigate by judgment)');
  });

  console.log('');
  console.log('Load only the FILES you judge relevant per task; report `loaded: K/relevant` for each.');
  console.log('[END VECTORA MAP]');
}

function truncateTask(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function persistLastMap(root, data) {
  try {
    fs.mkdirSync(path.join(root, '.vectora'), { recursive: true });
    fs.writeFileSync(path.join(root, '.vectora', 'last-map.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

// ─── Check (the honest receipt) ─────────────────────────────────────────────
// Compares what was actually edited against the co-change links vectora surfaced.
// Reports real assists and flags predicted peers that were left unedited.

function runCheck({ root = process.cwd() } = {}) {
  console.log('[VECTORA CHECK]');

  // Load graph first — it's needed for all signals.
  let graph = null;
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (fs.existsSync(graphPath)) {
    try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); } catch {}
  }

  // Resolve the since-hash from last-map (if available). check works even
  // without a prior map — that was the bug this fixes.
  let sinceHash = null;
  const lastMapPath = path.join(root, '.vectora', 'last-map.json');
  let lastMapCoChange = [];
  let lastMapTask = null;
  let lastMap = {};
  if (fs.existsSync(lastMapPath)) {
    try {
      const last = JSON.parse(fs.readFileSync(lastMapPath, 'utf8'));
      lastMap = last;
      sinceHash = last.gitHash || null;
      lastMapCoChange = last.coChange || [];
      lastMapTask = last.task || null;
    } catch {}
  }

  const edited = getEditedFiles(root, sinceHash);
  if (edited.length === 0) {
    console.log('  no edited source files detected (git working tree clean).');
    console.log('[END VECTORA CHECK]');
    return;
  }
  console.log(`  you edited: ${edited.map(e => shortPath(e)).join(', ')}`);

  // Surface @vectora danger annotations on files you actually edited.
  // These are the constraints most likely to matter right now.
  if (graph) {
    const byPathDanger = new Map((graph.files || []).map(f => [f.path, f]));
    const dangers = [];
    for (const ed of edited) {
      const f = byPathDanger.get(ed);
      if (f && f.dangerZones && f.dangerZones.length) {
        for (const dz of f.dangerZones) dangers.push({ file: ed, text: dz });
      }
    }
    if (dangers.length) {
      console.log('');
      console.log('  ⚠ DANGER ZONES — constraints on files you edited:');
      for (const { file, text } of dangers) {
        console.log(`  ⚠ ${shortPath(file)}: "${text}"`);
      }
    }
  }

  const editedSet = new Set(edited);

  // ── 1. Confirmed breaks (✗ BROKEN — fix before finishing) ──────────────────
  // Re-parse current signatures of edited JS/TS files from disk and check every
  // importer's live call sites. A call passing fewer args than `required` and no
  // spread is a proven inconsistency, not a guess.
  const confirmedBreaks = confirmCallerBreaks(graph, edited, editedSet, root);
  if (confirmedBreaks.length) {
    console.log('');
    console.log('  ✗ BROKEN — fix before finishing:');
    for (const b of confirmedBreaks) {
      console.log(`  ✗ ${shortPath(b.importer)} calls ${b.symbol}() with ${b.got} arg${b.got !== 1 ? 's' : ''} but it now requires ${b.required} — fix this call.`);
    }
  }

  // ── 2. Co-change misses (⚠ forgot a file) ──────────────────────────────────
  // Merge two independent sources:
  //   a) map-derived pairs (last-map.json, filtered by edited files)
  //   b) graph-derived peers for ALL edited files — fires even without a prior map
  const seen = new Set();
  const surfaced = [];
  const misses = [];

  const processPair = (a, b, sharedCommits, sessionCommits) => {
    const key = [a, b].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const aEd = editedSet.has(a), bEd = editedSet.has(b);
    if (aEd && bEd) surfaced.push({ a, b, sharedCommits, sessionCommits });
    else if (aEd !== bEd) misses.push({ sharedCommits, sessionCommits, missing: aEd ? b : a, anchor: aEd ? a : b });
  };

  for (const c of lastMapCoChange) processPair(c.a, c.b, c.sharedCommits || 0, c.sessionCommits || 0);
  if (graph) {
    const observedPeers = observedPeersMap(loadObserved(root), mergeConfig(loadConfig(root)).observedDecayDays);
    const byPath = new Map((graph.files || []).map(f => [f.path, f]));
    for (const ed of edited) {
      const f = byPath.get(ed);
      if (!f) continue;
      for (const peer of (f.coChangePeers || [])) processPair(ed, peer.partner, peer.sharedCommits || 0, 0);
      for (const peer of (observedPeers.get(ed) || [])) processPair(ed, peer.partner, 0, peer.sessionCommits || 0);
    }
  }

  let reported = confirmedBreaks.length > 0;
  if (surfaced.length) {
    reported = true;
    console.log('');
    for (const c of surfaced) {
      console.log(`  ✓ ${shortPath(c.a)} ↔ ${shortPath(c.b)}  (${coChangeLabel(c)}) — vectora linked these; you edited both.`);
    }
    console.log(`  vectora surfaced ${surfaced.length} link${surfaced.length > 1 ? 's' : ''} grep could not.`);
  }
  if (misses.length) {
    reported = true;
    misses.sort((a, b) => (b.sharedCommits + b.sessionCommits) - (a.sharedCommits + a.sessionCommits));
    console.log('');
    for (const m of misses.slice(0, 3)) {
      console.log(`  ⚠ ${shortPath(m.missing)} co-changes with ${shortPath(m.anchor)} (${coChangeLabel(m)}) but was not edited — worth a look?`);
    }
  }

  // ── 3. Soft caller warnings (⚠ verify — no arity proof) ────────────────────
  // Importers that use an exported symbol from an edited file but weren't touched.
  // These fall back to "verify?" for non-JS/TS files or when signature data is absent.
  const confirmedImporters = new Set(confirmedBreaks.map(b => b.importer));
  const callerWarnings = collectCallerWarnings(graph, edited, editedSet)
    .filter(w => !confirmedImporters.has(w.importer)); // don't double-report
  if (callerWarnings.length) {
    reported = true;
    console.log('');
    console.log('  callers of what you changed (verify they still hold):');
    for (const w of callerWarnings.slice(0, 5)) {
      const sym = w.usedSymbols.length ? ` (uses ${w.usedSymbols.slice(0, 3).join(', ')})` : '';
      console.log(`  ⚠ ${shortPath(w.importer)} imports ${shortPath(w.anchor)}${sym} but wasn't edited — verify?`);
    }
    if (callerWarnings.length > 5) console.log(`  …and ${callerWarnings.length - 5} more caller(s).`);
  }

  // ── 4. Test pairing (static, history-free) ─────────────────────────────────
  const staleTests = [];
  if (graph) {
    const byPath = new Map((graph.files || []).map(f => [f.path, f]));
    for (const ed of edited) {
      const f = byPath.get(ed);
      if (!f || !f.testPath) continue;
      if (!editedSet.has(f.testPath)) staleTests.push({ src: ed, test: f.testPath });
    }
    if (staleTests.length) {
      reported = true;
      console.log('');
      console.log('  tests for code you changed (update them?):');
      for (const t of staleTests.slice(0, 5)) {
        console.log(`  ⚠ ${shortPath(t.src)} changed but ${shortPath(t.test)} wasn't — update the test?`);
      }
    }
  }

  // ── Change 4: styled receipt box (null or signal) ─────────────────────────
  const hasSignal = confirmedBreaks.length > 0 || misses.length > 0 ||
                    callerWarnings.length > 0 || staleTests.length > 0;
  const today = new Date().toISOString().slice(0, 10);

  if (!hasSignal) {
    console.log('');
    console.log(box('VECTORA RECEIPT', [
      'SIGNAL NULL — no arity edges, co-change peers, or caller',
      'links in this file set. Graph not applicable.',
      '',
      `Ran: check · ${today}`,
    ]));
  } else {
    const receiptLines = [];
    for (const b of confirmedBreaks.slice(0, 3)) {
      receiptLines.push(`✗ BROKEN: ${shortPath(b.importer)}:${b.symbol}() called with ${b.got} arg${b.got !== 1 ? 's' : ''}`);
    }
    for (const m of misses.slice(0, 3)) {
      receiptLines.push(`⚑ Co-change miss: ${shortPath(m.missing)} (not in file set)`);
    }
    for (const w of callerWarnings.slice(0, 3)) {
      receiptLines.push(`⚠ Caller warning: ${shortPath(w.importer)} imports changed symbol`);
    }
    if (staleTests.length === 0) receiptLines.push('─ No stale tests');
    receiptLines.push('');
    receiptLines.push(`Ran: check · ${today}`);
    console.log('');
    console.log(box('VECTORA RECEIPT', receiptLines));
  }

  if (!reported) {
    console.log('  no co-change or caller links among your edits — your changes were structurally isolated.');
  }

  // Learn from this task + persist the ledger event. Record session co-change
  // WITHIN each task's scope so independent tasks bundled in one prompt don't
  // get falsely linked (the multi-task contamination guard).
  const editGroups = groupEditedByTask(edited, lastMap.taskScopes);
  for (const g of editGroups) recordObserved(root, g);
  recordLedger(root, {
    task: lastMapTask,
    editedFiles: edited,
    confirmedBreaks: confirmedBreaks.length,
    coChangeMisses: misses.length,
    callerWarnings: callerWarnings.length,
    staleTests: staleTests.length,
    items: [
      ...confirmedBreaks.map(b => ({ type: 'break', file: b.importer, detail: `${b.symbol}() got ${b.got}, needs ${b.required}` })),
      ...misses.map(m => ({ type: 'cochange', file: m.missing, detail: `co-changes with ${shortPath(m.anchor)}` })),
      ...callerWarnings.slice(0, 5).map(w => ({ type: 'caller', file: w.importer, detail: `imports ${shortPath(w.anchor)}` })),
      ...staleTests.map(t => ({ type: 'test', file: t.test, detail: `test for ${shortPath(t.src)}` })),
    ],
  });

  // Significant architectural event detection: new files created or broad structural
  // impact (many peers flagged) suggests the agent made a generalisable decision worth
  // capturing as a rule. This gives the skill a concrete signal without LLM inference.
  const archSignal = detectSignificantEvent(root, edited, misses.length, callerWarnings.length);
  if (archSignal) {
    console.log('');
    console.log('[ARCHITECTURAL SIGNAL]');
    console.log(`  ${archSignal}`);
    console.log('  → Did this task establish a pattern worth keeping? If so, propose:');
    console.log('    /vectora learn "<the rule you just established>"');
    console.log('[END ARCHITECTURAL SIGNAL]');
  }

  // Regression memory: if a co-change miss has recurred 3+ times in 30 days,
  // propose baking it into decisions.json via /vectora learn.
  const regressionProposals = detectRegressionPatterns(root, edited);
  if (regressionProposals.length) {
    console.log('');
    console.log('  ↺ REGRESSION PATTERN — this keeps happening:');
    for (const p of regressionProposals) {
      console.log(`  ↺ "${shortPath(p.file)}" co-change missed ${p.count}× in 30 days when editing "${p.anchor}".`);
      console.log(`     Propose: /vectora learn "${p.file} always needs update when ${p.anchor} changes"`);
    }
  }

  // Honest involvement banner — shown every time the prompt flow finishes.
  // Every figure is a reconciled fact (scope from last-map, results from this
  // check). No invented token number, ever.
  emitInvolvementBanner({
    taskCount: lastMap.taskCount || 1,
    scopedFileCount: lastMap.scopedFileCount != null ? lastMap.scopedFileCount : edited.length,
    indexedFileCount: lastMap.indexedFileCount != null ? lastMap.indexedFileCount : (graph ? (graph.files || []).length : 0),
    rulesApplied: lastMap.rulesApplied || 0,
    coChangeSurfaced: surfaced.length,
    callerCount: callerWarnings.length,
    breaks: confirmedBreaks.length,
  });

  console.log('[END VECTORA CHECK]');
}

// Draw the involvement banner. Facts only: how tightly vectora scoped the
// prompt, which rules it surfaced, what its safety net caught.
function emitInvolvementBanner(s) {
  const lines = [];
  const scopeTxt = s.indexedFileCount
    ? `scoped to ${s.scopedFileCount} of ${s.indexedFileCount} indexed files`
    : `scoped to ${s.scopedFileCount} files`;
  lines.push(`${s.taskCount} task${s.taskCount === 1 ? '' : 's'} · ${scopeTxt}`);
  lines.push(`rules applied: ${s.rulesApplied}  ·  co-change links surfaced: ${s.coChangeSurfaced}`);
  lines.push(`check: ${s.callerCount} caller${s.callerCount === 1 ? '' : 's'} to verify · ${s.breaks} confirmed break${s.breaks === 1 ? '' : 's'}`);
  lines.push('vectora narrowed the field — each task saw only its slice');
  const W = Math.max(...lines.map(l => l.length));
  const title = ' vectora · this prompt ';
  console.log('');
  console.log('╭' + title + '─'.repeat(Math.max(0, W + 2 - title.length)) + '╮');
  for (const l of lines) console.log('│ ' + l.padEnd(W) + ' │');
  console.log('╰' + '─'.repeat(W + 2) + '╯');
}

// ─── Ledger ───────────────────────────────────────────────────────────────────
// Per-developer, per-project record of incomplete edits flagged. Not committed.
// Every entry is a real, inspectable event — no invented percentages.

function recordLedger(root, summary) {
  const p = path.join(root, '.vectora', 'ledger.json');
  let d = { events: [] };
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); if (!Array.isArray(d.events)) d.events = []; }
  catch {}
  const total = summary.confirmedBreaks + summary.coChangeMisses + summary.callerWarnings + summary.staleTests;
  if (total === 0) return; // nothing to record — don't pollute the ledger with clean runs
  d.events.push({ ts: new Date().toISOString(), ...summary });
  try { fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8'); } catch {}
}

function runReceipts({ root = process.cwd() } = {}) {
  const p = path.join(root, '.vectora', 'ledger.json');
  if (!fs.existsSync(p)) {
    console.log('[VECTORA RECEIPTS]');
    console.log('  no receipts yet — run /vectora check after a task to start tracking.');
    console.log('[END VECTORA RECEIPTS]');
    return;
  }
  let d;
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {
    console.log('[VECTORA RECEIPTS]\n  could not read ledger.\n[END VECTORA RECEIPTS]'); return;
  }
  const events = d.events || [];
  const totals = { confirmedBreaks: 0, coChangeMisses: 0, callerWarnings: 0, staleTests: 0 };
  for (const e of events) {
    totals.confirmedBreaks  += e.confirmedBreaks  || 0;
    totals.coChangeMisses   += e.coChangeMisses   || 0;
    totals.callerWarnings   += e.callerWarnings   || 0;
    totals.staleTests       += e.staleTests       || 0;
  }
  const grand = totals.confirmedBreaks + totals.coChangeMisses + totals.callerWarnings + totals.staleTests;
  const W = 63;
  const pad = (s) => String(s).padEnd(W);
  console.log('[VECTORA RECEIPTS]');
  console.log('╔─ vectora receipts ────────────────────────────────────────────╗');
  console.log(`│ ${pad(`${grand} incomplete edit${grand !== 1 ? 's' : ''} flagged across ${events.length} task${events.length !== 1 ? 's' : ''}`)}│`);
  if (totals.confirmedBreaks) console.log(`│ ${pad(`  ✗ ${totals.confirmedBreaks} confirmed break${totals.confirmedBreaks !== 1 ? 's' : ''} (arity mismatch — would have failed)`)}│`);
  if (totals.coChangeMisses)  console.log(`│ ${pad(`  ⚠ ${totals.coChangeMisses} forgotten co-change file${totals.coChangeMisses !== 1 ? 's' : ''}`)}│`);
  if (totals.callerWarnings)  console.log(`│ ${pad(`  ⚠ ${totals.callerWarnings} caller${totals.callerWarnings !== 1 ? 's' : ''} to verify`)}│`);
  if (totals.staleTests)      console.log(`│ ${pad(`  ⚠ ${totals.staleTests} stale test${totals.staleTests !== 1 ? 's' : ''}`)}│`);
  console.log('╚───────────────────────────────────────────────────────────────╝');
  const recent = events.slice(-5).reverse();
  if (recent.length) {
    console.log('');
    console.log('  recent tasks:');
    for (const e of recent) {
      const n = (e.confirmedBreaks || 0) + (e.coChangeMisses || 0) + (e.callerWarnings || 0) + (e.staleTests || 0);
      const date = new Date(e.ts).toLocaleDateString();
      const parts = [];
      if (e.confirmedBreaks) parts.push(`${e.confirmedBreaks} broken`);
      if (e.coChangeMisses)  parts.push(`${e.coChangeMisses} co-change`);
      if (e.callerWarnings)  parts.push(`${e.callerWarnings} caller`);
      if (e.staleTests)      parts.push(`${e.staleTests} test`);
      console.log(`    ${date}  ${n} flagged  (${parts.join(', ')})`);
    }
  }
  console.log('[END VECTORA RECEIPTS]');
}

// Human-readable provenance for a co-change link. git history and the session
// ledger (#4) are merged into one signal but always shown with their source.
function coChangeLabel(c) {
  const parts = [];
  if (c.sharedCommits) parts.push(`git ${c.sharedCommits}×`);
  if (c.sessionCommits) parts.push(`sessions ${c.sessionCommits}×`);
  if (!parts.length) parts.push(`co-change ${c.sharedCommits || 0}×`);
  return parts.join(' · ');
}

// Static caller/consumer recall: importers of edited files that reference one of
// the edited file's exported symbols but were not themselves edited. Restricting
// to importers that actually USE an exported symbol keeps this precise (no
// flagging of side-effect-only imports) and history-independent.
function collectCallerWarnings(graph, edited, editedSet) {
  if (!graph) return [];
  const byPath = new Map((graph.files || []).map(f => [f.path, f]));
  const flagged = new Set();
  const warnings = [];
  for (const ed of edited) {
    const f = byPath.get(ed);
    if (!f) continue;
    const exportNames = (f.exports || []).map(String);
    if (exportNames.length === 0) continue;
    for (const importer of (f.importedBy || [])) {
      if (editedSet.has(importer) || flagged.has(importer)) continue;
      const imp = byPath.get(importer);
      if (!imp) continue;
      const ids = new Set(imp.allIdentifiers || []);
      const usedSymbols = exportNames.filter(e => ids.has(e.toLowerCase()));
      if (usedSymbols.length === 0) continue; // only real symbol consumers
      flagged.add(importer);
      warnings.push({ importer, anchor: ed, usedSymbols, inDegree: imp.inDegree || 0 });
    }
  }
  warnings.sort((a, b) => b.usedSymbols.length - a.usedSymbols.length || b.inDegree - a.inDegree);
  return warnings;
}

// Extract call-site argument counts from a source file, keyed by callee name
// (lowercased). For each name: the calls observed, each with its positional
// argument count and whether it spreads (`f(...args)` — unknowable arity).
function extractCallArgs(raw) {
  const ast = astFor(raw);
  const calls = new Map(); // lowerName -> [{ count, spread }]
  if (!ast) return calls;
  walkAst(ast.program, (node) => {
    if (node.type !== 'CallExpression') return;
    let name = null;
    if (node.callee?.type === 'Identifier') name = node.callee.name;
    else if (node.callee?.type === 'MemberExpression' && node.callee.property?.name) name = node.callee.property.name;
    if (!name) return;
    const args = node.arguments || [];
    const spread = args.some(a => a.type === 'SpreadElement');
    const key = name.toLowerCase();
    if (!calls.has(key)) calls.set(key, []);
    calls.get(key).push({ count: args.length, spread });
  });
  return calls;
}

// Confirmed caller breaks: re-parse the edited file's CURRENT signatures and its
// importers' CURRENT call sites from disk, and flag any call that passes fewer
// positional args than the function now requires (no spread). Unlike
// collectCallerWarnings ("verify?"), this is a definite inconsistency, not a
// guess — the credibility core of `check`. JS/TS only.
function confirmCallerBreaks(graph, edited, editedSet, root) {
  if (!graph) return [];
  const byPath = new Map((graph.files || []).map(f => [f.path, f]));
  const breaks = [];
  const seen = new Set();
  const readSrc = (rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  };
  for (const ed of edited) {
    if (!/\.(js|jsx|ts|tsx)$/.test(ed)) continue;
    const f = byPath.get(ed);
    if (!f || !(f.importedBy || []).length) continue;
    const src = readSrc(ed);
    if (src == null) continue;
    const parsed = parseBabel(src, ed);
    const sigs = parsed?.exportSignatures || {};
    const required = Object.entries(sigs).filter(([, s]) => s.required > 0);
    if (!required.length) continue;
    for (const importer of f.importedBy) {
      if (editedSet.has(importer)) continue;
      const isrc = readSrc(importer);
      if (isrc == null) continue;
      const calls = extractCallArgs(isrc);
      for (const [name, sig] of required) {
        const sites = calls.get(name.toLowerCase());
        if (!sites) continue;
        const bad = sites.find(c => !c.spread && c.count < sig.required);
        if (!bad) continue;
        const key = importer + '|' + name;
        if (seen.has(key)) continue;
        seen.add(key);
        breaks.push({ importer, anchor: ed, symbol: name, required: sig.required, got: bad.count });
      }
    }
  }
  breaks.sort((a, b) => (a.required - a.got) - (b.required - b.got) === 0 ? 0 : (b.required - b.got) - (a.required - a.got));
  return breaks;
}

// Returns a human-readable reason string when the current check looks like a
// significant architectural event (new files created, or broad structural impact),
// or null when nothing notable. The primary "is this worth learning?" judgment
// stays with the agent/user — this just surfaces the structural evidence.
function detectSignificantEvent(root, edited, coChangeMissCount, callerWarningCount) {
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: root, stdio: ['ignore','pipe','ignore'], timeout: 3000 }).toString(); }
    catch { return ''; }
  };
  const porcelain = run('git status --porcelain');
  const newFiles = [];
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    if (xy === '??' || xy === 'A ' || xy === 'AM') {
      const p = line.slice(3).trim().replace(/^"|"$/g, '');
      if (SOURCE_EXTENSIONS.test(p)) newFiles.push(p);
    }
  }
  if (newFiles.length >= 2) {
    return `${newFiles.length} new source files created (${newFiles.slice(0, 3).map(f => path.basename(f)).join(', ')}${newFiles.length > 3 ? ', …' : ''}).`;
  }
  if (newFiles.length === 1 && edited.length >= 3) {
    return `new file ${path.basename(newFiles[0])} + ${edited.length - 1} existing files touched — looks like a feature addition.`;
  }
  const structuralBreadth = coChangeMissCount + callerWarningCount;
  if (structuralBreadth >= 4) {
    return `${structuralBreadth} structural peers flagged (${coChangeMissCount} co-change + ${callerWarningCount} caller) — broad impact suggests an architectural refactor.`;
  }
  return null;
}

function getEditedFiles(root, sinceHash) {
  const set = new Set();
  const add = (out) => out.split('\n').map(l => l.trim())
    .filter(l => l && SOURCE_EXTENSIONS.test(l)).forEach(l => set.add(l));
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: root, stdio: ['ignore','pipe','ignore'], timeout: 3000 }).toString(); }
    catch { return ''; }
  };
  add(run('git diff --name-only'));
  add(run('git diff --name-only --cached'));
  if (sinceHash) add(run(`git diff --name-only ${sinceHash} HEAD`));
  // `git diff` misses untracked files — critical for new projects where the
  // agent just created files. Parse porcelain status to catch those too.
  const porcelain = run('git status --porcelain');
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    let p = line.slice(3).trim();          // strip the 2-char status + space
    if (p.includes(' -> ')) p = p.split(' -> ')[1].trim(); // renames
    p = p.replace(/^"|"$/g, '');
    if (SOURCE_EXTENSIONS.test(p)) set.add(p);
  }
  return [...set];
}


// Scoped institutional memory — the dynamic replacement for CLAUDE.md. Returns
// the rules that apply to the given domains (plus globals), so callers can
// surface only what the current task touches instead of dumping every rule.
function collectDecisions(root, domains) {
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  if (!fs.existsSync(decisionsPath)) return [];
  let d;
  try { d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8')); } catch { return []; }
  const rules = [];
  if (Array.isArray(d.global)) for (const r of d.global) rules.push({ scope: 'global', rule: r });
  if (d.domains && typeof d.domains === 'object') {
    for (const domain of domains || []) {
      const dr = d.domains[domain];
      if (Array.isArray(dr)) for (const r of dr) rules.push({ scope: domain, rule: r });
    }
  }
  return rules;
}

function printDecisions(root, domains) {
  const rules = collectDecisions(root, domains);
  if (rules.length > 0) {
    console.log('');
    console.log('INSTITUTIONAL MEMORY (Must follow):');
    for (const r of rules) console.log(`  - [${r.scope}] ${r.rule}`);
  }
}


// ─── Regression Pattern Detection ────────────────────────────────────────────
// Scans the last 30 days of ledger events to find co-change misses that have
// recurred 3+ times with the same anchor file. Surfaced at the end of `check`
// as a proposal to bake the coupling into decisions.json via /vectora learn.

function detectRegressionPatterns(root, editedFiles) {
  const p = path.join(root, '.vectora', 'ledger.json');
  if (!fs.existsSync(p)) return [];
  let d;
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = (d.events || []).filter(e => new Date(e.ts).getTime() > thirtyDaysAgo);

  // "file was flagged as a miss when anchor was edited" — count per (file, anchor)
  const missCounts = new Map();
  for (const ev of recent) {
    for (const item of (ev.items || [])) {
      if (item.type !== 'cochange') continue;
      // detail is "co-changes with <shortPath(anchor)>"
      const anchorShort = item.detail.replace('co-changes with ', '');
      const key = item.file + '|' + anchorShort;
      missCounts.set(key, (missCounts.get(key) || 0) + 1);
    }
  }

  const editedSet = new Set(editedFiles);
  const proposals = [];
  for (const [key, count] of missCounts) {
    if (count < 3) continue;
    const [file, anchorShort] = key.split('|');
    // Only propose if the anchor (by short path) matches one of the files just edited
    const anchorFull = editedFiles.find(ef => ef.endsWith(anchorShort) || shortPath(ef) === anchorShort);
    if (!anchorFull || !editedSet.has(anchorFull)) continue;
    proposals.push({ file, anchor: shortPath(anchorFull), count });
  }
  return proposals.slice(0, 2);
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
// Post-session causal receipt: why each file changed, what was left flagged,
// and the lifetime proof that vectora made a difference. Paste into PR descriptions.

function runManifest({ root = process.cwd() } = {}) {
  let graph = null;
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (fs.existsSync(graphPath)) {
    try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); } catch {}
  }

  let task = '(unknown task — run /vectora map "<task>" before your next session)';
  let lastMapCoChange = [];
  let lastMapSeeds = [];
  const lastMapPath = path.join(root, '.vectora', 'last-map.json');
  if (fs.existsSync(lastMapPath)) {
    try {
      const lm = JSON.parse(fs.readFileSync(lastMapPath, 'utf8'));
      if (lm.task) task = lm.task;
      lastMapCoChange = lm.coChange || [];
      lastMapSeeds = lm.seeds || [];
    } catch {}
  }

  let lifetimeSessions = 0, lifetimeBreaks = 0, lifetimeMisses = 0;
  const ledgerPath = path.join(root, '.vectora', 'ledger.json');
  if (fs.existsSync(ledgerPath)) {
    try {
      const ld = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const evs = ld.events || [];
      lifetimeSessions = evs.length;
      lifetimeBreaks  = evs.reduce((s, e) => s + (e.confirmedBreaks  || 0), 0);
      lifetimeMisses  = evs.reduce((s, e) => s + (e.coChangeMisses   || 0), 0);
    } catch {}
  }

  const edited = getEditedFiles(root, null);
  const editedSet = new Set(edited);

  console.log('[VECTORA MANIFEST]');
  console.log(`Task: ${task}`);
  console.log('');

  if (edited.length === 0) {
    console.log('  No edited source files detected (working tree clean).');
    console.log('[END VECTORA MANIFEST]');
    return;
  }

  const seedSet = new Set(lastMapSeeds);
  const targeted = [];
  const structural = [];
  const notChanged = [];

  if (graph) {
    const byPath = new Map((graph.files || []).map(f => [f.path, f]));

    for (const ed of edited) {
      if (seedSet.has(ed)) {
        targeted.push(ed);
      } else {
        const reasons = [];
        // Was it a co-change partner of a seed?
        for (const c of lastMapCoChange) {
          const partner = c.a === ed ? c.b : c.b === ed ? c.a : null;
          if (partner && editedSet.has(partner)) {
            reasons.push(`co-change with ${shortPath(partner)} (${coChangeLabel(c)})`);
          }
        }
        // Does it import or get imported by a seed?
        const f = byPath.get(ed);
        if (f) {
          const importsTarget = (f.importsResolved || []).filter(i => seedSet.has(i));
          if (importsTarget.length) reasons.push(`imports ${importsTarget.map(shortPath).join(', ')}`);
          const importedByTarget = (f.importedBy || []).filter(i => seedSet.has(i));
          if (importedByTarget.length) reasons.push(`imported by ${importedByTarget.map(shortPath).join(', ')}`);
        }
        structural.push({ file: ed, reason: reasons.length ? reasons.join('; ') : 'changed (reason unknown — run map first)' });
      }
    }

    // Co-change pairs surfaced but NOT edited
    const seen = new Set();
    for (const c of lastMapCoChange) {
      const key = [c.a, c.b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const aEd = editedSet.has(c.a), bEd = editedSet.has(c.b);
      if (aEd !== bEd) {
        notChanged.push({ file: aEd ? c.b : c.a, reason: `co-changes with ${shortPath(aEd ? c.a : c.b)} (${coChangeLabel(c)})` });
      }
    }
    // Graph-derived misses not already in the map list
    for (const ed of edited) {
      const f = byPath.get(ed);
      if (!f) continue;
      for (const peer of (f.coChangePeers || [])) {
        if (!editedSet.has(peer.partner)) {
          const key = [ed, peer.partner].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            notChanged.push({ file: peer.partner, reason: `co-changes with ${shortPath(ed)} (git ${peer.sharedCommits}×)` });
          }
        }
      }
    }
  }

  if (targeted.length) {
    console.log('Directly targeted:');
    for (const f of targeted) console.log(`  ${f}`);
    console.log('');
  }
  if (structural.length) {
    console.log('Changed because of structural coupling:');
    for (const { file, reason } of structural) console.log(`  ${file}  ← ${reason}`);
    console.log('');
  }
  if (notChanged.length) {
    console.log('NOT changed (flagged, unresolved):');
    for (const { file, reason } of notChanged.slice(0, 5)) console.log(`  ${file}  ← ${reason}`);
    console.log('');
  }

  if (graph) {
    let downstream = 0;
    for (const ed of edited) downstream += transitiveDependents(graph, ed).size;
    console.log(`Graph impact: ~${downstream} downstream dependent(s) across ${edited.length} edited file(s)`);
  }
  if (lifetimeSessions > 0) {
    console.log(`Lifetime (this repo): ${lifetimeSessions} session${lifetimeSessions !== 1 ? 's' : ''} · ${lifetimeBreaks} confirmed break${lifetimeBreaks !== 1 ? 's' : ''} caught · ${lifetimeMisses} co-change miss${lifetimeMisses !== 1 ? 'es' : ''} flagged`);
  }

  console.log('[END VECTORA MANIFEST]');
}

// ─── History ──────────────────────────────────────────────────────────────────
// Regression memory: how often a file has appeared in check events, which files
// it was edited with, and which co-change misses keep recurring. The longer you
// use vectora, the smarter this gets about your repo's real coupling patterns.

function runHistory(filepath, { root = process.cwd() } = {}) {
  const ledgerPath = path.join(root, '.vectora', 'ledger.json');
  console.log('[VECTORA HISTORY]');
  if (!fs.existsSync(ledgerPath)) {
    console.log('  no ledger yet — run /vectora check after a task to start tracking.');
    console.log('[END VECTORA HISTORY]');
    return;
  }
  let d;
  try { d = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
  catch { console.log('  could not read ledger.\n[END VECTORA HISTORY]'); return; }

  const events = d.events || [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const lower = filepath.toLowerCase();

  // Events where this file was part of the edited set or flagged in items
  const relevant = events.filter(ev =>
    (ev.editedFiles || []).some(f => f.toLowerCase().includes(lower)) ||
    (ev.items || []).some(i => i.file && i.file.toLowerCase().includes(lower))
  );
  const recent30 = relevant.filter(ev => new Date(ev.ts).getTime() > thirtyDaysAgo);

  if (relevant.length === 0) {
    console.log(`  "${filepath}" has not appeared in the ledger yet.`);
    console.log('[END VECTORA HISTORY]');
    return;
  }

  console.log(`  ${filepath}`);
  console.log(`  Changed in ${recent30.length} task${recent30.length !== 1 ? 's' : ''} (last 30 days) · ${relevant.length} total.`);
  console.log('');

  // Files co-edited with this file
  const coEditCounts = new Map();
  for (const ev of recent30) {
    const others = (ev.editedFiles || []).filter(f => !f.toLowerCase().includes(lower));
    for (const f of others) coEditCounts.set(f, (coEditCounts.get(f) || 0) + 1);
  }
  if (coEditCounts.size) {
    const sorted = [...coEditCounts.entries()].sort((a, b) => b[1] - a[1]);
    const total = recent30.length;
    console.log('  Files edited in the same sessions:');
    for (const [f, count] of sorted.slice(0, 6)) {
      const freq = count === total ? '(always)' : count >= total * 0.7 ? '(usually)' : '(sometimes)';
      console.log(`    ${f.padEnd(52)} ${count}/${total} sessions  ${freq}`);
    }
    console.log('');
  }

  // Co-change misses involving this file
  const missCounts = new Map();
  for (const ev of recent30) {
    for (const item of (ev.items || [])) {
      if (item.type !== 'cochange') continue;
      const anchor = item.detail.replace('co-changes with ', '');
      if (item.file.toLowerCase().includes(lower) || anchor.toLowerCase().includes(lower)) {
        const miss = item.file.toLowerCase().includes(lower) ? anchor : item.file;
        missCounts.set(miss, (missCounts.get(miss) || 0) + 1);
      }
    }
  }
  if (missCounts.size) {
    console.log('  Co-change misses (flagged but not edited):');
    for (const [f, count] of [...missCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      console.log(`    ${f.padEnd(52)} flagged ${count}×`);
    }
    console.log('');
    const topMiss = [...missCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topMiss[1] >= 3) {
      console.log(`  This pair keeps recurring. To bake it into memory:`);
      console.log(`  /vectora learn "${filepath} always needs update when ${topMiss[0]} changes"`);
    }
  }

  console.log('[END VECTORA HISTORY]');
}

// ─── Preflight ────────────────────────────────────────────────────────────────
// Pre-session situational awareness: open misses from last session, graph
// staleness, global architectural constraints, and danger zone inventory.
// Run before starting a new task to catch unresolved business from last time.

function runPreflight({ root = process.cwd() } = {}) {
  console.log('[VECTORA PREFLIGHT]');

  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.log('⚠ No graph found — run `npx vectora init` to activate vectora.');
    console.log('[END VECTORA PREFLIGHT]');
    return;
  }
  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch { console.log('⚠ Could not read graph.json — run `npx vectora init`.\n[END VECTORA PREFLIGHT]'); return; }

  const config = mergeConfig(loadConfig(root));
  let hasWarnings = false;

  // 1. Graph staleness
  const ageHours = graph.generated
    ? (Date.now() - new Date(graph.generated).getTime()) / 3600000
    : Infinity;
  if (ageHours > config.refreshAfterHours) {
    console.log(`⚠ Graph is ${Math.round(ageHours)}h old — run \`npx vectora diff\` for a fast update.`);
    hasWarnings = true;
  } else {
    console.log(`✓ Graph is current (built ${Math.round(ageHours)}h ago).`);
  }

  // 2. Open co-change misses from last session
  const ledgerPath = path.join(root, '.vectora', 'ledger.json');
  if (fs.existsSync(ledgerPath)) {
    try {
      const ld = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const evs = ld.events || [];
      const lastEv = evs[evs.length - 1];
      if (lastEv && (lastEv.coChangeMisses > 0 || lastEv.confirmedBreaks > 0)) {
        const misses = (lastEv.items || []).filter(i => i.type === 'cochange' || i.type === 'break');
        console.log(`⚠ ${misses.length} unresolved item${misses.length !== 1 ? 's' : ''} from last session:`);
        for (const m of misses.slice(0, 4)) {
          console.log(`    ${m.file}  — ${m.detail}`);
        }
        hasWarnings = true;
      } else {
        console.log('✓ No open items from last session.');
      }
    } catch {}
  }

  // 3. Global architectural rules from decisions.json
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  if (fs.existsSync(decisionsPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
      const globals = d.global || [];
      if (globals.length) {
        console.log(`✓ ${globals.length} global constraint${globals.length !== 1 ? 's' : ''} active (will surface in map when relevant).`);
      }
    } catch {}
  }

  // 4. Danger zone inventory
  const filesWithDanger = (graph.files || []).filter(f => f.dangerZones && f.dangerZones.length > 0);
  if (filesWithDanger.length) {
    console.log(`✓ ${filesWithDanger.length} file${filesWithDanger.length !== 1 ? 's have' : ' has'} @vectora danger annotations — surfaced automatically in map.`);
  }

  // 5. Circular imports
  const cycles = detectCycles(graph);
  if (cycles.length) {
    console.log(`⚠ ${cycles.length} circular import${cycles.length !== 1 ? 's' : ''} in the graph — editing these files may cause unexpected behavior.`);
    hasWarnings = true;
  }

  if (!hasWarnings) {
    console.log('✓ All clear — ready to start a new task.');
  }

  console.log('[END VECTORA PREFLIGHT]');
}

// ─── Impact Report ────────────────────────────────────────────────────────────
// 30-day summary: what vectora caught, files flagged most often, sessions count.
// The shareable receipt that answers "was this worth installing?"

function runImpactReport({ root = process.cwd() } = {}) {
  const ledgerPath = path.join(root, '.vectora', 'ledger.json');
  console.log('[VECTORA IMPACT-REPORT]');
  if (!fs.existsSync(ledgerPath)) {
    console.log('  no ledger yet — run /vectora check after a task to start tracking.');
    console.log('[END VECTORA IMPACT-REPORT]');
    return;
  }
  let d;
  try { d = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
  catch { console.log('  could not read ledger.\n[END VECTORA IMPACT-REPORT]'); return; }

  const events = d.events || [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = events.filter(e => new Date(e.ts).getTime() > thirtyDaysAgo);

  const totals = { confirmedBreaks: 0, coChangeMisses: 0, callerWarnings: 0, staleTests: 0 };
  const fileCounts = new Map();
  const allEditedFiles = new Set();

  for (const e of recent) {
    totals.confirmedBreaks += e.confirmedBreaks || 0;
    totals.coChangeMisses  += e.coChangeMisses  || 0;
    totals.callerWarnings  += e.callerWarnings  || 0;
    totals.staleTests      += e.staleTests      || 0;
    for (const item of (e.items || [])) fileCounts.set(item.file, (fileCounts.get(item.file) || 0) + 1);
    for (const f of (e.editedFiles || [])) allEditedFiles.add(f);
  }

  const grand = totals.confirmedBreaks + totals.coChangeMisses + totals.callerWarnings + totals.staleTests;
  const monthStr = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const W = 63;
  const pad = (s) => String(s).padEnd(W);

  console.log(`╔─ vectora 30-day report · ${monthStr} ${'─'.repeat(Math.max(0, W - monthStr.length - 20))}╗`);
  console.log(`│ ${pad(`${recent.length} session${recent.length !== 1 ? 's' : ''}  ·  ${allEditedFiles.size} distinct file${allEditedFiles.size !== 1 ? 's' : ''} edited`)}│`);
  console.log(`│ ${pad('')}│`);
  if (grand === 0) {
    console.log(`│ ${pad('  No incomplete edits flagged this period.')}│`);
  } else {
    console.log(`│ ${pad('What vectora surfaced:')}│`);
    if (totals.confirmedBreaks) console.log(`│ ${pad(`  ✗ ${totals.confirmedBreaks} confirmed break${totals.confirmedBreaks !== 1 ? 's' : ''} caught  (would have failed at runtime)`)}│`);
    if (totals.coChangeMisses)  console.log(`│ ${pad(`  ⚠ ${totals.coChangeMisses} co-change link${totals.coChangeMisses !== 1 ? 's' : ''} used  (files edited after vectora flagged them)`)}│`);
    if (totals.callerWarnings)  console.log(`│ ${pad(`  ⚠ ${totals.callerWarnings} caller${totals.callerWarnings !== 1 ? 's' : ''} warned`)}│`);
    if (totals.staleTests)      console.log(`│ ${pad(`  ⚠ ${totals.staleTests} stale test${totals.staleTests !== 1 ? 's' : ''} flagged`)}│`);
  }

  if (fileCounts.size > 0) {
    const topFile = [...fileCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`│ ${pad('')}│`);
    console.log(`│ ${pad(`Highest-risk file: ${shortPath(topFile[0])}  (flagged ${topFile[1]}×)`)}│`);
  }
  console.log('╚' + '─'.repeat(W + 2) + '╝');

  if (grand > 0) {
    console.log('');
    console.log(`  In 30 days, vectora flagged ${grand} incomplete edit${grand !== 1 ? 's' : ''} across ${recent.length} session${recent.length !== 1 ? 's' : ''}.`);
    if (totals.confirmedBreaks) {
      console.log(`  ${totals.confirmedBreaks} of those were proven arity breaks that would have failed at runtime.`);
    }
  }

  console.log('[END VECTORA IMPACT-REPORT]');
}

// ─── Coupling Debt ────────────────────────────────────────────────────────────
// Scored pair list: co-change frequency × shared imports − test coverage.
// Makes "high coupling" concrete and trackable as a team metric.

function runOverviewDebt({ root = process.cwd() } = {}) {
  const graph = loadGraphForTask(root, 'overview');
  if (!graph) return;
  const files = graph.files || [];
  const observed = loadObserved(root);
  const byPath = new Map(files.map(f => [f.path, f]));

  const pairMap = new Map(); // sorted "a|b" -> entry

  const ensurePair = (a, b) => {
    const key = [a, b].sort().join('|');
    if (!pairMap.has(key)) pairMap.set(key, { a: [a, b].sort()[0], b: [a, b].sort()[1], coChange: 0, sessionChange: 0, sharedImports: 0, hasTests: false });
    return pairMap.get(key);
  };

  // Git co-change pairs
  for (const f of files) {
    for (const peer of (f.coChangePeers || [])) {
      const e = ensurePair(f.path, peer.partner);
      e.coChange = Math.max(e.coChange, peer.sharedCommits || 0);
    }
  }
  // Session-observed pairs
  for (const [key, count] of Object.entries(observed.pairs || {})) {
    const [a, b] = key.split('|');
    if (!a || !b) continue;
    const e = ensurePair(a, b);
    e.sessionChange = Math.max(e.sessionChange, count);
  }
  // Shared import edges + test coverage
  for (const [, e] of pairMap) {
    const fa = byPath.get(e.a), fb = byPath.get(e.b);
    if (!fa || !fb) continue;
    const aImports = new Set(fa.importsResolved || []);
    const bImports = new Set(fb.importsResolved || []);
    let shared = 0;
    for (const imp of aImports) { if (bImports.has(imp)) shared++; }
    if (aImports.has(e.b) || bImports.has(e.a)) shared += 2;
    e.sharedImports = shared;
    e.hasTests = !!(fa.testPath || fb.testPath);
  }

  const scored = [...pairMap.values()]
    .map(e => ({ ...e, score: ((e.coChange + e.sessionChange) * 3) + (e.sharedImports * 2) - (e.hasTests ? 5 : 0) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);

  console.log('[VECTORA COUPLING DEBT]');
  if (scored.length === 0) {
    console.log('  No coupling debt detected — no co-change pairs found.');
    console.log('[END VECTORA COUPLING DEBT]');
    return;
  }

  console.log('  Highest-risk pairs (co-change × shared imports − test coverage):');
  console.log('');
  for (const e of scored.slice(0, 8)) {
    console.log(`  ${shortPath(e.a)} ↔ ${shortPath(e.b)}   debt: ${e.score}`);
    const parts = [];
    if (e.coChange) parts.push(`git co-change: ${e.coChange}×`);
    if (e.sessionChange) parts.push(`sessions: ${e.sessionChange}×`);
    if (e.sharedImports) parts.push(`shared imports: ${e.sharedImports}`);
    parts.push(e.hasTests ? 'has tests ✓' : 'no test coverage ✗');
    console.log(`    ${parts.join('  ·  ')}`);
    console.log('');
  }
  console.log(`  ${scored.length} pair${scored.length !== 1 ? 's' : ''} total. Reduce debt: add tests for high-scoring pairs, or /vectora learn to document the coupling.`);
  console.log('[END VECTORA COUPLING DEBT]');
}

// ─── File Parsing ─────────────────────────────────────────────────────────────

function getFileLanguage(filepath) {
  const ext = path.extname(filepath);
  const MAP = { '.js': 'js', '.jsx': 'js', '.ts': 'ts', '.tsx': 'ts',
                '.py': 'py', '.go': 'go', '.rs': 'rs', '.rb': 'rb' };
  return MAP[ext] || 'unknown';
}

/**
 * Parses a source file. Dispatches to the appropriate language parser.
 * Returns { imports, exports, allIdentifiers, stringLiterals, commentTerms,
 *           lineCount, charCount, manualPivot } or null on failure.
 */
function parseFile(filepath) {
  let raw;
  try { raw = fs.readFileSync(filepath, 'utf8'); }
  catch { console.warn(`vectora: could not read ${filepath} — skipped`); return null; }

  const ext = path.extname(filepath);

  let result;
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) result = parseBabel(raw, filepath);
  else if (ext === '.py') result = parsePython(raw, filepath);
  else if (ext === '.go') result = parseGo(raw, filepath);
  else if (ext === '.rs') result = parseRust(raw, filepath);
  else if (ext === '.rb') result = parseRuby(raw, filepath);
  else result = parseGeneric(raw, filepath);

  // Extract @vectora danger annotations from any language (// or # comment styles).
  // Done here so all parsers get it for free without touching each one.
  if (result) {
    const dangerZones = [];
    DANGER_ANNOTATION_RE.lastIndex = 0;
    for (const m of raw.matchAll(DANGER_ANNOTATION_RE)) {
      const text = m[1].trim();
      if (text) dangerZones.push(text);
    }
    result.dangerZones = dangerZones;
  }
  return result;
}

function parsePython(raw, filepath) {
  try { return require('./parsers/python').parsePython(raw, filepath); }
  catch { return parseGeneric(raw, filepath); }
}

function parseGo(raw, filepath) {
  try { return require('./parsers/go').parseGo(raw, filepath); }
  catch { return parseGeneric(raw, filepath); }
}

function parseRust(raw, filepath) {
  try { return require('./parsers/rust').parseRust(raw, filepath); }
  catch { return parseGeneric(raw, filepath); }
}

function parseRuby(raw, filepath) {
  // Inline lightweight Ruby parser
  const imports = [], exports = [], allIdentifiers = [], stringLiterals = [], commentTerms = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trim = line.trim();
    const reqRel = trim.match(/^require_relative\s+['"]([^'"]+)['"]/);
    if (reqRel) imports.push('./' + reqRel[1]);
    const req = trim.match(/^require\s+['"]([^'"]+)['"]/);
    if (req && !req[1].startsWith('.')) imports.push(req[1]);
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      const defMatch = trim.match(/^def\s+(?:self\.)?([a-zA-Z][a-zA-Z0-9_]*)/);
      if (defMatch && !defMatch[1].startsWith('_')) exports.push(defMatch[1]);
      const classMatch = trim.match(/^class\s+([A-Z][a-zA-Z0-9_]*)/);
      if (classMatch) exports.push(classMatch[1]);
    }
    for (const m of (trim.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]{3,})\b/g) || [])) allIdentifiers.push(m[1].toLowerCase());
    for (const m of (trim.matchAll(/"([^"]{4,80})"|'([^']{4,80})'/g) || [])) stringLiterals.push((m[1]||m[2]||'').trim());
    const hashIdx = trim.indexOf('#');
    if (hashIdx !== -1) {
      for (const word of (trim.slice(hashIdx+1).match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || [])) commentTerms.push(word.toLowerCase());
    }
  }
  const idFreq = new Map();
  for (const id of allIdentifiers) idFreq.set(id, (idFreq.get(id) || 0) + 1);
  return {
    imports: [...new Set(imports)], exports: [...new Set(exports)],
    allIdentifiers: [...idFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([id])=>id),
    stringLiterals: stringLiterals.slice(0,20), commentTerms: [...new Set(commentTerms)].slice(0,40),
    lineCount: lines.length, charCount: raw.length,
    manualPivot: /^[ \t]*#[ \t]*@vectora[ \t]+pivot[ \t]*$/m.test(raw),
  };
}

function parseGeneric(raw, filepath) {
  // Tier 4: symbol grep fallback — extract definition-like patterns from any text file
  const lines = raw.split('\n');
  const imports = [], exports = [], allIdentifiers = [], stringLiterals = [], commentTerms = [];
  const DEFINITION_RE = /\b(?:function|def|func|fn|class|struct|interface|type|sub|method)\s+([A-Za-z][A-Za-z0-9_]{2,})/g;
  for (const m of (raw.matchAll(DEFINITION_RE) || [])) exports.push(m[1]);
  for (const line of lines) {
    for (const m of (line.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]{4,})\b/g) || [])) allIdentifiers.push(m[1].toLowerCase());
    for (const m of (line.matchAll(/"([^"]{4,80})"|'([^']{4,80})'/g) || [])) {
      const val = (m[1]||m[2]||'').trim();
      if (val) stringLiterals.push(val);
    }
  }
  const idFreq = new Map();
  for (const id of allIdentifiers) idFreq.set(id, (idFreq.get(id) || 0) + 1);
  return {
    imports, exports: [...new Set(exports)],
    allIdentifiers: [...idFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([id])=>id),
    stringLiterals: stringLiterals.slice(0,20), commentTerms,
    lineCount: lines.length, charCount: raw.length, manualPivot: false,
  };
}

/**
 * Parses JS/TS files via Babel AST. Extracts ESM + CJS imports/exports,
 * plus all identifier names, string literals, and comment terms.
 */
function parseBabel(raw, filepath) {
  const manualPivot = MANUAL_PIVOT_RE.test(raw);
  const lineCount = raw.split('\n').length;

  let ast;
  try {
    const parser = require('@babel/parser');
    ast = parser.parse(raw, {
      sourceType: 'module',
      strictMode: false,
      plugins: ['typescript', ['jsx', { throwIfNamespace: false }], 'importAssertions', 'decorators-legacy'],
    });
  } catch {
    console.warn(`vectora: parse error in ${path.basename(filepath)} — skipped`);
    return null;
  }

  const imports = [];
  const exports = [];
  const allIdentifiers = [];
  const stringLiterals = [];
  const signatures = new Map(); // symbol name -> { required, max, hasRest }

  const recordSig = (name, params) => {
    if (name && Array.isArray(params) && !signatures.has(name)) signatures.set(name, arityOf(params));
  };

  walkAst(ast.program, (node) => {
    // Function/method/arrow signatures, keyed by their bound name. Used at
    // `check` time to confirm caller arity breaks (not just guess).
    if (node.type === 'FunctionDeclaration' && node.id?.name) recordSig(node.id.name, node.params);
    if (node.type === 'VariableDeclarator' && node.id?.name &&
        (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression')) {
      recordSig(node.id.name, node.init.params);
    }
    if ((node.type === 'ClassMethod' || node.type === 'ObjectMethod') && node.key?.name) {
      recordSig(node.key.name, node.params);
    }
    // `exports.foo = function(...)` / `module.exports.foo = (...) =>`
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' &&
        node.left.property?.name &&
        (node.right?.type === 'FunctionExpression' || node.right?.type === 'ArrowFunctionExpression')) {
      recordSig(node.left.property.name, node.right.params);
    }

    // ESM imports
    if (node.type === 'ImportDeclaration') { imports.push(node.source.value); return; }

    // ESM named exports
    if (node.type === 'ExportNamedDeclaration') {
      for (const spec of node.specifiers ?? []) { if (spec.exported?.name) exports.push(spec.exported.name); }
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.id?.name) exports.push(decl.id.name);
        for (const d of decl.declarations ?? []) { if (d.id?.name) exports.push(d.id.name); }
      }
      return;
    }

    // ESM default export
    if (node.type === 'ExportDefaultDeclaration') {
      exports.push(node.declaration?.id?.name || 'default');
      return;
    }

    // CJS require()
    if (node.type === 'CallExpression' && node.callee?.name === 'require' && node.arguments?.[0]?.type === 'StringLiteral') {
      imports.push(node.arguments[0].value);
      return;
    }

    // CJS module.exports
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression') {
      const obj = node.left.object, prop = node.left.property;
      if (obj?.type === 'MemberExpression' && obj.object?.name === 'module' && obj.property?.name === 'exports' && prop?.name) {
        exports.push(prop.name); return;
      }
      if (obj?.name === 'module' && prop?.name === 'exports' && node.right?.type === 'ObjectExpression') {
        for (const p of node.right.properties ?? []) { const key = p.key?.name || p.key?.value; if (key) exports.push(key); }
        return;
      }
      if (obj?.name === 'exports' && prop?.name) { exports.push(prop.name); }
    }

    // All identifiers (semantic vocabulary)
    if (node.type === 'Identifier' && node.name && node.name.length >= 4) {
      if (!PROGRAMMING_STOPWORDS.has(node.name) && !PROGRAMMING_STOPWORDS.has(node.name.toLowerCase())) {
        allIdentifiers.push(node.name.toLowerCase());
      }
    }

    // String literals — route paths, error messages
    if (node.type === 'StringLiteral' && node.value && node.value.length >= 4 && node.value.length <= 80) {
      if (!node.value.includes('\n') && !/^[{[\s]/.test(node.value)) {
        stringLiterals.push(node.value);
      }
    }
    if (node.type === 'TemplateLiteral') {
      for (const quasi of node.quasis || []) {
        const val = quasi.value?.cooked || quasi.value?.raw || '';
        if (val.length >= 4 && val.length <= 80 && !val.includes('\n')) stringLiterals.push(val);
      }
    }
  });

  // Comments from raw source (AST loses them)
  const commentTerms = [];
  for (const m of (raw.matchAll(/\/\/([^\n]+)|\/\*([\s\S]*?)\*\//g) || [])) {
    const comment = (m[1] || m[2] || '').trim();
    for (const word of (comment.match(/[a-zA-Z][a-zA-Z0-9]{3,}/g) || [])) {
      const lower = word.toLowerCase();
      if (!PROGRAMMING_STOPWORDS.has(lower)) commentTerms.push(lower);
    }
  }

  // Deduplicate identifiers, keep top 40 by frequency
  const idFreq = new Map();
  for (const id of allIdentifiers) idFreq.set(id, (idFreq.get(id) || 0) + 1);
  const topIds = [...idFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([id])=>id);

  // Keep only signatures of names that are actually exported — that's all
  // `check` can reason about from another file's call sites.
  const exportSet = new Set(exports);
  const exportSignatures = {};
  for (const [name, sig] of signatures) {
    if (exportSet.has(name)) exportSignatures[name] = sig;
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    exportSignatures,
    allIdentifiers: topIds,
    stringLiterals: stringLiterals.slice(0, 20),
    commentTerms: [...new Set(commentTerms)].slice(0, 40),
    lineCount,
    charCount: raw.length,
    manualPivot,
  };
}

// Arity of a parameter list: how many leading args are required (before the
// first default/optional), the max positional count, and whether it ends in a
// rest param. A call passing fewer than `required` real args is a hard break.
function arityOf(params) {
  let required = 0, max = 0, hasRest = false, stillRequired = true;
  for (const p of params || []) {
    if (p.type === 'RestElement') { hasRest = true; continue; }
    max++;
    const optional = p.type === 'AssignmentPattern' || p.optional === true;
    if (optional) stillRequired = false;
    else if (stillRequired) required++;
  }
  return { required, max, hasRest };
}

// Parse JS/TS source to a Babel AST with vectora's standard plugin set, or null.
function astFor(raw) {
  try {
    return require('@babel/parser').parse(raw, {
      sourceType: 'module',
      strictMode: false,
      plugins: ['typescript', ['jsx', { throwIfNamespace: false }], 'importAssertions', 'decorators-legacy'],
    });
  } catch { return null; }
}

// ─── AST Walk ─────────────────────────────────────────────────────────────────

function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (Array.isArray(child)) { for (const c of child) walkAst(c, fn); }
    else if (child && typeof child === 'object' && child.type) { walkAst(child, fn); }
  }
}

// ─── File Classification ──────────────────────────────────────────────────────

function isBarrelFile(f) {
  // A barrel file re-exports everything and has no own logic
  return (
    f.exports.length > 0 &&
    f.imports.length > 0 &&
    f.imports.every(i => i.startsWith('.')) &&
    f.lineCount < 50 &&
    (f.allIdentifiers || []).length < 8
  );
}

function isConfigFile(f) {
  const name = path.basename(f.path);
  return /\b(constants?|config|settings?|env|vars?|defaults?|conf)\b/i.test(name);
}

// ─── Co-Change Graph ──────────────────────────────────────────────────────────

// Returns { peerMap, pairs }.
//   peerMap: path → [{ partner, sharedCommits }]  (top peers per file, for clustering + map)
//   pairs:   [{ a, b, sharedCommits }]             (deduped, for the receipt / co-change list)
// Commits touching more than `maxFiles` source files are dropped — mega-refactors and
// "format everything" commits create false co-change links and are the main noise source.
function buildCoChangePeers(parsedFiles, root, maxFiles = 15) {
  const empty = { peerMap: new Map(), pairs: [] };
  let commits = [];
  const known = new Set(parsedFiles.map(f => f.path));
  try {
    const out = execSync('git log --name-only --pretty=format:"" -n 300', {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).toString();
    // Each commit block is separated by blank lines
    const blocks = out.split(/\n\n+/);
    for (const block of blocks) {
      const files = block.split('\n')
        .map(l => l.trim().replace(/^"|"$/g, ''))
        .filter(l => l.length > 0 && SOURCE_EXTENSIONS.test(l) && known.has(l));
      // Drop sprawling commits — they imply nothing about which files truly belong together.
      if (files.length >= 2 && files.length <= maxFiles) commits.push(files);
    }
  } catch { return empty; }

  if (commits.length === 0) return empty;

  const coChangeCounts = new Map();
  for (const files of commits) {
    const uniq = [...new Set(files)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const key = [uniq[i], uniq[j]].sort().join('|');
        coChangeCounts.set(key, (coChangeCounts.get(key) || 0) + 1);
      }
    }
  }

  const pairs = [];
  const peerMap = new Map(parsedFiles.map(f => [f.path, []]));
  for (const [key, count] of coChangeCounts) {
    const [a, b] = key.split('|');
    pairs.push({ a, b, sharedCommits: count });
    if (peerMap.has(a)) peerMap.get(a).push({ partner: b, sharedCommits: count });
    if (peerMap.has(b)) peerMap.get(b).push({ partner: a, sharedCommits: count });
  }
  for (const peers of peerMap.values()) {
    peers.sort((x, y) => y.sharedCommits - x.sharedCommits);
  }
  pairs.sort((x, y) => y.sharedCommits - x.sharedCommits);
  return { peerMap, pairs };
}

function clusterByCoChange(flatFiles, coChangePeers) {
  // Simple greedy clustering: seed with the file that has the most co-change peers
  const clusters = new Map(); // filepath → clusterName
  let clusterIdx = 0;

  for (const f of flatFiles) {
    if (clusters.has(f.path)) continue;
    const peers = (coChangePeers.get(f.path) || []).map(p => p.partner);
    if (peers.length === 0) {
      clusters.set(f.path, `domain_${clusterIdx++}`);
      continue;
    }
    // Find if any peer already has a cluster
    let assigned = null;
    for (const peer of peers) {
      if (clusters.has(peer)) { assigned = clusters.get(peer); break; }
    }
    const label = assigned || `domain_${clusterIdx++}`;
    clusters.set(f.path, label);
    // Assign all peers to the same cluster
    for (const peer of peers) {
      if (!clusters.has(peer)) clusters.set(peer, label);
    }
  }
  return clusters;
}

// ─── Centrality ───────────────────────────────────────────────────────────────

// ─── TS / Alias Resolution ────────────────────────────────────────────────────

// Reads tsconfig.json (or jsconfig.json as fallback) and extracts path alias
// config: baseUrl (absolute) and paths map. Follows one level of local `extends`
// so child config overrides parent — npm-package extends are skipped silently.
function loadTsConfig(root, tsConfigPath) {
  const NAMES = tsConfigPath
    ? [tsConfigPath]
    : ['tsconfig.json', 'jsconfig.json'];

  const parseJsonc = (raw) =>
    JSON.parse(
      raw
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,(\s*[}\]])/g, '$1')
    );

  const readOne = (filePath) => {
    try {
      return parseJsonc(fs.readFileSync(filePath, 'utf8'));
    } catch { return null; }
  };

  for (const name of NAMES) {
    const filePath = path.isAbsolute(name) ? name : path.join(root, name);
    const tc = readOne(filePath);
    if (!tc) continue;

    // Merge parent config if `extends` is a local file (not an npm package)
    let parentOpts = {};
    const ext = tc.extends;
    if (ext && (ext.startsWith('.') || ext.startsWith('/'))) {
      const parentPath = path.resolve(path.dirname(filePath), ext.endsWith('.json') ? ext : ext + '.json');
      const parent = readOne(parentPath);
      if (parent && parent.compilerOptions) parentOpts = parent.compilerOptions;
    }

    const opts = { ...parentOpts, ...(tc.compilerOptions || {}) };
    const baseUrl = opts.baseUrl ? path.resolve(path.dirname(filePath), opts.baseUrl) : null;
    const paths = opts.paths || {};
    return { baseUrl, paths };
  }
  return { baseUrl: null, paths: {} };
}

// Reads root package.json `workspaces` and returns a Map from package name to
// { dir (absolute), main (relative entry) }. Handles both array and
// { packages: [...] } forms. Expands simple `prefix/*` globs via readdirSync;
// falls back to minimatch for complex patterns (minimatch is already a dep).
function loadWorkspacePackages(root) {
  const pkgPath = path.join(root, 'package.json');
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { return new Map(); }

  const workspacesRaw = pkg.workspaces;
  if (!workspacesRaw) return new Map();

  const patterns = Array.isArray(workspacesRaw) ? workspacesRaw : (workspacesRaw.packages || []);
  const map = new Map();

  const addPkgDir = (dir) => {
    const subPkg = path.join(dir, 'package.json');
    if (!fs.existsSync(subPkg)) return;
    let sp;
    try { sp = JSON.parse(fs.readFileSync(subPkg, 'utf8')); } catch { return; }
    if (!sp.name) return;
    // Resolve entry point: prefer module > main > index
    const mainEntry = sp.exports?.['.']?.import || sp.exports?.['.']?.default
      || sp.exports?.['.'] || sp.module || sp.main || 'index';
    const mainStr = typeof mainEntry === 'string' ? mainEntry : 'index';
    map.set(sp.name, { dir, main: mainStr.replace(/^\.\//, '') });
  };

  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      const dir = path.join(root, pattern);
      if (fs.existsSync(dir)) addPkgDir(dir);
      continue;
    }
    // Simple `prefix/*` glob — expand with readdirSync
    const parts = pattern.split('/');
    const starIdx = parts.indexOf('*');
    if (starIdx !== -1) {
      const prefix = path.join(root, ...parts.slice(0, starIdx));
      try {
        for (const entry of fs.readdirSync(prefix, { withFileTypes: true })) {
          if (entry.isDirectory()) addPkgDir(path.join(prefix, entry.name));
        }
      } catch {}
    }
  }
  return map;
}

// Shared extension-probing logic for both relative and alias resolution.
// Tries: exact → strip-JS-ext+TS-ext → append-exts → /index.*
function probeExtensions(resolved, allPaths) {
  if (allPaths.has(resolved)) return resolved;

  const jsExt = resolved.match(/\.(js|jsx|mjs|cjs)$/);
  if (jsExt) {
    const base = resolved.slice(0, -jsExt[0].length);
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      if (allPaths.has(base + ext)) return base + ext;
    }
  }
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb']) {
    if (allPaths.has(resolved + ext)) return resolved + ext;
  }
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    if (allPaths.has(path.join(resolved, 'index') + ext)) return path.join(resolved, 'index') + ext;
  }
  return null;
}

// Resolves a non-relative import (alias or workspace package) to an absolute
// path in allPaths. Returns null for genuine external npm packages.
function resolveAlias(importSource, allPaths, { baseUrl, paths, workspacePackages }) {
  // 1. tsconfig `paths` patterns — e.g. "@/*" → ["./src/*"]
  for (const [pattern, targets] of Object.entries(paths || {})) {
    // Escape regex special chars except `*`, then replace `*` with a capture group
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)') + '$');
    const m = importSource.match(re);
    if (!m) continue;
    for (const target of (Array.isArray(targets) ? targets : [targets])) {
      const expanded = target.replace(/\*/g, m[1]);
      const base = baseUrl
        ? path.resolve(baseUrl, expanded)
        : path.resolve(expanded);
      const hit = probeExtensions(base, allPaths);
      if (hit) return hit;
    }
  }

  // 2. baseUrl bare resolution — `import 'utils/format'` when baseUrl is set
  if (baseUrl) {
    const base = path.resolve(baseUrl, importSource);
    const hit = probeExtensions(base, allPaths);
    if (hit) return hit;
  }

  // 3. Workspace package names — `import '@myorg/shared'` or `'@myorg/shared/utils'`
  if (workspacePackages) {
    for (const [pkgName, { dir, main }] of workspacePackages) {
      if (importSource === pkgName) {
        const hit = probeExtensions(path.resolve(dir, main), allPaths)
          || probeExtensions(path.join(dir, 'index'), allPaths);
        if (hit) return hit;
      } else if (importSource.startsWith(pkgName + '/')) {
        const sub = importSource.slice(pkgName.length + 1);
        const hit = probeExtensions(path.resolve(dir, sub), allPaths);
        if (hit) return hit;
      }
    }
  }

  return null;
}

function resolveImport(importer, importSource, allPaths, aliases = {}) {
  if (!importSource.startsWith('.')) {
    // Try alias/workspace resolution before giving up on non-relative imports
    return resolveAlias(importSource, allPaths, aliases);
  }
  const dir = path.dirname(importer);
  return probeExtensions(path.resolve(dir, importSource), allPaths);
}

function computeCentrality(parsedFiles, aliases = {}) {
  const allPaths = new Set(parsedFiles.map(f => f.fullPath));
  const inDegree  = new Map(parsedFiles.map(f => [f.fullPath, 0]));
  const outDegree = new Map(parsedFiles.map(f => [f.fullPath, 0]));
  // Resolved edges keyed by fullPath: imports = forward, importedBy = reverse.
  const imports     = new Map(parsedFiles.map(f => [f.fullPath, []]));
  const importedBy  = new Map(parsedFiles.map(f => [f.fullPath, []]));

  for (const f of parsedFiles) {
    const visited = new Set();
    for (const imp of f.imports) {
      const resolved = resolveImport(f.fullPath, imp, allPaths, aliases);
      if (!resolved || visited.has(resolved)) continue;
      visited.add(resolved);
      outDegree.set(f.fullPath, (outDegree.get(f.fullPath) ?? 0) + 1);
      inDegree.set(resolved, (inDegree.get(resolved) ?? 0) + 1);
      imports.get(f.fullPath).push(resolved);
      importedBy.get(resolved).push(f.fullPath);
    }
  }
  return { inDegree, outDegree, imports, importedBy };
}

// ─── Domain Inference ─────────────────────────────────────────────────────────

function inferDomain(relative, configDomains, framework) {
  // Layer 1: user-configured globs
  if (configDomains) {
    try {
      const { minimatch } = require('minimatch');
      for (const [domainName, pattern] of Object.entries(configDomains)) {
        if (minimatch(relative, pattern, { matchBase: true })) return domainName;
      }
    } catch {}
    return 'root';
  }

  // Layer 2: framework-specific rules
  if (framework === 'nextjs') {
    // app/(group)/domain/page.tsx → domain
    const m1 = relative.match(/^(?:src\/)?app\/(?:\([^)]+\)\/)?([^/]+)\//);
    if (m1 && !['(', '['].includes(m1[1][0])) return m1[1];
    // pages/domain/... → domain
    const m2 = relative.match(/^(?:src\/)?pages\/([^/]+)\//);
    if (m2) return m2[1];
  }
  if (framework === 'django') {
    // appname/models.py → appname
    const m = relative.match(/^([^/]+)\/(models|views|urls|forms|admin|serializers|signals)\.py/);
    if (m) return m[1];
  }
  if (framework === 'nestjs') {
    // src/auth/auth.module.ts → auth
    const m = relative.match(/^(?:src\/)?([^/]+)\//);
    if (m && m[1] !== 'src') return m[1];
  }

  // Layer 3: standard src/domain/ folder structure
  const parts = relative.split(path.sep);
  if (parts[0] === 'src' && parts.length > 2) return parts[1];
  if (parts.length > 1) return parts[0];

  // Layer 4: filename as domain (last resort — keep extension to match old behaviour)
  return path.basename(relative);
}

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * Builds domain vocabulary from all 5 semantic signals, weighted by TF-IDF
 * distinctiveness. Terms that appear only in this domain score highest.
 */
function buildVocabulary(domainFiles, allDomainFilesMap) {
  // Collect all terms from all 5 signals for this domain
  const domainTermFreq = new Map();

  const addTerms = (terms) => {
    for (const t of terms) {
      if (t && t.length >= 3 && !PROGRAMMING_STOPWORDS.has(t)) {
        domainTermFreq.set(t, (domainTermFreq.get(t) || 0) + 1);
      }
    }
  };

  for (const f of domainFiles) {
    // Signal 1: all identifiers
    addTerms(f.allIdentifiers || []);

    // Signal 3: string literals (tokenized)
    for (const str of (f.stringLiterals || [])) addTerms(tokenize(str));

    // Signal 4: comment terms
    addTerms(f.commentTerms || []);

    // Signal 5: path segments + exports + file stem
    addTerms(tokenize(f.path));
    addTerms((f.exports || []).flatMap(e => tokenize(e)));
  }

  // TF-IDF: compute how many domains contain each term
  const domainCount = allDomainFilesMap ? Object.keys(allDomainFilesMap).length : 1;
  const termDomainCount = new Map();
  if (allDomainFilesMap) {
    for (const [, dFiles] of Object.entries(allDomainFilesMap)) {
      const domainTerms = new Set();
      for (const f of dFiles) {
        for (const t of [
          ...(f.allIdentifiers || []),
          ...(f.commentTerms || []),
          ...tokenize(f.path),
          ...(f.exports || []).flatMap(e => tokenize(e)),
        ]) { if (t && t.length >= 3) domainTerms.add(t); }
      }
      for (const t of domainTerms) termDomainCount.set(t, (termDomainCount.get(t) || 0) + 1);
    }
  }

  // Score each term: TF × IDF
  const scored = [];
  for (const [term, tf] of domainTermFreq) {
    const domainsWithTerm = termDomainCount.get(term) || 1;
    const idf = Math.log(domainCount / domainsWithTerm + 1);
    scored.push({ term, score: tf * idf });
  }
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 60).map(s => s.term);
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(str) {
  if (!str) return [];
  const decamel = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  const deseparated = decamel.replace(/[_\-]/g, ' ');
  return deseparated
    .toLowerCase()
    .split(/[\s/\\.,:;'"!?()[\]{}|<>@#+*=~`]+/)
    .filter(t => t.length >= 3 && !PROGRAMMING_STOPWORDS.has(t));
}

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig(root) {
  const configPath = path.join(root, 'vectora.config.js');
  let raw;
  try { raw = require(configPath); } catch { return {}; }

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

function mergeConfig(userConfig) {
  return {
    pivotThreshold: userConfig.pivotThreshold ?? 0.15,
    refreshAfterHours: userConfig.refreshAfterHours ?? 24,
    refreshAfterChanges: userConfig.refreshAfterChanges ?? 10,
    forcePivots: userConfig.forcePivots ?? [],
    exclude: userConfig.exclude ?? [],
    domains: userConfig.domains ?? null,
    coChangeMaxFiles: userConfig.coChangeMaxFiles ?? 15,
    configDownweight: userConfig.configDownweight ?? true,
    tsConfigPath: userConfig.tsConfigPath ?? null,
    observedDecayDays: userConfig.observedDecayDays ?? 90,
  };
}

// ─── File Walking ─────────────────────────────────────────────────────────────

function walkDir(dir, root, config, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

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

// Directory + stem key for a path, e.g. src/charge.ts → "src/charge". Used to
// pair a source file with its colocated test by location, not just name.
function stemKey(relative) {
  const dir = path.dirname(relative);
  const base = path.basename(relative).replace(SOURCE_EXTENSIONS, '');
  return dir === '.' ? base : `${dir}/${base}`;
}

// Walks the tree for colocated test files (foo.test.ts, foo.spec.js, …) and maps
// each back to the stem key of the source file it tests. These are NOT added to
// the graph — they exist only so `check` can flag "you changed X but not its test".
function findColocatedTests(root, config, dir = root, map = new Map()) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return map; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      findColocatedTests(root, config, fullPath, map);
    } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      const relative = path.relative(root, fullPath);
      if (isExcluded(relative, config.exclude)) continue;
      // foo.test.ts → stem key src/foo
      const base = path.basename(relative).replace(/\.(test|spec|stories)\.(js|jsx|ts|tsx|py|go|rs|rb)$/, '');
      const d = path.dirname(relative);
      map.set(d === '.' ? base : `${d}/${base}`, relative);
    }
  }
  return map;
}

function isExcluded(relative, patterns) {
  if (!patterns || patterns.length === 0) return false;
  try {
    const { minimatch } = require('minimatch');
    return patterns.some(p => minimatch(relative, p, { matchBase: true }));
  } catch { return false; }
}

// ─── Git Utilities ────────────────────────────────────────────────────────────

function getGitHash(root) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim();
  } catch { return null; }
}

function getChangedFileCount(root, fromHash) {
  try {
    const out = execSync(`git diff --name-only ${fromHash} HEAD`, {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim();
    return out ? out.split('\n').filter(f => SOURCE_EXTENSIONS.test(f)).length : 0;
  } catch { return 0; }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  main,
  runInit,
  runDiff,
  runMap,
  runCheck,
  findSeeds,
  findSpecSeeds,
  findPromptConstraint,
  expandNeighborhood,
  runStatus,
  runWhy,
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
  detectProjectType,
  isBarrelFile,
  isConfigFile,
  buildCoChangePeers,
  collectCallerWarnings,
  coChangeLabel,
  runImpact,
  runOverview,
  runTrace,
  transitiveDependents,
  detectCycles,
  findColocatedTests,
  stemKey,
  loadObserved,
  observedPeersMap,
  recordObserved,
  recordLedger,
  runReceipts,
  confirmCallerBreaks,
  extractCallArgs,
  arityOf,
  detectRegressionPatterns,
  runManifest,
  runHistory,
  runPreflight,
  runImpactReport,
  runOverviewDebt,
  runMigrate,
  detectSignificantEvent,
  loadTsConfig,
  loadWorkspacePackages,
  probeExtensions,
  resolveAlias,
  splitTasks,
  classifyRouting,
  collectDecisions,
  groupEditedByTask,
  box,
};

if (require.main === module) main();
