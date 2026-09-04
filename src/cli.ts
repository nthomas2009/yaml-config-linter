#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { lint, type Finding } from './linter.js';

const CONFIG_FILE = '.yamllintrc';

type OutputFormat = 'text' | 'json';

interface FileResult {
  path: string;
  findings: Finding[];
  readError?: string;
}

interface ParsedArgs {
  paths: string[];
  format: OutputFormat;
}

function formatFinding(path: string, f: Finding): string {
  return `${path}:${f.line}:${f.column} ${f.severity} ${f.rule} - ${f.message}`;
}

// Splits argv into file paths and recognized flags. Returns an error string
// instead of throwing so main() can print a usage-style message and exit
// with the normal non-zero status rather than an uncaught stack trace.
function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const paths: string[] = [];
  let format: OutputFormat = 'text';

  const setFormat = (value: string | undefined): string | undefined => {
    if (value !== 'text' && value !== 'json') {
      return `--format expects "text" or "json", got ${value === undefined ? 'nothing' : `"${value}"`}`;
    }
    format = value;
    return undefined;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--format') {
      const err = setFormat(argv[++i]);
      if (err) return { error: err };
    } else if (arg.startsWith('--format=')) {
      const err = setFormat(arg.slice('--format='.length));
      if (err) return { error: err };
    } else if (arg.startsWith('-')) {
      return { error: `unrecognized option "${arg}"` };
    } else {
      paths.push(arg);
    }
  }

  return { paths, format };
}

// Reads `.yamllintrc` from the current directory, if present. The file is
// JSON with a `rules` object; a rule set to `false` is disabled everywhere.
// Unknown rule names are ignored rather than rejected, so a config written
// against a newer version of the linter doesn't break an older one.
function loadDisabledRules(): Set<string> {
  const disabled = new Set<string>();
  if (!existsSync(CONFIG_FILE)) return disabled;

  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf8');
  } catch (err) {
    process.stderr.write(`${CONFIG_FILE}: could not read file (${(err as Error).message})\n`);
    return disabled;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`${CONFIG_FILE}: invalid JSON (${(err as Error).message})\n`);
    return disabled;
  }

  const rules =
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).rules : undefined;
  if (!rules || typeof rules !== 'object') return disabled;

  for (const [rule, enabled] of Object.entries(rules as Record<string, unknown>)) {
    if (enabled === false) disabled.add(rule);
  }
  return disabled;
}

function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 1;
  }
  const { paths, format } = parsed;

  if (paths.length === 0) {
    process.stderr.write('usage: yamllint-ts [--format text|json] <file.yaml> [more files...]\n');
    return 1;
  }

  const disabledRules = loadDisabledRules();

  let errorCount = 0;
  let warningCount = 0;
  const results: FileResult[] = [];

  for (const path of paths) {
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (err) {
      const message = (err as Error).message;
      if (format === 'text') {
        process.stderr.write(`${path}: could not read file (${message})\n`);
      }
      errorCount++;
      results.push({ path, findings: [], readError: message });
      continue;
    }

    const findings = lint(source, { disabledRules });
    for (const finding of findings) {
      if (finding.severity === 'error') errorCount++;
      else warningCount++;
    }
    if (format === 'text') {
      for (const finding of findings) {
        process.stdout.write(formatFinding(path, finding) + '\n');
      }
    }
    results.push({ path, findings });
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify({ files: results, errorCount, warningCount }, null, 2) + '\n');
  } else {
    process.stdout.write(`\n${errorCount} error(s), ${warningCount} warning(s)\n`);
  }
  return errorCount > 0 ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
