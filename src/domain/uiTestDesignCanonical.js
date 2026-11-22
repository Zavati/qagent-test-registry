import { TestRegistryError } from './errors.js';

export const UI_COMPILATION_MAX_BYTES = 768 * 1024;
export const UI_APPEND_MAX_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function validString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TestRegistryError('Invalid Unicode in UI JSON.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID' });
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TestRegistryError('Invalid Unicode in UI JSON.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID' });
  }
  return value;
}

export function canonicalUiJson(value) {
  let nodes = 0;
  function encode(item, depth) {
    if (++nodes > 100000 || depth > 48) throw new TestRegistryError('UI payload exceeds structural limits.', { code: 'UI_TEST_DESIGN_LIMIT_EXCEEDED', status: 413 });
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') return JSON.stringify(validString(item));
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) if (!Object.hasOwn(item, index)) throw new TestRegistryError('Sparse UI JSON array.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID' });
      return '[' + item.map(child => encode(child, depth + 1)).join(',') + ']';
    }
    if (item && typeof item === 'object' && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      return '{' + Object.keys(item).sort().map(key => {
        if (forbidden.has(key)) throw new TestRegistryError('Forbidden UI property.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID', path: key });
        return JSON.stringify(validString(key)) + ':' + encode(item[key], depth + 1);
      }).join(',') + '}';
    }
    throw new TestRegistryError('UI payload must contain finite JSON values.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID' });
  }
  return encode(value, 0);
}
export function uiByteLength(text) { return encoder.encode(text).byteLength; }
export async function uiSha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function uiContentHash(value) { return uiSha256(canonicalUiJson(value)); }

/** Authenticated JSON still has to be unambiguous: JSON.parse alone hides duplicate keys. */
export function parseUiJsonStrict(text) {
  let offset = 0, nodes = 0;
  const invalid = () => { throw new TestRegistryError('UI Registry JSON is invalid or ambiguous.', { code: 'UI_TEST_REGISTRY_JSON_INVALID', status: 400 }); };
  const whitespace = () => { while (offset < text.length && /[\x20\t\r\n]/.test(text[offset])) offset += 1; };
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') { try { return validString(JSON.parse(text.slice(start, offset))); } catch { invalid(); } }
      if (char === '\\') offset += 1;
    }
    invalid();
  }
  function value(depth) {
    if (depth > 48 || ++nodes > 100000) throw new TestRegistryError('UI JSON exceeds structural limits.', { code: 'UI_TEST_DESIGN_LIMIT_EXCEEDED', status: 413 });
    whitespace(); const char = text[offset];
    if (char === '"') return string();
    if (char === '{') {
      offset += 1; const out = Object.create(null); whitespace();
      if (text[offset] === '}') { offset += 1; return out; }
      while (offset < text.length) {
        whitespace(); if (text[offset] !== '"') invalid(); const key = string(); whitespace();
        if (forbidden.has(key) || Object.hasOwn(out, key) || text[offset++] !== ':') invalid();
        out[key] = value(depth + 1); whitespace(); const ending = text[offset++];
        if (ending === '}') return out; if (ending !== ',') invalid();
      }
      invalid();
    }
    if (char === '[') {
      offset += 1; const out = []; whitespace();
      if (text[offset] === ']') { offset += 1; return out; }
      while (offset < text.length) { out.push(value(depth + 1)); whitespace(); const ending = text[offset++]; if (ending === ']') return out; if (ending !== ',') invalid(); }
      invalid();
    }
    for (const [word, output] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(word, offset)) { offset += word.length; return output; }
    const match = text.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) invalid(); offset += match[0].length; const n = Number(match[0]); if (!Number.isFinite(n)) invalid(); return n;
  }
  const result = value(0); whitespace(); if (offset !== text.length) invalid(); return result;
}
