# Migrating `htmlq` from Rust to JavaScript

This document records how the port was verified, which original behaviours were
deliberately preserved even though they look like bugs, and where the JavaScript
implementation cannot match the Rust one exactly.

## Mapping

| Rust | JavaScript | Notes |
| --- | --- | --- |
| `kuchikiki` node tree | `parse5` + `parse5-htmlparser2-tree-adapter` | wrapped in `src/tree.js` |
| `kuchikiki::traits::*` selection | `src/selector-parse.js`, `src/selector-match.js` | hand-ported; see [Selector engine](#selector-engine) |
| `html5ever` `HtmlSerializer` | `src/serializer.js` | hand-ported, not `parse5.serializeOuter` |
| `src/pretty_print.rs` | `src/pretty-print.js` | |
| `src/link.rs` | `src/link.js` | |
| `clap` derive | `src/cli.js` | hand-rolled to reproduce clap's exact output |
| `url::Url` | WHATWG `URL` | see [URL resolution](#url-resolution) |

The serializer is a manual port rather than a call to `parse5`'s own serializer
because the two disagree on attribute escaping, void elements and namespace
prefixes. Those differences are user-visible on every single run.

## How equivalence was established

`test/differential.js` runs the compiled Rust binary and this implementation over
a corpus of documents crossed with a matrix of flag combinations, and compares
stdout, stderr and exit status byte for byte.

Current status: **9735 / 9735 cases byte-identical**.

```sh
HTMLQ_REFERENCE=/path/to/rust/htmlq npm run test:differential
```

The corpus deliberately includes malformed markup, optional-tag omission,
foreign content (SVG/MathML), HTML integration points, raw-text elements,
`<template>`, byte-order marks, numeric-looking attribute names, duplicate
attributes, protocol-relative links, rejected selectors and malformed command
lines, because those are where the two stacks were found to diverge.

Every divergence found during the port is locked by a regression test in
`test/quirks.test.js`, `test/selectors.test.js` or `test/cli-args.test.js`.
Argument parsing and selector acceptance are covered by their own suites because
the differential matrix originally varied only *valid* flag combinations and
*valid* selectors, which is precisely where the remaining defects were hiding.

## Preserved quirks

These are faithfully reproduced. They are not bugs to be fixed here; fixing any
of them would break equivalence with the original.

| # | Behaviour |
| --- | --- |
| Q1 | Detaching a node during iteration truncates the match iterator, silently dropping later matches. `htmlq li -r a` on a three-item list prints one `<li></li>`. If the removed node is the *last* child, the lookahead survives and iteration continues. |
| Q2 | `-r` removes only the **first** match within each selected element. |
| Q3 | `-r` matching is inclusive of the selected element, so an element can detach itself and still be printed. |
| Q4 | An empty or invalid `-r` selector is a silent no-op with exit 0. |
| Q5 | `--base` rewrites only the **matched element**, never its descendants. `htmlq body -b …` rewrites nothing. |
| Q6 | An `href` beginning `////` has all leading slashes stripped and skips URL resolution entirely. `//` is resolved normally. |
| Q7 | A non-absolute `--base` silently disables rewriting, with exit 0. |
| Q8 | Output mode precedence is `-a` > `-t` > `-p`. `-i` has no effect outside `-t`. |
| Q9 | `-t` includes `<script>` and `<style>` text content. |
| Q10 | `-t -i` appends a newline after every kept node, producing a trailing blank line. |
| Q11 | `-p` output **begins** with a newline, and indentation is bumped for every element including inline and void ones. |
| Q12 | `<` and `>` are **not** escaped inside attribute values. |
| Q13 | Void elements are serialised with no closing tag and no self-closing slash. |
| Q14 | `-a` lookup is case-sensitive against parser-lowercased names, so `-a HREF` matches nothing. A repeated `-a` prints the value repeatedly. |
| Q15 | Repeated `-r` values are joined into a single selector list, so one invalid component disables all removal. |
| Q16 | `-B` falls back to `--base` when no `<base>` tag is found. |

Two further inherited behaviours worth calling out:

- Attribute output order is **source order**, including for numeric-looking
  names. `<div 2=a 0=b zz=c>` round-trips in that order. A plain JavaScript
  object would reorder integer-like keys, so `src/tree.js` maintains an explicit
  ordered name list.
- A duplicated source attribute keeps the **first** value.

## Deliberate deviations

### Panic messages

Rust panics carry a source location and a backtrace hint:

```
thread 'main' panicked at src/main.rs:115:10:
Failed to parse CSS selector: ()
```

The port writes a stable, location-free message to stderr instead:

```
htmlq: Failed to parse CSS selector
```

**Exit codes are identical** — 101 for a panic, 2 for a usage error, 0 otherwise
— and the differential harness compares exit status on these cases while
skipping the stderr text.

### URL resolution

Rust's `url` crate rejects a reference with an empty authority, such as
`///three`, when the base scheme requires a host. WHATWG `URL` — and therefore
`new URL` — instead skips the extra slashes and reads `three` as the **host**,
which would silently retarget the link to a different origin. `src/link.js`
rejects that shape for `http:`, `https:`, `ws:`, `wss:` and `ftp:` bases so the
base URL is used verbatim, exactly as in Rust. `file:` and non-special schemes
permit an empty host and both implementations agree there.

Every other href shape tested — `//host`, `////host`, backslashes, opaque
schemes, spaces, invalid percent-escapes, dot-segments — resolves identically.

### Byte-order marks

`html5ever` strips a leading BOM from the input stream; `parse5` does not.
`src/main.js` strips one leading `U+FEFF` before parsing. A BOM appearing
anywhere else is preserved as text by both.

### Whitespace definition in `--pretty`

Rust's `str::trim` uses the Unicode `White_Space` property, which JavaScript's
`String.prototype.trim` does not match exactly: `White_Space` includes `U+0085`
and excludes `U+FEFF`, and `trim` does the opposite. `src/pretty-print.js` uses
an explicit character class matching Rust rather than `trim`.

### `<template>` contents

`html5ever` stores template contents in a detached fragment that `kuchikiki`'s
traversal never reaches, so `htmlq template` prints `<template></template>`. The
htmlparser2 tree adapter instead nests a `Document` node inside the element. The
traversal in `src/tree.js` skips `Document` children to reproduce the original
output.

### `<annotation-xml>` integration points

`parse5` implements the HTML spec rule that a MathML `<annotation-xml>` with
`encoding="text/html"` or `encoding="application/xhtml+xml"` is an HTML
integration point, so HTML children stay nested inside it. `html5ever` 0.26 does
not implement that rule at any encoding value, so the children break out to
`<body>` instead.

`parse5` is correct here and `html5ever` is not, but this port reproduces
`html5ever`'s parse tree for the same reason it reproduces Q1–Q16: matching the
original output is the goal. `src/tree.js` subclasses `parse5`'s `Parser` and
forces `_isIntegrationPoint` to return `false` for `annotation-xml`. All other
integration points — `foreignObject`, `desc`, `title`, `mtext`, `mi`, `ms`,
`mo`, `mn` — already agreed and are untouched.

### Namespaced attributes

The stock htmlparser2 adapter keys attributes by their **local** name, so
`xlink:href` lands in `attribs.href`. That made `[href]` match an SVG
`<a xlink:href>`, which Servo's `selectors` never does, and it
would drop one attribute if an element carried both. `src/tree.js` keys
attributes by qualified name and resolves lookups against the null namespace
only, matching `kuchikiki`'s `ExpandedName` keying.

Note that link rewriting itself compares **only the local element name** and
ignores the namespace, so an SVG `<a href>` *is* rewritten. That is the Rust
behaviour and is preserved.

## Selector engine

The port originally used `css-select`. A 104-selector conformance probe against
the Rust binary found **26 divergences in three classes**, so `css-select` was
replaced with a hand-written engine (`src/selector-parse.js`,
`src/selector-match.js`) modelled on Servo's `selectors` as `kuchikiki` uses it.

An earlier revision of this document claimed that invalid selectors exit 101 in
both implementations and that namespace syntax was accepted by neither. **Both
claims were wrong.** The three failure classes were:

- **Rust exits 101, `css-select` exited 0 and printed output.** `:is(a,p)`,
  `:where(a)`, `:has(p)`, `:matches(a)`, `:not(a,p)`, `:not(div a)`, `#1abc`,
  `.1abc`, `[a=]`, `[=b]`, `a[href=/f]`, `:required`, `:optional`, and the bare
  combinators `-`, `+`, `>`, `~`. This was the silent-wrong-results case the old
  text asserted could not happen.
- **Rust exits 0, `css-select` exited 101.** `*|a`, `|a`, `:focus`,
  `:indeterminate`, and unterminated blocks such as `[id` or `a[href`.
- **Both exited 0 with different output.** Uppercase type selectors (`A`,
  `SVG`, `TEXT`), uppercase attribute names (`[HREF]`), and `:link`,
  `:any-link`, `:enabled`, `:disabled`, `:checked`, `:optional`.

The replacement reproduces Servo's actual rules:

- Type and attribute names fold case **only for HTML-namespace elements**. `A`
  matches an HTML `<a>` but not an SVG `<a>`; `SVG` and `TEXT` match nothing,
  because those elements are not in the HTML namespace and so compare
  case-sensitively against their lowercase local names.
- `kuchikiki` tracks no element state, so `:hover`, `:active`, `:focus`,
  `:visited`, `:enabled`, `:disabled`, `:checked` and `:indeterminate` parse but
  match nothing — even when a matching control is present.
- `:link` and `:any-link` match HTML-namespace `a`, `area` and `link` carrying
  an `href`.
- `:scope` behaves as `:root`. All pseudo-elements are rejected.
- `:not()` takes exactly one simple selector.
- Only the `*|` and `|` namespace prefixes resolve; any other prefix is an
  undeclared-prefix error. `|a` matches nothing, since every parsed element has
  a namespace.
- End of input closes an open block, so `[id` parses while `[id=` does not.
- `:is`, `:where`, `:has`, `:matches`, `:lang`, `:required`, `:optional`,
  `:target`, `:read-only`, `:read-write`, `:default` and `:placeholder-shown`
  are rejected.

All 104 probe selectors now agree with the reference binary, and the acceptance
sets are locked in `test/selectors.test.js`. Every selector asserted there was
re-run against the Rust binary to confirm the test encodes Rust's behaviour
rather than the port's.

## Argument parsing

`src/cli.js` reproduces clap's exact stderr text and exit codes, including
rejection of repeated single-value options, refusal to consume a following
token that looks like an option, and the `-` stdin/stdout sentinel.

One caveat: when a command line contains **two or more** distinct errors, clap's
choice of which to report is internally inconsistent — `-t -t -x` reports the
duplicate flag, but `-b a -b b -x` reports the unknown argument, while
`-b a -b b -t -t` and `-b a -b b p -x` report the duplicate again. The port
instead reports errors in the position they are detected, which matches clap for
every single-error command line and for three of those four cases.

## Non-goals

No new features, no streaming, no library API, and no fixing of Q1–Q16.
