export type Severity = 'error' | 'warning';

export interface Finding {
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: Severity;
}

interface Frame {
  indent: number;
  keys: Set<string>;
}

const KEY_PATTERN = /^("[^"]*"|'[^']*'|[^:#\s][^:]*?)\s*:(\s|$)/;

function makeFinding(
  line: number,
  column: number,
  rule: string,
  message: string,
  severity: Severity
): Finding {
  return { line, column, rule, message, severity };
}

// Finds the start of a trailing # comment, but only outside of quoted
// strings, and only when it starts a token (preceded by whitespace or start
// of line). This is not a full YAML scalar parser -- it's just enough to
// keep comments from polluting the indentation and key checks below.
function findCommentIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return i;
    }
  }
  return -1;
}

function stripComment(line: string): string {
  const idx = findCommentIndex(line);
  return idx === -1 ? line : line.slice(0, idx);
}

const DISABLE_LINE = /yamllint-ts:disable-line(?:=([\w-]+(?:\s*,\s*[\w-]+)*))?/;
const DISABLE_NEXT_LINE =
  /yamllint-ts:disable-next-line(?:=([\w-]+(?:\s*,\s*[\w-]+)*))?/;

// A suppression is either "all rules" (from a bare disable comment) or a set
// of specific rule names (from `disable-line=rule-a,rule-b`).
type Suppression = 'all' | Set<string>;

function addSuppression(
  map: Map<number, Suppression>,
  targetLine: number,
  rulesArg: string | undefined
): void {
  if (rulesArg === undefined) {
    map.set(targetLine, 'all');
    return;
  }
  const existing = map.get(targetLine);
  if (existing === 'all') return;
  const set = existing ?? new Set<string>();
  for (const rule of rulesArg.split(',')) set.add(rule.trim());
  map.set(targetLine, set);
}

// Scans every line for `# yamllint-ts:disable-line[=rule,...]` and
// `# yamllint-ts:disable-next-line[=rule,...]` comments, independent of the
// main pass below, since a suppression comment can appear on a line the main
// pass never looks at closely (e.g. a line with no key at all).
function collectSuppressions(lines: string[]): Map<number, Suppression> {
  const map = new Map<number, Suppression>();
  lines.forEach((rawLine, i) => {
    const commentIndex = findCommentIndex(rawLine);
    if (commentIndex === -1) return;
    const comment = rawLine.slice(commentIndex);
    const lineNo = i + 1;
    const lineMatch = comment.match(DISABLE_LINE);
    if (lineMatch) addSuppression(map, lineNo, lineMatch[1]);
    const nextMatch = comment.match(DISABLE_NEXT_LINE);
    if (nextMatch) addSuppression(map, lineNo + 1, nextMatch[1]);
  });
  return map;
}

function isSuppressed(
  suppressions: Map<number, Suppression>,
  finding: Finding
): boolean {
  const suppression = suppressions.get(finding.line);
  if (suppression === undefined) return false;
  return suppression === 'all' || suppression.has(finding.rule);
}

export function lint(source: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split(/\r\n|\n/);
  const suppressions = collectSuppressions(lines);
  const stack: Frame[] = [];

  // The step size (in spaces) between a frame and its first-seen child is
  // taken as the file's convention. List entries get their own step because
  // "- " bakes in a fixed offset that has nothing to do with mapping
  // indentation, so comparing the two would just produce false positives.
  let mapStep: number | null = null;
  let listStep: number | null = null;

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;

    const trailing = rawLine.match(/[ \t]+$/);
    if (trailing && rawLine.trim().length > 0) {
      findings.push(
        makeFinding(
          lineNo,
          rawLine.length - trailing[0].length + 1,
          'trailing-whitespace',
          'trailing whitespace',
          'warning'
        )
      );
    }

    const content = stripComment(rawLine);
    if (content.trim() === '') return;

    const indentText = content.match(/^[ \t]*/)![0];
    const tabIndex = indentText.indexOf('\t');
    if (tabIndex !== -1) {
      findings.push(
        makeFinding(
          lineNo,
          tabIndex + 1,
          'tab-indentation',
          'tabs are not allowed for indentation',
          'error'
        )
      );
    }

    const indent = indentText.length;
    let rest = content.slice(indent);
    let keyIndent = indent;
    const isListItem = rest === '-' || rest.startsWith('- ');
    if (isListItem) {
      rest = rest === '-' ? '' : rest.slice(2);
      keyIndent = indent + 2;
    }

    const keyMatch = rest.match(KEY_PATTERN);
    if (!keyMatch) return;
    const key = keyMatch[1].trim();

    while (stack.length && stack[stack.length - 1].indent > keyIndent) {
      stack.pop();
    }
    let frame = stack[stack.length - 1];

    // A new sequence entry ("- ") always starts a fresh mapping, even if a
    // previous sibling entry left a frame at the same indent behind.
    if (isListItem && frame && frame.indent === keyIndent) {
      stack.pop();
      frame = stack[stack.length - 1];
    }

    if (!frame || frame.indent < keyIndent) {
      if (frame) {
        const step = keyIndent - frame.indent;
        const established = isListItem ? listStep : mapStep;
        if (established === null) {
          if (isListItem) listStep = step;
          else mapStep = step;
        } else if (step !== established) {
          findings.push(
            makeFinding(
              lineNo,
              keyIndent + 1,
              'indentation-consistency',
              `indentation increases by ${step} space(s) here but by ${established} elsewhere in the file`,
              'warning'
            )
          );
        }
      }
      frame = { indent: keyIndent, keys: new Set() };
      stack.push(frame);
    }

    if (frame.indent === keyIndent) {
      if (frame.keys.has(key)) {
        findings.push(
          makeFinding(
            lineNo,
            keyIndent + 1,
            'duplicate-key',
            `duplicate key "${key}"`,
            'error'
          )
        );
      } else {
        frame.keys.add(key);
      }
    }
  });

  return findings
    .filter((f) => !isSuppressed(suppressions, f))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}
