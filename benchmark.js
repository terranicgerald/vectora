#!/usr/bin/env node
'use strict';

/**
 * vectora benchmark — no API key required.
 *
 * Measures token reduction by comparing:
 *   BASELINE  — tokens to load all source files in a repo (what an agent does without vectora)
 *   WITH vectora — tokens in the vectora brief for a specific task
 *
 * Token estimate: characters ÷ 4 (standard proxy; within ~10% of actual Claude tokenizer).
 * Results are fully reproducible: fixed repos, fixed tags, fixed tasks.
 *
 * Usage:
 *   node benchmark.js
 *
 * Requires: git, node >= 18, internet access to clone repos.
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Benchmark targets ────────────────────────────────────────────────────────
// Each entry: a public repo at a pinned tag + a realistic task.
const REPOS = [
  {
    name:    'expressjs/express',
    url:     'https://github.com/expressjs/express.git',
    tag:     'v4.18.2',
    task:    'Refactor route parameter matching to support optional segments',
    files:   143,
  },
  {
    name:    'sindresorhus/got',
    url:     'https://github.com/sindresorhus/got.git',
    tag:     'v13.0.0',
    task:    'Fix retry logic when a request times out',
    files:   80,
  },
  {
    name:    'fastify/fastify',
    url:     'https://github.com/fastify/fastify.git',
    tag:     'v4.24.3',
    task:    'Add request body size limit validation',
    files:   190,
  },
];

// ── Source file extensions (mirrors vectora's SOURCE_EXTENSIONS) ─────────────
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|rb)$/;
const SKIP_DIRS  = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.vectora', 'vendor', 'target']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokEst(chars) { return Math.round(chars / 4); }

function fmtNum(n) { return n.toLocaleString(); }

function collectSourceFiles(dir) {
  const results = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name));
      } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
        // Exclude test files to match vectora's default behaviour
        if (!/\.(test|spec|stories)\.|__tests__/.test(e.name)) results.push(path.join(d, e.name));
      }
    }
  }
  walk(dir);
  return results;
}

function totalChars(files) {
  return files.reduce((sum, f) => {
    try { return sum + fs.readFileSync(f, 'utf8').length; } catch { return sum; }
  }, 0);
}

function run(cmd, cwd, opts = {}) {
  return spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', timeout: 120_000, ...opts });
}

function cloneRepo(repo, workDir) {
  const dest = path.join(workDir, repo.name.replace('/', '-'));
  if (fs.existsSync(dest)) {
    console.log(`  ✓ already cloned (${dest})`);
    return dest;
  }
  console.log(`  → cloning ${repo.name} @ ${repo.tag} …`);
  const r = run(
    `git clone --depth 1 --branch ${repo.tag} --single-branch ${repo.url} ${dest}`,
    workDir, { stdio: 'pipe' }
  );
  if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
  return dest;
}

function initVectora(repoDir) {
  console.log(`  → running npx vectora@latest init …`);
  const r = run('node ' + path.join(__dirname, 'bin/vectora.js') + ' init', repoDir, { stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`vectora init failed: ${r.stderr}`);
}

function getBriefOutput(repoDir, task) {
  const r = run(
    `node ${path.join(__dirname, 'bin/vectora.js')} brief "${task.replace(/"/g, '\\"')}"`,
    repoDir, { stdio: 'pipe' }
  );
  return r.stdout || '';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const workDir = path.join(os.tmpdir(), 'vectora-benchmark');
  fs.mkdirSync(workDir, { recursive: true });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              vectora benchmark — local token counting        ║');
  console.log('║  Token estimate: chars ÷ 4  (no API key required)           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const repo of REPOS) {
    console.log(`\n▸ ${repo.name}`);
    console.log(`  task: "${repo.task}"`);

    let repoDir;
    try {
      repoDir = cloneRepo(repo, workDir);
    } catch (e) {
      console.error(`  ✗ clone failed — skipping: ${e.message}`);
      continue;
    }

    // Baseline: total chars of all source files (simulates "agent loads everything")
    const sourceFiles = collectSourceFiles(repoDir);
    const baselineChars = totalChars(sourceFiles);
    const baselineTok   = tokEst(baselineChars);

    console.log(`  ✓ ${sourceFiles.length} source files found — baseline: ~${fmtNum(baselineTok)} tokens`);

    // vectora init
    try {
      initVectora(repoDir);
    } catch (e) {
      console.error(`  ✗ vectora init failed — skipping: ${e.message}`);
      continue;
    }

    // vectora brief
    const brief = getBriefOutput(repoDir, repo.task);
    const briefTok = tokEst(brief.length);

    const reduction = Math.round((1 - briefTok / baselineTok) * 100);

    console.log(`  ✓ vectora brief: ~${fmtNum(briefTok)} tokens`);
    console.log(`  ✓ reduction: ${reduction}%`);

    results.push({ name: repo.name, files: sourceFiles.length, task: repo.task, baselineTok, briefTok, reduction });
  }

  // ── Results table ──────────────────────────────────────────────────────────
  if (results.length === 0) {
    console.log('\n✗ No results — check errors above.');
    return;
  }

  console.log('\n\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Repository               │  Files │ Baseline tok │ With vectora │ Reduction │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  for (const r of results) {
    const name    = r.name.padEnd(24);
    const files   = String(r.files).padStart(6);
    const before  = fmtNum(r.baselineTok).padStart(12);
    const after   = fmtNum(r.briefTok).padStart(12);
    const pct     = `${r.reduction}%`.padStart(9);
    console.log(`│ ${name} │ ${files} │ ${before} │ ${after} │ ${pct} │`);
  }
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  const avgReduction = Math.round(results.reduce((s, r) => s + r.reduction, 0) / results.length);
  console.log(`\nAverage reduction: ${avgReduction}%`);
  console.log(`\nMethodology: baseline = all source files loaded in full (chars ÷ 4 tokens).`);
  console.log(`             vectora  = full text of vectora brief output (chars ÷ 4 tokens).`);
  console.log(`             Repos cloned at pinned tags for reproducibility.\n`);

  // Write JSON for easy copy-paste into README
  const jsonOut = path.join(workDir, 'results.json');
  fs.writeFileSync(jsonOut, JSON.stringify({ date: new Date().toISOString(), methodology: 'chars/4', results }, null, 2));
  console.log(`Full results written to: ${jsonOut}`);
}

main().catch(e => { console.error(e); process.exit(1); });
