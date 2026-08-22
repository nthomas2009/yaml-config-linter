#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { lint, type Finding } from './linter.js';

function formatFinding(path: string, f: Finding): string {
  return `${path}:${f.line}:${f.column} ${f.severity} ${f.rule} - ${f.message}`;
}

function main(argv: string[]): number {
  const paths = argv.filter((a) => !a.startsWith('-'));

  if (paths.length === 0) {
    process.stderr.write('usage: yamllint-ts <file.yaml> [more files...]\n');
    return 1;
  }

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

    const findings = lint(source);
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
