#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatNodeLockfileDoctorReport, inspectNodeLockfiles, type ProjectFiles } from "./index.js";

const lockfileNames = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
] as const;

function main(argv: string[]): number {
  const json = argv.includes("--json");
  const directoryArg = argv.find((arg) => !arg.startsWith("-")) ?? ".";
  const root = resolve(directoryArg);
  const files: ProjectFiles = {};

  for (const name of ["package.json", ...lockfileNames]) {
    const path = join(root, name);
    try {
      const stats = statSync(path);
      if (!stats.isFile()) continue;
      files[name] = name === "bun.lockb" ? readFileSync(path) : readFileSync(path, "utf8");
    } catch {
      // Missing files are reported by the core inspector.
    }
  }

  const result = inspectNodeLockfiles(files);
  process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${formatNodeLockfileDoctorReport(result)}\n`);
  return result.ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
