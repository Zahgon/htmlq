/**
 * Selector-engine conformance with Servo's `selectors` crate as used by
 * `kuchikiki`.
 *
 * The acceptance/rejection sets and the match semantics below were all captured
 * from the Rust binary. They are the reason `src/selector-parse.js` and
 * `src/selector-match.js` exist rather than a third-party CSS engine: every
 * off-the-shelf JS engine disagreed in both directions, and the disagreements
 * were silent wrong answers rather than errors.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlq } from './helpers.js';
import { parseSelectorList } from '../src/selector-parse.js';
import { compileSelectorList } from '../src/selector-match.js';

const accepts = (selector) => {
  parseSelectorList(selector);
};

const rejects = (selector) => {
  assert.throws(() => parseSelectorList(selector), `expected ${selector} to be rejected`);
};

test('selectors Servo rejects are rejected here', () => {
  for (const selector of [
    ':is(a,p)', ':where(a)', ':has(p)', ':matches(a)',
    ':not(a,p)', ':not(div a)', 'a:not(:not(a))',
    '#1abc', '.1abc', '[a=]', '[=b]', 'a[href=/f]', 'div[',
    '-', '+', '>', '~', '',
    ':required', ':optional', ':target', ':lang(en)',
    '::before', ':before', '::first-line', 'p::before',
    'p|*', ':nth-child()', ':nth-child(foo)', '[id i]',
  ]) {
    rejects(selector);
  }
});

test('selectors Servo accepts are accepted here', () => {
  for (const selector of [
    '*|a', '|a', '[*|id]', '[|id]',
    ':focus', ':indeterminate', ':enabled', ':disabled', ':checked',
    ':hover', ':active', ':visited', ':link', ':any-link', ':scope', ':root',
    '[id', 'a[href', '[id="x"',
    ':NTH-CHILD(2)', ':FIRST-CHILD', ':Not(p)',
    ':not(#x)', ':not(*)', ':not(:first-child)',
    ':nth-child(  2  )', ':nth-child(+2)', ':nth-child( odd )',
    '#-x', '.-x', '#_x', '#x\\.y', '\\2d abc',
    '[href$=".css" i]', '[href^="/" s]',
  ]) {
    accepts(selector);
  }
});

test('type and attribute names fold case only for HTML elements', () => {
  const doc = '<a href="/h">h</a><svg><a href="/s">s</a></svg>';
  assert.equal(htmlq(['A'], doc).stdout, '<a href="/h">h</a>\n');
  assert.equal(htmlq(['[HREF]'], doc).stdout, '<a href="/h">h</a>\n');
  assert.equal(htmlq(['SVG'], doc).stdout, '');
  assert.equal(htmlq(['TEXT'], doc).stdout, '');
});

test('state pseudo-classes parse but match nothing, as kuchikiki tracks no state', () => {
  const doc = '<form><input disabled><input checked><a href="/x">l</a></form>';
  for (const selector of [':disabled', ':checked', ':enabled', ':focus', ':hover', ':visited']) {
    const r = htmlq([selector], doc);
    assert.equal(r.status, 0, selector);
    assert.equal(r.stdout, '', `${selector} must match nothing`);
  }
});

test(':link matches only HTML a/area/link carrying href', () => {
  const doc = '<a href="/h">h</a><a>bare</a><svg><a href="/s">s</a></svg>';
  assert.equal(htmlq([':link'], doc).stdout, '<a href="/h">h</a>\n');
  assert.equal(htmlq([':any-link'], doc).stdout, '<a href="/h">h</a>\n');
});

test('the none namespace matches nothing because parsed elements always have one', () => {
  assert.equal(htmlq(['|a'], '<a href="/h">h</a>').stdout, '');
  assert.equal(htmlq(['*|a'], '<a href="/h">h</a>').stdout, '<a href="/h">h</a>\n');
});

test('an unterminated block is closed at end of input', () => {
  const doc = '<div id="x">d</div>';
  assert.equal(htmlq(['[id'], doc).stdout, '<div id="x">d</div>\n');
  assert.equal(htmlq(['[id="x"'], doc).stdout, '<div id="x">d</div>\n');
});

test('an invalid selector exits 101 rather than silently returning wrong results', () => {
  for (const selector of [':is(a,p)', ':has(p)', '#1abc', '[a=]', '>']) {
    const r = htmlq([selector], '<p>x</p>');
    assert.equal(r.status, 101, selector);
    assert.equal(r.stdout, '', `${selector} must not emit output`);
  }
});

test('compiled selectors are reusable predicates', () => {
  const match = compileSelectorList('div > .hi');
  assert.equal(typeof match, 'function');
});
