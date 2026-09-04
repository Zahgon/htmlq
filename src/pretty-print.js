/**
 * Pretty printer.
 *
 * Direct port of `src/pretty_print.rs`. The Rust version implements the
 * `Serializer` trait by delegating to an inner `HtmlSerializer` while injecting
 * newlines and indentation straight into the underlying writer (bypassing
 * escaping). This wraps `HtmlSerializer` the same way.
 *
 * Quirks preserved: output always begins with a newline, whitespace-only text
 * nodes are dropped entirely, and `indent` is bumped for *every* element --
 * inline and void ones included.
 */

import { HtmlSerializer, serializeInto } from './serializer.js';

/** The exact inline-element set from `src/pretty_print.rs`. */
const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'acronym', 'audio', 'b', 'bdi', 'bdo', 'big', 'button', 'canvas',
  'cite', 'code', 'data', 'datalist', 'del', 'dfn', 'em', 'embed', 'i', 'iframe',
  'img', 'input', 'ins', 'kbd', 'label', 'map', 'mark', 'meter', 'noscript',
  'object', 'output', 'picture', 'progress', 'q', 'ruby', 's', 'samp', 'script',
  'select', 'slot', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'template',
  'textarea', 'time', 'u', 'tt', 'var', 'video', 'wbr',
]);

function isInline(name) {
  return INLINE_ELEMENTS.has(name);
}

/**
 * Rust's `str::trim` uses the Unicode `White_Space` property. JS `String.trim`
 * differs: it also strips U+FEFF and does not strip U+0085. Match Rust.
 */
const RUST_WHITESPACE_ONLY =
  /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*$/;

export function isRustWhitespaceOnly(text) {
  return RUST_WHITESPACE_ONLY.test(text);
}

class PrettyPrint {
  constructor() {
    this.indent = 0;
    this.previousWasBlock = false;
    this.inner = new HtmlSerializer();
  }

  startElem(name, attrs) {
    const inline = isInline(name.local);
    if (!inline || this.previousWasBlock) {
      this.inner.writeRaw('\n');
      this.inner.writeRaw(' '.repeat(this.indent));
    }

    this.indent += 2;
    this.inner.startElem(name, attrs);
  }

  endElem(name) {
    this.indent -= 2;

    if (isInline(name.local)) {
      this.previousWasBlock = false;
    } else {
      this.inner.writeRaw('\n');
      this.inner.writeRaw(' '.repeat(this.indent));
      this.previousWasBlock = true;
    }

    this.inner.endElem(name);
  }

  writeText(text) {
    if (isRustWhitespaceOnly(text)) return;

    if (this.previousWasBlock) {
      this.inner.writeRaw('\n');
      this.inner.writeRaw(' '.repeat(this.indent));
    }

    this.previousWasBlock = false;
    this.inner.writeText(text);
  }

  writeComment(text) {
    this.inner.writeComment(text);
  }

  writeDoctype(name) {
    this.inner.writeDoctype(name);
  }

  writeProcessingInstruction(target, data) {
    this.inner.writeProcessingInstruction(target, data);
  }

  toString() {
    return this.inner.toString();
  }
}

/**
 * Port of `pretty_print::pretty_print`.
 */
export function prettyPrint(node) {
  const pp = new PrettyPrint();
  serializeInto(node, pp);
  return pp.toString();
}
