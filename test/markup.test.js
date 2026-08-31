import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return full.includes(`${path.sep}ui`) ? [] : walk(full);
    return e.name.endsWith('.svelte') ? [full] : [];
  });
}

const GLOBALS = new Set([
  'Math', 'Object', 'Array', 'JSON', 'Number', 'String', 'Boolean', 'Date', 'Set', 'Map',
  'console', 'window', 'document', 'navigator', 'setTimeout', 'clearTimeout', 'fetch',
  'structuredClone', 'encodeURIComponent', 'decodeURIComponent', 'RegExp', 'Error', 'Promise',
  'undefined', 'null', 'true', 'false', 'this', 'globalThis', 'isNaN', 'parseInt', 'parseFloat',
]);

function declared(script, markup) {
  const names = new Set();
  const add = (s) => s && names.add(s.trim());

  for (const m of script.matchAll(/(?:let|const|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of script.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of script.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) add(part.split(/\s+as\s+/).pop());
  }
  for (const m of script.matchAll(/(?:let|const)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) add(part.split(':').pop().split('=')[0]);
  }
  for (const m of script.matchAll(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) add(part.split(/[=:]/)[0].replace(/[{}[\].]/g, ''));
  }
  for (const m of script.matchAll(/\$props\(\)/g)) void m;
  for (const m of script.matchAll(/let\s*\{([\s\S]*?)\}\s*(?::[^=]*)?=\s*\$props\(\)/g)) {
    for (const part of m[1].split(',')) add(part.split('=')[0].split(':').pop().replace(/[{}[\]]/g, ''));
  }

  for (const m of markup.matchAll(/\{#each\s+[\s\S]*?\s+as\s+([^(){}]+)/g)) {
    for (const part of m[1].split(',')) add(part.replace(/[[\]]/g, ''));
  }
  for (const m of markup.matchAll(/(?:\(|,)\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*\)?\s*=>/g)) add(m[1]);
  for (const m of markup.matchAll(/([A-Za-z_$][\w$,\s]*?)\s*=>/g)) {
    for (const part of m[1].split(',')) add(part.replace(/[()]/g, ''));
  }
  for (const m of markup.matchAll(/\{@const\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of markup.matchAll(/\{#snippet\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    add(m[1]);
    for (const part of m[2].split(',')) add(part.replace(/[{}[\]]/g, '').split(':')[0]);
  }
  for (const m of markup.matchAll(/\{#await\s+[^}]*?\s+then\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  return names;
}

function referenced(markup) {
  const used = new Set();
  const expressions = markup.replace(/<!--[\s\S]*?-->/g, '');

  for (const m of expressions.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1]
      .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ')
      .replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ')
      .replace(/([A-Za-z_$][\w$]*)\s*:/g, ' ')
      .replace(/[A-Za-z_$][\w$,\s()]*?=>/g, ' ');
    for (const id of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)) used.add(id[1]);
  }
  return used;
}

const KEYWORDS = new Set([
  'if', 'else', 'each', 'as', 'key', 'const', 'snippet', 'render', 'await', 'then', 'catch',
  'html', 'debug', 'in', 'of', 'new', 'typeof', 'instanceof', 'void', 'return', 'class', 'style',
]);

test('every identifier a component renders is declared or imported', () => {
  const problems = [];

  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    const cut = src.lastIndexOf('</script>');
    const script = cut === -1 ? '' : src.slice(0, cut);
    const markup = cut === -1 ? src : src.slice(cut);

    const known = declared(script, markup);
    for (const name of referenced(markup)) {
      if (KEYWORDS.has(name) || GLOBALS.has(name) || known.has(name)) continue;
      problems.push(`${path.relative(ROOT, file)} :: ${name}`);
    }
  }

  assert.deepEqual(problems, [], `undefined in markup:\n  ${problems.join('\n  ')}`);
});
