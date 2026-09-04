import test from 'node:test';
import assert from 'node:assert/strict';

import { htmlq, stdoutOf } from './helpers.js';
import { HELP_TEXT, VERSION } from '../src/cli.js';

const CLASS_DOC =
  '<html><head></head><body><div class="hi"><a href="/foo/bar">Hello</a></div></body></html>';
const ID_DOC =
  '<html><head></head><body><div id="my-id"><a href="/foo/bar">Hello</a></div></body></html>';

test('find_by_class', () => {
  assert.equal(
    stdoutOf(['.hi'], CLASS_DOC),
    '<div class="hi"><a href="/foo/bar">Hello</a></div>\n',
  );
});

test('find_by_id', () => {
  assert.equal(
    stdoutOf(['#my-id'], ID_DOC),
    '<div id="my-id"><a href="/foo/bar">Hello</a></div>\n',
  );
});

test('remove_links', () => {
  assert.equal(
    stdoutOf(['#my-id', '--remove-nodes', 'a'], ID_DOC),
    '<div id="my-id"></div>\n',
  );
});

test('--help matches the clap-generated text byte for byte', () => {
  const result = htmlq(['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, HELP_TEXT);
  assert.equal(htmlq(['-h']).stdout, HELP_TEXT);
});

test('--version prints "htmlq <version>"', () => {
  assert.equal(htmlq(['--version']).stdout, `htmlq ${VERSION}\n`);
  assert.equal(htmlq(['-V']).stdout, `htmlq ${VERSION}\n`);
});

test('default selector is html and empty input yields a full document', () => {
  assert.equal(
    stdoutOf([], ''),
    '<html><head></head><body></body></html>\n',
  );
});

test('a second positional argument is a usage error with exit 2', () => {
  const result = htmlq(['span', 'div'], '<span>x</span>');
  assert.equal(result.status, 2);
  assert.equal(
    result.stderr,
    "error: unexpected argument 'div' found\n\n" +
      'Usage: htmlq [OPTIONS] [SELECTOR]\n\n' +
      "For more information, try '--help'.\n",
  );
  assert.equal(result.stdout, '');
});

test('an unknown flag suggests the -- escape hatch', () => {
  const result = htmlq(['--bogus'], '');
  assert.equal(result.status, 2);
  assert.equal(
    result.stderr,
    "error: unexpected argument '--bogus' found\n\n" +
      "  tip: to pass '--bogus' as a value, use '-- --bogus'\n\n" +
      'Usage: htmlq [OPTIONS] [SELECTOR]\n\n' +
      "For more information, try '--help'.\n",
  );
});

test('a flag missing its value reports without a usage block', () => {
  const result = htmlq(['--filename'], '');
  assert.equal(result.status, 2);
  assert.equal(
    result.stderr,
    "error: a value is required for '--filename <INPUT_PATH>' but none was supplied\n\n" +
      "For more information, try '--help'.\n",
  );
});

test('-- terminates option parsing', () => {
  assert.equal(
    stdoutOf(['--', '#x'], '<div id="x">v</div>'),
    '<div id="x">v</div>\n',
  );
});

test('short options accept attached values and pack together', () => {
  const doc = '<div id="x"> <b>Hi</b> </div>';
  assert.equal(stdoutOf(['-ti', '#x'], doc), 'Hi\n\n');
  assert.equal(stdoutOf(['-ahref', 'a'], '<a href="/v">L</a>'), '/v\n');
});

test('a missing input file panics with exit 101', () => {
  const result = htmlq(['-f', '/nonexistent/htmlq-input.html']);
  assert.equal(result.status, 101);
  assert.match(result.stderr, /should have opened input file/);
});

test('an unparseable selector panics with exit 101', () => {
  const result = htmlq(['>>>bad'], '<div>x</div>');
  assert.equal(result.status, 101);
  assert.match(result.stderr, /Failed to parse CSS selector/);
});

test('an empty selector panics with exit 101', () => {
  assert.equal(htmlq([''], '<div>x</div>').status, 101);
});

test('zero matches still exits 0 with no output', () => {
  const result = htmlq(['.nothing'], '<div>x</div>');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
