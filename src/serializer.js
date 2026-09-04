/**
 * HTML serialization.
 *
 * Direct port of `html5ever::serialize::HtmlSerializer` (as used by
 * `kuchikiki`'s `Display`/`to_string`), plus the `Serialize for NodeRef`
 * traversal driver.
 *
 * The `Serializer` visitor interface is preserved verbatim so that
 * `pretty-print.js` can wrap it the same way `src/pretty_print.rs` wraps
 * `HtmlSerializer` -- which in turn guarantees the plain and pretty output
 * paths cannot drift apart.
 */

import {
  NS,
  isElement,
  isTextNode,
  isCommentNode,
  isDoctypeNode,
  isProcessingInstructionNode,
  listAttrs,
  localName,
  elementNamespace,
} from './tree.js';
import { traverseInclusive, OPEN } from './traverse.js';

/**
 * HTML-namespace elements whose children `html5ever` refuses to emit and which
 * get no closing tag (`ElemInfo::ignore_children`).
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr',
  'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * HTML-namespace elements whose text children are emitted raw.
 *
 * `noscript` is included because `SerializeOpts::default()` sets
 * `scripting_enabled: true`.
 */
const RAW_TEXT_PARENTS = new Set([
  'style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext',
  'noscript',
]);

/**
 * Port of `html5ever`'s `write_escaped`.
 *
 * Attribute mode escapes `&`, U+00A0 and `"`.
 * Text mode escapes `&`, U+00A0, `<` and `>`.
 *
 * Note that `<` and `>` are deliberately NOT escaped inside attribute values --
 * verified against the reference binary (quirk Q12).
 */
export function escape(text, attrMode) {
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '\u00A0') out += '&nbsp;';
    else if (attrMode && ch === '"') out += '&quot;';
    else if (!attrMode && ch === '<') out += '&lt;';
    else if (!attrMode && ch === '>') out += '&gt;';
    else out += ch;
  }
  return out;
}

/**
 * Port of `html5ever::serialize::HtmlSerializer`.
 */
export class HtmlSerializer {
  constructor() {
    this.buf = [];
    // `html5ever` seeds its stack with a sentinel parent frame.
    this.stack = [{ htmlName: null, ignoreChildren: false }];
  }

  /** Raw write, bypassing escaping (`self.inner.writer.write_all`). */
  writeRaw(text) {
    this.buf.push(text);
  }

  get parentFrame() {
    return this.stack[this.stack.length - 1];
  }

  startElem(name, attrs) {
    const htmlName = name.ns === NS.HTML ? name.local : null;

    if (this.parentFrame.ignoreChildren) {
      this.stack.push({ htmlName, ignoreChildren: true });
      return;
    }

    // Tag name is the local name only -- no namespace prefix, even for
    // SVG/MathML.
    this.writeRaw('<');
    this.writeRaw(name.local);

    for (const attr of attrs) {
      this.writeRaw(' ');
      switch (attr.namespace) {
        case undefined:
        case null:
        case '':
          break;
        case NS.XML:
          this.writeRaw('xml:');
          break;
        case NS.XMLNS:
          if (attr.name !== 'xmlns') this.writeRaw('xmlns:');
          break;
        case NS.XLINK:
          this.writeRaw('xlink:');
          break;
        default:
          this.writeRaw('unknown_namespace:');
          break;
      }
      this.writeRaw(attr.name);
      this.writeRaw('="');
      this.writeRaw(escape(attr.value, true));
      this.writeRaw('"');
    }

    this.writeRaw('>');

    const ignoreChildren = name.ns === NS.HTML && VOID_ELEMENTS.has(name.local);
    this.stack.push({ htmlName, ignoreChildren });
  }

  endElem(name) {
    const info = this.stack.pop();
    if (info === undefined || info.ignoreChildren) return;
    this.writeRaw('</');
    this.writeRaw(name.local);
    this.writeRaw('>');
  }

  writeText(text) {
    const parentName = this.parentFrame.htmlName;
    const raw = parentName !== null && RAW_TEXT_PARENTS.has(parentName);
    this.writeRaw(raw ? text : escape(text, false));
  }

  writeComment(text) {
    this.writeRaw('<!--');
    this.writeRaw(text);
    this.writeRaw('-->');
  }

  writeDoctype(name) {
    this.writeRaw('<!DOCTYPE ');
    this.writeRaw(name);
    this.writeRaw('>');
  }

  writeProcessingInstruction(target, data) {
    this.writeRaw('<?');
    this.writeRaw(target);
    this.writeRaw(' ');
    this.writeRaw(data);
    this.writeRaw('>');
  }

  toString() {
    return this.buf.join('');
  }
}

function qualName(el) {
  return { ns: elementNamespace(el), local: localName(el) };
}

/**
 * Port of `kuchikiki`'s `Serialize for NodeRef` with
 * `TraversalScope::IncludeNode`.
 *
 * Drives an arbitrary serializer visitor over the node's inclusive traversal.
 */
export function serializeInto(node, serializer) {
  for (const edge of traverseInclusive(node)) {
    const n = edge.node;

    if (edge.kind === OPEN) {
      if (isElement(n)) {
        serializer.startElem(qualName(n), listAttrs(n));
      } else if (isDoctypeNode(n)) {
        serializer.writeDoctype(n['x-name'] ?? '');
      } else if (isTextNode(n)) {
        serializer.writeText(n.data);
      } else if (isCommentNode(n)) {
        serializer.writeComment(n.data);
      } else if (isProcessingInstructionNode(n)) {
        serializer.writeProcessingInstruction(n.name, n.data);
      }
      // Document / DocumentFragment nodes emit nothing.
    } else if (isElement(n)) {
      serializer.endElem(qualName(n));
    }
  }
}

/**
 * Port of `kuchikiki::NodeRef::to_string`.
 */
export function serialize(node) {
  const s = new HtmlSerializer();
  serializeInto(node, s);
  return s.toString();
}
