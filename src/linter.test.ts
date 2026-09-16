import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint, type Finding } from './linter.js';

function ruleFindings(findings: Finding[], rule: string): Finding[] {
  return findings.filter((f) => f.rule === rule);
}

test('duplicate-key: flags a repeated key in the same mapping', () => {
  const findings = lint(['a: 1', 'b: 2', 'a: 3'].join('\n'));
  const dupes = ruleFindings(findings, 'duplicate-key');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].line, 3);
});

test('duplicate-key: a key repeated after a nested block closes is still caught', () => {
  // The frame for "parent" has to survive pushing and popping the frame for
  // "child"'s own contents, or this second "child" would look unrelated to
  // the first instead of a duplicate sibling under the same parent.
  const source = ['parent:', '  child:', '    a: 1', '  child:', '    a: 2'].join('\n');
  const findings = lint(source);
  const dupes = ruleFindings(findings, 'duplicate-key');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].line, 4);
  assert.deepEqual(
    dupes.map((f) => f.message),
    ['duplicate key "child"']
  );
});

test('duplicate-key: keys at the same indent under different parents are not duplicates', () => {
  // Both "x" keys sit at column 3, but they belong to separate frames (one
  // pushed under "a", one under "b"), so the stack must not confuse them.
  const source = ['a:', '  x: 1', 'b:', '  x: 1'].join('\n');
  const findings = lint(source);
  assert.equal(ruleFindings(findings, 'duplicate-key').length, 0);
});

test('duplicate-key: dedenting multiple levels at once still restores the right frame', () => {
  const source = ['a:', '  b:', '    c: 1', 'd: 2', 'd: 3'].join('\n');
  const findings = lint(source);
  const dupes = ruleFindings(findings, 'duplicate-key');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].line, 5);
});

test('duplicate-key: each list entry starts a fresh mapping frame', () => {
  // Every "- name:" opens a new mapping, so seeing "name" once per entry is
  // normal and must not be reported, even though they all land at the same
  // indent and the previous frame at that indent is still on the stack.
  const source = ['items:', '  - name: foo', '  - name: bar', '  - name: baz'].join('\n');
  const findings = lint(source);
  assert.equal(ruleFindings(findings, 'duplicate-key').length, 0);
});

test('duplicate-key: a repeated key within one list entry is still caught', () => {
  const source = ['items:', '  - name: foo', '    name: bar'].join('\n');
  const findings = lint(source);
  const dupes = ruleFindings(findings, 'duplicate-key');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].line, 3);
});

test('duplicate-key: siblings after a list block closes are compared against the right frame', () => {
  // Once the list under "items" ends, "other" at the same indent belongs to
  // the top-level frame, not to whatever frame the last list entry pushed.
  const source = ['items:', '  - name: foo', 'other: 1', 'other: 2'].join('\n');
  const findings = lint(source);
  const dupes = ruleFindings(findings, 'duplicate-key');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].line, 4);
});

test('duplicate-key: re-indenting back to a shallower sibling after deep nesting works repeatedly', () => {
  const source = [
    'a:',
    '  b:',
    '    c:',
    '      d: 1',
    '  e: 1',
    '  e: 2',
    'f: 1',
    'f: 2',
  ].join('\n');
  const findings = lint(source);
  const dupes = ruleFindings(findings, 'duplicate-key');
  assert.deepEqual(
    dupes.map((f) => f.line),
    [6, 8]
  );
});

test('indentation-consistency: flags a nested key indented differently than the step established earlier', () => {
  const source = ['a:', '  b: 1', 'c:', '   d: 1'].join('\n');
  const findings = lint(source);
  const warnings = ruleFindings(findings, 'indentation-consistency');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].line, 4);
  assert.equal(warnings[0].column, 4);
  assert.match(warnings[0].message, /increases by 3 space\(s\) here but by 2 elsewhere/);
});

test('indentation-consistency: a file nested by the same step throughout is not flagged', () => {
  const source = ['a:', '  b: 1', 'c:', '  d: 1'].join('\n');
  const findings = lint(source);
  assert.equal(ruleFindings(findings, 'indentation-consistency').length, 0);
});

test('indentation-consistency: list-entry step is tracked separately from mapping step', () => {
  // "- " bakes a 2-space offset into the first list entry regardless of how
  // deep the enclosing mapping is nested, so it must not be compared against
  // the mapping step established by "a"/"b" above it.
  const source = ['a:', '  b: 1', 'items:', '    - x: 1', '    - y: 1'].join('\n');
  const findings = lint(source);
  assert.equal(ruleFindings(findings, 'indentation-consistency').length, 0);
});

test('comment-stripping: a hash inside a double-quoted value is not treated as a comment', () => {
  const findings = lint('a: "value # not a comment"');
  assert.equal(findings.length, 0);
});

test('comment-stripping: a hash inside a single-quoted value is not treated as a comment', () => {
  const findings = lint("a: 'value # not a comment'");
  assert.equal(findings.length, 0);
});

test('comment-stripping: a hash with no preceding whitespace does not start a comment', () => {
  const findings = lint('a: http://example.com#fragment');
  assert.equal(findings.length, 0);
});

test('comment-stripping: trailing whitespace inside a comment is still flagged', () => {
  // Trailing whitespace is checked against the raw line, before stripComment
  // runs, so a comment can't be used to hide it.
  const findings = lint('a: 1  # comment with trailing space   ');
  assert.equal(ruleFindings(findings, 'trailing-whitespace').length, 1);
});

test('comment-stripping: a comment-only line is not checked for tab indentation', () => {
  // Once the comment is stripped there is no content left on the line, so
  // the tab-indentation check (which only looks at real content) never runs.
  const findings = lint('\t# a comment, not code');
  assert.equal(ruleFindings(findings, 'tab-indentation').length, 0);
});

test('empty-document: a zero-length source is flagged', () => {
  const findings = lint('');
  const empty = ruleFindings(findings, 'empty-document');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].line, 1);
  assert.equal(empty[0].column, 1);
  assert.equal(empty[0].severity, 'warning');
});

test('empty-document: blank lines with no other content are flagged', () => {
  const findings = lint('\n  \n\n');
  assert.equal(ruleFindings(findings, 'empty-document').length, 1);
});

test('empty-document: a file with only comments is flagged', () => {
  const findings = lint(['# header', '', '# another note'].join('\n'));
  assert.equal(ruleFindings(findings, 'empty-document').length, 1);
});

test('empty-document: a file with any real content is not flagged', () => {
  const findings = lint('a: 1');
  assert.equal(ruleFindings(findings, 'empty-document').length, 0);
});

test('empty-document: a bare scalar document with no keys counts as content', () => {
  const findings = lint('just a string, no mapping keys here');
  assert.equal(ruleFindings(findings, 'empty-document').length, 0);
});
