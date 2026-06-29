'use strict';

/**
 * Go grammar parser — Tier 2 language support.
 * Extracts import paths, exported symbols (capitalized), identifiers,
 * string literals, and comment terms. No external dependencies.
 */

const MANUAL_PIVOT_RE = /^[ \t]*\/\/[ \t]*@vectora[ \t]+pivot[ \t]*$/m;

const GO_STOPWORDS = new Set([
  'func', 'type', 'struct', 'interface', 'package', 'import', 'return',
  'error', 'string', 'bool', 'byte', 'rune', 'make', 'append', 'delete',
  'copy', 'close', 'panic', 'recover', 'print', 'println', 'goroutine',
  'chan', 'select', 'defer', 'goto', 'fallthrough', 'range', 'case',
  'switch', 'default', 'break', 'continue', 'const', 'var', 'iota',
  'true', 'false', 'nilvalue', 'context', 'Context', 'Request', 'Response',
]);

function parseGo(raw, filepath) {
  const imports = [];
  const exports = [];
  const allIdentifiers = [];
  const stringLiterals = [];
  const commentTerms = [];

  const lines = raw.split('\n');

  // ── Import blocks: import ( "path/to/pkg" ) or import "path/to/pkg" ────────
  const importBlockRe = /import\s*\(([\s\S]*?)\)/g;
  for (const block of raw.matchAll(importBlockRe)) {
    for (const line of block[1].split('\n')) {
      const m = line.trim().match(/"([^"]+)"/);
      if (m) imports.push(m[1]);
    }
  }
  // Single-line imports not in a block
  for (const m of raw.matchAll(/^import\s+"([^"]+)"/gm)) imports.push(m[1]);
  // Aliased: import alias "path"
  for (const m of raw.matchAll(/^import\s+\w+\s+"([^"]+)"/gm)) imports.push(m[1]);

  // ── Exported symbols (capitalized — Go's convention) ────────────────────────
  // func Name(
  for (const m of raw.matchAll(/^func\s+([A-Z][a-zA-Z0-9_]*)\s*[(\[]/gm)) exports.push(m[1]);
  // func (recv) Name(  — method
  for (const m of raw.matchAll(/^func\s+\([^)]+\)\s+([A-Z][a-zA-Z0-9_]*)\s*\(/gm)) exports.push(m[1]);
  // type Name struct/interface
  for (const m of raw.matchAll(/^type\s+([A-Z][a-zA-Z0-9_]*)\s+(?:struct|interface)/gm)) exports.push(m[1]);
  // var Name =  or  const Name =
  for (const m of raw.matchAll(/^(?:var|const)\s+([A-Z][a-zA-Z0-9_]*)\s/gm)) exports.push(m[1]);

  // ── All identifiers ───────────────────────────────────────────────────────
  for (const line of lines) {
    for (const m of (line.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]{3,})\b/g) || [])) {
      const id = m[1];
      if (!GO_STOPWORDS.has(id)) allIdentifiers.push(id.toLowerCase());
    }
    // String literals
    for (const m of (line.matchAll(/"([^"\\]{4,80})"/g) || [])) {
      const val = m[1].trim();
      if (val && !val.includes('\n')) stringLiterals.push(val);
    }
    // Single-line comments //
    const commentIdx = line.indexOf('//');
    if (commentIdx !== -1) {
      const comment = line.slice(commentIdx + 2).trim();
      for (const word of comment.match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || []) {
        if (!GO_STOPWORDS.has(word)) commentTerms.push(word.toLowerCase());
      }
    }
  }

  // Block comments /* */
  for (const m of (raw.matchAll(/\/\*([\s\S]*?)\*\//g) || [])) {
    for (const word of (m[1].match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || [])) {
      if (!GO_STOPWORDS.has(word)) commentTerms.push(word.toLowerCase());
    }
  }

  const idFreq = new Map();
  for (const id of allIdentifiers) idFreq.set(id, (idFreq.get(id) || 0) + 1);
  const topIds = [...idFreq.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    allIdentifiers: topIds,
    stringLiterals: stringLiterals.slice(0, 20),
    commentTerms: [...new Set(commentTerms)].slice(0, 40),
    lineCount: lines.length,
    charCount: raw.length,
    manualPivot: MANUAL_PIVOT_RE.test(raw),
  };
}

module.exports = { parseGo };
