'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  parseFile,
  computeCentrality,
  inferDomain,
  buildVocabulary,
  resolveImport,
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

console.log('All tests passed.');
