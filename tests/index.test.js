'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  parseFile,
  scoreFile,
  selectFiles,
  detectChain,
  computeCentrality,
  inferDomain,
  buildVocabulary,
  resolveImport,
  tokenize,
  mergeConfig,
  runInit,
  buildKiroVariant,
  buildOpenCodeVariant,
  buildGeminiVariant,
  stripFrontmatter,
} = require('../cli/index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory with a set of files and return its path. */
function makeTmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectora-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

/** Remove a temp directory recursively. */
function rmTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// parseFile — ESM
// ---------------------------------------------------------------------------

let tmpDir;

{
  tmpDir = makeTmpRepo({
    'src/auth/login.ts': `
import { hash } from 'bcrypt';
import { env } from '../config/env';
export function login(user, pass) {}
export const LOGIN_TIMEOUT = 30;
`,
  });
  const result = parseFile(path.join(tmpDir, 'src/auth/login.ts'));
  assert.ok(result, 'parseFile should succeed on valid TS');
  assert.deepStrictEqual(result.imports, ['bcrypt', '../config/env'], 'ESM imports');
  assert.ok(result.exports.includes('login'), 'exports login');
  assert.ok(result.exports.includes('LOGIN_TIMEOUT'), 'exports LOGIN_TIMEOUT');
  assert.strictEqual(result.manualPivot, false, 'no manual pivot annotation');
  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// parseFile — CommonJS require + module.exports
// ---------------------------------------------------------------------------

{
  tmpDir = makeTmpRepo({
    'src/config.js': `
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

module.exports = {
  connect: function() {},
  disconnect: function() {},
};
`,
  });
  const result = parseFile(path.join(tmpDir, 'src/config.js'));
  assert.ok(result, 'parseFile should succeed on CJS');
  assert.ok(result.imports.includes('fs'), 'CJS import fs');
  assert.ok(result.imports.includes('./lib'), 'CJS import ./lib');
  assert.ok(result.exports.includes('connect'), 'CJS export connect');
  assert.ok(result.exports.includes('disconnect'), 'CJS export disconnect');
  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// parseFile — manualPivot regex (true positive)
// ---------------------------------------------------------------------------

{
  tmpDir = makeTmpRepo({
    'src/engine.ts': `
// @vectora pivot
export function run() {}
`,
  });
  const result = parseFile(path.join(tmpDir, 'src/engine.ts'));
  assert.strictEqual(result.manualPivot, true, 'annotation on its own line → pivot');
  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// parseFile — manualPivot regex (false positives)
// ---------------------------------------------------------------------------

{
  // The annotation as a string literal inside a call expression — must NOT trigger.
  tmpDir = makeTmpRepo({
    'src/parser.js': `
'use strict';
const manualPivot = raw.includes('// @vectora pivot');
module.exports = { manualPivot };
`,
  });
  const result = parseFile(path.join(tmpDir, 'src/parser.js'));
  assert.strictEqual(result.manualPivot, false, 'string literal mention must NOT be a pivot');
  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// resolveImport — exact extension, bare, index
// ---------------------------------------------------------------------------

{
  const allPaths = new Set([
    '/repo/src/auth/login.ts',
    '/repo/src/config/env.ts',
    '/repo/src/config/index.ts',
    '/repo/src/utils.js',
  ]);

  assert.strictEqual(
    resolveImport('/repo/src/auth/login.ts', '../config/env', allPaths),
    '/repo/src/config/env.ts',
    'bare specifier resolves with .ts extension'
  );

  assert.strictEqual(
    resolveImport('/repo/src/auth/login.ts', '../config', allPaths),
    '/repo/src/config/index.ts',
    'directory import resolves to index.ts'
  );

  assert.strictEqual(
    resolveImport('/repo/src/auth/login.ts', '../utils.js', allPaths),
    '/repo/src/utils.js',
    'explicit .js extension (CJS style) resolves exactly'
  );

  assert.strictEqual(
    resolveImport('/repo/src/auth/login.ts', 'bcrypt', allPaths),
    null,
    'external package returns null'
  );
}

// ---------------------------------------------------------------------------
// computeCentrality
// ---------------------------------------------------------------------------

{
  // env.ts is imported by both login.ts and session.ts → high in-degree → pivot
  tmpDir = makeTmpRepo({
    'src/auth/login.ts':   `import { getEnv } from '../config/env';\nexport function login() {}`,
    'src/auth/session.ts': `import { getEnv } from '../config/env';\nexport function session() {}`,
    'src/config/env.ts':   `export function getEnv() {}`,
  });

  const parsed = [
    'src/auth/login.ts',
    'src/auth/session.ts',
    'src/config/env.ts',
  ].map(rel => {
    const fullPath = path.join(tmpDir, rel);
    return { fullPath, path: rel, ...parseFile(fullPath) };
  });

  const { inDegree, outDegree } = computeCentrality(parsed);
  const envPath = path.join(tmpDir, 'src/config/env.ts');
  assert.strictEqual(inDegree.get(envPath), 2, 'env.ts imported by 2 files');
  assert.strictEqual(outDegree.get(envPath), 0, 'env.ts imports nothing local');

  const loginPath = path.join(tmpDir, 'src/auth/login.ts');
  assert.strictEqual(inDegree.get(loginPath), 0, 'login.ts not imported by anyone');
  assert.strictEqual(outDegree.get(loginPath), 1, 'login.ts imports 1 local file');

  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// inferDomain
// ---------------------------------------------------------------------------

{
  assert.strictEqual(inferDomain('src/auth/login.ts', null), 'auth');
  assert.strictEqual(inferDomain('src/payments/charge.ts', null), 'payments');
  assert.strictEqual(inferDomain('bin/vectora.js', null), 'bin');
  assert.strictEqual(inferDomain('cli/index.js', null), 'cli');
  assert.strictEqual(inferDomain('index.js', null), 'index.js');
}

// ---------------------------------------------------------------------------
// runInit — self-index smoke test
// ---------------------------------------------------------------------------

{
  // vectora must index its own CLI and produce a sane, non-degenerate graph.
  const root = path.join(__dirname, '..');
  const graphPath = path.join(root, '.vectora', 'graph.json');

  const ok = runInit({ silent: true, root });
  assert.strictEqual(ok, true, 'runInit returns true for vectora repo');

  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  assert.ok(graph.files.length >= 2, 'at least 2 files indexed');

  const cli = graph.files.find(f => f.path === 'cli/index.js');
  assert.ok(cli, 'cli/index.js is in the graph');
  assert.strictEqual(cli.manualPivot, false, 'cli/index.js must NOT be a false manual pivot');
  assert.ok(cli.isPivot, 'cli/index.js should be the pivot (highest centrality)');
  assert.ok(cli.exports.length > 0, 'cli/index.js exports are detected');

  const examplePollution = graph.files.some(f => f.path.startsWith('example-repo'));
  assert.strictEqual(examplePollution, false, 'example-repo must NOT appear in the graph');

  const nonZero = graph.files.filter(f => f.centralityScore > 0).length;
  assert.ok(nonZero > 0, 'at least one file has nonzero centrality (graph not degenerate)');
}

// ---------------------------------------------------------------------------
// fixture exclusion: test files must not appear in a graph
// ---------------------------------------------------------------------------

{
  tmpDir = makeTmpRepo({
    'src/auth/login.ts':         `export function login() {}`,
    'src/auth/login.test.ts':    `import { login } from './login';\n// test`,
    'src/auth/login.spec.ts':    `import { login } from './login';\n// spec`,
    'src/auth/login.stories.ts': `import { login } from './login';\n// story`,
    'tests/integration.ts':      `export function integration() {}`,
    'example-repo/src/app.ts':   `export function app() {}`,
  });

  runInit({ silent: true, root: tmpDir });
  const graph = JSON.parse(fs.readFileSync(path.join(tmpDir, '.vectora', 'graph.json'), 'utf8'));
  const paths = graph.files.map(f => f.path);

  assert.ok(paths.includes('src/auth/login.ts'), 'source file indexed');
  assert.ok(!paths.some(p => p.includes('.test.')), '.test. files excluded');
  assert.ok(!paths.some(p => p.includes('.spec.')), '.spec. files excluded');
  assert.ok(!paths.some(p => p.includes('.stories.')), '.stories. files excluded');
  assert.ok(!paths.some(p => p.startsWith('tests/')), 'tests/ dir excluded');
  assert.ok(!paths.some(p => p.startsWith('example-repo/')), 'example-repo/ excluded');

  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// buildKiroVariant / buildOpenCodeVariant / buildGeminiVariant
// ---------------------------------------------------------------------------

{
  const body = 'Read the graph first.\n';

  const kiro = buildKiroVariant(body);
  assert.ok(kiro.startsWith('---\n'), 'Kiro variant has YAML frontmatter');
  assert.ok(kiro.includes('alwaysApply: false'), 'Kiro variant has alwaysApply: false');
  assert.ok(kiro.includes(body), 'Kiro variant includes body');

  const opencode = buildOpenCodeVariant(body);
  assert.ok(opencode.startsWith('---\n'), 'OpenCode variant has YAML frontmatter');
  assert.ok(opencode.includes('alwaysApply: false'), 'OpenCode variant has alwaysApply: false');

  const gemini = buildGeminiVariant(body);
  assert.ok(!gemini.startsWith('---'), 'Gemini variant has no frontmatter');
  assert.strictEqual(gemini, body, 'Gemini variant is plain body');
}

// ---------------------------------------------------------------------------
// postinstall smoke test — writes all 5 dedicated-path agent files
// ---------------------------------------------------------------------------

{
  const { run: runPostinstall } = require('../postinstall.js');
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectora-postinstall-'));
  const origCwd = process.env.INIT_CWD;
  process.env.INIT_CWD = installDir;

  try {
    runPostinstall();
  } finally {
    if (origCwd === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = origCwd;
  }

  const expectedFiles = [
    path.join(installDir, '.claude', 'skills', 'vectora', 'SKILL.md'),
    path.join(installDir, '.cursor', 'rules', 'vectora.mdc'),
    path.join(installDir, '.kiro', 'rules', 'vectora.md'),
    path.join(installDir, '.opencode', 'rules', 'vectora.md'),
    path.join(installDir, '.gemini', 'skills', 'vectora', 'SKILL.md'),
  ];

  for (const f of expectedFiles) {
    assert.ok(fs.existsSync(f), `postinstall must create ${path.relative(installDir, f)}`);
    assert.ok(fs.readFileSync(f, 'utf8').length > 0, `${path.basename(f)} must not be empty`);
  }

  rmTmp(installDir);
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

{
  assert.deepStrictEqual(tokenize('camelCase'), ['camel', 'case'], 'splits camelCase');
  assert.deepStrictEqual(tokenize('snake_case'), ['snake', 'case'], 'splits snake_case');
  assert.deepStrictEqual(tokenize('JWT'), ['jwt'], 'lowercases all tokens');
  assert.ok(!tokenize('io').includes('io'), '2-char token filtered out');
  assert.ok(tokenize('authentication').includes('authentication'), 'long token passes through');
  assert.strictEqual(tokenize('').length, 0, 'empty string → empty array');
  assert.strictEqual(tokenize(null).length, 0, 'null → empty array');
}

// ---------------------------------------------------------------------------
// scoreFile — the core scoring pipeline
// ---------------------------------------------------------------------------

function mkFile(overrides) {
  return {
    path: 'src/util.ts',
    exports: [],
    isPivot: false,
    packageSignals: [],
    allIdentifiers: [],
    stringLiterals: [],
    commentTerms: [],
    charCount: 400,
    ...overrides,
  };
}

{
  // Signal 1a: exact path in task → score >= 1.0
  const f = mkFile({ path: 'src/auth/login.ts' });
  const task = 'Fix src/auth/login.ts token handling';
  const score = scoreFile(f, new Set(tokenize(task)), task.toLowerCase());
  assert.ok(score >= 1.0, `exact path match: expected >= 1.0, got ${score}`);
}

{
  // Signal 1b: filename match → score >= 0.8
  const f = mkFile({ path: 'src/auth/login.ts' });
  const task = 'Fix the login.ts file';
  const score = scoreFile(f, new Set(tokenize(task)), task.toLowerCase());
  assert.ok(score >= 0.8, `filename match: expected >= 0.8, got ${score}`);
}

{
  // Signal 2: stem token overlap — "charge" in task, file stem is "charge"
  const f = mkFile({ path: 'src/payments/charge.ts' });
  const task = 'fix the charge logic';
  const score = scoreFile(f, new Set(tokenize(task)), task.toLowerCase());
  // stem='charge', 1 hit / 1 token → 0.5 + dir overlap for 'payments'... 'payments' not in task
  assert.ok(score >= 0.4, `stem token overlap: expected >= 0.4, got ${score}`);
}

{
  // Signal 3: export name overlap
  const f = mkFile({ path: 'src/payments/invoice.ts', exports: ['processRefund', 'cancelRefund'] });
  const task = 'test the refund flow';
  const score = scoreFile(f, new Set(tokenize(task)), task.toLowerCase());
  assert.ok(score > 0, `export overlap: expected > 0, got ${score}`);
}

{
  // Signal 4: directory segment in task → score from dir overlap
  const f = mkFile({ path: 'src/auth/session.ts' });
  const task = 'debug auth session handling';
  const score = scoreFile(f, new Set(tokenize(task)), task.toLowerCase());
  assert.ok(score > 0.1, `dir segment overlap: expected > 0.1, got ${score}`);
}

{
  // Signal 9: pivot bonus adds exactly 0.05 to an otherwise identical file
  const base  = mkFile({ path: 'src/index.ts', isPivot: false });
  const pivot = mkFile({ path: 'src/index.ts', isPivot: true });
  const task = 'refactor the index module';
  const tokens = new Set(tokenize(task));
  const lower  = task.toLowerCase();
  const diff = scoreFile(pivot, tokens, lower) - scoreFile(base, tokens, lower);
  assert.ok(Math.abs(diff - 0.05) < 0.001, `pivot bonus: expected 0.05, got ${diff}`);
}

{
  // Completely unrelated file scores 0
  const f = mkFile({ path: 'src/database/migrate.ts', exports: ['runMigration'], allIdentifiers: ['migrate', 'rollback'] });
  const task = 'fix jwt expiry';
  const score = scoreFile(f, new Set(tokenize(task)), task.toLowerCase());
  assert.strictEqual(score, 0, `unrelated file: expected 0, got ${score}`);
}

// ---------------------------------------------------------------------------
// selectFiles — token budget and threshold logic
// ---------------------------------------------------------------------------

function mkScored(filePath, score, charCount = 400) {
  return { path: filePath, _score: score, charCount, exports: [], imports: [], isPivot: false, isBarrel: false, semanticEdges: [] };
}

{
  // High-score file → fullLoadFiles; low-score file → skeletonFiles
  const scored = [
    mkScored('src/auth/login.ts', 1.5, 400),
    mkScored('src/utils.ts', 0.05, 200),
  ];
  const { fullLoadFiles, skeletonFiles } = selectFiles(scored, 2000);
  assert.ok(fullLoadFiles.some(f => f.path === 'src/auth/login.ts'), 'high-score file in fullLoadFiles');
  assert.ok(skeletonFiles.some(f => f.path === 'src/utils.ts'), 'low-score file in skeletonFiles');
}

{
  // Token budget cap: file with 80k chars (20k tokens) exceeds 2k budget → excluded from fullLoad
  const scored = [
    mkScored('src/giant.ts', 1.5, 80000),
    mkScored('src/small.ts', 0.8, 400),
  ];
  const { fullLoadFiles } = selectFiles(scored, 2000);
  assert.ok(!fullLoadFiles.some(f => f.path === 'src/giant.ts'), 'oversized file excluded by token budget');
  assert.ok(fullLoadFiles.some(f => f.path === 'src/small.ts'), 'small file included within budget');
}

{
  // Returns the correct shape with all three fields
  const scored = [mkScored('src/index.ts', 1.0, 200)];
  const result = selectFiles(scored, 2000);
  assert.ok('fullLoadFiles' in result, 'result has fullLoadFiles');
  assert.ok('skeletonFiles' in result, 'result has skeletonFiles');
  assert.ok('budgetUsed' in result, 'result has budgetUsed');
  assert.ok(typeof result.budgetUsed === 'number', 'budgetUsed is a number');
}

{
  // Fallback: when all files score 0, some files are still loaded
  const scored = [
    mkScored('src/a.ts', 0, 100),
    mkScored('src/b.ts', 0, 100),
  ];
  const { fullLoadFiles } = selectFiles(scored, 2000);
  assert.ok(fullLoadFiles.length > 0, 'fallback: files loaded when all score 0');
}

// ---------------------------------------------------------------------------
// buildVocabulary — TF-IDF domain term selection
// ---------------------------------------------------------------------------

{
  // Domain-distinctive terms appear in vocabulary
  const authFiles = [
    { packageSignals: ['jwt'], allIdentifiers: ['verifyToken', 'hashPassword', 'refreshToken'],
      stringLiterals: [], commentTerms: [], exports: ['login'], path: 'src/auth/login.ts' },
  ];
  const vocab = buildVocabulary(authFiles, null);
  assert.ok(Array.isArray(vocab), 'vocabulary is an array');
  assert.ok(vocab.length <= 60, 'vocabulary has at most 60 terms');
  assert.ok(vocab.includes('jwt'), '"jwt" appears in auth vocabulary');
  assert.ok(vocab.includes('verify') || vocab.includes('verifytoken') || vocab.some(t => t.includes('verify')), '"verify*" term in auth vocabulary');
}

{
  // Short identifiers (< 3 chars) are filtered by addTerms; packageSignals bypass that check.
  // Test only the identifier path here.
  const files = [
    { packageSignals: [], allIdentifiers: ['db', 'id', 'authentication'],
      stringLiterals: [], commentTerms: [], exports: [], path: 'src/util.ts' },
  ];
  const vocab = buildVocabulary(files, null);
  assert.ok(!vocab.includes('db'), '2-char identifier "db" excluded from vocabulary');
  assert.ok(!vocab.includes('id'), '2-char identifier "id" excluded from vocabulary');
  assert.ok(vocab.includes('authentication'), 'long identifier "authentication" included');
}

{
  // TF-IDF: term present in only one domain ranks higher than a cross-domain term
  const authFiles = [
    { packageSignals: ['jwt'], allIdentifiers: ['jwtSign'], stringLiterals: [], commentTerms: [], exports: [], path: 'src/auth/jwt.ts' },
  ];
  const payFiles = [
    { packageSignals: ['stripe'], allIdentifiers: ['stripePay', 'jwt'], stringLiterals: [], commentTerms: [], exports: [], path: 'src/pay/charge.ts' },
  ];
  const allDomains = { auth: authFiles, payments: payFiles };
  const authVocab = buildVocabulary(authFiles, allDomains);
  // 'jwt' is in both domains → IDF is lower; should still appear but is ranked lower
  // 'jwtsign' is auth-only → IDF is higher → should appear
  assert.ok(authVocab.includes('jwt'), 'cross-domain term "jwt" still in vocabulary');
  const jwtRank = authVocab.indexOf('jwt');
  const jwtSignRank = authVocab.indexOf('jwtsign');
  if (jwtSignRank !== -1) {
    assert.ok(jwtSignRank <= jwtRank, 'domain-exclusive term ranks before cross-domain term');
  }
}

// ---------------------------------------------------------------------------
// detectChain
// ---------------------------------------------------------------------------

{
  // ", then" is the canonical chain separator
  const parts = detectChain('Fix the login bug, then add rate limiting');
  assert.ok(Array.isArray(parts) && parts.length === 2, 'detectChain splits on ", then"');
  assert.ok(parts[0].toLowerCase().includes('login'), `first sub-task is about login, got: "${parts[0]}"`);
  assert.ok(parts[1].toLowerCase().includes('rate'), `second sub-task is about rate, got: "${parts[1]}"`);
}

{
  // Single task → null (no chain)
  const result = detectChain('Fix the login bug');
  assert.strictEqual(result, null, 'single task returns null from detectChain');
}

{
  // "and then" also triggers
  const parts = detectChain('Refactor the auth module and then update the tests');
  assert.ok(Array.isArray(parts) && parts.length >= 2, 'detectChain splits on "and then"');
}

console.log('All tests passed.');
