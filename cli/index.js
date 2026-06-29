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

const VALID_CONFIG_FIELDS = new Set([
  'pivotThreshold', 'refreshAfterHours', 'refreshAfterChanges',
  'forcePivots', 'exclude', 'domains', 'tokenBudget', 'languages',
  'barrelsAsSkeletons', 'configDownweight',
]);

const SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|go|rs|rb)$/;

const SKILL_SRC = path.join(__dirname, '..', 'skill', 'SKILL.src.md');

// ─── Package → Domain Signal Table ───────────────────────────────────────────
// External package imports are the strongest domain signal — a file importing
// 'stripe' is definitively in the payments domain, regardless of folder structure.

const PACKAGE_DOMAIN_SIGNALS = {
  // Auth / Security
  bcrypt: 'auth', bcryptjs: 'auth', argon2: 'auth', 'node-argon2': 'auth',
  jsonwebtoken: 'auth', passport: 'auth', 'passport-jwt': 'auth',
  'passport-local': 'auth', 'passport-google-oauth20': 'auth',
  jose: 'auth', 'express-jwt': 'auth', speakeasy: 'auth',
  otplib: 'auth', 'node-2fa': 'auth',

  // Payments
  stripe: 'payments', paypal: 'payments', 'paypal-rest-sdk': 'payments',
  braintree: 'payments', square: 'payments', '@adyen/api-library': 'payments',
  razorpay: 'payments', cashfree: 'payments',

  // Database / ORM
  pg: 'database', mysql2: 'database', sqlite3: 'database', 'better-sqlite3': 'database',
  sequelize: 'database', '@prisma/client': 'database', prisma: 'database',
  mongoose: 'database', typeorm: 'database', knex: 'database',
  'drizzle-orm': 'database', mikro_orm: 'database', objection: 'database',

  // Cache / Session
  redis: 'cache', ioredis: 'cache', memcached: 'cache',
  'express-session': 'session', 'connect-redis': 'session', 'cookie-session': 'session',

  // Email / Notifications
  nodemailer: 'email', '@sendgrid/mail': 'email', 'mailgun-js': 'email',
  '@mailchimp/mailchimp_marketing': 'email', postmark: 'email',
  twilio: 'notifications', '@slack/web-api': 'notifications',
  'firebase-admin': 'notifications',

  // Storage / Uploads
  multer: 'uploads', sharp: 'images', jimp: 'images', '@aws-sdk/client-s3': 'storage',
  cloudinary: 'storage', minio: 'storage', '@google-cloud/storage': 'storage',

  // Queue / Background Jobs
  bull: 'jobs', bullmq: 'jobs', agenda: 'jobs', 'node-cron': 'jobs', bee_queue: 'jobs',

  // Search
  '@elastic/elasticsearch': 'search', algoliasearch: 'search', meilisearch: 'search',

  // Logging / Monitoring
  winston: 'logging', pino: 'logging', morgan: 'logging', bunyan: 'logging',
  '@sentry/node': 'monitoring', newrelic: 'monitoring',

  // HTTP / API clients
  axios: 'api', 'node-fetch': 'api', got: 'api', superagent: 'api',

  // Python equivalents (package names as imported)
  PyJWT: 'auth', cryptography: 'auth', 'python-jose': 'auth',
  'stripe-python': 'payments', paypalrestsdk: 'payments',
  psycopg2: 'database', pymysql: 'database', sqlalchemy: 'database',
  motor: 'database', pymongo: 'database', 'django-orm': 'database',
  celery: 'jobs', rq: 'jobs', boto3: 'storage', 'azure-storage-blob': 'storage',

  // Go/Rust crate signals (first path segment)
  'golang.org/x/crypto': 'auth', 'github.com/golang-jwt': 'auth',
  'github.com/stripe/stripe-go': 'payments',
  'github.com/go-redis/redis': 'cache', 'github.com/jackc/pgx': 'database',
};

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

// ─── Main Dispatcher ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const subcmd = args[0];

  if (subcmd === 'install' || !subcmd) {
    runInstall({ silent: false });
  } else if (subcmd === 'watch') {
    runWatch();
  } else if (subcmd === 'init' || subcmd === '--reset') {
    let step = null;
    let getPivots = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--step') step = args[i+1];
      if (args[i] === '--get-pivots') getPivots = true;
    }
    if (step === 'math') {
      runInitMath();
    } else if (getPivots) {
      runInitGetPivots();
    } else {
      if (!runInit()) process.exit(1);
    }
  } else if (subcmd === 'enrich') {
    const type = args[1];
    const mapping = args.slice(2).join(' ');
    runEnrich(type, mapping);
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
  } else if (subcmd === 'brief') {
    const task = args.slice(1).join(' ');
    if (!task) { console.error('vectora brief: provide a task description'); process.exit(1); }
    runBrief(task);
  } else if (subcmd === 'why') {
    const filepath = args.slice(1).join(' ');
    if (!filepath) { console.error('vectora why: provide a file path'); process.exit(1); }
    runWhy(filepath);
  } else if (subcmd === '--help' || subcmd === '-h') {
    printHelp();
  } else {
    console.error(`vectora: unknown command "${subcmd}". Run vectora --help.`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
vectora — structural codebase navigation for AI coding agents

Commands:
  vectora install            Install the skill into detected AI agent(s) (default)
  vectora init               Build the mathematical graph (or run specific steps)
  vectora diff               Fast incremental graph update (git-based)
  vectora status             Show graph state and staleness
  vectora doctor             Run system health check and configuration validation
  vectora learn "<rule>"     Add an architectural rule to decisions.json
  vectora unlearn "<rule>"   Remove an architectural rule from decisions.json
  vectora brief "<task>"     Generate context brief for a task
  vectora why <filepath>     Explain why a file is or isn't a pivot
  vectora watch              Watch for file changes, rebuild automatically
  vectora install            Explicitly install the skill into detected AI agent(s)
  vectora --reset            Force a full rescan (alias for init)
  vectora --help             Show this message

Use /vectora prompt <task> inside your AI agent to navigate and execute.
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
    console.log(`✓ vectora: open your agent and type '/vectora init' to build the semantic substrate`);
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
  return `You are handling a \`/vectora $ARGUMENTS\` command. This command is part of the vectora skill — follow the full skill protocol.

**Entry sequence (required before any keyword logic):**
1. Check \`.vectora/dirty\` — if present, run \`npx vectora diff\` to reload the graph, then delete the file.
2. Confirm the graph is current.

**Then act on the keyword in $ARGUMENTS:**

**No argument or "init"**
- Output: \`↺ vectora: rebuilding graph...\`
- Run \`npx vectora init\` and wait for completion — output its lines verbatim
- Note: next task brief will show a "↺ graph refreshed" row

**"diff"**
Run \`npx vectora diff\` — fast incremental update. Output result verbatim.

**"status"**
Run \`npx vectora status\` — output result verbatim. Append session total from working memory.

**"watch"**
Run \`npx vectora watch\` in the background. Confirm it started.

**"why <filepath>"**
Run \`npx vectora why <filepath>\` — output result verbatim.

**"prompt <task>"**
The recommended pairing pattern. Extract everything after "prompt" as the task.
Run \`npx vectora brief "<task>"\`. Emit banner verbatim. Load files. Execute. Show savings.

**Unknown keyword**
List available: \`init\`, \`diff\`, \`status\`, \`watch\`, \`why <filepath>\`, \`prompt <task>\`, \`help\`.
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
  console.log('╔─ vectora status ──────────────────────────────────────╗');
  console.log(`│ files:   ${pad(fileCount + '  ·  language: ' + lang, 44)}│`);
  console.log(`│ pivots:  ${pad(pivotCount + '   (' + pivotPct + '% of codebase)', 44)}│`);
  console.log(`│ domains: ${pad(domains.length > 44 ? domains.slice(0,41)+'...' : domains, 44)}│`);
  console.log(`│ built:   ${pad(built, 44)}│`);
  console.log(`│ git:     ${pad(gitHash + '  ·  stale: ' + stale, 44)}│`);
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

  const importedBy = (graph.files || [])
    .filter(other => (other.imports || []).some(imp => imp.includes(path.basename(f.path, path.extname(f.path)))))
    .map(other => other.path)
    .slice(0, 4)
    .join(', ') || 'none';

  const importsLocal = (f.imports || [])
    .filter(i => i.startsWith('.'))
    .slice(0, 4)
    .join(', ') || 'none';

  const pad = (s, n) => String(s).padEnd(n);
  const header = `─ vectora why: ${f.path} `;
  console.log(`╔${header}${'─'.repeat(Math.max(0, 54 - header.length))}╗`);
  console.log(`│ centrality:  ${pad(f.centralityScore + '  (in: ' + (f.inDegree||0) + ', out: ' + (f.outDegree||0) + ')', 40)}│`);
  console.log(`│ pivot:       ${pad(f.isPivot ? 'yes' : 'no', 40)}│`);
  console.log(`│ reason:      ${pad(reason.length > 40 ? reason.slice(0,37)+'...' : reason, 40)}│`);
  console.log(`│ domain:      ${pad(f.domain || 'unknown', 40)}│`);
  console.log(`│ imported by: ${pad(importedBy.length > 40 ? importedBy.slice(0,37)+'...' : importedBy, 40)}│`);
  console.log(`│ imports:     ${pad(importsLocal.length > 40 ? importsLocal.slice(0,37)+'...' : importsLocal, 40)}│`);
  console.log(`╚${'─'.repeat(54)}╝`);
}

// ─── Init & Enrichment ────────────────────────────────────────────────────────

function runInitMath({ root = process.cwd() } = {}) {
  // Build the basic graph and output raw clusters
  if (!runInit({ silent: true, root })) {
    console.error('vectora init --step math failed.');
    process.exit(1);
  }
  const graphPath = path.join(root, '.vectora', 'graph.json');
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  console.log('--- RAW CLUSTERS ---');
  for (const [domainName, domainObj] of Object.entries(graph.domains || {})) {
    console.log(`Cluster: ${domainName}`);
    console.log(`Files: ${domainObj.pivots?.slice(0, 5).join(', ')} ...`);
  }
}

function runInitGetPivots({ root = process.cwd() } = {}) {
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (!fs.existsSync(graphPath)) return;
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  console.log('--- TOP PIVOTS ---');
  for (const [domainName, domainObj] of Object.entries(graph.domains || {})) {
    if (domainObj.pivots && domainObj.pivots.length > 0) {
      console.log(`Domain [${domainName}]:`);
      for (const p of domainObj.pivots.slice(0, 3)) {
        console.log(`  ${p}`);
      }
    }
  }
}

function runEnrich(type, mappingRaw, { root = process.cwd() } = {}) {
  const graphPath = path.join(root, '.vectora', 'graph.json');
  if (!fs.existsSync(graphPath)) return;
  let graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

  let mapping = {};
  try {
    mapping = JSON.parse(mappingRaw);
  } catch (e) {
    console.error('vectora enrich: invalid JSON mapping');
    process.exit(1);
  }

  if (type === 'domains') {
    // mapping is { oldClusterName: newSemanticName }
    const newDomains = {};
    for (const [oldName, newName] of Object.entries(mapping)) {
      if (graph.domains[oldName]) {
        newDomains[newName] = graph.domains[oldName];
      }
    }
    // Update files domainLabel
    for (const file of graph.files) {
      if (mapping[file.domain]) file.domain = mapping[file.domain];
    }
    // Keep unmapped ones
    for (const [name, obj] of Object.entries(graph.domains)) {
      if (!mapping[name]) newDomains[name] = obj;
    }
    graph.domains = newDomains;
    console.log('vectora enrich: domains updated successfully.');

  } else if (type === 'edges') {
    // mapping is { "file/A.js": ["file/B.js"] }
    for (const file of graph.files) {
      if (mapping[file.path]) {
        file.semanticEdges = mapping[file.path];
      }
    }
    console.log('vectora enrich: semantic edges updated successfully.');
  }

  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf8');
}

function runInit({ silent = false, root = process.cwd() } = {}) {
  const config = mergeConfig(loadConfig(root));
  const projectType = detectProjectType(root);
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

  // Build co-change peers from git history (supplementary, non-blocking)
  const coChangePeers = buildCoChangePeers(parsed, root);

  // Compute centrality from import edges
  const { inDegree, outDegree } = computeCentrality(parsed);

  // Classify barrel and config files before scoring
  const allPathsSet = new Set(parsed.map(f => f.fullPath));

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
    isPivot: (topPaths.has(f.fullPath) || f.manualPivot || forcePivotSet.has(f.fullPath) ||
              isFrameworkForcedPivot(f, projectType.framework)) && !f.isBarrel,
    manualPivot: f.manualPivot || forcePivotSet.has(f.fullPath),
    isBarrel: f.isBarrel,
    isConfig: f.isConfig,
    centralityScore: f.centralityScore,
    inDegree: f.inDegree,
    outDegree: f.outDegree,
    lineCount: f.lineCount,
    charCount: f.charCount,
    exports: f.exports,
    imports: f.imports,
    packageSignals: getPackageSignals(f.imports || []),
    allIdentifiers: f.allIdentifiers || [],
    stringLiterals: f.stringLiterals || [],
    commentTerms: f.commentTerms || [],
    coChangePeers: f.coChangePeers,
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
    const domainList = Object.keys(domains).join(', ');
    // Box inner width = 63 chars (between │ and │), total box = 65 chars
    const W = 63;
    const pad = (s) => String(s).padEnd(W);
    const trunc = (s) => s.length > W ? s.slice(0, W - 3) + '...' : s;
    console.log('╔─ vectora ─────────────────────────────────────────────────────╗');
    console.log(`│ ${pad('↺ graph built')}│`);
    console.log(`│ ${pad('files:    ' + files.length + '  ·  ' + projectType.label)}│`);
    console.log(`│ ${pad('pivots:   ' + totalPivots + '  (' + Math.round((totalPivots/files.length)*100) + '%)')}│`);
    console.log(`│ ${pad('domains:  ' + trunc(domainList))}│`);
    console.log('╚───────────────────────────────────────────────────────────────╝');
    console.log('');
    console.log(`  Use /vectora prompt <task> to start navigating with full context.`);
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

  const currentHash = getGitHash(root);
  if (!currentHash || currentHash === graph.gitHash) {
    // Check dirty flag
    const dirtyPath = path.join(root, '.vectora', 'dirty');
    if (!fs.existsSync(dirtyPath)) {
      if (!silent) console.log('vectora: graph is current — nothing to update');
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
    if (!silent) console.log('vectora: graph is current — nothing to update');
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

  const { inDegree, outDegree } = computeCentrality(newParsedForCentrality);
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
      packageSignals: getPackageSignals(source.imports || []),
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

  if (!silent) console.log(`done (${changedFiles.length} files updated)`);
  return true;
}

// ─── Brief ────────────────────────────────────────────────────────────────────

function runBrief(task, { root = process.cwd() } = {}) {
  const graphPath = path.join(root, '.vectora', 'graph.json');

  // Auto-heal: check dirty flag and stale graph before generating brief
  const dirtyPath = path.join(root, '.vectora', 'dirty');
  if (fs.existsSync(dirtyPath)) {
    runDiff({ silent: true, root });
    try { fs.rmSync(dirtyPath, { force: true }); } catch {}
  }

  if (!fs.existsSync(graphPath)) {
    // Bootstrap: degraded banner
    console.log('[VECTORA BRIEF]');
    console.log('╔─ vectora ─────────────────────────────────────────────╗');
    console.log('│ ⚠ no graph — run `npx vectora init` to activate      │');
    console.log('│ mode:      degraded (navigation disabled)             │');
    console.log('╚───────────────────────────────────────────────────────╝');
    console.log('');
    console.log('skeleton_pool: 0');
    console.log('PROPAGATION: prepend this brief to sub-agent prompts for coding tasks.');
    console.log('[END VECTORA BRIEF]');
    return;
  }

  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch {
    console.error('vectora brief: failed to parse graph.json — run `npx vectora init`');
    process.exit(1);
  }

  // Staleness check: silently diff if stale
  if (graph.gitHash) {
    try {
      const current = execSync('git rev-parse HEAD', {
        cwd: root, stdio: ['ignore','pipe','ignore'], timeout: 2000
      }).toString().trim();
      if (current !== graph.gitHash) {
        runDiff({ silent: true, root });
        try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); } catch {}
      }
    } catch {}
  }

  const config = mergeConfig(loadConfig(root));
  const TOKEN_BUDGET = config.tokenBudget || 2000;

  // Detect if task is chained (multiple distinct sub-tasks)
  const subTasks = detectChain(task);

  if (subTasks && subTasks.length >= 2) {
    emitChainedBrief(task, subTasks, graph, TOKEN_BUDGET, root);
  } else {
    emitSingleBrief(task, graph, TOKEN_BUDGET, root);
  }
}

function detectChain(task) {
  // Split on clear chaining signals: ", then", "; then", "after that", numbered list
  const patterns = [
    /,\s+then\s+/i,
    /;\s+(?:then\s+)?/,
    /\s+and\s+then\s+/i,
    /\s+after\s+(?:that|which),?\s+/i,
    /\s+(?:next|following\s+that),?\s+/i,
    /\.\s+(?=[A-Z](?:dd|efactor|ix|pdate|reate|emove))/,
  ];
  for (const pat of patterns) {
    const parts = task.split(pat).map(p => p.trim()).filter(p => p.length > 4);
    if (parts.length >= 2) return parts;
  }
  return null;
}

function scoreFile(f, taskTokens, taskLower) {
  let score = 0;
  const filename = path.basename(f.path);
  const stem = path.basename(f.path, path.extname(f.path));

  // Signal 1: explicit path or filename in task text
  if (taskLower.includes(f.path.toLowerCase())) score += 1.0;
  else if (taskLower.includes(filename.toLowerCase())) score += 0.8;

  // Signal 2: file stem token overlap
  const stemTokens = tokenize(stem);
  if (stemTokens.length > 0) {
    let hits = 0;
    for (const t of stemTokens) { if (taskTokens.has(t)) hits++; }
    score += (hits / stemTokens.length) * 0.5;
  }

  // Signal 3: export name overlap
  const exps = f.exports || [];
  let expHits = 0;
  for (const exp of exps) {
    for (const t of tokenize(exp)) { if (taskTokens.has(t)) { expHits++; break; } }
  }
  score += Math.min(expHits * 0.1, 0.4);

  // Signal 4: directory path segment overlap
  const segments = f.path.split('/').slice(0, -1);
  for (const seg of segments) {
    for (const t of tokenize(seg)) { if (taskTokens.has(t)) { score += 0.15; break; } }
  }

  // Signal 5: package domain signal overlap
  for (const pkgDomain of (f.packageSignals || [])) {
    if (taskTokens.has(pkgDomain)) score += 0.3;
  }

  // Signal 6: identifier overlap (new — semantic vocabulary)
  for (const id of (f.allIdentifiers || [])) {
    if (taskTokens.has(id)) { score += 0.08; }
  }

  // Signal 7: string literal overlap (route paths, error messages)
  for (const str of (f.stringLiterals || [])) {
    for (const t of tokenize(str)) { if (taskTokens.has(t)) { score += 0.06; break; } }
  }

  // Signal 8: comment term overlap
  for (const term of (f.commentTerms || [])) {
    if (taskTokens.has(term)) { score += 0.04; }
  }

  // Signal 9: small pivot bonus as tie-breaker
  if (f.isPivot) score += 0.05;

  return score;
}

function selectFiles(scored, TOKEN_BUDGET) {
  const FULL_LOAD_CAP = 12;

  // Dynamic threshold: on small repos (<= 10 files), lower the bar so
  // the top-scoring file is always included when it has ANY relevance.
  // On larger repos, keep the 0.2 floor to avoid loading irrelevant files.
  const maxScore = scored.length > 0 ? scored[0]._score : 0;
  let FULL_LOAD_THRESHOLD = 0.2;
  if (scored.length <= 10 && maxScore > 0 && maxScore < FULL_LOAD_THRESHOLD) {
    // Lower threshold to half the max score, minimum 0.03
    FULL_LOAD_THRESHOLD = Math.max(maxScore * 0.5, 0.03);
  }

  let fullLoadFiles = scored.filter(f => f._score >= FULL_LOAD_THRESHOLD);

  // Apply token budget
  let budgetUsed = 0;
  const budgetedFullLoad = [];
  for (const f of fullLoadFiles) {
    const cost = Math.floor(f.charCount / 4);
    if (budgetUsed + cost <= TOKEN_BUDGET) {
      budgetedFullLoad.push(f);
      budgetUsed += cost;
    }
    if (budgetedFullLoad.length >= FULL_LOAD_CAP) break;
  }
  fullLoadFiles = budgetedFullLoad;

  // Fallback: no strong matches at all
  if (fullLoadFiles.length === 0) {
    const weakMatches = scored.filter(f => f._score > 0);
    const pool = weakMatches.length > 0 ? weakMatches : scored;
    let b = 0;
    for (const f of pool.slice(0, FULL_LOAD_CAP)) {
      const cost = Math.floor(f.charCount / 4);
      if (b + cost > TOKEN_BUDGET) break;
      fullLoadFiles.push(f);
      b += cost;
    }
  }

  const fullLoadPaths = new Set(fullLoadFiles.map(f => f.path));
  const fullLoadDirs  = new Set(fullLoadFiles.map(f => path.dirname(f.path)));

  const SKELETON_CAP = 25;
  const skeletonFiles = scored
    .filter(f => !fullLoadPaths.has(f.path))
    .filter(f => f._score > 0 || fullLoadDirs.has(path.dirname(f.path)))
    .slice(0, SKELETON_CAP);

  // Barrels always appear in skeletons if they're in the matched domain
  for (const f of scored) {
    if (f.isBarrel && !fullLoadPaths.has(f.path) && !skeletonFiles.find(s => s.path === f.path)) {
      if (fullLoadDirs.has(path.dirname(f.path))) skeletonFiles.push(f);
    }
  }

  // Follow semantic edges: if a file is fully loaded, pull its semantic edges into skeletons
  for (const f of fullLoadFiles) {
    if (f.semanticEdges && Array.isArray(f.semanticEdges)) {
      for (const edgePath of f.semanticEdges) {
        if (!fullLoadPaths.has(edgePath) && !skeletonFiles.find(s => s.path === edgePath)) {
          const edgeFile = scored.find(s => s.path === edgePath);
          if (edgeFile) skeletonFiles.push(edgeFile);
        }
      }
    }
  }

  return { fullLoadFiles, skeletonFiles, budgetUsed };
}

function computeSkeletonPool(skeletonFiles) {
  return skeletonFiles.reduce((sum, f) => sum + Math.max(0, Math.floor(f.charCount / 4) - 30), 0);
}

function matchDomain(scored) {
  const domainCounts = {};
  for (const f of scored.filter(f => f._score > 0).slice(0, 10)) {
    domainCounts[f.domain] = (domainCounts[f.domain] || 0) + f._score;
  }
  const all = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  const isFallback = all.length === 0;
  return {
    label: isFallback ? 'fallback (all pivots)' : all.map(([d]) => d).join(', '),
    isFallback,
  };
}

function fmtTok(n) { return `~${n} tok`; }

function printDecisions(root, domains) {
  const decisionsPath = path.join(root, '.vectora', 'decisions.json');
  if (!fs.existsSync(decisionsPath)) return;
  
  let d;
  try { d = JSON.parse(fs.readFileSync(decisionsPath, 'utf8')); }
  catch { return; }

  const rules = [];
  if (d.global && Array.isArray(d.global)) {
    for (const rule of d.global) rules.push(`  - [global] ${rule}`);
  }
  
  if (d.domains && typeof d.domains === 'object') {
    for (const domain of domains) {
      const domainRules = d.domains[domain];
      if (domainRules && Array.isArray(domainRules)) {
        for (const rule of domainRules) rules.push(`  - [${domain}] ${rule}`);
      }
    }
  }

  if (rules.length > 0) {
    console.log('');
    console.log('INSTITUTIONAL MEMORY (Must follow):');
    for (const rule of rules) console.log(rule);
  }
}

// Verb prefixes for skeleton sentence generation — no API call, pure template NLG.
const SKELETON_VERB_MAP = {
  create: 'creates', generate: 'generates', build: 'builds', make: 'makes',
  get: 'gets', fetch: 'fetches', load: 'loads', read: 'reads', find: 'finds', query: 'queries',
  set: 'sets', update: 'updates', save: 'saves', write: 'writes', store: 'stores', put: 'puts',
  delete: 'deletes', remove: 'removes', clear: 'clears', purge: 'purges',
  validate: 'validates', verify: 'verifies', check: 'checks', parse: 'parses', assert: 'asserts',
  handle: 'handles', process: 'processes', run: 'runs', execute: 'executes', dispatch: 'dispatches',
  send: 'sends', emit: 'emits', publish: 'publishes', broadcast: 'broadcasts', notify: 'notifies',
  authenticate: 'authenticates', authorize: 'authorizes', login: 'authenticates', sign: 'signs',
  connect: 'connects', init: 'initializes', setup: 'sets up', configure: 'configures', boot: 'boots',
  render: 'renders', format: 'formats', transform: 'transforms', convert: 'converts', map: 'maps',
  log: 'logs', track: 'tracks', monitor: 'monitors', record: 'records',
  hash: 'hashes', encrypt: 'encrypts', decrypt: 'decrypts',
  charge: 'charges', pay: 'pays', refund: 'refunds', cancel: 'cancels',
  register: 'registers', mount: 'mounts', route: 'routes', middleware: 'applies middleware for',
  start: 'starts', stop: 'stops', restart: 'restarts', listen: 'listens',
  upload: 'uploads', download: 'downloads', stream: 'streams',
  schedule: 'schedules', queue: 'queues', retry: 'retries',
};

function buildSkeletonSentence(f) {
  const exps = (f.exports || []).slice(0, 3);
  const pkgs = (f.imports || []).filter(i => !i.startsWith('.')).slice(0, 2);

  // Extract a verb from the first export name by splitting camelCase
  let verb = null;
  for (const exp of exps) {
    const parts = exp.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\W+/);
    for (const p of parts) {
      if (SKELETON_VERB_MAP[p]) { verb = SKELETON_VERB_MAP[p]; break; }
    }
    if (verb) break;
  }

  const expsStr = exps.length ? exps.slice(0, 2).join(', ') : null;
  const pkgsStr = pkgs.length ? `via ${pkgs.join(', ')}` : '';

  if (verb && expsStr) return `${verb} ${expsStr}${pkgsStr ? ' ' + pkgsStr : ''}`;
  if (expsStr)          return `exports ${expsStr}${pkgsStr ? ' ' + pkgsStr : ''}`;
  if (pkgsStr)          return `uses ${pkgsStr}`;
  return path.basename(f.path, path.extname(f.path));
}

function emitSingleBrief(task, graph, TOKEN_BUDGET, root = process.cwd()) {
  const { files = [] } = graph;
  const taskTokens = new Set(tokenize(task));
  const taskLower = task.toLowerCase();

  const scored = files.map(f => ({ ...f, _score: scoreFile(f, taskTokens, taskLower) }));
  scored.sort((a, b) => b._score - a._score);

  const { fullLoadFiles, skeletonFiles, budgetUsed } = selectFiles(scored, TOKEN_BUDGET);
  const skeletonPool = computeSkeletonPool(skeletonFiles);
  const { label: domainLabel, isFallback } = matchDomain(scored);

  const pivotTok = budgetUsed;
  const savedTok = skeletonPool;

  // ── Emit banner-embedded brief ─────────────────────────────────────────────
  console.log('[VECTORA BRIEF]');
  if (isFallback) {
    console.log('╔─ vectora ─────────────────────────────────────────────╗');
    console.log('│ domain:    fallback (no strong match — all pivots)    │');
    console.log(`│ loaded:    ${String(fullLoadFiles.length + ' pivots (' + fmtTok(pivotTok) + ')').padEnd(44)}│`);
    console.log(`│ skipped:   ${String(skeletonFiles.length + ' files → skeletonized (' + fmtTok(savedTok) + ' saved)').padEnd(44)}│`);
    console.log('╚───────────────────────────────────────────────────────╝');
  } else {
    console.log('╔─ vectora ─────────────────────────────────────────────╗');
    console.log(`│ domain:    ${String(domainLabel).padEnd(44)}│`);
    console.log(`│ loaded:    ${String(fullLoadFiles.length + ' pivots (' + fmtTok(pivotTok) + ')').padEnd(44)}│`);
    console.log(`│ skipped:   ${String(skeletonFiles.length + ' files → skeletonized (' + fmtTok(savedTok) + ' saved)').padEnd(44)}│`);
    console.log('╚───────────────────────────────────────────────────────╝');
  }

  if (fullLoadFiles.some(f => f.manualPivot)) {
    console.log('  ✦ manually declared via @vectora pivot');
  }

  console.log('');
  console.log('LOAD IN FULL:');
  if (fullLoadFiles.length === 0) {
    console.log('  (none — load files by best judgment)');
  } else {
    for (const f of fullLoadFiles) {
      const tokEst = fmtTok(Math.floor(f.charCount / 4));
      const summary = (f.exports || []).slice(0, 3).join(', ') || f.domain;
      console.log(`  ${f.path.padEnd(40)} [${f.lineCount} lines, ${tokEst}]`);
    }
  }

  console.log('');
  console.log('SKELETON ONLY — emit these lines verbatim, do not open the files:');
  if (skeletonFiles.length === 0) {
    console.log('  (none)');
  } else {
    for (const f of skeletonFiles) {
      const savedTokFile = Math.max(0, Math.floor(f.charCount / 4) - 30);
      const barrel = f.isBarrel ? ' [barrel]' : '';
      const sentence = buildSkeletonSentence(f);
      console.log(`  // ${f.path} [${f.lineCount} lines, ~${savedTokFile} tok saved]${barrel} — ${sentence}`);
    }
  }

  printDecisions(root, [domainLabel]);

  console.log('');
  console.log(`skeleton_pool: ${skeletonPool}`);
  console.log('PROPAGATION: prepend this brief to sub-agent prompts for coding tasks.');
  console.log('[END VECTORA BRIEF]');
}

function emitChainedBrief(task, subTasks, graph, TOKEN_BUDGET, root = process.cwd()) {
  const { files = [] } = graph;
  const subTaskResults = [];

  // Score each sub-task independently
  for (const subTask of subTasks) {
    const taskTokens = new Set(tokenize(subTask));
    const taskLower = subTask.toLowerCase();
    const scored = files.map(f => ({ ...f, _score: scoreFile(f, taskTokens, taskLower) }));
    scored.sort((a, b) => b._score - a._score);
    const perBudget = Math.floor(TOKEN_BUDGET / subTasks.length);
    const { fullLoadFiles, skeletonFiles } = selectFiles(scored, perBudget);
    const { label: domainLabel } = matchDomain(scored);
    subTaskResults.push({ subTask, fullLoadFiles, skeletonFiles, domainLabel });
  }

  // Find shared pivots (appear in 2+ sub-tasks)
  const pivotCounts = new Map();
  for (const { fullLoadFiles } of subTaskResults) {
    for (const f of fullLoadFiles) {
      pivotCounts.set(f.path, (pivotCounts.get(f.path) || 0) + 1);
    }
  }
  const sharedPivots = [...pivotCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([p]) => p);
  const sharedPivotSet = new Set(sharedPivots);

  const totalPool = subTaskResults.reduce(
    (sum, { skeletonFiles }) => sum + computeSkeletonPool(skeletonFiles), 0
  );

  // ── Emit chained banner ────────────────────────────────────────────────────
  console.log('[VECTORA BRIEF]');
  console.log('╔─ vectora ───────────────────────────────────────────────╗');
  console.log(`│ chained tasks: ${String(subTasks.length).padEnd(40)}│`);
  if (sharedPivots.length > 0) {
    const spDisplay = sharedPivots.map(p => path.basename(p)).join(', ');
    console.log(`│ shared pivots: ${String(spDisplay.length > 40 ? spDisplay.slice(0,37)+'...' : spDisplay + ' → once').padEnd(40)}│`);
  }
  console.log('│                                                         │');
  for (let i = 0; i < subTaskResults.length; i++) {
    const { fullLoadFiles, skeletonFiles, domainLabel } = subTaskResults[i];
    const pivotTok = fullLoadFiles.reduce((s, f) => s + Math.floor(f.charCount / 4), 0);
    const skTok = computeSkeletonPool(skeletonFiles);
    console.log(`│ [${i+1}/${subTasks.length}] domain: ${String(domainLabel).padEnd(40)}│`);
    console.log(`│       loaded:  ${String(fullLoadFiles.length + ' pivots (' + fmtTok(pivotTok) + ')').padEnd(40)}│`);
    console.log(`│       skipped: ${String(skeletonFiles.length + ' files → skeletonized (' + fmtTok(skTok) + ' saved)').padEnd(40)}│`);
    if (i < subTaskResults.length - 1) console.log('│                                                         │');
  }
  console.log('╚─────────────────────────────────────────────────────────╝');

  if (sharedPivots.length > 0) {
    console.log('');
    console.log('SHARED (load first — do not reload per sub-task):');
    for (const p of sharedPivots) {
      const f = (graph.files || []).find(f => f.path === p);
      if (f) console.log(`  ${f.path.padEnd(40)} [${f.lineCount} lines, ${fmtTok(Math.floor(f.charCount/4))}]`);
    }
  }

  for (let i = 0; i < subTaskResults.length; i++) {
    const { subTask, fullLoadFiles, skeletonFiles } = subTaskResults[i];
    console.log('');
    console.log(`SUB-TASK ${i+1} — ${subTask}`);
    console.log('LOAD IN FULL:');
    const uniqueLoad = fullLoadFiles.filter(f => !sharedPivotSet.has(f.path));
    if (uniqueLoad.length === 0) {
      console.log('  (all pivots are shared — see SHARED above)');
    } else {
      for (const f of uniqueLoad) {
        console.log(`  ${f.path.padEnd(40)} [${f.lineCount} lines, ${fmtTok(Math.floor(f.charCount/4))}]`);
      }
    }
    console.log('SKELETON ONLY:');
    if (skeletonFiles.length === 0) {
      console.log('  (none)');
    } else {
      for (const f of skeletonFiles) {
        const savedTokFile = Math.max(0, Math.floor(f.charCount / 4) - 30);
        const sentence = buildSkeletonSentence(f);
        console.log(`  // ${f.path} [${f.lineCount} lines, ~${savedTokFile} tok saved] — ${sentence}`);
      }
    }
  }

  const allDomains = [...new Set(subTaskResults.map(r => r.domainLabel))];
  printDecisions(root, allDomains);

  console.log('');
  console.log(`skeleton_pool: ${totalPool}`);
  console.log('PROPAGATION: prepend this brief to sub-agent prompts for coding tasks.');
  console.log('[END VECTORA BRIEF]');
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

  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return parseBabel(raw, filepath);
  if (ext === '.py') return parsePython(raw, filepath);
  if (ext === '.go') return parseGo(raw, filepath);
  if (ext === '.rs') return parseRust(raw, filepath);
  if (ext === '.rb') return parseRuby(raw, filepath);

  // Generic fallback for unrecognised extensions
  return parseGeneric(raw, filepath);
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

  walkAst(ast.program, (node) => {
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

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    allIdentifiers: topIds,
    stringLiterals: stringLiterals.slice(0, 20),
    commentTerms: [...new Set(commentTerms)].slice(0, 40),
    lineCount,
    charCount: raw.length,
    manualPivot,
  };
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

function isFrameworkForcedPivot(f, framework) {
  const p = f.path;
  if (framework === 'nextjs') {
    return /\/(page|layout|actions|loading|error|middleware|route)\.(tsx?|jsx?)$/.test(p);
  }
  if (framework === 'django') {
    return /(models|urls|views|settings|serializers|admin)\.py$/.test(p);
  }
  if (framework === 'nestjs') {
    return /\.(module|controller|service|guard|interceptor|pipe)\.(ts|js)$/.test(p);
  }
  if (framework === 'express' || framework === 'fastify' || framework === 'node') {
    return /(index|app|server|router|routes)\.(ts|js)$/.test(p);
  }
  if (framework === 'go') {
    return /(?:^|\/)(main|cmd\/.+)\.go$/.test(p);
  }
  return false;
}

// ─── Package Domain Signals ───────────────────────────────────────────────────

function getPackageSignals(imports) {
  const signals = new Set();
  for (const imp of imports) {
    if (!imp || imp.startsWith('.')) continue;
    const domain = PACKAGE_DOMAIN_SIGNALS[imp];
    if (domain) signals.add(domain);
    // Try first path segment for scoped packages
    const first = imp.split('/')[0];
    if (PACKAGE_DOMAIN_SIGNALS[first]) signals.add(PACKAGE_DOMAIN_SIGNALS[first]);
  }
  return [...signals];
}

// ─── Co-Change Graph ──────────────────────────────────────────────────────────

function buildCoChangePeers(parsedFiles, root) {
  let commits = [];
  try {
    const out = execSync('git log --name-only --pretty=format:"" -n 300', {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).toString();
    // Each commit block is separated by blank lines
    const blocks = out.split(/\n\n+/);
    for (const block of blocks) {
      const files = block.split('\n').map(l => l.trim().replace(/^"/, '')).filter(l => l.length > 0 && SOURCE_EXTENSIONS.test(l));
      if (files.length >= 2) commits.push(files);
    }
  } catch { return new Map(); }

  if (commits.length === 0) return new Map();

  const coChangeCounts = new Map();
  for (const files of commits) {
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = [files[i], files[j]].sort().join('|');
        coChangeCounts.set(key, (coChangeCounts.get(key) || 0) + 1);
      }
    }
  }

  const fileFreq = new Map();
  for (const files of commits) for (const f of files) fileFreq.set(f, (fileFreq.get(f) || 0) + 1);

  const peerMap = new Map();
  for (const f of parsedFiles) {
    const peers = [];
    for (const [key, count] of coChangeCounts) {
      const [a, b] = key.split('|');
      const partner = a === f.path ? b : (b === f.path ? a : null);
      if (!partner) continue;
      const freq = Math.min(fileFreq.get(a) || 1, fileFreq.get(b) || 1);
      peers.push({ partner, score: count / freq });
    }
    peers.sort((a, b) => b.score - a.score);
    peerMap.set(f.path, peers.slice(0, 3).map(p => p.partner));
  }
  return peerMap;
}

function clusterByCoChange(flatFiles, coChangePeers) {
  // Simple greedy clustering: seed with the file that has the most co-change peers
  const clusters = new Map(); // filepath → clusterName
  let clusterIdx = 0;

  for (const f of flatFiles) {
    if (clusters.has(f.path)) continue;
    const peers = coChangePeers.get(f.path) || [];
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

function resolveImport(importer, importSource, allPaths) {
  if (!importSource.startsWith('.')) return null;
  const dir = path.dirname(importer);
  const resolved = path.resolve(dir, importSource);

  if (allPaths.has(resolved)) return resolved;
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb']) {
    const candidate = resolved + ext;
    if (allPaths.has(candidate)) return candidate;
  }
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = path.join(resolved, 'index') + ext;
    if (allPaths.has(candidate)) return candidate;
  }
  return null;
}

function computeCentrality(parsedFiles) {
  const allPaths = new Set(parsedFiles.map(f => f.fullPath));
  const inDegree  = new Map(parsedFiles.map(f => [f.fullPath, 0]));
  const outDegree = new Map(parsedFiles.map(f => [f.fullPath, 0]));

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
    // Signal 1: package domain signals (highest weight — multiply by 5)
    for (const sig of (f.packageSignals || [])) {
      for (let i = 0; i < 5; i++) domainTermFreq.set(sig, (domainTermFreq.get(sig) || 0) + 1);
    }

    // Signal 2: all identifiers
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
          ...(f.packageSignals || []),
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
    tokenBudget: userConfig.tokenBudget ?? 2000,
    barrelsAsSkeletons: userConfig.barrelsAsSkeletons ?? true,
    configDownweight: userConfig.configDownweight ?? true,
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
  runBrief,
  runStatus,
  runWhy,
  tokenize,
  parseFile,
  scoreFile,
  selectFiles,
  detectChain,
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
  getPackageSignals,
  buildCoChangePeers,
};

if (require.main === module) main();
