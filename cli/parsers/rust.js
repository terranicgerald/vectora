'use strict';

/**
 * Rust grammar parser — Tier 2 language support.
 * Extracts use/mod declarations, pub exports, identifiers, string literals,
 * and doc/line comments. No external dependencies.
 */

const MANUAL_PIVOT_RE = /^[ \t]*\/\/[ \t]*@vectora[ \t]+pivot[ \t]*$/m;

const RUST_STOPWORDS = new Set([
  'self', 'super', 'crate', 'impl', 'trait', 'where', 'type', 'enum',
  'struct', 'union', 'match', 'loop', 'while', 'return', 'break',
  'continue', 'else', 'move', 'async', 'await', 'dyn', 'extern',
  'unsafe', 'static', 'const', 'true', 'false', 'none', 'some',
  'result', 'option', 'string', 'vector', 'hashmap', 'error', 'panic',
  'println', 'format', 'assert', 'clone', 'copy', 'iter', 'into',
  'from', 'into', 'default', 'display', 'debug', 'send', 'sync',
]);

function parseRust(raw, filepath) {
  const imports = [];
  const exports = [];
  const allIdentifiers = [];
  const stringLiterals = [];
  const commentTerms = [];

  const lines = raw.split('\n');

  for (const line of lines) {
    const trim = line.trim();

    // ── Imports via use declarations ──────────────────────────────────────────
    // use crate::auth::session;  →  crate::auth::session
    // use super::config;         →  super::config
    // use std::collections::HashMap;  →  ignored (std)
    const useMatch = trim.match(/^(?:pub\s+)?use\s+([\w:]+(?:::\{[^}]*\})?);/);
    if (useMatch) {
      const path = useMatch[1];
      if (path.startsWith('crate::') || path.startsWith('super::') || path.startsWith('self::')) {
        imports.push(path);
      }
      // External crate (first segment is the crate name)
      else if (!path.startsWith('std::') && !path.startsWith('core::') && !path.startsWith('alloc::')) {
        const crate = path.split('::')[0];
        if (crate) imports.push(crate);
      }
    }

    // mod declarations: mod payments;  →  creates edge to payments.rs or payments/mod.rs
    const modMatch = trim.match(/^(?:pub\s+)?mod\s+([a-z][a-z0-9_]+);/);
    if (modMatch) imports.push(`mod::${modMatch[1]}`);

    // ── Exported symbols (pub fn, pub struct, pub enum, pub trait, pub const) ─
    const pubFnMatch = trim.match(/^pub(?:\(crate\))?\s+(?:async\s+)?fn\s+([a-zA-Z][a-zA-Z0-9_]*)/);
    if (pubFnMatch) exports.push(pubFnMatch[1]);

    const pubStructMatch = trim.match(/^pub(?:\(crate\))?\s+struct\s+([A-Z][a-zA-Z0-9_]*)/);
    if (pubStructMatch) exports.push(pubStructMatch[1]);

    const pubEnumMatch = trim.match(/^pub(?:\(crate\))?\s+enum\s+([A-Z][a-zA-Z0-9_]*)/);
    if (pubEnumMatch) exports.push(pubEnumMatch[1]);

    const pubTraitMatch = trim.match(/^pub(?:\(crate\))?\s+trait\s+([A-Z][a-zA-Z0-9_]*)/);
    if (pubTraitMatch) exports.push(pubTraitMatch[1]);

    const pubConstMatch = trim.match(/^pub(?:\(crate\))?\s+const\s+([A-Z][A-Z0-9_]+)/);
    if (pubConstMatch) exports.push(pubConstMatch[1]);

    // ── All identifiers ────────────────────────────────────────────────────────
    for (const m of (trim.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]{3,})\b/g) || [])) {
      const id = m[1].toLowerCase();
      if (!RUST_STOPWORDS.has(id)) allIdentifiers.push(id);
    }

    // ── String literals ────────────────────────────────────────────────────────
    for (const m of (trim.matchAll(/"([^"\\]{4,80})"/g) || [])) {
      const val = m[1].trim();
      if (val && !val.includes('\n')) stringLiterals.push(val);
    }

    // ── Line comments // and doc comments /// ─────────────────────────────────
    const commentIdx = trim.indexOf('//');
    if (commentIdx !== -1) {
      const comment = trim.slice(commentIdx + 2).replace(/^\//, '').trim(); // strip extra / for ///
      for (const word of (comment.match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || [])) {
        if (!RUST_STOPWORDS.has(word.toLowerCase())) commentTerms.push(word.toLowerCase());
      }
    }
  }

  // Block comments /* */
  for (const m of (raw.matchAll(/\/\*([\s\S]*?)\*\//g) || [])) {
    for (const word of (m[1].match(/[a-zA-Z][a-zA-Z0-9_]{3,}/g) || [])) {
      if (!RUST_STOPWORDS.has(word.toLowerCase())) commentTerms.push(word.toLowerCase());
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

module.exports = { parseRust };
