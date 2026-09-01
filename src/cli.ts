#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { lint, type Finding } from './linter.js';

const CONFIG_FILE = '.yamllintrc';

function formatFinding(path: string, f: Finding): string {
  return `${path}:${f.line}:${f.column} ${f.severity} ${f.rule} - ${f.message}`;
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
  const paths = argv.filter((a) => !a.startsWith('-'));

  if (paths.length === 0) {
    process.stderr.write('usage: yamllint-ts <file.yaml> [more files...]\n');
    return 1;
  }

  const disabledRules = loadDisabledRules();

  let errorCount = 0;
  let warningCount = 0;

  for (const path of paths) {
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (err) {
      process.stderr.write(`${path}: could not read file (${(err as Error).message})\n`);
      errorCount++;
      continue;
    }

    const findings = lint(source, { disabledRules });
    for (const finding of findings) {
      process.stdout.write(formatFinding(path, finding) + '\n');
      if (finding.severity === 'error') errorCount++;
      else warningCount++;
    }
  }

  process.stdout.write(`\n${errorCount} error(s), ${warningCount} warning(s)\n`);
  return errorCount > 0 ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
