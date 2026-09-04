/**
 * Tree layer.
 *
 * Port of the `kuchikiki` node model on top of `parse5` + the htmlparser2 tree
 * adapter (domhandler nodes).
 *
 * The one non-obvious piece here is `x-attribsOrder`. The stock htmlparser2
 * adapter stores attributes in a plain object (`attribs`), and JS object key
 * ordering puts integer-like keys first, in ascending numeric order. So
 * `<div 2=a 0=b zz=c>` would serialize as `0, 2, zz` while `kuchikiki` (backed
 * by an IndexMap) emits source order `2, 0, zz`. We therefore keep an explicit
 * ordered list of attribute names alongside `attribs` and serialize from it.
 */

import { Parser, html as parse5Html } from 'parse5';
import { adapter as htmlparser2Adapter } from 'parse5-htmlparser2-tree-adapter';
import { isTag, isText, isComment, isDirective, isDocument } from 'domhandler';

export const NS = {
  HTML: 'http://www.w3.org/1999/xhtml',
  MATHML: 'http://www.w3.org/1998/Math/MathML',
  SVG: 'http://www.w3.org/2000/svg',
  XLINK: 'http://www.w3.org/1999/xlink',
  XML: 'http://www.w3.org/XML/1998/namespace',
  XMLNS: 'http://www.w3.org/2000/xmlns/',
};

const ORDER = 'x-attribsOrder';
const LOCAL = 'x-attribsLocal';

/**
 * Storage key for an attribute.
 *
 * The stock htmlparser2 adapter keys `attribs` by the attribute's *local* name,
 * so `xlink:href` lands in `attribs.href`. That is wrong for us in two ways:
 *
 *   1. An attribute selector `[href]` would then match an SVG `<a xlink:href>`,
 *      whereas Servo's `selectors` only ever matches attribute selectors
 *      against null-namespace attributes.
 *   2. An element carrying both `xlink:href` and `href` would lose one of them.
 *
 * Keying by the qualified name fixes both. The local name is kept alongside for
 * the serializer, which emits `prefix + local` derived from the namespace.
 */
function attrKey(attr) {
  return attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
}

export const adapter = {
  ...htmlparser2Adapter,

  createElement(tagName, namespaceURI, attrs) {
    const node = htmlparser2Adapter.createElement(tagName, namespaceURI, attrs);
    const attribs = Object.create(null);
    const namespaces = Object.create(null);
    const prefixes = Object.create(null);
    const locals = Object.create(null);
    const order = [];
    for (const attr of attrs) {
      const key = attrKey(attr);
      // html5ever keeps the *first* of a duplicated attribute name.
      if (attribs[key] !== undefined) continue;
      order.push(key);
      attribs[key] = attr.value;
      namespaces[key] = attr.namespace;
      prefixes[key] = attr.prefix;
      locals[key] = attr.name;
    }
    node.attribs = attribs;
    node['x-attribsNamespace'] = namespaces;
    node['x-attribsPrefix'] = prefixes;
    node[LOCAL] = locals;
    node[ORDER] = order;
    return node;
  },

  adoptAttributes(recipient, attrs) {
    const order = recipient[ORDER] ?? (recipient[ORDER] = Object.keys(recipient.attribs));
    const locals = recipient[LOCAL] ?? (recipient[LOCAL] = Object.create(null));
    for (const attr of attrs) {
      const key = attrKey(attr);
      if (recipient.attribs[key] !== undefined) continue;
      order.push(key);
      recipient.attribs[key] = attr.value;
      recipient['x-attribsNamespace'][key] = attr.namespace;
      recipient['x-attribsPrefix'][key] = attr.prefix;
      locals[key] = attr.name;
    }
  },
};

/**
 * `html5ever` 0.26 does not implement the `<annotation-xml>` HTML integration
 * point, at any `encoding` value. `parse5` does, and is spec-correct in doing
 * so, but the difference is observable: HTML children of an `<annotation-xml>`
 * stay nested inside the MathML subtree under `parse5`, whereas `html5ever`
 * breaks them out into `<body>`. `annotation-xml` is never a MathML *text*
 * integration point, so suppressing it here is the whole of the difference.
 */
class Html5everParser extends Parser {
  _isIntegrationPoint(tagId, element, foreignNS) {
    if (tagId === parse5Html.TAG_ID.ANNOTATION_XML) return false;
    return super._isIntegrationPoint(tagId, element, foreignNS);
  }
}

export function parseDocument(html) {
  return Html5everParser.parse(html, { treeAdapter: adapter });
}

/* ------------------------------------------------------------------ */
/* Node predicates                                                     */
/* ------------------------------------------------------------------ */

export const isElement = isTag;
export const isTextNode = isText;
export const isCommentNode = isComment;
export const isDocumentNode = isDocument;

export function isDoctypeNode(node) {
  return isDirective(node) && node.name === '!doctype';
}

export function isProcessingInstructionNode(node) {
  return isDirective(node) && node.name !== '!doctype';
}

/* ------------------------------------------------------------------ */
/* Traversal primitives                                                */
/* ------------------------------------------------------------------ */

/**
 * `<template>` contents are reachable as children here but NOT in `kuchikiki`,
 * where html5ever stores them in a detached fragment that traversal never
 * visits (`htmlq template` prints `<template></template>`). The htmlparser2
 * adapter models those contents as a nested Document node, so skipping
 * Document children reproduces kuchikiki exactly -- the real root Document is
 * never reached through these functions.
 */
export function firstChild(node) {
  for (const child of node.children ?? []) {
    if (!isDocumentNode(child)) return child;
  }
  return null;
}

export function nextSibling(node) {
  let sibling = node.next ?? null;
  while (sibling !== null && isDocumentNode(sibling)) sibling = sibling.next ?? null;
  return sibling;
}

export function parent(node) {
  return node.parent ?? null;
}

/**
 * Port of `kuchikiki::NodeRef::detach`.
 *
 * Unlinks the node from its parent AND nulls out `parent`/`prev`/`next`. The
 * null-out is load-bearing: it is what causes an in-flight lazy traversal that
 * has already looked ahead into this subtree to terminate early (quirk Q1).
 */
export function detach(node) {
  const p = node.parent;
  if (p) {
    const idx = p.children.indexOf(node);
    if (idx !== -1) p.children.splice(idx, 1);
  }
  const { prev, next } = node;
  if (prev) prev.next = next ?? null;
  if (next) next.prev = prev ?? null;
  node.prev = null;
  node.next = null;
  node.parent = null;
}

/* ------------------------------------------------------------------ */
/* Attributes                                                          */
/* ------------------------------------------------------------------ */

function attrOrder(el) {
  return el[ORDER] ?? (el[ORDER] = Object.keys(el.attribs ?? {}));
}

/**
 * `kuchikiki` keys attributes by `ExpandedName`, and `Attributes::get`/
 * `contains` are always called with a bare local name -- i.e. the *null*
 * namespace. A namespaced attribute such as `xlink:href` must therefore NOT be
 * found by a lookup for `href`.
 */
function isNullNamespaceAttr(el, name) {
  const ns = (el['x-attribsNamespace'] ?? {})[name];
  return ns === undefined || ns === null || ns === '';
}

export function hasAttr(el, name) {
  if (el.attribs == null || el.attribs[name] === undefined) return false;
  return isNullNamespaceAttr(el, name);
}

export function getAttr(el, name) {
  if (!hasAttr(el, name)) return undefined;
  return el.attribs[name];
}

export function setAttr(el, name, value) {
  if (el.attribs == null) el.attribs = Object.create(null);
  if (el.attribs[name] === undefined) attrOrder(el).push(name);
  el.attribs[name] = value;
}

/**
 * Attributes in source order, with namespace/prefix metadata, as the
 * serializer needs them.
 */
export function listAttrs(el) {
  const attribs = el.attribs ?? {};
  const namespaces = el['x-attribsNamespace'] ?? {};
  const prefixes = el['x-attribsPrefix'] ?? {};
  const locals = el[LOCAL] ?? {};
  const out = [];
  for (const key of attrOrder(el)) {
    if (attribs[key] === undefined) continue;
    out.push({
      name: locals[key] ?? key,
      value: attribs[key],
      namespace: namespaces[key],
      prefix: prefixes[key],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Element naming                                                      */
/* ------------------------------------------------------------------ */

export function localName(el) {
  return el.name;
}

export function elementNamespace(el) {
  return el.namespace ?? NS.HTML;
}

export function isHtmlElement(el) {
  return elementNamespace(el) === NS.HTML;
}
