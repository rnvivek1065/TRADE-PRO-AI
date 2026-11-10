#!/usr/bin/env node
/**
 * Parses every JavaScript file in the repository with `node --check`.
 *
 * This is a syntax gate only: it proves the files parse, not that they run.
 * Functional behaviour is covered by `npm test`.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", ".wrangler", ".wrangler-d1"]);
const EXTENSIONS = [".js", ".mjs"];

function collect(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;

    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(fullPath, files);
      continue;
    }

    if (EXTENSIONS.some(extension => entry.name.endsWith(extension))) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = collect(ROOT).sort();
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push({
      file: relative(ROOT, file),
      message: (error.stderr || error.message || "").toString().trim()
    });
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed for ${failures.length} file(s):`);

  for (const failure of failures) {
    console.error(`\n${failure.file}\n${failure.message}`);
  }

  process.exit(1);
}

console.log(`Syntax OK: ${files.length} JavaScript files parsed.`);
