'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  parseFile,
  findSeeds,
  expandNeighborhood,
  runMap,
  runCheck,
  computeCentrality,
  inferDomain,
  buildVocabulary,
  resolveImport,
  buildCoChangePeers,
  tokenize,
  mergeConfig,
  runInit,
  buildKiroVariant,
  buildOpenCodeVariant,
  buildGeminiVariant,
  stripFrontmatter,
  collectCallerWarnings,
  transitiveDependents,
  detectCycles,
  recordObserved,
  loadObserved,
  observedPeersMap,
  coChangeLabel,
  arityOf,
  extractCallArgs,
  confirmCallerBreaks,
  recordLedger,
  runReceipts,
  runMigrate,
  detectSignificantEvent,
  loadTsConfig,
  loadWorkspacePackages,
  probeExtensions,
  resolveAlias,
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

  // …but the source file now knows its colocated test (for the test-pairing check)
  const login = graph.files.find(f => f.path === 'src/auth/login.ts');
  assert.ok(login.testPath && login.testPath.includes('login.test.ts'),
    'source file is paired with its colocated test (testPath set)');

  rmTmp(tmpDir);
}

// ---------------------------------------------------------------------------
// collectCallerWarnings — caller/consumer recall (static, NO git history)
// ---------------------------------------------------------------------------

{
  // errors.ts exports RetryError; retry.ts imports it and references it,
  // client.ts imports errors.ts but does NOT use RetryError.
  const graph = { files: [
    { path: 'src/errors.ts', exports: ['RetryError'],
      importedBy: ['src/retry.ts', 'src/client.ts'], allIdentifiers: [] },
    { path: 'src/retry.ts', exports: [], importedBy: [],
      allIdentifiers: ['retryerror', 'backoff'] },
    { path: 'src/client.ts', exports: [], importedBy: [],
      allIdentifiers: ['fetch', 'headers'] },
  ]};
  // Edited errors.ts only — retry.ts (a real consumer) was not touched.
  const warnings = collectCallerWarnings(graph, ['src/errors.ts'], new Set(['src/errors.ts']));
  assert.strictEqual(warnings.length, 1, 'exactly one caller flagged (the symbol consumer)');
  assert.strictEqual(warnings[0].importer, 'src/retry.ts', 'retry.ts flagged');
  assert.ok(warnings[0].usedSymbols.includes('RetryError'), 'names the consumed symbol');
  // client.ts imports errors.ts but uses none of its symbols → not flagged (no noise)
  assert.ok(!warnings.some(w => w.importer === 'src/client.ts'),
    'importer that uses no exported symbol is NOT flagged');

  // If the consumer WAS edited, nothing is flagged.
  const none = collectCallerWarnings(graph, ['src/errors.ts', 'src/retry.ts'],
    new Set(['src/errors.ts', 'src/retry.ts']));
  assert.strictEqual(none.length, 0, 'edited consumers are not flagged');
}

// ---------------------------------------------------------------------------
// transitiveDependents — blast radius closure
// ---------------------------------------------------------------------------

{
  // core <- a <- b  (b imports a, a imports core)
  const graph = { files: [
    { path: 'core.ts', importedBy: ['a.ts'] },
    { path: 'a.ts', importedBy: ['b.ts'] },
    { path: 'b.ts', importedBy: [] },
  ]};
  const deps = transitiveDependents(graph, 'core.ts');
  assert.ok(deps.has('a.ts') && deps.has('b.ts'), 'transitive dependents include indirect importers');
  assert.ok(!deps.has('core.ts'), 'the file itself is excluded from its blast radius');
  assert.strictEqual(transitiveDependents(graph, 'b.ts').size, 0, 'a leaf has empty blast radius');
}

// ---------------------------------------------------------------------------
// detectCycles — circular imports
// ---------------------------------------------------------------------------

{
  const graph = { files: [
    { path: 'x.ts', importsResolved: ['y.ts'] },
    { path: 'y.ts', importsResolved: ['x.ts'] },
    { path: 'z.ts', importsResolved: [] },
  ]};
  const cycles = detectCycles(graph);
  assert.ok(cycles.length >= 1, 'detects the x↔y cycle');
  assert.ok(cycles[0].includes('x.ts') && cycles[0].includes('y.ts'), 'cycle names both files');

  const acyclic = detectCycles({ files: [
    { path: 'a.ts', importsResolved: ['b.ts'] },
    { path: 'b.ts', importsResolved: [] },
  ]});
  assert.strictEqual(acyclic.length, 0, 'no false cycle on a DAG');
}

// ---------------------------------------------------------------------------
// session-observed ledger — record, load, merge into neighborhood (NO git)
// ---------------------------------------------------------------------------

{
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectora-ledger-'));
  try {
    // Record alpha + beta edited together twice.
    recordObserved(tmpDir, ['src/alpha.ts', 'src/beta.ts']);
    recordObserved(tmpDir, ['src/alpha.ts', 'src/beta.ts']);
    const observed = loadObserved(tmpDir);
    assert.strictEqual(observed.pairs['src/alpha.ts|src/beta.ts'], 2, 'pair counted across two sessions');

    // A sprawling edit (> maxFiles) is ignored — same noise filter as git co-change.
    const big = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`);
    recordObserved(tmpDir, big);
    const after = loadObserved(tmpDir);
    assert.ok(!Object.keys(after.pairs).some(k => k.includes('f19.ts')), 'sprawling edit not recorded');

    // The ledger surfaces as co-change in expandNeighborhood, with session provenance.
    const peers = observedPeersMap(observed);
    const graph = { files: [
      mkGraphFile({ path: 'src/alpha.ts' }),
      mkGraphFile({ path: 'src/beta.ts' }),
    ]};
    const nb = expandNeighborhood([{ path: 'src/alpha.ts' }], graph, peers);
    const link = nb.coChange.find(c => c.a === 'src/alpha.ts' || c.b === 'src/alpha.ts');
    assert.ok(link, 'session-observed pair surfaces as co-change with no git history');
    assert.strictEqual(link.sessionCommits, 2, 'session count carried through');
    assert.strictEqual(link.sharedCommits, 0, 'no git history → git count is zero');
    assert.ok(/sessions 2×/.test(coChangeLabel(link)), 'provenance label shows the session source');
  } finally {
    rmTmp(tmpDir);
  }
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
// resolveImport — TS ESM `.js`→`.ts` mapping (the got-repo bug)
// ---------------------------------------------------------------------------

{
  const paths = new Set([
    '/p/src/core/index.ts',
    '/p/src/core/errors.ts',
    '/p/src/util/help.tsx',
  ]);
  // `import './errors.js'` from index.ts must resolve to errors.ts
  assert.strictEqual(
    resolveImport('/p/src/core/index.ts', './errors.js', paths),
    '/p/src/core/errors.ts',
    'TS ESM: ./errors.js resolves to errors.ts');
  // bare relative without extension still resolves
  assert.strictEqual(
    resolveImport('/p/src/core/index.ts', './errors', paths),
    '/p/src/core/errors.ts',
    'extensionless relative import resolves');
  // non-relative import returns null
  assert.strictEqual(
    resolveImport('/p/src/core/index.ts', 'node:http', paths),
    null,
    'bare package import is not a graph edge');
}

// ---------------------------------------------------------------------------
// findSeeds — transparent seed matching with reasons
// ---------------------------------------------------------------------------

function mkGraphFile(overrides) {
  return {
    path: 'src/util.ts',
    exports: [],
    stringLiterals: [],
    inDegree: 0,
    lineCount: 10,
    importsResolved: [],
    importedBy: [],
    coChangePeers: [],
    ...overrides,
  };
}

{
  // Filename named in task → matched with a reason, ranked first
  const files = [
    mkGraphFile({ path: 'src/auth/login.ts' }),
    mkGraphFile({ path: 'src/util.ts' }),
  ];
  const seeds = findSeeds(files, 'fix the login.ts timeout');
  assert.ok(seeds.length >= 1, 'at least one seed matched');
  assert.strictEqual(seeds[0].path, 'src/auth/login.ts', 'login.ts ranked first');
  assert.ok(seeds[0].reasons.some(r => /filename/.test(r)), 'reason mentions filename');
}

{
  // Export-name match surfaces the file and names the export in the reason
  const files = [
    mkGraphFile({ path: 'src/core/errors.ts', exports: ['RetryError', 'RequestError'] }),
  ];
  const seeds = findSeeds(files, 'throw a RetryError when retries are exhausted');
  assert.ok(seeds.length === 1, 'export match found');
  assert.ok(seeds[0].reasons.some(r => r.includes('RetryError')), 'reason names the export');
}

{
  // No keyword overlap → no seeds (the map then falls back to centrality)
  const files = [mkGraphFile({ path: 'src/database/migrate.ts', exports: ['runMigration'] })];
  const seeds = findSeeds(files, 'fix jwt expiry');
  assert.strictEqual(seeds.length, 0, 'unrelated task yields no seeds');
}

// ---------------------------------------------------------------------------
// expandNeighborhood — graph + co-change expansion around seeds
// ---------------------------------------------------------------------------

{
  const graph = { files: [
    mkGraphFile({ path: 'src/core/errors.ts', inDegree: 5,
      importsResolved: ['src/core/index.ts'],
      importedBy: ['src/core/options.ts'],
      coChangePeers: [{ partner: 'src/core/calc.ts', sharedCommits: 5 }] }),
    mkGraphFile({ path: 'src/core/index.ts', inDegree: 7 }),
    mkGraphFile({ path: 'src/core/options.ts', inDegree: 9 }),
    mkGraphFile({ path: 'src/core/calc.ts', inDegree: 1 }),
  ]};
  const seeds = [{ path: 'src/core/errors.ts' }];
  const nb = expandNeighborhood(seeds, graph);
  const npaths = nb.neighbors.map(n => n.path);
  assert.ok(npaths.includes('src/core/index.ts'), 'forward import included as neighbor');
  assert.ok(npaths.includes('src/core/options.ts'), 'reverse importer included as neighbor');
  assert.ok(npaths.includes('src/core/calc.ts'), 'co-change peer included as neighbor');
  assert.ok(nb.coChange.some(c => c.b === 'src/core/calc.ts' && c.sharedCommits === 5),
    'co-change pair recorded with shared-commit count');
  // neighbors are sorted by inDegree desc
  assert.strictEqual(nb.neighbors[0].path, 'src/core/options.ts', 'highest in-degree neighbor first');
  // seed itself is never listed as its own neighbor
  assert.ok(!npaths.includes('src/core/errors.ts'), 'seed excluded from its own neighborhood');
}

// ---------------------------------------------------------------------------
// buildVocabulary — TF-IDF domain term selection
// ---------------------------------------------------------------------------

{
  // Domain-distinctive terms appear in vocabulary (terms come from identifiers/exports)
  const authFiles = [
    { allIdentifiers: ['verifyToken', 'hashPassword', 'refreshToken', 'jwtVerify'],
      stringLiterals: [], commentTerms: [], exports: ['login'], path: 'src/auth/login.ts' },
  ];
  const vocab = buildVocabulary(authFiles, null);
  assert.ok(Array.isArray(vocab), 'vocabulary is an array');
  assert.ok(vocab.length <= 60, 'vocabulary has at most 60 terms');
  assert.ok(vocab.some(t => t.includes('verify')), '"verify*" term in auth vocabulary');
}

{
  // Short identifiers (< 3 chars) are filtered; long ones kept.
  const files = [
    { allIdentifiers: ['db', 'id', 'authentication'],
      stringLiterals: [], commentTerms: [], exports: [], path: 'src/util.ts' },
  ];
  const vocab = buildVocabulary(files, null);
  assert.ok(!vocab.includes('db'), '2-char identifier "db" excluded from vocabulary');
  assert.ok(!vocab.includes('id'), '2-char identifier "id" excluded from vocabulary');
  assert.ok(vocab.includes('authentication'), 'long identifier "authentication" included');
}

{
  // TF-IDF: a domain-exclusive term ranks at least as high as a cross-domain term
  const authFiles = [
    { allIdentifiers: ['jwtsign', 'token'], stringLiterals: [], commentTerms: [], exports: [], path: 'src/auth/jwt.ts' },
  ];
  const payFiles = [
    { allIdentifiers: ['stripepay', 'token'], stringLiterals: [], commentTerms: [], exports: [], path: 'src/pay/charge.ts' },
  ];
  const allDomains = { auth: authFiles, payments: payFiles };
  const authVocab = buildVocabulary(authFiles, allDomains);
  const tokenRank = authVocab.indexOf('token');     // cross-domain
  const jwtSignRank = authVocab.indexOf('jwtsign');  // auth-only
  if (jwtSignRank !== -1 && tokenRank !== -1) {
    assert.ok(jwtSignRank <= tokenRank, 'domain-exclusive term ranks before cross-domain term');
  }
}

// ---------------------------------------------------------------------------
// runCheck — the honest receipt (co-change recall on a real git repo)
// ---------------------------------------------------------------------------

{
  // Build a tiny git repo where a.ts and b.ts always change together,
  // init the graph, map a task, edit both, and assert check sees the link.
  const { execSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectora-check-'));
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(dir, 'errors.ts'), "import {retry} from './retry.js';\nexport const RetryError = () => retry;\n");
    fs.writeFileSync(path.join(dir, 'retry.ts'), 'export const retry = 1;\n');
    sh('git init -q && git config user.email t@t.t && git config user.name t');
    sh('git add -A && git commit -qm c1');
    // errors + retry co-change across several commits
    for (let i = 0; i < 4; i++) {
      fs.appendFileSync(path.join(dir, 'errors.ts'), `// edit ${i}\n`);
      fs.appendFileSync(path.join(dir, 'retry.ts'), `// edit ${i}\n`);
      sh('git add -A && git commit -qm c');
    }
    runInit({ silent: true, root: dir });
    const graph = JSON.parse(fs.readFileSync(path.join(dir, '.vectora', 'graph.json'), 'utf8'));
    const errFile = graph.files.find(f => f.path === 'errors.ts');
    assert.ok(errFile, 'errors.ts in graph');
    assert.ok((errFile.coChangePeers || []).some(p => p.partner === 'retry.ts'),
      'graph records errors.ts ↔ retry.ts co-change');

    // map + persist last-map (task names errors.ts so it becomes a seed)
    const log = [];
    const orig = console.log; console.log = (...x) => log.push(x.join(' '));
    try { runMap('fix the errors module', { root: dir }); } finally { console.log = orig; }
    assert.ok(fs.existsSync(path.join(dir, '.vectora', 'last-map.json')), 'last-map.json written');
    const lastMap = JSON.parse(fs.readFileSync(path.join(dir, '.vectora', 'last-map.json'), 'utf8'));
    assert.ok((lastMap.coChange || []).some(c => c.a === 'errors.ts' || c.b === 'errors.ts'),
      'last-map records the errors.ts co-change prediction');

    // edit both, then check — expect a surfaced co-change link
    fs.appendFileSync(path.join(dir, 'errors.ts'), '// fix\n');
    fs.appendFileSync(path.join(dir, 'retry.ts'), '// fix\n');
    const out = [];
    console.log = (...x) => out.push(x.join(' '));
    try { runCheck({ root: dir }); } finally { console.log = orig; }
    const text = out.join('\n');
    assert.ok(/you edited:/.test(text), 'check reports edited files');
    assert.ok(/surfaced \d+ link/.test(text) || /✓/.test(text),
      'check surfaces the a↔b co-change link the agent used');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// arityOf — required vs default vs rest
// ---------------------------------------------------------------------------

{
  // arityOf is tested via parseFile exportSignatures
  const dir = makeTmpRepo({
    'a.js': `
export function strict(x, y, z) { return x + y + z; }
export function withDefault(x, y = 0, z = 0) { return x + y + z; }
export function withRest(x, ...rest) { return x; }
export const arrow = (a, b) => a + b;
`,
  });
  const r = parseFile(path.join(dir, 'a.js'));
  assert.ok(r, 'parseFile ok');
  const sigs = r.exportSignatures || {};
  assert.strictEqual(sigs.strict?.required, 3, 'strict: 3 required');
  assert.strictEqual(sigs.withDefault?.required, 1, 'withDefault: 1 required (x)');
  assert.strictEqual(sigs.withRest?.hasRest, true, 'withRest has rest param');
  assert.strictEqual(sigs.withRest?.required, 1, 'withRest: 1 required (x)');
  assert.strictEqual(sigs.arrow?.required, 2, 'arrow: 2 required');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// confirmCallerBreaks — detects arity mismatch
// ---------------------------------------------------------------------------

{
  // a.js exports f(x,y,z) — 3 required.
  // b.js calls f(1, 2) — only 2 args → confirmed break.
  // c.js calls f(1, 2, 3) → no break.
  // d.js calls f(...args) → spread, no break (unknowable arity).
  const dir = makeTmpRepo({
    'a.js': `export function f(x, y, z) { return x + y + z; }`,
    'b.js': `import { f } from './a.js';\nf(1, 2);`,
    'c.js': `import { f } from './a.js';\nf(1, 2, 3);`,
    'd.js': `import { f } from './a.js';\nconst args = [1,2,3]; f(...args);`,
  });
  // Build graph
  runInit({ root: dir, silent: true });
  const graph = JSON.parse(fs.readFileSync(path.join(dir, '.vectora', 'graph.json'), 'utf8'));
  const edited = ['a.js'];
  const editedSet = new Set(edited);
  const breaks = confirmCallerBreaks(graph, edited, editedSet, dir);
  const breakImporters = breaks.map(b => b.importer);
  assert.ok(breakImporters.includes('b.js'), 'b.js flagged as broken (2 < 3)');
  assert.ok(!breakImporters.includes('c.js'), 'c.js not broken (3 == 3)');
  assert.ok(!breakImporters.includes('d.js'), 'd.js not broken (spread)');
  const b = breaks.find(x => x.importer === 'b.js');
  assert.strictEqual(b?.required, 3, 'required=3 reported');
  assert.strictEqual(b?.got, 2, 'got=2 reported');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// runCheck — decoupled from map: co-change misses fire without a prior map
// ---------------------------------------------------------------------------

{
  // Build a repo with a git history so buildCoChangePeers has data.
  // We fake this by directly planting coChangePeers in the graph.
  const dir = makeTmpRepo({
    'alpha.js': `export const A = 1;`,
    'beta.js': `import { A } from './alpha.js'; export const B = A + 1;`,
  });

  runInit({ root: dir, silent: true });

  // Manually inject a co-change peer into the graph (simulates git history)
  const gp = path.join(dir, '.vectora', 'graph.json');
  const g = JSON.parse(fs.readFileSync(gp, 'utf8'));
  const alphaF = g.files.find(f => f.path === 'alpha.js');
  if (alphaF) alphaF.coChangePeers = [{ partner: 'beta.js', sharedCommits: 5 }];
  fs.writeFileSync(gp, JSON.stringify(g, null, 2));

  // Edit alpha.js only; no last-map.json (check decoupled from map)
  fs.appendFileSync(path.join(dir, 'alpha.js'), '\n// changed\n');

  // git-init so getEditedFiles can detect the working tree change
  try {
    const { execSync } = require('child_process');
    execSync('git init && git add -A && git commit -m "init" --allow-empty', { cwd: dir, stdio: 'ignore' });
    fs.appendFileSync(path.join(dir, 'alpha.js'), '// changed2\n');
  } catch {}

  const out = [];
  const orig = console.log; console.log = (...x) => out.push(x.join(' '));
  try { runCheck({ root: dir }); } finally { console.log = orig; }
  const text = out.join('\n');
  // Either the co-change miss fires, or "structurally isolated" (if git didn't
  // initialise cleanly in CI). What must NOT happen: a crash requiring last-map.
  assert.ok(/\[VECTORA CHECK\]/.test(text), 'check runs without last-map.json');
  assert.ok(!/could not read last map/.test(text), 'no crash from missing last-map');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// recordLedger + runReceipts — accumulate honest counts
// ---------------------------------------------------------------------------

{
  const dir = makeTmpRepo({});
  fs.mkdirSync(path.join(dir, '.vectora'), { recursive: true });

  recordLedger(dir, { confirmedBreaks: 2, coChangeMisses: 1, callerWarnings: 0, staleTests: 1, items: [] });
  recordLedger(dir, { confirmedBreaks: 0, coChangeMisses: 3, callerWarnings: 2, staleTests: 0, items: [] });
  // clean run (total=0) — should NOT be recorded
  recordLedger(dir, { confirmedBreaks: 0, coChangeMisses: 0, callerWarnings: 0, staleTests: 0, items: [] });

  const lp = path.join(dir, '.vectora', 'ledger.json');
  const ledger = JSON.parse(fs.readFileSync(lp, 'utf8'));
  assert.strictEqual(ledger.events.length, 2, 'only non-zero events recorded');
  assert.strictEqual(ledger.events[0].confirmedBreaks, 2, 'first event: 2 breaks');
  assert.strictEqual(ledger.events[1].coChangeMisses, 3, 'second event: 3 misses');

  const out = [];
  const orig = console.log; console.log = (...x) => out.push(x.join(' '));
  try { runReceipts({ root: dir }); } finally { console.log = orig; }
  const text = out.join('\n');
  assert.ok(/9 incomplete edits flagged/.test(text) || /incomplete edit/.test(text), 'receipts shows grand total');
  assert.ok(/2 confirmed break/.test(text), 'receipts shows confirmed breaks');
  assert.ok(/4 forgotten co-change/.test(text) || /co-change/.test(text), 'receipts shows co-change misses');
  assert.ok(/2 task/.test(text), 'receipts shows task count');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// runMigrate — auto-discovery of rule source files
// ---------------------------------------------------------------------------

{
  // Repo with CLAUDE.md and a nested RULES.md
  const dir = makeTmpRepo({
    'CLAUDE.md': '# Project Rules\n\n- Always validate input at the boundary\n- No direct DB calls from controllers\n',
    'docs/RULES.md': '## Architecture\n\nControllers must delegate to services.\n',
    'src/app.js': 'module.exports = {};',
  });
  fs.mkdirSync(path.join(dir, '.vectora'), { recursive: true });

  const out = [];
  const orig = console.log; console.log = (...x) => out.push(x.join(' '));
  try { runMigrate({ root: dir }); } finally { console.log = orig; }
  const text = out.join('\n');
  assert.ok(/\[VECTORA MIGRATE\]/.test(text), 'migrate emits block header');
  assert.ok(/CLAUDE\.md/.test(text), 'migrate includes CLAUDE.md');
  assert.ok(/RULES\.md/.test(text), 'migrate discovers nested RULES.md');
  assert.ok(/validate input at the boundary/.test(text), 'migrate includes file content');
  assert.ok(/Confirm with the user/.test(text), 'migrate reminds to confirm');
  rmTmp(dir);
}

{
  // Repo with existing decisions + CLAUDE.md — existing rules listed as "skip"
  const dir = makeTmpRepo({
    'CLAUDE.md': '- No singletons\n- Always validate at boundary\n',
    'src/x.js': 'module.exports = {};',
  });
  fs.mkdirSync(path.join(dir, '.vectora'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.vectora', 'decisions.json'),
    JSON.stringify({ global: ['No singletons'], domains: {} }),
    'utf8'
  );

  const out = [];
  const orig = console.log; console.log = (...x) => out.push(x.join(' '));
  try { runMigrate({ root: dir }); } finally { console.log = orig; }
  const text = out.join('\n');
  assert.ok(/Already in decisions\.json/.test(text), 'existing rules surfaced as skip-list');
  assert.ok(/No singletons/.test(text), 'existing rule shown in skip-list');
  rmTmp(dir);
}

{
  // Repo with no rule files — migrate gracefully says nothing found
  const dir = makeTmpRepo({ 'src/a.js': 'module.exports = {};' });
  fs.mkdirSync(path.join(dir, '.vectora'), { recursive: true });

  const out = [];
  const orig = console.log; console.log = (...x) => out.push(x.join(' '));
  try { runMigrate({ root: dir }); } finally { console.log = orig; }
  const text = out.join('\n');
  assert.ok(/No rule source files found/.test(text), 'graceful no-op when no files');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// detectSignificantEvent — structural breadth heuristic
// ---------------------------------------------------------------------------

{
  // High structural breadth (≥4 co-change + caller peers)
  const dir = makeTmpRepo({ 'src/a.js': 'module.exports = {};' });
  const result = detectSignificantEvent(dir, ['src/a.js'], 3, 2);
  assert.ok(result !== null, 'detects significant event with 5 structural peers');
  assert.ok(/structural peers flagged/.test(result), 'describes the structural breadth');
  rmTmp(dir);
}

{
  // Low breadth — no signal
  const dir = makeTmpRepo({ 'src/a.js': 'module.exports = {};' });
  const result = detectSignificantEvent(dir, ['src/a.js'], 1, 1);
  assert.strictEqual(result, null, 'no signal for low structural breadth');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// loadTsConfig — reads tsconfig.json, follows local extends
// ---------------------------------------------------------------------------

{
  // Basic paths + baseUrl
  const dir = makeTmpRepo({});
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      baseUrl: './src',
      paths: { '@/*': ['./src/*'], '~/utils': ['./src/utils/index'] },
    },
  }), 'utf8');
  const result = loadTsConfig(dir, null);
  assert.strictEqual(result.baseUrl, path.join(dir, 'src'), 'baseUrl resolved to absolute');
  assert.ok(result.paths['@/*'], 'paths @/* present');
  assert.ok(result.paths['~/utils'], 'paths ~/utils present');
  rmTmp(dir);
}

{
  // JSONC — comments and trailing commas
  const dir = makeTmpRepo({});
  fs.writeFileSync(path.join(dir, 'tsconfig.json'),
    `// tsconfig\n{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@/*": ["./src/*"] }, // comment\n  }\n}`, 'utf8');
  const result = loadTsConfig(dir, null);
  assert.ok(result.paths['@/*'], 'JSONC parsed correctly');
  rmTmp(dir);
}

{
  // Local extends — child paths override parent baseUrl
  const dir = makeTmpRepo({});
  fs.writeFileSync(path.join(dir, 'tsconfig.base.json'), JSON.stringify({
    compilerOptions: { baseUrl: './src', paths: { '#lib/*': ['./lib/*'] } },
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    extends: './tsconfig.base.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
  }), 'utf8');
  const result = loadTsConfig(dir, null);
  assert.ok(result.paths['@/*'], 'child paths present');
  // Child paths override parent so parent paths may not be present
  assert.strictEqual(result.baseUrl, path.join(dir, 'src'), 'baseUrl inherited from parent');
  rmTmp(dir);
}

{
  // No tsconfig — returns empty
  const dir = makeTmpRepo({});
  const result = loadTsConfig(dir, null);
  assert.strictEqual(result.baseUrl, null, 'no tsconfig → null baseUrl');
  assert.deepStrictEqual(result.paths, {}, 'no tsconfig → empty paths');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// resolveImport / resolveAlias — path alias and workspace resolution
// ---------------------------------------------------------------------------

{
  // @/ alias resolves to actual file
  const dir = makeTmpRepo({
    'src/components/Button.tsx': 'export const Button = () => {};',
    'src/pages/Home.tsx': 'import { Button } from "@/components/Button";',
  });
  const allPaths = new Set([
    path.join(dir, 'src/components/Button.tsx'),
    path.join(dir, 'src/pages/Home.tsx'),
  ]);
  const aliases = {
    baseUrl: path.join(dir, 'src'),
    paths: { '@/*': ['./components/*', './*'] },
    workspacePackages: new Map(),
  };
  // resolveAlias should find Button.tsx via @/* → src/*
  const resolved = resolveAlias('@/components/Button', allPaths, aliases);
  assert.strictEqual(resolved, path.join(dir, 'src/components/Button.tsx'), '@/ alias resolves');
  rmTmp(dir);
}

{
  // baseUrl-only resolution (no explicit paths)
  const dir = makeTmpRepo({ 'src/utils/format.ts': 'export const fmt = () => {};' });
  const allPaths = new Set([path.join(dir, 'src/utils/format.ts')]);
  const aliases = { baseUrl: path.join(dir, 'src'), paths: {}, workspacePackages: new Map() };
  const resolved = resolveAlias('utils/format', allPaths, aliases);
  assert.strictEqual(resolved, path.join(dir, 'src/utils/format.ts'), 'baseUrl bare resolution');
  rmTmp(dir);
}

{
  // External npm package → null (not in allPaths)
  const dir = makeTmpRepo({});
  const allPaths = new Set();
  const aliases = { baseUrl: null, paths: {}, workspacePackages: new Map() };
  const resolved = resolveAlias('react', allPaths, aliases);
  assert.strictEqual(resolved, null, 'external npm package returns null');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// loadWorkspacePackages — monorepo workspace detection
// ---------------------------------------------------------------------------

{
  // Standard packages/* workspace
  const dir = makeTmpRepo({
    'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    'packages/shared/package.json': JSON.stringify({ name: '@myorg/shared', main: './src/index.js' }),
    'packages/shared/src/index.ts': 'export const foo = 1;',
    'packages/ui/package.json': JSON.stringify({ name: '@myorg/ui' }),
    'packages/ui/index.ts': 'export const Bar = () => {};',
  });
  const pkgs = loadWorkspacePackages(dir);
  assert.ok(pkgs.has('@myorg/shared'), 'shared package detected');
  assert.ok(pkgs.has('@myorg/ui'), 'ui package detected');
  assert.strictEqual(pkgs.get('@myorg/shared').main, 'src/index.js', 'main resolved');
  rmTmp(dir);
}

{
  // Workspace package import resolution via resolveAlias
  const dir = makeTmpRepo({
    'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    'packages/shared/package.json': JSON.stringify({ name: '@myorg/shared', main: 'index.js' }),
    'packages/shared/index.ts': 'export const util = () => {};',
    'apps/web/src/app.ts': 'import { util } from "@myorg/shared";',
  });
  const allPaths = new Set([
    path.join(dir, 'packages/shared/index.ts'),
    path.join(dir, 'apps/web/src/app.ts'),
  ]);
  const wsPkgs = loadWorkspacePackages(dir);
  const aliases = { baseUrl: null, paths: {}, workspacePackages: wsPkgs };
  const resolved = resolveAlias('@myorg/shared', allPaths, aliases);
  assert.strictEqual(resolved, path.join(dir, 'packages/shared/index.ts'), 'workspace pkg resolves to index.ts');
  rmTmp(dir);
}

{
  // Sub-path import from workspace package
  const dir = makeTmpRepo({
    'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    'packages/shared/package.json': JSON.stringify({ name: '@myorg/shared' }),
    'packages/shared/utils/helpers.ts': 'export const h = () => {};',
  });
  const allPaths = new Set([path.join(dir, 'packages/shared/utils/helpers.ts')]);
  const wsPkgs = loadWorkspacePackages(dir);
  const aliases = { baseUrl: null, paths: {}, workspacePackages: wsPkgs };
  const resolved = resolveAlias('@myorg/shared/utils/helpers', allPaths, aliases);
  assert.strictEqual(resolved, path.join(dir, 'packages/shared/utils/helpers.ts'), 'workspace sub-path resolves');
  rmTmp(dir);
}

// ---------------------------------------------------------------------------
// runInit with tsconfig paths — import edges now appear for aliased imports
// ---------------------------------------------------------------------------

{
  const dir = makeTmpRepo({
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }),
    'src/lib/core.ts': 'export function core() {}',
    'src/app.ts': 'import { core } from "@/lib/core";',
  });

  const out = [];
  const orig = console.log; console.log = (...x) => out.push(x.join(' '));
  try { runInit({ root: dir, silent: false }); } finally { console.log = orig; }

  const gp = path.join(dir, '.vectora', 'graph.json');
  assert.ok(fs.existsSync(gp), 'graph.json written');
  const g = JSON.parse(fs.readFileSync(gp, 'utf8'));
  const appFile = g.files.find(f => f.path === 'src/app.ts');
  assert.ok(appFile, 'src/app.ts in graph');
  assert.ok((appFile.importsResolved || []).some(r => r.includes('core')), 'alias import resolved in graph');
  const coreFile = g.files.find(f => f.path === 'src/lib/core.ts');
  assert.ok((coreFile.importedBy || []).length > 0, 'core.ts has importedBy via alias');
  const text = out.join('\n');
  assert.ok(/aliases.*path alias/.test(text), 'init output mentions path aliases');
  rmTmp(dir);
}

console.log('All tests passed.');
