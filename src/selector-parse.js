/**
 * Selector parser mirroring the grammar accepted by Servo's `selectors` crate
 * as configured by `kuchikiki`, which is what `htmlq` compiles selectors with.
 *
 * This exists instead of `css-what` because the two grammars disagree in both
 * directions, and every disagreement is a silent wrong answer: `css-what`
 * accepts `:is()`, `:has()`, `#1abc` and bare combinators that Servo rejects,
 * and rejects `*|a` and `:focus` that Servo accepts. `htmlq` turns a rejected
 * selector into an exit-101 panic, so acceptance itself is observable
 * behaviour, not an implementation detail.
 */

export class SelectorError extends Error {}

const FUNCTIONAL_PSEUDOS = new Set([
  'not',
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
]);

const PSEUDO_CLASSES = new Set([
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'only-of-type',
  'empty',
  'root',
  'scope',
  'link',
  'any-link',
  'visited',
  'hover',
  'active',
  'focus',
  'enabled',
  'disabled',
  'checked',
  'indeterminate',
]);

const ATTR_OPERATORS = ['~=', '|=', '^=', '$=', '*=', '='];

const NTH_KEYWORDS = new Map([
  ['odd', { a: 2, b: 1 }],
  ['even', { a: 2, b: 0 }],
]);

function isIdentStart(ch) {
  return /[a-zA-Z_]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

function isIdentChar(ch) {
  return /[a-zA-Z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

class Parser {
  constructor(input) {
    this.input = input;
    this.pos = 0;
  }

  get done() {
    return this.pos >= this.input.length;
  }

  peek(offset = 0) {
    return this.input[this.pos + offset];
  }

  skipWhitespace() {
    while (!this.done && /\s/.test(this.peek())) this.pos += 1;
  }

  fail(message) {
    return new SelectorError(`${message} at offset ${this.pos}`);
  }

  /**
   * CSS escapes: `\2d abc` is the ident `-abc`, `\.` is a literal dot. A hex
   * escape swallows one trailing whitespace character as its terminator.
   */
  readEscape() {
    this.pos += 1;
    if (this.done) throw this.fail('trailing backslash');
    const hex = /^[0-9a-fA-F]{1,6}/.exec(this.input.slice(this.pos));
    if (!hex) {
      const ch = this.peek();
      this.pos += 1;
      return ch;
    }
    this.pos += hex[0].length;
    if (!this.done && /\s/.test(this.peek())) this.pos += 1;
    const code = parseInt(hex[0], 16);
    if (code === 0 || code > 0x10ffff) return '\uFFFD';
    return String.fromCodePoint(code);
  }

  readIdent() {
    let out = '';
    if (this.peek() === '-') {
      out += '-';
      this.pos += 1;
      if (this.peek() === '-') {
        out += '-';
        this.pos += 1;
      }
    }
    if (this.done) throw this.fail('expected identifier');
    if (this.peek() === '\\') out += this.readEscape();
    else if (isIdentStart(this.peek())) {
      out += this.peek();
      this.pos += 1;
    } else throw this.fail('expected identifier');

    while (!this.done) {
      const ch = this.peek();
      if (ch === '\\') out += this.readEscape();
      else if (isIdentChar(ch)) {
        out += ch;
        this.pos += 1;
      } else break;
    }
    return out;
  }

  readString() {
    const quote = this.peek();
    this.pos += 1;
    let out = '';
    while (!this.done && this.peek() !== quote) {
      if (this.peek() === '\\') out += this.readEscape();
      else {
        out += this.peek();
        this.pos += 1;
      }
    }
    if (this.done) throw this.fail('unterminated string');
    this.pos += 1;
    return out;
  }

  /**
   * Servo has no namespace declarations available here, so the only prefixes
   * that can resolve are `*|` (any namespace) and `|` (no namespace). Any
   * other prefix is an undeclared-namespace error.
   */
  readNamespacePrefix() {
    if (this.peek() === '|') {
      this.pos += 1;
      return 'none';
    }
    const start = this.pos;
    let prefix;
    if (this.peek() === '*') {
      this.pos += 1;
      prefix = '*';
    } else if (this.peek() === '\\' || isIdentStart(this.peek()) || this.peek() === '-') {
      prefix = this.readIdent();
    } else return null;

    if (this.peek() === '|' && this.peek(1) !== '=') {
      this.pos += 1;
      if (prefix !== '*') throw this.fail(`undeclared namespace prefix '${prefix}'`);
      return 'any';
    }
    this.pos = start;
    return null;
  }

  readAttribute() {
    this.pos += 1;
    this.skipWhitespace();
    if (this.done) throw this.fail('expected attribute name');

    let namespace = this.readNamespacePrefix() ?? 'default';
    if (this.done) throw this.fail('expected attribute name');
    const name = this.peek() === '*' ? null : this.readIdent();
    if (name === null) throw this.fail('expected attribute name');
    this.skipWhitespace();

    // cssparser treats end-of-input as closing an open block, so `[id` and
    // `[id="x"` parse, while `[id=` is a genuine error.
    if (this.done || this.peek() === ']') {
      if (!this.done) this.pos += 1;
      return { type: 'attr', name, namespace, operator: null, value: null, caseInsensitive: false };
    }

    const operator = ATTR_OPERATORS.find((op) => this.input.startsWith(op, this.pos));
    if (!operator) throw this.fail('expected attribute operator');
    this.pos += operator.length;
    this.skipWhitespace();
    if (this.done) throw this.fail('expected attribute value');

    const value = this.peek() === '"' || this.peek() === "'" ? this.readString() : this.readIdent();
    this.skipWhitespace();

    let caseInsensitive = false;
    if (!this.done && this.peek() !== ']') {
      const flag = this.readIdent().toLowerCase();
      if (flag !== 'i' && flag !== 's') throw this.fail(`unknown attribute flag '${flag}'`);
      caseInsensitive = flag === 'i';
      this.skipWhitespace();
    }
    if (!this.done) {
      if (this.peek() !== ']') throw this.fail('expected "]"');
      this.pos += 1;
    }
    return { type: 'attr', name, namespace, operator, value, caseInsensitive };
  }

  readFunctionArgument() {
    let depth = 1;
    let out = '';
    while (!this.done) {
      const ch = this.peek();
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          this.pos += 1;
          return out;
        }
      }
      out += ch;
      this.pos += 1;
    }
    return out;
  }

  readPseudo() {
    this.pos += 1;
    if (this.peek() === ':') throw this.fail('pseudo-elements are not supported');
    if (this.done) throw this.fail('expected pseudo-class name');
    const name = this.readIdent().toLowerCase();

    if (this.peek() === '(') {
      this.pos += 1;
      if (!FUNCTIONAL_PSEUDOS.has(name)) throw this.fail(`unsupported pseudo-class ':${name}()'`);
      const argument = this.readFunctionArgument();
      if (name === 'not') return { type: 'not', selector: parseNegation(argument) };
      return { type: 'nth', name, ...parseNth(argument) };
    }

    if (!PSEUDO_CLASSES.has(name)) throw this.fail(`unsupported pseudo-class ':${name}'`);
    return { type: 'pseudo', name };
  }

  readCompound() {
    const compound = { namespace: 'any', name: null, simples: [] };
    let matched = false;

    const namespace = this.readNamespacePrefix();
    if (namespace !== null) {
      compound.namespace = namespace;
      matched = true;
      if (this.peek() === '*') this.pos += 1;
      else compound.name = this.readIdent();
    } else if (this.peek() === '*') {
      this.pos += 1;
      matched = true;
    } else if (!this.done && (this.peek() === '\\' || this.peek() === '-' || isIdentStart(this.peek()))) {
      compound.name = this.readIdent();
      matched = true;
    }

    while (!this.done) {
      const ch = this.peek();
      if (ch === '#') {
        this.pos += 1;
        compound.simples.push({ type: 'id', value: this.readIdent() });
      } else if (ch === '.') {
        this.pos += 1;
        compound.simples.push({ type: 'class', value: this.readIdent() });
      } else if (ch === '[') {
        compound.simples.push(this.readAttribute());
      } else if (ch === ':') {
        compound.simples.push(this.readPseudo());
      } else break;
      matched = true;
    }

    if (!matched) throw this.fail('expected a selector');
    return compound;
  }

  readComplex() {
    const parts = [{ combinator: null, compound: this.readCompound() }];
    for (;;) {
      const hadWhitespace = /\s/.test(this.peek() ?? '');
      this.skipWhitespace();
      if (this.done || this.peek() === ',') return parts;

      let combinator;
      if (this.peek() === '>' || this.peek() === '+' || this.peek() === '~') {
        combinator = this.peek();
        this.pos += 1;
        this.skipWhitespace();
      } else if (hadWhitespace) {
        combinator = ' ';
      } else throw this.fail('expected a combinator');

      parts.push({ combinator, compound: this.readCompound() });
    }
  }

  parseList() {
    const list = [];
    for (;;) {
      this.skipWhitespace();
      list.push(this.readComplex());
      this.skipWhitespace();
      if (this.done) return list;
      if (this.peek() !== ',') throw this.fail('expected ","');
      this.pos += 1;
    }
  }
}

/**
 * Selectors Level 3 restricts `:not()` to a single simple selector: no
 * combinators, no selector list, and no nested negation.
 */
function parseNegation(argument) {
  const parser = new Parser(argument);
  parser.skipWhitespace();
  const compound = parser.readCompound();
  parser.skipWhitespace();
  if (!parser.done) throw new SelectorError(':not() takes a single simple selector');

  const simpleCount = compound.simples.length + (compound.name !== null || compound.namespace !== 'any' ? 1 : 0);
  if (simpleCount > 1) throw new SelectorError(':not() takes a single simple selector');
  if (compound.simples.some((simple) => simple.type === 'not')) {
    throw new SelectorError(':not() may not be nested');
  }
  return compound;
}

function parseNth(argument) {
  const text = argument.trim().toLowerCase();
  const keyword = NTH_KEYWORDS.get(text);
  if (keyword) return keyword;

  const integer = /^([+-]?\d+)$/.exec(text);
  if (integer) return { a: 0, b: parseInt(integer[1], 10) };

  // `An+B`: whitespace is allowed around the `+`/`-` joining B, but not
  // between the coefficient and the `n`, so `2 n` must not parse.
  const match = /^([+-]?\d*)n\s*(?:([+-])\s*(\d+))?$/.exec(text);
  if (!match) throw new SelectorError(`invalid An+B argument '${argument}'`);
  const coefficient = match[1];
  const a = coefficient === '' || coefficient === '+' ? 1 : coefficient === '-' ? -1 : parseInt(coefficient, 10);
  const b = match[3] ? parseInt(match[3], 10) * (match[2] === '-' ? -1 : 1) : 0;
  return { a, b };
}

export function parseSelectorList(input) {
  return new Parser(input).parseList();
}
