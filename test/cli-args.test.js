/**
 * Argument-parsing conformance with clap 4.5.
 *
 * Every expected string here was captured byte-for-byte from the Rust binary.
 * These cases exist because the original differential matrix only ever varied
 * *valid* flag combinations, which hid a class of bugs where the JS parser
 * accepted input clap rejects -- silently, with exit 0, and in the `-o` case
 * with a filesystem side effect Rust never performs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { htmlq } from './helpers.js';

const USAGE = 'Usage: htmlq [OPTIONS] [SELECTOR]';
const TRY_HELP = "For more information, try '--help'.";
const DOC = '<p id="q">x</p>';

const duplicate = (display) =>
  `error: the argument '${display}' cannot be used multiple times\n\n${USAGE}\n\n${TRY_HELP}\n`;

const missingValue = (display) =>
  `error: a value is required for '${display}' but none was supplied\n\n${TRY_HELP}\n`;

const unexpectedArg = (token) =>
  `error: unexpected argument '${token}' found\n\n  tip: to pass '${token}' as a value, use '-- ${token}'\n\n${USAGE}\n\n${TRY_HELP}\n`;

test('repeated single-value options are rejected', () => {
  const cases = [
    [['-b', 'https://a/', '-b', 'https://b/'], '--base <BASE>'],
    [['--base', 'https://a/', '--base', 'https://b/'], '--base <BASE>'],
    [['-f', 'a.html', '-f', 'b.html'], '--filename <INPUT_PATH>'],
    [['-o', 'a.txt', '-o', 'b.txt'], '--output <OUTPUT_PATH>'],
  ];
  for (const [args, display] of cases) {
    const r = htmlq(args, DOC);
    assert.equal(r.status, 2, `exit for ${args.join(' ')}`);
    assert.equal(r.stderr, duplicate(display));
    assert.equal(r.stdout, '');
  }
});

test('repeated flags are rejected, including packed forms', () => {
  const cases = [
    [['-t', '-t'], '--text'],
    [['-tt'], '--text'],
    [['-ti', '-i'], '--ignore-whitespace'],
    [['-p', '--pretty'], '--pretty'],
    [['-B', '-B'], '--detect-base'],
  ];
  for (const [args, display] of cases) {
    const r = htmlq(args, DOC);
    assert.equal(r.status, 2, `exit for ${args.join(' ')}`);
    assert.equal(r.stderr, duplicate(display));
  }
});

test('a duplicate --output does not create any file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlq-'));
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  const r = htmlq(['-o', a, '-o', b], DOC);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(a), false, 'first output file must not be created');
  assert.equal(fs.existsSync(b), false, 'second output file must not be created');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a known option is never swallowed as another option value', () => {
  const cases = [
    [['-a', '-t'], '--attributes <ATTRIBUTES>'],
    [['-b', '-p'], '--base <BASE>'],
    [['-r', '-i'], '--remove-nodes <REMOVE_NODES>'],
    [['-f', '-o'], '--filename <INPUT_PATH>'],
    [['--base', '--text'], '--base <BASE>'],
    [['-b', '--'], '--base <BASE>'],
    [['-b', '-tx'], '--base <BASE>'],
  ];
  for (const [args, display] of cases) {
    const r = htmlq(args, DOC);
    assert.equal(r.status, 2, `exit for ${args.join(' ')}`);
    assert.equal(r.stderr, missingValue(display));
  }
});

test('an unknown dash token after a value option is an unexpected argument', () => {
  for (const [args, token] of [
    [['-b', '-x'], '-x'],
    [['-a', '--bogus'], '--bogus'],
  ]) {
    const r = htmlq(args, DOC);
    assert.equal(r.status, 2);
    assert.equal(r.stderr, unexpectedArg(token));
  }
});

test('a bare dash is a valid value, not an option', () => {
  for (const args of [['-f', '-'], ['-o', '-'], ['-b', '-'], ['-r', '-'], ['-a', '-']]) {
    assert.equal(htmlq([...args, 'p'], DOC).status, 0, args.join(' '));
  }
});

test('attached values may begin with a dash', () => {
  for (const args of [['--base=-x'], ['-b-x']]) {
    assert.equal(htmlq([...args, 'p'], DOC).status, 0, args.join(' '));
  }
});

test('one equals sign joining a short option to its value is stripped', () => {
  const withEquals = htmlq(['-a=id', 'p'], DOC);
  assert.equal(withEquals.status, 0);
  assert.equal(withEquals.stdout, 'q\n');
  assert.equal(htmlq(['-ahref', 'p'], DOC).stdout, htmlq(['-a', 'href', 'p'], DOC).stdout);
});

test('flags reject an inline value with a flag-specific usage line', () => {
  for (const [args, long] of [
    [['--text=x'], 'text'],
    [['--pretty=1'], 'pretty'],
    [['--help=x'], 'help'],
    [['--version=x'], 'version'],
  ]) {
    const r = htmlq(args, DOC);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(
      r.stderr,
      `error: unexpected value '${args[0].split('=')[1]}' for '--${long}' found; no more were expected\n\n` +
        `Usage: htmlq --${long} [SELECTOR]\n\n${TRY_HELP}\n`,
    );
  }
});

test('--remove-nodes and --attributes stay repeatable', () => {
  const doc = '<div id="x"><a href="/1">a</a><b>b</b></div>';
  assert.equal(htmlq(['-r', 'a', '-r', 'b', '#x'], doc).status, 0);
  const attrs = htmlq(['-a', 'id', '-a', 'id', '#x'], doc);
  assert.equal(attrs.status, 0);
  assert.equal(attrs.stdout, 'x\nx\n');
});

test('reading a directory reports the Result path, not a stack trace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlq-'));
  const r = htmlq(['-f', dir, 'p'], '');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith('Error: '), `got: ${r.stderr}`);
  assert.ok(!r.stderr.includes('at '), 'must not contain a stack trace');
  fs.rmSync(dir, { recursive: true, force: true });
});
