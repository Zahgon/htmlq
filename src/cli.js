/**
 * Command-line parsing.
 *
 * Hand-rolled reimplementation of the `clap` derive interface in
 * `src/main.rs`, including clap's exact `--help` / `--version` / error output.
 * A generic arg-parsing library was rejected because none of them reproduce
 * clap's error wording byte-for-byte, and the differential test suite compares
 * stderr against the reference binary.
 */

export const VERSION = '0.5.0';

export const HELP_TEXT = `Like jq, but for HTML.

Usage: htmlq [OPTIONS] [SELECTOR]

Arguments:
  [SELECTOR]  What CSS selector to filter with [default: html]

Options:
  -f, --filename <INPUT_PATH>        Where to read HTML input from [default: -]
  -o, --output <OUTPUT_PATH>         Where to write the filtered HTML to [default: -]
  -b, --base <BASE>                  What URL to prepend to links without an origin, i.e. starting with a slash (/)
  -B, --detect-base                  Look for the \`<base>\` tag in input for the base
  -t, --text                         Output only the contained text of the filtered nodes, not the entire HTML
  -i, --ignore-whitespace            Skip over text nodes whose text that is solely whitespace
  -p, --pretty                       If to reformat the HTML to be more nicely user-readable
  -r, --remove-nodes <REMOVE_NODES>  Do not output the nodes matching any of these selectors
  -a, --attributes <ATTRIBUTES>      Output only the contents of the given attributes
  -h, --help                         Print help
  -V, --version                      Print version
`;

const USAGE = 'Usage: htmlq [OPTIONS] [SELECTOR]';
const TRY_HELP = "For more information, try '--help'.";

const VALUE_OPTIONS = new Map([
  ['f', { long: 'filename', placeholder: 'INPUT_PATH', field: 'inputPath' }],
  ['o', { long: 'output', placeholder: 'OUTPUT_PATH', field: 'outputPath' }],
  ['b', { long: 'base', placeholder: 'BASE', field: 'base' }],
  ['r', { long: 'remove-nodes', placeholder: 'REMOVE_NODES', field: 'removeNodes', many: true }],
  ['a', { long: 'attributes', placeholder: 'ATTRIBUTES', field: 'attributes', many: true }],
]);

const FLAG_OPTIONS = new Map([
  ['B', 'detectBase'],
  ['t', 'textOnly'],
  ['i', 'ignoreWhitespace'],
  ['p', 'prettyPrint'],
]);

const LONG_VALUE_OPTIONS = new Map(
  [...VALUE_OPTIONS.values()].map((spec) => [spec.long, spec]),
);
const LONG_FLAG_OPTIONS = new Map([
  ['detect-base', 'detectBase'],
  ['text', 'textOnly'],
  ['ignore-whitespace', 'ignoreWhitespace'],
  ['pretty', 'prettyPrint'],
]);

const LONG_NAME_BY_FIELD = new Map(
  [...LONG_FLAG_OPTIONS].map(([long, field]) => [field, long]),
);

/** Signals `-h` / `-V`: print `text` to stdout and exit 0. */
export class EarlyExit extends Error {
  constructor(text) {
    super('early exit');
    this.text = text;
  }
}

/** A clap-style usage error: print `text` to stderr and exit 2. */
export class UsageError extends Error {
  constructor(text) {
    super('usage error');
    this.text = text;
  }
}

function unexpectedArgument(arg) {
  let text = `error: unexpected argument '${arg}' found\n\n`;
  if (arg.startsWith('-')) {
    text += `  tip: to pass '${arg}' as a value, use '-- ${arg}'\n\n`;
  }
  return new UsageError(`${text}${USAGE}\n\n${TRY_HELP}\n`);
}

function missingValue(spec) {
  return new UsageError(
    `error: a value is required for '--${spec.long} <${spec.placeholder}>' but none was supplied\n\n${TRY_HELP}\n`,
  );
}

function duplicateArgument(display) {
  return new UsageError(
    `error: the argument '${display}' cannot be used multiple times\n\n${USAGE}\n\n${TRY_HELP}\n`,
  );
}

function unexpectedValue(value, long) {
  return new UsageError(
    `error: unexpected value '${value}' for '--${long}' found; no more were expected\n\n`
      + `Usage: htmlq --${long} [SELECTOR]\n\n${TRY_HELP}\n`,
  );
}

/**
 * True for a token clap refuses to consume as an option value.
 *
 * A bare `-` is the documented stdin/stdout sentinel and IS accepted, but any
 * other leading-dash token (including `--`) makes clap report the pending
 * option as missing its value rather than swallowing the flag.
 */
function isOptionLike(token) {
  return token.startsWith('-') && token !== '-';
}

/**
 * Whether a leading-dash token names an option this CLI knows about.
 *
 * clap distinguishes the two failure modes: a recognised flag after a pending
 * option yields "a value is required", an unrecognised one yields "unexpected
 * argument". Only the first character of a short cluster is consulted, matching
 * clap's behaviour for `-b -tx`.
 */
function isKnownOption(token) {
  if (token === '--') return true;
  if (token.startsWith('--')) {
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    return (
      LONG_VALUE_OPTIONS.has(name)
      || LONG_FLAG_OPTIONS.has(name)
      || name === 'help'
      || name === 'version'
    );
  }
  const ch = token[1];
  return VALUE_OPTIONS.has(ch) || FLAG_OPTIONS.has(ch) || ch === 'h' || ch === 'V';
}

export function parseArgs(argv) {
  const config = {
    selector: 'html',
    inputPath: '-',
    outputPath: '-',
    base: null,
    detectBase: false,
    textOnly: false,
    ignoreWhitespace: false,
    prettyPrint: false,
    removeNodes: [],
    attributes: [],
  };

  let positionalSeen = false;
  let optionsEnded = false;
  let i = 0;

  const seen = new Set();

  const takeValue = (spec, inline) => {
    if (inline !== null) return inline;
    if (i >= argv.length) throw missingValue(spec);
    const next = argv[i];
    if (isOptionLike(next)) {
      if (isKnownOption(next)) throw missingValue(spec);
      throw unexpectedArgument(next);
    }
    i++;
    return next;
  };

  const setValue = (spec, value) => {
    if (spec.many) {
      config[spec.field].push(value);
      return;
    }
    if (seen.has(spec.field)) {
      throw duplicateArgument(`--${spec.long} <${spec.placeholder}>`);
    }
    seen.add(spec.field);
    config[spec.field] = value;
  };

  const setFlag = (field, long) => {
    if (seen.has(field)) throw duplicateArgument(`--${long}`);
    seen.add(field);
    config[field] = true;
  };

  const acceptPositional = (arg) => {
    if (positionalSeen) throw unexpectedArgument(arg);
    positionalSeen = true;
    config.selector = arg;
  };

  while (i < argv.length) {
    const arg = argv[i++];

    if (optionsEnded) {
      acceptPositional(arg);
      continue;
    }

    if (arg === '--') {
      optionsEnded = true;
    } else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inline = eq === -1 ? null : arg.slice(eq + 1);

      const valueSpec = LONG_VALUE_OPTIONS.get(name);
      if (valueSpec !== undefined) {
        setValue(valueSpec, takeValue(valueSpec, inline));
        continue;
      }

      const flagField = LONG_FLAG_OPTIONS.get(name);
      if (flagField !== undefined) {
        if (inline !== null) throw unexpectedValue(inline, name);
        setFlag(flagField, name);
        continue;
      }

      if (name === 'help' || name === 'version') {
        if (inline !== null) throw unexpectedValue(inline, name);
        throw new EarlyExit(name === 'help' ? HELP_TEXT : `htmlq ${VERSION}\n`);
      }

      throw unexpectedArgument(arg);
    } else if (arg.startsWith('-') && arg.length > 1) {
      // A short cluster: flags may be packed together, and the first
      // value-taking option consumes the rest of the cluster as its value.
      for (let k = 1; k < arg.length; k++) {
        const ch = arg[k];

        const valueSpec = VALUE_OPTIONS.get(ch);
        if (valueSpec !== undefined) {
          // clap drops one `=` joining a short option to its attached value,
          // so `-a=href` and `-ahref` both mean `href`.
          let rest = arg.slice(k + 1);
          if (rest.startsWith('=')) rest = rest.slice(1);
          setValue(valueSpec, takeValue(valueSpec, rest === '' ? null : rest));
          break;
        }

        const flagField = FLAG_OPTIONS.get(ch);
        if (flagField !== undefined) {
          setFlag(flagField, LONG_NAME_BY_FIELD.get(flagField));
          continue;
        }

        if (ch === 'h') throw new EarlyExit(HELP_TEXT);
        if (ch === 'V') throw new EarlyExit(`htmlq ${VERSION}\n`);

        throw unexpectedArgument(arg);
      }
    } else {
      acceptPositional(arg);
    }
  }

  return config;
}
