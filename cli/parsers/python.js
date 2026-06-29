'use strict';

/**
 * Python grammar parser — Tier 2 language support.
 * Line-by-line regex extraction of imports, exports, identifiers, string
 * literals, and comment terms. No external dependencies. Same return shape
 * as parseBabel() in cli/index.js.
 */

const MANUAL_PIVOT_RE = /^[ \t]*#[ \t]*@vectora[ \t]+pivot[ \t]*$/m;

// Python keywords and builtins to exclude from identifier vocabulary
const PY_STOPWORDS = new Set([
  'self', 'cls', 'None', 'True', 'False', 'pass', 'break', 'continue',
  'return', 'yield', 'raise', 'import', 'from', 'with', 'else', 'elif',
  'except', 'finally', 'lambda', 'global', 'nonlocal', 'assert', 'del',
  'print', 'range', 'len', 'list', 'dict', 'tuple', 'set', 'str', 'int',
  'float', 'bool', 'bytes', 'type', 'object', 'super', 'isinstance',
  'hasattr', 'getattr', 'setattr', 'enumerate', 'zip', 'map', 'filter',
  'open', 'read', 'write', 'close', 'append', 'extend', 'items', 'keys',
  'values', 'format', 'strip', 'split', 'join', 'lower', 'upper',
]);

function parsePython(raw, filepath) {
  const imports = [];
  const exports = [];
  const allIdentifiers = [];
  const stringLiterals = [];
  const commentTerms = [];

  const lines = raw.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();

    // ── Imports ──────────────────────────────────────────────────────────────
    // from X import Y, Z  or  from .X import Y
    const fromMatch = trim.match(/^from\s+([\w.]+)\s+import\s+/);
    if (fromMatch) {
      const src = fromMatch[1];
      // Relative imports: convert leading dots to relative path notation
      imports.push(src.startsWith('.') ? src : src);
    }

    // import X  or  import X as Y  or  import X, Y
    const impMatch = trim.match(/^import\s+([\w.,\s]+)/);
    if (impMatch && !fromMatch) {
      for (const part of impMatch[1].split(',')) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim();
        if (mod) imports.push(mod);
      }
    }

    // ── Exports (top-level only — not indented) ───────────────────────────────
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      // def foo(  — public functions only (not _private or __dunder__)
      const defMatch = trim.match(/^(?:async\s+)?def\s+([a-zA-Z][a-zA-Z0-9_]*)\s*\(/);
      if (defMatch && !defMatch[1].startsWith('_')) exports.push(defMatch[1]);

      // class Foo:
      const classMatch = trim.match(/^class\s+([a-zA-Z][a-zA-Z0-9_]*)/);
      if (classMatch && !classMatch[1].startsWith('_')) exports.push(classMatch[1]);

      // CONSTANT = ...   (module-level uppercase)
      const constMatch = trim.match(/^([A-Z][A-Z0-9_]{2,})\s*=/);
      if (constMatch) exports.push(constMatch[1]);
    }

    // ── All identifiers (every line, deduped later) ───────────────────────────
    for (const m of (trim.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]{3,})\b/g) || [])) {
      const id = m[1];
      if (!PY_STOPWORDS.has(id)) allIdentifiers.push(id.toLowerCase());
    }

    // ── String literals (route paths, error messages, keys) ──────────────────
    for (const m of (trim.matchAll(/"([^"\\]{4,80})"|'([^'\\]{4,80})'/g) || [])) {
      const val = (m[1] || m[2] || '').trim();
      // Keep path-like or message-like strings, skip code fragments
      if (val && !/^[{[\s\\]/.test(val) && !val.includes('\n') && !/^\s*$/.test(val)) {
        stringLiterals.push(val);
      }
    }

    // ── Comments ──────────────────────────────────────────────────────────────
    const hashIdx = trim.indexOf('#');
    if (hashIdx !== -1) {
      const comment = trim.slice(hashIdx + 1).trim();
      // Simple word tokenizer for comments
      for (const word of comment.match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || []) {
        if (!PY_STOPWORDS.has(word.toLowerCase())) commentTerms.push(word.toLowerCase());
      }
    }
  }

  // Docstrings (triple-quoted) — extract first line of each
  for (const m of (raw.matchAll(/"""([\s\S]*?)"""|'''([\s\S]*?)'''/g) || [])) {
    const doc = (m[1] || m[2] || '').trim().split('\n')[0].trim();
    if (doc && doc.length >= 4) {
      for (const word of doc.match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || []) {
        commentTerms.push(word.toLowerCase());
      }
    }
  }

  // Deduplicate identifiers, keep top 40 by frequency
  const idFreq = new Map();
  for (const id of allIdentifiers) idFreq.set(id, (idFreq.get(id) || 0) + 1);
  const topIds = [...idFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([id]) => id);

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

module.exports = { parsePython };
