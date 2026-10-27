import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';

export function validateExtensionScripts(target) {
  const manifest = JSON.parse(readFileSync(resolve(target, 'manifest.json'), 'utf8'));
  const seen = new Set();
  const accessible = (name, matches) =>
    (manifest.web_accessible_resources ?? []).some(
      (entry) =>
        matches.every((match) => entry.matches.includes(match)) &&
        entry.resources.some((pattern) =>
          new RegExp(
            `^${pattern
              .split('*')
              .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
              .join('.*')}$`,
          ).test(name),
        ),
    );
  function check(name, classic, matches) {
    const path = resolve(target, name);
    const local = relative(resolve(target), path);
    if (local.startsWith('..') || !existsSync(path))
      throw new Error(`Missing/inaccessible script: ${name}`);
    const code = readFileSync(path, 'utf8');
    if (classic) new Script(code, { filename: name });
    const key = `${name}:${classic}:${matches.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      const dynamic =
        ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (dynamic || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (classic && name === 'page-bridge.js')
          throw new Error('Classic page bridge cannot import runtime code.');
        const specifier = dynamic ? node.arguments[0] : node.moduleSpecifier;
        if (specifier && ts.isStringLiteral(specifier)) {
          if (!specifier.text.startsWith('.')) throw new Error(`Nonlocal script import in ${name}`);
          const dependency = relative(
            resolve(target),
            resolve(dirname(path), specifier.text),
          ).replaceAll('\\', '/');
          if (matches.length && !accessible(dependency, matches))
            throw new Error(`Chunk is not web accessible: ${dependency}`);
          check(dependency, false, matches);
        } else if (dynamic) {
          // The isolated bootstrap has one fixed chrome.runtime URL; validate its target explicitly.
          if (name !== 'content-loader.js' || !code.includes("chrome.runtime.getURL('content.js')"))
            throw new Error(`Unverifiable dynamic import in ${name}`);
          if (!accessible('content.js', matches))
            throw new Error('content.js is not web accessible.');
          check('content.js', false, matches);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const bridge = manifest.content_scripts?.find((entry) => entry.js?.includes('page-bridge.js'));
  if (!bridge || bridge.world !== 'MAIN' || bridge.run_at !== 'document_start')
    throw new Error('Missing MAIN document_start page bridge.');
  for (const entry of manifest.content_scripts ?? [])
    for (const name of entry.js ?? []) check(name, true, entry.matches);
  check(manifest.background.service_worker, manifest.background.type !== 'module', []);
  const popup = manifest.action?.default_popup;
  if (typeof popup !== 'string' || !existsSync(resolve(target, popup)))
    throw new Error('Missing popup entrypoint.');
  const html = readFileSync(resolve(target, popup), 'utf8');
  for (const tag of html.matchAll(/<script\b([^>]*)>/gi)) {
    const source = /\bsrc=["']([^"']+)["']/i.exec(tag[1]);
    if (source) {
      const name = source[1].replace(/^\//, '');
      check(name, !/\btype=["']module["']/i.test(tag[1]), []);
    }
  }
}
