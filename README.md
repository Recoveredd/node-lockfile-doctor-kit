# node-lockfile-doctor-kit

[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/Recoveredd/node-lockfile-doctor-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Recoveredd/node-lockfile-doctor-kit/actions/workflows/ci.yml)

Inspect Node package-manager lockfile consistency with structured diagnostics.

`node-lockfile-doctor-kit` is a clean-room TypeScript package for checking a project snapshot before a CI install surprises you. The core accepts file contents in memory, has no runtime dependencies, and stays browser-friendly. A small optional CLI reads files from disk when used in Node.

## Demo

Try the browser preview: [packages.wasta-wocket.fr/node-lockfile-doctor-kit](https://packages.wasta-wocket.fr/node-lockfile-doctor-kit/).

## Package quality

- TypeScript types are generated from the source.
- ESM-only package with no runtime dependencies.
- Marked as side-effect free for bundlers.
- CI runs `npm ci`, `typecheck`, `build`, and `test`.
- Tested on Node.js 20 and 22 with GitHub Actions.
- Browser-friendly core with no Node-only APIs; only the optional CLI reads files from disk.

## Install

```bash
npm install node-lockfile-doctor-kit
```

## Quick Start

```ts
import { inspectNodeLockfiles } from "node-lockfile-doctor-kit";

const result = inspectNodeLockfiles({
  "package.json": JSON.stringify({
    packageManager: "pnpm@9.1.0",
    dependencies: { zod: "^3.0.0" },
    workspaces: ["packages/*"]
  }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      zod: {}\n"
});

console.log(result.ok);
console.log(result.diagnostics);
```

## CLI

```bash
npx node-lockfile-doctor .
npx node-lockfile-doctor . --json
```

The CLI reads `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` and `bun.lockb` from one directory. The reusable core does not read the filesystem.

## Why This Package

Lockfile failures are often caused by boring drift: `packageManager` says one thing, the repo contains another lockfile, workspaces are present without the expected root lockfile, a merge conflict marker slipped through, or a dependency was added to `package.json` without a matching lockfile update.

This package does not try to be a dependency graph solver. It gives a small, inspectable consistency report that can run in tests, CI comments, browser workbenches or local CLIs.

## API

### `inspectNodeLockfiles(files, options?)`

Returns:

```ts
type NodeLockfileDoctorResult = {
  ok: boolean;
  manager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  packageJson?: PackageSummary;
  lockfiles: LockfileSummary[];
  diagnostics: NodeLockfileDoctorDiagnostic[];
};
```

### `formatNodeLockfileDoctorReport(result)`

Formats a stable text report for CLIs, logs or pull request comments.

### `createNodeLockfileDoctor(defaultOptions?)`

Creates a reusable inspector with default options.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `expectedManager` | from `packageManager` or lockfiles | Force the expected package manager. |
| `packageJsonPath` | `package.json` | Read package metadata from a different key in the file map. |
| `workspaceGlobs` | from `workspaces` | Override workspace globs for generated snapshots. |

## Diagnostics

Stable diagnostic codes:

- `invalid-files`
- `invalid-options`
- `missing-package-json`
- `invalid-package-json`
- `missing-lockfile`
- `multiple-lockfiles`
- `manager-mismatch`
- `missing-package-manager`
- `unknown-package-manager`
- `missing-dependency-in-lockfile`
- `workspace-missing-lockfile`
- `merge-conflict-marker`
- `unsupported-binary-lockfile`

## Limits

- It only inspects the top-level files supplied to the core.
- It does not parse full npm, pnpm, Yarn or Bun dependency graphs.
- `bun.lockb` is detected as binary but not decoded.
- Dependency presence checks are deliberately shallow string checks, useful for drift hints but not a proof of graph correctness.

## License

MPL-2.0
