/**
 * Link rewriting and <base> detection.
 *
 * Direct port of `src/link.rs`.
 */

import { compileSelectorList } from './selector-match.js';
import { isElement, localName, hasAttr, getAttr, setAttr } from './tree.js';
import { selectFirst } from './traverse.js';

const REWRITABLE = new Set(['a', 'link', 'area']);

const HOST_REQUIRED_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

/**
 * Port of Rust's `Url::parse` -- absolute URLs only. A relative string yields
 * `null`, which disables link rewriting entirely (quirk Q7).
 *
 * Both Rust's `url` crate and JS's `URL` are WHATWG-conformant, so resolution
 * results agree.
 */
export function parseAbsoluteUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/**
 * Port of `link::rewrite_relative_url`.
 *
 * Operates on a single element. `main.rs` only ever calls this on the matched
 * node, never on its descendants -- see quirk Q5.
 */
export function rewriteRelativeUrl(node, base) {
  // Rust matches on `elem.name.local` alone and never checks the namespace, so
  // an SVG <a href> is rewritten too.
  if (!isElement(node) || !REWRITABLE.has(localName(node))) return;

  if (!hasAttr(node, 'href')) return;

  const url = getAttr(node, 'href');

  // Rust returns early here without touching the URL resolver.
  if (url.startsWith('////')) {
    setAttr(node, 'href', url.replace(/^\/+/, ''));
    return;
  }

  let resolved;
  try {
    // Rust's `url` crate rejects a reference with an empty authority such as
    // `///three` ("empty host") when the base scheme requires a host, so `join`
    // fails and the base is used verbatim. WHATWG -- and therefore `new URL` --
    // instead skips the extra slashes and reads `three` as the host, which
    // would silently retarget the link. `file:` and non-special schemes do
    // permit an empty host, and there both agree.
    if (url.startsWith('///') && HOST_REQUIRED_SCHEMES.has(base.protocol)) {
      throw new Error('empty host');
    }
    resolved = new URL(url, base).toString();
  } catch {
    resolved = base.toString();
  }
  setAttr(node, 'href', resolved);
}

/**
 * Port of `link::detect_base`.
 *
 * Note: does not require the tag to be in <head>, and does not fall through to
 * a later <base> if the first one lacks an href.
 */
const BASE_SELECTOR = compileSelectorList('base');

export function detectBase(document) {
  const node = selectFirst(document, BASE_SELECTOR);
  if (node === null) return null;

  if (hasAttr(node, 'href')) {
    return parseAbsoluteUrl(getAttr(node, 'href'));
  }

  return null;
}
