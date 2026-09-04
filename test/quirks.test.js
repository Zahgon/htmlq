/**
 * Behaviour locks.
 *
 * Every assertion here was captured from the original Rust binary. Several of
 * them look like bugs, and they are -- but reproducing them is the whole point
 * of this port, so treat a failure as a regression rather than as a fix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { htmlq, stdoutOf } from './helpers.js';

test('Q1 detaching a node truncates the match iterator', () => {
  assert.equal(
    stdoutOf(['.c', '-r', 'a'], '<p class=c><a href="/1">1</a><a href="/2">2</a></p><p class=c><a href="/3">3</a></p>'),
    '<p class="c"><a href="/2">2</a></p>\n',
  );
  assert.equal(
    stdoutOf(['li', '-r', 'a'], '<ul><li><a href=/1>1</a></li><li><a href=/2>2</a></li><li>3</li></ul>'),
    '<li></li>\n',
  );
});

test('Q1 removing a last child leaves the lookahead intact', () => {
  assert.equal(
    stdoutOf(['div', '-r', 'a'], '<div id=x>text<b>B</b><a href="/1">1</a></div><div id=y>Y</div>'),
    '<div id="x">text<b>B</b></div>\n<div id="y">Y</div>\n',
  );
});

test('Q2 -r removes only the first match inside each matched element', () => {
  assert.equal(
    stdoutOf(['#x', '-r', 'a'], '<div id=x><a>1</a><a>2</a><a>3</a></div>'),
    '<div id="x"><a>2</a><a>3</a></div>\n',
  );
});

test('Q3 -r matching is inclusive, so an element can detach itself and still print', () => {
  assert.equal(
    stdoutOf(['.c', '-r', '.c'], '<p class=c>1</p><p class=c>2</p>'),
    '<p class="c">1</p>\n',
  );
});

test('Q4 an invalid or absent -r selector is a silent no-op', () => {
  const doc = '<div id=x><a>1</a></div>';
  assert.equal(stdoutOf(['#x', '-r', '>>>bad'], doc), '<div id="x"><a>1</a></div>\n');
  assert.equal(stdoutOf(['#x', '-r', ''], doc), '<div id="x"><a>1</a></div>\n');
});

test('Q5 --base rewrites only the matched element, never its descendants', () => {
  assert.equal(
    stdoutOf(['body', '-b', 'https://mgdm.net'], '<body><a href="/foo">L</a></body>'),
    '<body><a href="/foo">L</a></body>\n',
  );
});

test('Q6 an href starting //// has its slashes stripped and skips resolution', () => {
  assert.equal(
    stdoutOf(['a', '-b', 'https://mgdm.net', '-a', 'href'], '<a href="////evil.com/x">L</a>'),
    'evil.com/x\n',
  );
  assert.equal(
    stdoutOf(['a', '-b', 'https://mgdm.net', '-a', 'href'], '<a href="//evil.com/x">L</a>'),
    'https://evil.com/x\n',
  );
});

test('an href starting with exactly /// falls back to the base for host-required schemes', () => {
  assert.equal(
    stdoutOf(['a', '-b', 'https://mgdm.net/sub/page', '-a', 'href'], '<a href="///three">L</a>'),
    'https://mgdm.net/sub/page\n',
  );
  assert.equal(
    stdoutOf(['a', '-b', 'file:///tmp/', '-a', 'href'], '<a href="///three">L</a>'),
    'file:///three\n',
  );
});

test('Q7 a non-absolute --base silently disables rewriting', () => {
  const result = htmlq(['a', '-b', 'notaurl', '-a', 'href'], '<a href="/foo">L</a>');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '/foo\n');
});

test('Q8 -a beats -t beats -p', () => {
  const doc = '<div id=x>text</div>';
  assert.equal(stdoutOf(['#x', '-a', 'id', '-t', '-p'], doc), 'x\n');
  assert.equal(stdoutOf(['#x', '-t', '-p'], doc), 'text\n');
});

test('Q9 -t includes script and style text', () => {
  assert.equal(
    stdoutOf(['html', '-t'], '<script>var a=1;</script><style>p{}</style>Vis'),
    'var a=1;p{}Vis\n',
  );
});

test('Q10 -t -i emits a trailing blank line', () => {
  const doc = '<div id=x> <b>Hi</b> <i>there</i> </div>';
  assert.equal(stdoutOf(['#x', '-t'], doc), ' Hi there \n');
  assert.equal(stdoutOf(['#x', '-t', '-i'], doc), 'Hi\nthere\n\n');
});

test('Q10 -i has no effect outside -t', () => {
  const doc = '<div id=x> <b>Hi</b> </div>';
  assert.equal(stdoutOf(['#x', '-i'], doc), stdoutOf(['#x'], doc));
});

test('Q11 -p output begins with a newline', () => {
  assert.equal(
    stdoutOf(['#x', '-p'], '<div id=x><p>Hello <b>bold</b> tail</p><ul><li>a</li><li>b</li></ul></div>'),
    '\n<div id="x">\n  <p>Hello <b>bold</b> tail\n  </p>\n  <ul>\n    <li>\n      a\n    </li>\n    <li>\n      b\n    </li>\n  </ul>\n</div>\n',
  );
});

test('Q12 < and > are not escaped inside attribute values', () => {
  assert.equal(
    stdoutOf(['#x'], '<div id=x title="a&quot;b&amp;c<d">a &amp; b &lt; c &gt; &nbsp;</div>'),
    '<div id="x" title="a&quot;b&amp;c<d">a &amp; b &lt; c &gt; &nbsp;</div>\n',
  );
});

test('Q13 void elements get no closing tag and no self-closing slash', () => {
  assert.equal(
    stdoutOf(['link'], '<link href="/a.css" rel="stylesheet"/>'),
    '<link href="/a.css" rel="stylesheet">\n',
  );
});

test('Q14 -a lookup is case-sensitive against parser-lowercased names', () => {
  const doc = '<a HREF="/1" DaTa-X="v">L</a>';
  assert.equal(stdoutOf(['a', '-a', 'href'], doc), '/1\n');
  assert.equal(stdoutOf(['a', '-a', 'data-x'], doc), 'v\n');
  assert.equal(stdoutOf(['a', '-a', 'HREF'], doc), '');
});

test('Q14 a repeated -a prints the value once per occurrence', () => {
  assert.equal(stdoutOf(['a', '-a', 'href', '-a', 'href'], '<a href="/1">L</a>'), '/1\n/1\n');
});

test('Q15 -r values join into one selector list, so one bad component disables all', () => {
  assert.equal(
    stdoutOf(['#x', '-r', 'a', '-r', '>>>bad'], '<div id=x><a>1</a><b>2</b></div>'),
    '<div id="x"><a>1</a><b>2</b></div>\n',
  );
});

test('Q16 -B falls back to --base when no <base> is present', () => {
  assert.equal(
    stdoutOf(['a', '-B', '-b', 'https://mgdm.net', '-a', 'href'], '<a href="/foo">L</a>'),
    'https://mgdm.net/foo\n',
  );
});

test('Q16 -B prefers a <base href> over --base', () => {
  assert.equal(
    stdoutOf(
      ['a', '-B', '-b', 'https://mgdm.net', '-a', 'href'],
      '<base href="https://example.org/sub/"><a href="rel">L</a>',
    ),
    'https://example.org/sub/rel\n',
  );
});

test('attributes keep source order even when the names look numeric', () => {
  assert.equal(
    stdoutOf(['#x'], '<div 2=a 0=b zz=c id=x>v</div>'),
    '<div 2="a" 0="b" zz="c" id="x">v</div>\n',
  );
});

test('a duplicated source attribute keeps the first value', () => {
  assert.equal(
    stdoutOf(['#x'], '<div id=x class=a class=b>v</div>'),
    '<div id="x" class="a">v</div>\n',
  );
});

test('a leading BOM is stripped from the input but kept inside text', () => {
  assert.equal(
    stdoutOf(['body'], '\ufeff<div id="x">\ufeffbom</div>'),
    '<body><div id="x">\ufeffbom</div></body>\n',
  );
});

test('an attribute selector does not match a namespaced attribute of the same local name', () => {
  const doc = '<svg><a xlink:href="/u"><text>t</text></a><a href="/v">w</a></svg>';
  assert.equal(stdoutOf(['[href^="/"]'], doc), '<a href="/v">w</a>\n');
});

test('-a uses the null namespace, so xlink:href is not readable as href', () => {
  const doc = '<svg><a xlink:href="/u">t</a></svg>';
  assert.equal(stdoutOf(['a', '-a', 'href'], doc), '');
  assert.equal(stdoutOf(['a', '-a', 'xlink:href'], doc), '');
});

test('an SVG <a href> is rewritten because only the local name is checked', () => {
  assert.equal(
    stdoutOf(['a', '-b', 'https://mgdm.net', '-a', 'href'], '<svg><a href="/v">w</a></svg>'),
    'https://mgdm.net/v\n',
  );
});

test('template contents are not reachable, matching html5ever fragment storage', () => {
  assert.equal(
    stdoutOf(['template'], '<template><p>inner</p></template>'),
    '<template></template>\n',
  );
});

test('a doctype outside the selected node is not emitted', () => {
  assert.equal(
    stdoutOf([], '<!DOCTYPE html><p>x'),
    '<html><head></head><body><p>x</p></body></html>\n',
  );
});

test('-t decodes entities', () => {
  assert.equal(
    stdoutOf(['#x', '-t'], '<div id=x>a &amp; b &lt; c &nbsp;d</div>'),
    'a & b < c \u00a0d\n',
  );
});

test('a broken pipe is swallowed and still exits 0', () => {
  const bin = fileURLToPath(new URL('../bin/htmlq.js', import.meta.url));
  const script = `seq 1 20000 | sed 's|.*|<p>&</p>|' | "${process.execPath}" "${bin}" p | head -c 100 >/dev/null; exit \${PIPESTATUS[0]}`;
  const result = spawnSync('bash', ['-o', 'pipefail', '-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0);
});
