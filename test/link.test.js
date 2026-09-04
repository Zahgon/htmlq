import test from 'node:test';
import assert from 'node:assert/strict';

import { parse } from 'parse5';
import { compileSelectorList } from '../src/selector-match.js';

import { adapter } from '../src/tree.js';
import { select } from '../src/traverse.js';
import { serialize } from '../src/serializer.js';
import { rewriteRelativeUrl, detectBase, parseAbsoluteUrl } from '../src/link.js';

const BASE = new URL('https://mgdm.net');
const LINK_SELECTOR = compileSelectorList('a, area, link');

function makeDoc(html) {
  return parse(html, { treeAdapter: adapter });
}

function rewriteAll(html) {
  const doc = makeDoc(html);
  for (const node of select(doc, LINK_SELECTOR)) {
    rewriteRelativeUrl(node, BASE);
  }
  return serialize(doc);
}

const rewriteCases = {
  rewrite_a_href: [
    '<html><head></head><body><a href="/foo/bar">Hello</a></body></html>',
    '<html><head></head><body><a href="https://mgdm.net/foo/bar">Hello</a></body></html>',
  ],
  rewrite_link_href: [
    '<html><head><link  href="/style.css" rel="stylesheet"/></head><body>Hello</body></html>',
    '<html><head><link href="https://mgdm.net/style.css" rel="stylesheet"></head><body>Hello</body></html>',
  ],
  rewrite_map_area_href: [
    '<html><head></head><body><map name="primary"><area coords="75,75,75" href="left.html" shape="circle"></map></body></html>',
    '<html><head></head><body><map name="primary"><area coords="75,75,75" href="https://mgdm.net/left.html" shape="circle"></map></body></html>',
  ],
  do_not_rewrite_absolute_url: [
    '<html><head></head><body><a href="https://example.org/foo/bar">Hello</a></body></html>',
    '<html><head></head><body><a href="https://example.org/foo/bar">Hello</a></body></html>',
  ],
};

for (const [name, [input, expected]] of Object.entries(rewriteCases)) {
  test(name, () => {
    assert.equal(rewriteAll(input), expected);
  });
}

test('base_ok', () => {
  const doc = makeDoc(
    '<html><head><base href="https://example.org"></head><body><a href="https://example.org/foo/bar">Hello</a></body></html>',
  );
  assert.deepEqual(detectBase(doc), parseAbsoluteUrl('https://example.org'));
});

test('base_not_found', () => {
  const doc = makeDoc(
    '<html><head></head><body><a href="https://example.org/foo/bar">Hello</a></body></html>',
  );
  assert.equal(detectBase(doc), null);
});

test('a <base> without href yields no base', () => {
  assert.equal(detectBase(makeDoc('<base>')), null);
});

test('a relative <base href> is not absolute, so it yields no base', () => {
  assert.equal(detectBase(makeDoc('<base href="/relative/">')), null);
});

test('parseAbsoluteUrl rejects relative and malformed input', () => {
  assert.equal(parseAbsoluteUrl('notaurl'), null);
  assert.equal(parseAbsoluteUrl('/relative'), null);
  assert.equal(parseAbsoluteUrl(''), null);
  assert.equal(parseAbsoluteUrl('https://example.org').href, 'https://example.org/');
});
