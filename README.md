# htmlq

Like [`jq`](https://stedolan.github.io/jq/), but for HTML. Uses [CSS selectors](https://developer.mozilla.org/en-US/docs/Learn/CSS/Introduction_to_CSS/Selectors) to extract bits of content from HTML files.

This is a JavaScript port of the [original Rust implementation](https://github.com/mgdm/htmlq) by Michael Maclean. It is intended to be a drop-in replacement: see [MIGRATION.md](MIGRATION.md) for the equivalence testing behind that claim, and for the handful of documented deviations.

## Installation

```sh
npm install -g htmlq
```

Requires Node.js 20 or newer.

## Usage

```console
$ htmlq -h
Like jq, but for HTML.

Usage: htmlq [OPTIONS] [SELECTOR]

Arguments:
  [SELECTOR]  What CSS selector to filter with [default: html]

Options:
  -f, --filename <INPUT_PATH>        Where to read HTML input from [default: -]
  -o, --output <OUTPUT_PATH>         Where to write the filtered HTML to [default: -]
  -b, --base <BASE>                  What URL to prepend to links without an origin, i.e. starting with a slash (/)
  -B, --detect-base                  Look for the `<base>` tag in input for the base
  -t, --text                         Output only the contained text of the filtered nodes, not the entire HTML
  -i, --ignore-whitespace            Skip over text nodes whose text that is solely whitespace
  -p, --pretty                       If to reformat the HTML to be more nicely user-readable
  -r, --remove-nodes <REMOVE_NODES>  Do not output the nodes matching any of these selectors
  -a, --attributes <ATTRIBUTES>      Output only the contents of the given attributes
  -h, --help                         Print help
  -V, --version                      Print version
$
```

## Examples

### Using with cURL to find part of a page by ID

```console
$ curl --silent https://www.rust-lang.org/ | htmlq '#get-help'
<div class="four columns mt3 mt0-l" id="get-help">
        <h4>Get help!</h4>
        <ul>
          <li><a href="https://doc.rust-lang.org">Documentation</a></li>
          <li><a href="https://users.rust-lang.org">Ask a Question on the Users Forum</a></li>
          <li><a href="http://ping.rust-lang.org">Check Website Status</a></li>
        </ul>
        <div class="languages">
            <label class="hidden" for="language-footer">Language</label>
            <select id="language-footer">
                <option title="English (US)" value="en-US">English (en-US)</option>
<option title="French" value="fr">Français (fr)</option>
<option title="German" value="de">Deutsch (de)</option>

            </select>
        </div>
      </div>
```

### Find all the links in a page

```console
$ curl --silent https://www.rust-lang.org/ | htmlq --attributes href a
/
/tools/install
/learn
/tools
/governance
/community
https://blog.rust-lang.org/
/learn/get-started
https://blog.rust-lang.org/2019/04/25/Rust-1.34.1.html
https://blog.rust-lang.org/2018/12/06/Rust-1.31-and-rust-2018.html
[...]
```

### Get the text content of a post

```console
$ curl --silent https://nixos.org/nixos/about.html | htmlq  --text .main

          About NixOS

NixOS is a GNU/Linux distribution that aims to
improve the state of the art in system configuration management.  In
existing distributions, actions such as upgrades are dangerous:
upgrading a package can cause other packages to break, upgrading an
entire system is much less reliable than reinstalling from scratch,
you can’t safely test what the results of a configuration change will
be, you cannot easily undo changes to the system, and so on.  We want
to change that.  NixOS has many innovative features:

[...]
```

### Remove a node before output

There's a big SVG image in this page that I don't need, so here's how to remove it.

```console
$ curl --silent https://nixos.org/ | htmlq '.whynix' --remove-nodes svg
<ul class="whynix">
      <li>

        <h2>Reproducible</h2>
        <p>
          Nix builds packages in isolation from each other. This ensures that they
          are reproducible and don't have undeclared dependencies, so <strong>if a
            package works on one machine, it will also work on another</strong>.
        </p>
      </li>
      <li>

        <h2>Declarative</h2>
        <p>
          Nix makes it <strong>trivial to share development and build
            environments</strong> for your projects, regardless of what programming
          languages and tools you’re using.
        </p>
      </li>
      <li>

        <h2>Reliable</h2>
        <p>
          Nix ensures that installing or upgrading one package <strong>cannot
            break other packages</strong>. It allows you to <strong>roll back to
            previous versions</strong>, and ensures that no package is in an
          inconsistent state during an upgrade.
        </p>
      </li>
    </ul>
```

Note that `--remove-nodes` removes only the *first* matching descendant of each
selected element, and that removing a node can cut the match iteration short.
Both behaviours are inherited from the Rust original and are described in
[MIGRATION.md](MIGRATION.md).

### Pretty print HTML

(This is a bit of a work in progress)

```console
$ curl --silent https://mgdm.net | htmlq --pretty '#posts'
<section id="posts">
  <h2>I write about...
  </h2>
  <ul class="post-list">
    <li>
      <time datetime="2019-04-29 00:%i:1556496000" pubdate="">
        29/04/2019</time><a href="/weblog/nettop/">
        <h3>Debugging network connections on macOS with nettop
        </h3></a>
      <p>Using nettop to find out what network connections a program is trying to make.
      </p>
    </li>
[...]
```

### Syntax highlighting with [`bat`](https://github.com/sharkdp/bat)

```console
$ curl --silent example.com | htmlq 'body' | bat --language html
```

> <img alt="Syntax highlighted output" width="700" src="https://user-images.githubusercontent.com/2346707/132808980-db8991ff-9177-4cb7-a018-39ad94282374.png" />

## Development

```sh
npm install
npm test
```

`npm test` runs the ported unit and CLI tests. There is also a differential
harness that compares this implementation against a compiled copy of the Rust
original, byte for byte, across a corpus of documents and flag combinations:

```sh
HTMLQ_REFERENCE=/path/to/rust/htmlq npm run test:differential
```

## Licence

MIT, © 2019 Michael Maclean. See [LICENSE.md](LICENSE.md). The JavaScript port
retains the original licence and attribution.
