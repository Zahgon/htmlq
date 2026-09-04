/**
 * Selector evaluation with the semantics `kuchikiki` gets from Servo.
 *
 * Two rules drive most of the behaviour and neither is what a generic JS
 * selector engine does:
 *
 *   - Type and attribute *names* are ASCII case-insensitive only for elements
 *     in the HTML namespace. `A` matches `<a>` but not an SVG `<a>`, and `SVG`
 *     matches nothing at all.
 *   - `kuchikiki` tracks no element state, so `:checked`, `:disabled`,
 *     `:focus` and friends parse but never match.
 */

import { NS, isElement, isTextNode, localName, elementNamespace, isHtmlElement } from './tree.js';
import { parseSelectorList } from './selector-parse.js';

const LINK_ELEMENTS = new Set(['a', 'area', 'link']);

const NEVER_MATCH = new Set([
  'visited',
  'hover',
  'active',
  'focus',
  'enabled',
  'disabled',
  'checked',
  'indeterminate',
]);

function elementChildren(node) {
  return node?.children?.filter(isElement) ?? [];
}

function siblings(element) {
  return elementChildren(element.parent);
}

function attributeEntries(element) {
  const attribs = element.attribs ?? {};
  const namespaces = element['x-attribsNamespace'] ?? {};
  const locals = element['x-attribsLocal'] ?? {};
  return Object.keys(attribs).map((key) => ({
    key,
    local: locals[key] ?? key,
    value: attribs[key],
    namespace: namespaces[key],
  }));
}

function findAttribute(element, name, namespace) {
  const wanted = isHtmlElement(element) ? name.toLowerCase() : name;
  for (const entry of attributeEntries(element)) {
    if (entry.local !== wanted) continue;
    const isNullNamespace = entry.namespace == null || entry.namespace === '';
    if (namespace === 'any' || isNullNamespace) return entry.value;
  }
  return undefined;
}

function matchesAttributeValue(actual, simple) {
  const { operator, caseInsensitive } = simple;
  if (operator === null) return true;

  const expected = caseInsensitive ? simple.value.toLowerCase() : simple.value;
  const value = caseInsensitive ? actual.toLowerCase() : actual;

  switch (operator) {
    case '=':
      return value === expected;
    case '~=':
      return expected !== '' && !/\s/.test(expected) && value.split(/\s+/).includes(expected);
    case '|=':
      return value === expected || value.startsWith(`${expected}-`);
    case '^=':
      return expected !== '' && value.startsWith(expected);
    case '$=':
      return expected !== '' && value.endsWith(expected);
    case '*=':
      return expected !== '' && value.includes(expected);
    default:
      return false;
  }
}

function nthMatches({ a, b }, index) {
  if (a === 0) return index === b;
  const n = (index - b) / a;
  return Number.isInteger(n) && n >= 0;
}

function indexAmong(element, list, fromEnd) {
  const position = list.indexOf(element);
  return fromEnd ? list.length - position : position + 1;
}

function sameType(element) {
  const name = localName(element);
  const namespace = elementNamespace(element);
  return (other) => localName(other) === name && elementNamespace(other) === namespace;
}

function isEmpty(element) {
  return (element.children ?? []).every(
    (child) => !isElement(child) && (!isTextNode(child) || child.data === ''),
  );
}

function matchesNth(element, simple) {
  const fromEnd = simple.name === 'nth-last-child' || simple.name === 'nth-last-of-type';
  const ofType = simple.name === 'nth-of-type' || simple.name === 'nth-last-of-type';
  const list = ofType ? siblings(element).filter(sameType(element)) : siblings(element);
  return nthMatches(simple, indexAmong(element, list, fromEnd));
}

function matchesPseudo(element, name) {
  if (NEVER_MATCH.has(name)) return false;

  switch (name) {
    case 'root':
    case 'scope':
      return element.parent == null || !isElement(element.parent);
    case 'empty':
      return isEmpty(element);
    case 'link':
    case 'any-link':
      return (
        elementNamespace(element) === NS.HTML &&
        LINK_ELEMENTS.has(localName(element)) &&
        findAttribute(element, 'href', 'default') !== undefined
      );
    case 'first-child':
      return indexAmong(element, siblings(element), false) === 1;
    case 'last-child':
      return indexAmong(element, siblings(element), true) === 1;
    case 'only-child':
      return siblings(element).length === 1;
    case 'first-of-type':
      return indexAmong(element, siblings(element).filter(sameType(element)), false) === 1;
    case 'last-of-type':
      return indexAmong(element, siblings(element).filter(sameType(element)), true) === 1;
    case 'only-of-type':
      return siblings(element).filter(sameType(element)).length === 1;
    default:
      return false;
  }
}

function matchesSimple(element, simple) {
  switch (simple.type) {
    case 'id':
      return findAttribute(element, 'id', 'default') === simple.value;
    case 'class': {
      const value = findAttribute(element, 'class', 'default');
      return value !== undefined && value.split(/\s+/).includes(simple.value);
    }
    case 'attr': {
      const actual = findAttribute(element, simple.name, simple.namespace);
      return actual !== undefined && matchesAttributeValue(actual, simple);
    }
    case 'pseudo':
      return matchesPseudo(element, simple.name);
    case 'nth':
      return matchesNth(element, simple);
    case 'not':
      return !matchesCompound(element, simple.selector);
    default:
      return false;
  }
}

function matchesCompound(element, compound) {
  if (compound.namespace === 'none' && elementNamespace(element) !== '') return false;

  if (compound.name !== null) {
    const name = isHtmlElement(element) ? compound.name.toLowerCase() : compound.name;
    if (localName(element) !== name) return false;
  }

  return compound.simples.every((simple) => matchesSimple(element, simple));
}

function matchesComplex(element, parts, index) {
  if (!matchesCompound(element, parts[index].compound)) return false;
  if (index === 0) return true;

  const { combinator } = parts[index];
  if (combinator === ' ' || combinator === '>') {
    let ancestor = element.parent;
    while (ancestor != null && isElement(ancestor)) {
      if (matchesComplex(ancestor, parts, index - 1)) return true;
      if (combinator === '>') return false;
      ancestor = ancestor.parent;
    }
    return false;
  }

  const previous = siblings(element).slice(0, siblings(element).indexOf(element)).reverse();
  for (const sibling of previous) {
    if (matchesComplex(sibling, parts, index - 1)) return true;
    if (combinator === '+') return false;
  }
  return false;
}

export function compileSelectorList(input) {
  const list = parseSelectorList(input);
  return (node) =>
    isElement(node) && list.some((parts) => matchesComplex(node, parts, parts.length - 1));
}
