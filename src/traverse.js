/**
 * Lazy tree traversal.
 *
 * Direct port of `kuchikiki`'s `Traverse` / `Descendants` / `Select` iterators.
 *
 * THIS MODULE IS THE HEART OF THE PORT. `kuchikiki::select()` is a lazy
 * pre-order iterator that computes its *next* edge eagerly, at the moment it
 * yields the current one. Mutating the tree between two `next()` calls
 * therefore changes what the iterator subsequently sees -- and if the node it
 * has already looked ahead to gets detached, traversal walks into an orphaned
 * subtree, hits `parent === null`, and silently stops.
 *
 * `htmlq` detaches nodes mid-iteration (`--remove-nodes`), so that early
 * termination is observable, load-bearing behaviour. Implementing selection as
 * an eager `selectAll()` array would produce different output. See MIGRATION.md
 * quirk Q1.
 */

import { firstChild, nextSibling, parent, isElement, isTextNode } from './tree.js';

export const OPEN = 'open';
export const CLOSE = 'close';

/**
 * Port of `kuchikiki::iter::Traverse`.
 *
 * Yields `{ kind, node }` edges in pre-order. The following edge is computed
 * *before* the current one is yielded, mirroring Rust's `self.next.take()`
 * then-recompute ordering exactly.
 */
export function* traverseInclusive(root) {
  let edge = { kind: OPEN, node: root };

  while (edge !== null) {
    const current = edge;

    // Eager lookahead: computed from the pre-mutation tree, exactly as
    // `Traverse::next` does before handing the current edge to the consumer.
    let next;
    if (current.kind === OPEN) {
      const child = firstChild(current.node);
      next = child !== null
        ? { kind: OPEN, node: child }
        : { kind: CLOSE, node: current.node };
    } else if (current.node === root) {
      next = null;
    } else {
      const sibling = nextSibling(current.node);
      if (sibling !== null) {
        next = { kind: OPEN, node: sibling };
      } else {
        const p = parent(current.node);
        next = p !== null ? { kind: CLOSE, node: p } : null;
      }
    }

    edge = next;
    yield current;
  }
}

/**
 * Port of `kuchikiki::NodeRef::inclusive_descendants`.
 *
 * Pre-order, and *inclusive* of `root` itself.
 */
export function* inclusiveDescendants(root) {
  for (const edge of traverseInclusive(root)) {
    if (edge.kind === OPEN) yield edge.node;
  }
}

/**
 * Port of `kuchikiki::NodeRef::select` -- inclusive descendants filtered to
 * elements matching the compiled selector.
 */
export function* select(root, matches) {
  for (const node of inclusiveDescendants(root)) {
    if (isElement(node) && matches(node)) yield node;
  }
}

/**
 * Port of `kuchikiki::NodeRef::select_first`.
 *
 * Inclusive of `root`: an element can match -- and therefore detach -- itself.
 */
export function selectFirst(root, matches) {
  for (const node of select(root, matches)) return node;
  return null;
}

/**
 * Port of `.inclusive_descendants().text_nodes()`.
 */
export function* textNodes(root) {
  for (const node of inclusiveDescendants(root)) {
    if (isTextNode(node)) yield node;
  }
}
