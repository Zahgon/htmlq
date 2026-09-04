/**
 * Differential test harness.
 *
 * Runs the Rust reference binary and this port over a matrix of
 * (input document x argument set) and requires byte-identical stdout, stderr
 * and exit codes.
 *
 * Point it at the reference build with:
 *   HTMLQ_REFERENCE=/path/to/htmlq node test/differential.js
 */

import { execFile } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, '..', 'bin', 'htmlq.js');

const REFERENCE = process.env.HTMLQ_REFERENCE ?? path.resolve(
  here, '..', '..', 'scraped_repos', 'Rust', 'mgdm_htmlq', 'target', 'debug', 'htmlq',
);

export const DOCUMENTS = {
  empty: '',
  simple: '<div id="my-id" class="hi"><a href="/foo/bar">Hello</a></div>',
  doctype: '<!DOCTYPE html><!-- lead --><p>x</p>',
  nested: '<ul><li><a href="/1">1</a></li><li><a href="/2">2</a></li><li>3</li></ul>',
  siblings: '<p class="c"><a href="/1">1</a><a href="/2">2</a></p><p class="c"><a href="/3">3</a></p>',
  lastChild: '<div id="x">text<b>B</b><a href="/1">1</a></div><div id="y">Y</div>',
  attrs: '<div 2="a" 0="b" zz="c" id="x" class="a" class="b" zeta="1" alpha="2"></div>',
  weirdAttrs: '<a HREF="/1" DaTa-X="v" title="q&quot;uote">t</a>',
  escaping: '<div id="x" title="a&quot;b&amp;c<d">a &amp; b &lt; c &gt; &nbsp;</div>',
  voids: '<head><link href="/a.css" rel="stylesheet"><meta charset="utf-8"><br><hr></head>',
  rawText: '<div id="x"><script>var a = 1 < 2 && 3;</script><style>p{color:red}</style>Vis</div>',
  whitespace: '<div id="x"> <b>Hi</b> <i>there</i> </div>',
  inlineMix: '<div id="x"><p>Hello <b>bold</b> tail</p><ul><li>a</li><li>b</li></ul></div>',
  baseTag: '<html><head><base href="https://example.org/sub/"></head><body><a href="rel">r</a></body></html>',
  baseNoHref: '<html><head><base></head><body><a href="/x">x</a></body></html>',
  links: '<a href="/foo">1</a><a href="//evil.com/x">2</a><a href="////evil.com/x">3</a><a href="https://a.example/z">4</a><a>5</a>',
  area: '<map><area href="/foo/bar"></map>',
  svg: '<svg viewBox="0 0 1 1"><clipPath id="c"></clipPath><a xlink:href="/u"><text>t</text></a><a href="/v">w</a></svg>',
  table: '<table><tr><td>a</td><td>b</td></tr></table>',
  template: '<div id="x"><template><p>inside</p></template></div>',
  comments: '<div id="x">a<!-- c -->b</div>',
  entities: '<div id="x">a &amp; b &lt; c &nbsp;d</div>',
  unclosed: '<div id="x"><p>one<p>two<span>three',
  formatting: '<b>bold<i>both</b>italic</i>',
  nbsp: '<div id="x">\u00a0\u2028\u0085 </div>',
  mathml: '<math><mi>x</mi></math>',
  deepNest: '<div id="x">' + '<span>'.repeat(20) + 'deep' + '</span>'.repeat(20) + '</div>',
  uppercase: '<DIV ID="x" CLASS="Hi"><A HREF="/foo">Hello</A></DIV>',
  selfClosing: '<div id="x"><br/><img src="/a.png"/><input type="text"/></div>',
  dupIds: '<div id="x">1</div><div id="x">2</div><div id="x">3</div>',
  form: '<form id="x"><input name="a" value="1" disabled><select><option selected>o</option></select><textarea> raw </textarea></form>',
  xmp: '<div id="x"><xmp>a < b & c</xmp><noscript><p>ns</p></noscript><noembed>ne</noembed></div>',
  plaintext: '<div id="x"><plaintext>a < b & c',
  iframeEl: '<div id="x"><iframe src="/f">fallback < text</iframe></div>',
  nestedTables: '<table id="x"><tbody><tr><td><table><tr><td>inner</td></tr></table></td></tr></tbody></table>',
  unicode: '<div id="x" title="\u00e9\u4e2d\ud83d\ude00">caf\u00e9 \u4e2d\u6587 \ud83d\ude00</div>',
  bom: '\ufeff<div id="x">\ufeffbom</div>',
  badRefs: '<div id="x">&notanentity; &amp &#xZZ; &#999999999;</div>',
  cdataish: '<div id="x"><![CDATA[raw]]>after</div>',
  weirdTags: '<div id="x"><custom-el attr="1">c</custom-el><a:b>ns</a:b></div>',
  emptyAttrs: '<div id="x" data-empty="" novalue class=" spaced "></div>',
  quotes: `<div id="x" a='single' b=unquoted c="dou\\"ble"></div>`,
  manyClasses: '<div id="x" class="a b c d e"><span class="a">s</span></div>',
  headLinks: '<html><head><link rel="stylesheet" href="/style.css"><base href="https://example.org/deep/path/"></head><body><a href="up">u</a><a href="/abs">a</a><a href="?q=1">q</a><a href="#frag">f</a></body></html>',
  protocolRel: '<a href="//cdn.example/x">1</a><a href="////evil.com/x">2</a><a href="///three">3</a><a href="/">4</a><a href="">5</a>',
  scriptEdge: '<div id="x"><script>if (a < b && c > d) { }</script></div>',
  onlyWhitespace: '<div id="x">   \n\t  </div>',
  mixedSiblings: '<section id="x"><h1>T</h1>lead<p>para</p>tail<span>sp</span>end</section>',
  svgNested: '<div id="x"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><clipPath id="cp"><rect width="1"/></clipPath></defs><use xlink:href="#cp"/></svg></div>',
  brokenNesting: '<div id="x"><table><div>escaped</div><tr><td>c</td></tr></table></div>',
  optionalTags: '<table id="x"><tr><td>a<td>b<tr><td>c</table>',
  annotationHtml: '<math><annotation-xml encoding="text/html"><p>h</p></annotation-xml></math>',
  annotationXhtml: '<math><annotation-xml encoding="application/xhtml+xml"><b>a<i>b</b>c</i></annotation-xml></math>',
  annotationPlain: '<math><annotation-xml encoding="text/plain"><p>h</p></annotation-xml></math>',
  annotationBare: '<math><annotation-xml><svg><foreignObject><p>x</p></foreignObject></svg></annotation-xml></math>',
  annotationTable: '<math><annotation-xml encoding="text/html"><table><tr><td>c</table></annotation-xml></math>',
  mathIntegration: '<math><mtext><p>a</p></mtext><mi><p>b</p></mi><ms><p>c</p></ms><mo><p>d</p></mo></math>',
  svgIntegration: '<svg><foreignObject><p>a</p></foreignObject><desc><p>b</p></desc><title><p>c</p></title></svg>',
  states: '<form id="x"><input disabled><input checked><a href="/h">h</a><a>bare</a></form>',
};

export const ARG_SETS = [
  [],
  ['html'],
  ['#x'],
  ['#my-id'],
  ['.hi'],
  ['.c'],
  ['a'],
  ['li'],
  ['div'],
  ['p'],
  ['body'],
  ['head'],
  ['*'],
  ['nonexistent'],
  ['#x', '-p'],
  ['#x', '-t'],
  ['#x', '-t', '-i'],
  ['#x', '-i'],
  ['#x', '-t', '-p'],
  ['#x', '-a', 'id'],
  ['#x', '-a', 'href'],
  ['#x', '-a', 'id', '-a', 'id'],
  ['#x', '-a', 'id', '-t'],
  ['#x', '-a', 'id', '-t', '-p'],
  ['a', '-a', 'href'],
  ['a', '-a', 'HREF'],
  ['a', '-a', 'data-x'],
  ['li', '-r', 'a'],
  ['.c', '-r', 'a'],
  ['.c', '-r', '.c'],
  ['div', '-r', 'a'],
  ['div', '-r', 'a', '-r', 'b'],
  ['div', '-r', ''],
  ['div', '-r', '>>>bad'],
  ['div', '-r', 'a', '-r', '>>>bad'],
  ['a', '-b', 'https://mgdm.net'],
  ['a', '-b', 'https://mgdm.net/sub/page'],
  ['a', '-b', 'notaurl'],
  ['body', '-b', 'https://mgdm.net'],
  ['a', '-B'],
  ['a', '-B', '-b', 'https://mgdm.net'],
  ['link', '-b', 'https://mgdm.net'],
  ['area', '-b', 'https://mgdm.net'],
  ['-t'],
  ['-p'],
  ['svg'],
  ['table'],
  ['template'],
  ['math'],
  ['--help'],
  ['-h'],
  ['--version'],
  ['-V'],
  ['div', 'extra'],
  ['--bogus'],
  ['-Z'],
  ['-f'],
  ['-r'],
  [''],
  ['>>>bad'],
  ['--', '#x'],
  ['-ti', '#x'],
  ['--pretty', '#x'],
  ['--text', '--ignore-whitespace', '#x'],
  ['--attributes=id', '#x'],
  ['--remove-nodes=a', 'div'],

  ['[id]'],
  ['[id="x"]'],
  ['[class~="a"]'],
  ['[href^="/"]'],
  ['[href$=".css"]'],
  ['[href*="example"]'],
  ['[title]', '-a', 'title'],
  ['div > a'],
  ['div a'],
  ['div + div'],
  ['div ~ div'],
  ['li:first-child'],
  ['li:last-child'],
  ['li:nth-child(2)'],
  ['li:nth-of-type(2)'],
  ['div:not(.hi)'],
  ['div:empty'],
  ['DIV'],
  ['#x, #y'],
  ['a[href]', '-a', 'href'],
  ['a[href]', '-b', 'https://mgdm.net/deep/page.html'],
  ['head > *'],
  ['body *'],
  ['span'],
  ['script'],
  ['style'],
  ['textarea', '-t'],
  ['option'],
  ['input', '-a', 'name', '-a', 'value', '-a', 'disabled'],
  ['#x', '-r', 'span'],
  ['#x', '-r', '*'],
  ['*', '-r', '*'],
  ['div', '-r', 'div'],
  ['#x', '-t', '-r', 'span'],
  ['#x', '-p', '-r', 'span'],
  ['a', '-b', 'https://mgdm.net', '-t'],
  ['a', '-b', 'https://mgdm.net', '-a', 'href'],
  ['a', '-B', '-a', 'href'],
  ['a', '-b', 'file:///tmp/'],
  ['a', '-b', 'https://user:pw@host:8080/a/b?c#d'],
  ['a', '-b', ''],
  ['link', '-B', '-a', 'href'],
  ['use', '-a', 'xlink:href'],
  ['svg', '-p'],
  ['custom-el'],
  ['#x', '-p', '-t'],
  ['-Vh'],
  ['-tpi', '#x'],

  ['*|a'],
  ['|a'],
  ['[*|id]'],
  ['A'],
  ['[HREF]'],
  ['SVG'],
  [':link'],
  [':any-link'],
  [':disabled'],
  [':checked'],
  [':focus'],
  [':root'],
  [':scope'],
  ['[id'],
  ['[id="x"'],
  [':NTH-CHILD(2)'],
  [':not(#x)'],
  [':not(*)'],
  [':nth-child( odd )'],
  ['#-x'],
  ['\\2d abc'],
  ['[href$=".css" i]'],
  ['annotation-xml'],
  ['annotation-xml', '-t'],
  ['math'],
  ['math', '-p'],
  [':is(a,p)'],
  [':has(p)'],
  ['#1abc'],
  ['[a=]'],
  ['>'],
  ['::before'],
  [':target'],
  ['p|*'],
  ['-b', 'https://a/', '-b', 'https://b/'],
  ['-f', 'a.html', '-f', 'b.html'],
  ['-t', '-t'],
  ['-tt'],
  ['-ti', '-i'],
  ['-a', '-t'],
  ['-b', '-p'],
  ['-r', '-i'],
  ['-b', '-x'],
  ['-b', '--'],
  ['--base=-x', 'p'],
  ['-b-x', 'p'],
  ['-a=id', 'p'],
  ['--text=x'],
  ['--help=x'],
  ['-b', '-', 'p'],
  ['-r', '-', 'p'],
];

function runOne(cmd, args, input) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd[0],
      [...cmd.slice(1), ...args],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          status: err?.code ?? 0,
          stdout: stdout ?? Buffer.alloc(0),
          stderr: stderr ?? Buffer.alloc(0),
        });
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Rust panic messages embed source locations and a backtrace note that this
 * port intentionally does not reproduce; only the fact of a 101 is compared.
 */
function isPanic(result) {
  return result.status === 101;
}

async function main() {
  if (!fs.existsSync(REFERENCE)) {
    console.error(`Reference binary not found: ${REFERENCE}`);
    console.error('Set HTMLQ_REFERENCE to the path of a built htmlq.');
    process.exit(2);
  }

  const cases = [];
  for (const [docName, doc] of Object.entries(DOCUMENTS)) {
    for (const args of ARG_SETS) cases.push({ docName, doc, args });
  }

  const failures = await mapConcurrent(cases, os.cpus().length * 2, async ({ docName, doc, args }) => {
    const [expected, actual] = await Promise.all([
      runOne([REFERENCE], args, doc),
      runOne([process.execPath, BIN], args, doc),
    ]);

    const problems = [];
    if (expected.status !== actual.status) {
      problems.push(`exit: expected ${expected.status}, got ${actual.status}`);
    }
    if (!expected.stdout.equals(actual.stdout)) {
      problems.push(
        `stdout:\n    expected ${JSON.stringify(expected.stdout.toString())}\n    actual   ${JSON.stringify(actual.stdout.toString())}`,
      );
    }
    if (!isPanic(expected) && !expected.stderr.equals(actual.stderr)) {
      problems.push(
        `stderr:\n    expected ${JSON.stringify(expected.stderr.toString())}\n    actual   ${JSON.stringify(actual.stderr.toString())}`,
      );
    }

    if (problems.length === 0) return null;
    return `[${docName}] htmlq ${args.map((a) => JSON.stringify(a)).join(' ')}\n  ${problems.join('\n  ')}`;
  });

  const failed = failures.filter((f) => f !== null);
  for (const failure of failed) console.error(failure);
  console.log(`\n${cases.length - failed.length}/${cases.length} cases byte-identical to the reference binary.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
