#!/usr/bin/env node
'use strict';

/**
 * vectora demo — the honest artifact, no token-savings theatre.
 *
 * For each pinned repo, this clones it WITH FULL HISTORY (co-change needs git
 * history), runs `vectora init` (offline, zero tokens), runs `vectora map` for a
 * realistic task, and reports the one thing vectora can actually prove:
 *
 *   how many co-change links it surfaced — pairs of files that real commits
 *   edited together, which grep / embeddings / the model cannot see in the
 *   source text.
 *
 * There is no "tokens saved" number here, because that number was never real.
 *
 * Usage:
 *   node benchmark.js
 *
 * Requires: git, node >= 18, internet access to clone repos.
 */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Each entry: a public repo + a realistic task. Cloned at a pinned tag, but with
// full history so co-change is meaningful.
const REPOS = [
  {
    name: 'sindresorhus/got',
    url:  'https://github.com/sindresorhus/got.git',
    tag:  'v13.0.0',
    task: 'make got throw a specific error type when all retries are exhausted',
  },
  {
    name: 'expressjs/express',
    url:  'https://github.com/expressjs/express.git',
    tag:  'v4.18.2',
    task: 'refactor route parameter matching to support optional segments',
  },
];

function run(cmd, cwd, opts = {}) {
  return spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', timeout: 180_000, ...opts });
}

function cloneRepo(repo, workDir) {
  const dest = path.join(workDir, repo.name.replace('/', '-'));
  if (fs.existsSync(dest)) { console.log(`  ✓ already cloned`); return dest; }
  console.log(`  → cloning ${repo.name} @ ${repo.tag} (full history) …`);
  const r = run(`git clone --branch ${repo.tag} --single-branch ${repo.url} ${dest}`, workDir, { stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
  return dest;
}

function vectora(args, cwd) {
  return run(`node ${path.join(__dirname, 'bin/vectora.js')} ${args}`, cwd, { stdio: 'pipe' });
}

function main() {
  const workDir = path.join(os.tmpdir(), 'vectora-demo');
  fs.mkdirSync(workDir, { recursive: true });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   vectora demo — co-change links grep cannot see             ║');
  console.log('║   (no token-savings claims — only what vectora can prove)    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const results = [];

  for (const repo of REPOS) {
    console.log(`\n▸ ${repo.name}`);
    console.log(`  task: "${repo.task}"`);

    let dir;
    try { dir = cloneRepo(repo, workDir); }
    catch (e) { console.error(`  ✗ ${e.message}`); continue; }

    fs.rmSync(path.join(dir, '.vectora'), { recursive: true, force: true });
    const init = vectora('init', dir);
    if (init.status !== 0) { console.error(`  ✗ init failed: ${init.stderr}`); continue; }
    const edges    = (init.stdout.match(/import edges:\s*(\d+)/)   || [])[1] || '0';
    const coChange = (init.stdout.match(/co-change:\s*(\d+)/)      || [])[1] || '0';
    console.log(`  ✓ graph: ${edges} import edges, ${coChange} co-change pairs (offline, 0 tokens)`);

    const map = vectora(`map "${repo.task.replace(/"/g, '\\"')}"`, dir);
    const out = map.stdout || '';
    const surfaced = (out.match(/× together/g) || []).length;
    const seeds    = (out.match(/START HERE/) ? out.split('START HERE')[1].split('NEIGHBORHOOD')[0] : '')
                       .split('\n').filter(l => l.trim().startsWith('source/') || /\.\w+\s/.test(l)).length;
    console.log(`  ✓ map: ${surfaced} co-change links surfaced for the agent to consider`);

    results.push({ name: repo.name, edges: +edges, coChange: +coChange, surfaced });
  }

  if (results.length) {
    console.log('\n┌──────────────────────────────────────────────────────────────────┐');
    console.log('│ Repository           │ Import edges │ Co-change pairs │ Surfaced   │');
    console.log('├──────────────────────────────────────────────────────────────────┤');
    for (const r of results) {
      console.log(`│ ${r.name.padEnd(20)} │ ${String(r.edges).padStart(12)} │ ${String(r.coChange).padStart(15)} │ ${String(r.surfaced).padStart(10)} │`);
    }
    console.log('└──────────────────────────────────────────────────────────────────┘');
    console.log('\nThese co-change pairs come from real commit history. They are invisible');
    console.log('to grep, embeddings, and the model\'s own reading of the source. That is the');
    console.log('information vectora exists to provide. Verify it on your own repo with');
    console.log('`npx vectora check` after a real task.\n');
  } else {
    console.log('\n✗ No results — check errors above.\n');
  }
}

main();
