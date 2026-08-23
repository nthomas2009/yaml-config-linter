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

// Strips a trailing # comment, but only outside of quoted strings, and only
// when it starts a token (preceded by whitespace or start of line). This is
// not a full YAML scalar parser -- it's just enough to keep comments from
// polluting the indentation and key checks below.
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

export function lint(source: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split(/\r\n|\n/);
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

  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
