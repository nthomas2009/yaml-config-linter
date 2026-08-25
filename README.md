# yaml-config-linter

YAML config files fail quietly. A duplicate key doesn't error, it just silently
overwrites the earlier one. A stray tab in the indentation is invisible in most
editors but breaks the parse. Trailing whitespace does nothing most of the
time until it does. This is a small linter that walks a YAML file line by line
and reports these problems with a file, line, and column, the same shape
you'd get from a compiler error.

It has no dependencies. It doesn't parse YAML into a full document tree, it
just tracks indentation and key names well enough to catch the mistakes that
actually show up in hand-edited config files.

## Rules

- `tab-indentation` - a tab character used for indentation (YAML indentation
  must be spaces)
- `trailing-whitespace` - trailing spaces or tabs at the end of a line
- `duplicate-key` - the same key defined twice inside the same mapping
- `indentation-consistency` - a nested key or list entry indented by a
  different number of spaces than the step already established elsewhere in
  the file (this is how a stray extra space quietly nests a line under the
  wrong parent)

## Suppressing a finding

Sometimes a file has a line that legitimately needs to break a rule (a
generated block with a trailing space it can't avoid, for example). Add a
comment to silence it:

```yaml
key: value with a trailing space  # yamllint-ts:disable-line
```

or target the next line, when the line itself has no room for a comment:

```yaml
# yamllint-ts:disable-next-line=duplicate-key
key: value
```

Both forms take an optional `=rule-a,rule-b` suffix to suppress only the
named rules instead of everything on that line:

```yaml
key: value with a trailing space  # yamllint-ts:disable-line=trailing-whitespace
```

## Usage

Build once:

```sh
npm run build
```

Then run it against one or more files:

```sh
node dist/cli.js config.yaml
```

Given this file:

```yaml
service:
  name: billing
	port: 8080
service:
  name: billing-v2
```

it reports:

```
config.yaml:3:1 error tab-indentation - tabs are not allowed for indentation
config.yaml:4:1 error duplicate-key - duplicate key "service"

2 error(s), 0 warning(s)
```

The process exits with status 1 if any error-level finding was reported, so
it can be dropped into a pre-commit hook or CI step directly:

```sh
node dist/cli.js config/*.yaml || exit 1
```

## How it works

`src/linter.ts` exports a single `lint(source: string): Finding[]` function.
For each line it strips comments (respecting quoted strings), checks for
tabs and trailing whitespace, and if the line defines a mapping key, tracks
it against a stack of "frames" keyed by indentation level. Popping and
pushing frames as indentation changes is what lets it tell a real duplicate
key apart from two sibling list items that happen to share a key name.

`src/cli.ts` is just the file-reading and output-formatting wrapper around
that function.

## Status

Early. Four rules, inline suppression comments, no config file yet, no glob
support (files must be named explicitly on the command line), no test suite.
