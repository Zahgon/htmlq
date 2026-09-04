import fs from 'node:fs';
import { compileSelectorList } from './selector-match.js';

import { parseArgs, EarlyExit, UsageError } from './cli.js';
import { parseDocument, detach, getAttr } from './tree.js';
import { select, selectFirst, textNodes } from './traverse.js';
import { serialize } from './serializer.js';
import { prettyPrint, isRustWhitespaceOnly } from './pretty-print.js';
import { detectBase, parseAbsoluteUrl, rewriteRelativeUrl } from './link.js';

/**
 * Port of Rust's `.expect(...)` on a `Result`: abort with exit code 101.
 */
class Panic extends Error {
  constructor(message) {
    super(message);
  }
}

/** Returns a match predicate, or `null` if the selector is invalid. */
function compileSelector(selector) {
  try {
    return compileSelectorList(selector);
  } catch {
    return null;
  }
}

function readAll(fd) {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let read;
    try {
      read = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      // Reading a pipe that has no data ready yet surfaces as EAGAIN; a TTY at
      // EOF surfaces as EOF on some platforms.
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EOF') break;
      throw err;
    }
    if (read === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, read)));
  }
  return Buffer.concat(chunks);
}

/**
 * Buffered writer mirroring `writeln!(output, ...).ok()`: every write error is
 * discarded, so a closed downstream pipe (`htmlq ... | head`) still exits 0.
 */
class Output {
  constructor(fd) {
    this.fd = fd;
    this.chunks = [];
    this.size = 0;
    this.broken = false;
  }

  writeLine(text) {
    this.chunks.push(`${text}\n`);
    this.size += text.length + 1;
    if (this.size >= 65536) this.flush();
  }

  flush() {
    if (this.chunks.length === 0) return;
    const buf = Buffer.from(this.chunks.join(''), 'utf8');
    this.chunks = [];
    this.size = 0;
    if (this.broken) return;

    let offset = 0;
    while (offset < buf.length) {
      try {
        offset += fs.writeSync(this.fd, buf, offset, buf.length - offset);
      } catch (err) {
        if (err.code === 'EAGAIN') continue;
        this.broken = true;
        return;
      }
    }
  }
}

function resolveBase(config, document) {
  if (config.base !== null) {
    if (config.detectBase) {
      return detectBase(document) ?? parseAbsoluteUrl(config.base);
    }
    return parseAbsoluteUrl(config.base);
  }
  return config.detectBase ? detectBase(document) : null;
}

/**
 * Port of `main::serialize_text`.
 */
function serializeText(node, ignoreWhitespace) {
  let result = '';
  for (const textNode of textNodes(node)) {
    if (ignoreWhitespace && isRustWhitespaceOnly(textNode.data)) continue;
    result += textNode.data;
    if (ignoreWhitespace) result += '\n';
  }
  return result;
}

function selectAttributes(node, attributes, output) {
  for (const attr of attributes) {
    const value = getAttr(node, attr);
    if (value !== undefined) output.writeLine(value);
  }
}

function openInput(path) {
  if (path === '-') return 0;
  try {
    return fs.openSync(path, 'r');
  } catch (err) {
    throw new Panic(`should have opened input file: ${err.message}`);
  }
}

function openOutput(path) {
  if (path === '-') return 1;
  try {
    return fs.openSync(path, 'w');
  } catch (err) {
    throw new Panic(`should have created output file: ${err.message}`);
  }
}

function run(config) {
  const inputFd = openInput(config.inputPath);
  const outputFd = openOutput(config.outputPath);
  const output = new Output(outputFd);

  const source = readAll(inputFd);
  if (inputFd !== 0) fs.closeSync(inputFd);

  // html5ever strips a leading BOM off the byte stream; parse5 does not.
  const text = source.toString('utf8').replace(/^\uFEFF/, '');
  const document = parseDocument(text);

  const base = resolveBase(config, document);

  const matches = compileSelector(config.selector);
  if (matches === null) throw new Panic('Failed to parse CSS selector');

  // An empty or unparseable removal selector is a silent no-op, matching
  // `let Ok(remove) = ... else { return; }`.
  const removeMatches = compileSelector(config.removeNodes.join(','));

  // Deliberately lazy: `--remove-nodes` detaches nodes while this iterator is
  // live, which can truncate it. See traverse.js and MIGRATION.md quirk Q1.
  for (const node of select(document, matches)) {
    if (removeMatches !== null) {
      const victim = selectFirst(node, removeMatches);
      if (victim !== null) detach(victim);
    }

    if (base !== null) rewriteRelativeUrl(node, base);

    if (config.attributes.length > 0) {
      selectAttributes(node, config.attributes, output);
    } else if (config.textOnly) {
      output.writeLine(serializeText(node, config.ignoreWhitespace));
    } else if (config.prettyPrint) {
      output.writeLine(prettyPrint(node));
    } else {
      output.writeLine(serialize(node));
    }
  }

  output.flush();
  if (outputFd !== 1) fs.closeSync(outputFd);
}

function writeAllTo(fd, text) {
  const buf = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buf.length) {
    try {
      offset += fs.writeSync(fd, buf, offset, buf.length - offset);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      return;
    }
  }
}

export function main(argv) {
  let config;
  try {
    config = parseArgs(argv);
  } catch (err) {
    if (err instanceof EarlyExit) {
      writeAllTo(1, err.text);
      return 0;
    }
    if (err instanceof UsageError) {
      writeAllTo(2, err.text);
      return 2;
    }
    throw err;
  }

  try {
    run(config);
  } catch (err) {
    if (err instanceof Panic) {
      writeAllTo(2, `htmlq: ${err.message}\n`);
      return 101;
    }
    // `main` in Rust returns a Result, so an I/O failure while reading or
    // writing is reported by the runtime as `Error: <debug>` with exit 1
    // rather than unwinding. Node would otherwise dump a stack trace.
    if (err instanceof Error && typeof err.code === 'string') {
      writeAllTo(2, `Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  return 0;
}
