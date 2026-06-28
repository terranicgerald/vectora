'use strict';

// Zero-touch skill installation. Runs automatically after `npm install vectora`.
// Writes skill files for every supported agent into the user's project.
// graph.json is NOT generated here — that requires `npx vectora init`.

const fs = require('fs');
const path = require('path');

const {
  stripFrontmatter,
  buildCursorVariant,
  buildKiroVariant,
  buildOpenCodeVariant,
  buildGeminiVariant,
  buildAgentsMdSection,
  buildWindsurfSection,
} = require('./cli/index.js');

function run() {
  // npm sets INIT_CWD to the directory where `npm install` was invoked.
  // npm_config_local_prefix is a reliable fallback.
  const projectRoot =
    process.env.INIT_CWD ||
    process.env.npm_config_local_prefix ||
    process.cwd();

  const skillSrc = path.join(__dirname, 'skill', 'SKILL.src.md');

  if (!fs.existsSync(skillSrc)) {
    // Shouldn't happen in a published package but be graceful.
    console.warn('vectora: skill source missing — skipping auto-install');
    return;
  }

  const skillContent = fs.readFileSync(skillSrc, 'utf8');
  const skillBody = stripFrontmatter(skillContent);

  // Each agent entry: [logLabel, destPath, content, mergeOnly]
  // mergeOnly=true → write only if file already exists (shared/user-owned files)
  // mergeOnly=false → always create (vectora-owned dedicated paths)
  const agents = [
    ['Claude Code', path.join(projectRoot, '.claude', 'skills', 'vectora', 'SKILL.md'), skillContent, false],
    ['Cursor', path.join(projectRoot, '.cursor', 'rules', 'vectora.mdc'), buildCursorVariant(skillBody), false],
    ['Kiro', path.join(projectRoot, '.kiro', 'rules', 'vectora.md'), buildKiroVariant(skillBody), false],
    ['OpenCode', path.join(projectRoot, '.opencode', 'rules', 'vectora.md'), buildOpenCodeVariant(skillBody), false],
    ['Gemini CLI', path.join(projectRoot, '.gemini', 'skills', 'vectora', 'SKILL.md'), buildGeminiVariant(skillBody), false],
  ];

  // Shared files — only merge if the user already has them
  const sharedAgents = [
    ['Codex', path.join(projectRoot, 'AGENTS.md'), buildAgentsMdSection(skillBody)],
    ['Windsurf', path.join(projectRoot, '.windsurfrules'), buildWindsurfSection(skillBody)],
  ];

  let installed = 0;

  for (const [label, dest, content] of agents) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf8');
      installed++;
    } catch (err) {
      console.warn(`vectora: could not install for ${label} — ${err.message}`);
    }
  }

  for (const [label, dest, section] of sharedAgents) {
    if (!fs.existsSync(dest)) continue;
    try {
      mergeSection(dest, '<!-- vectora -->', section);
      installed++;
    } catch (err) {
      console.warn(`vectora: could not merge for ${label} — ${err.message}`);
    }
  }

  console.log(`\n✓ vectora: skill installed for ${installed} agent(s)`);
  console.log(`✓ vectora: run 'npx vectora init' to build the structural graph\n`);
}

function mergeSection(filepath, marker, section) {
  const endMarker = marker.replace('<!--', '<!--/').replace(' -->', ' -->');
  let existing = fs.readFileSync(filepath, 'utf8');

  const startIdx = existing.indexOf(marker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    existing = existing.slice(0, startIdx) + existing.slice(endIdx + endMarker.length).trimStart();
  }

  const final = existing.trimEnd() + (existing.trimEnd() ? '\n\n' : '') + section + '\n';
  fs.writeFileSync(filepath, final, 'utf8');
}

// Allow requiring this file in tests without auto-running.
if (require.main === module) run();

module.exports = { run };
