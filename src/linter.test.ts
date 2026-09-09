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
