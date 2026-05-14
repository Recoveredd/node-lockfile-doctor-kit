import { describe, expect, it } from "vitest";
import {
  createNodeLockfileDoctor,
  formatNodeLockfileDoctorReport,
  inspectNodeLockfiles
} from "../src/index.js";

const packageJson = JSON.stringify({
  name: "demo",
  packageManager: "pnpm@9.1.0",
  dependencies: { "@scope/ui": "^1.0.0", zod: "^3.0.0" },
  devDependencies: { vitest: "^4.0.0" },
  workspaces: ["packages/*"]
});

describe("inspectNodeLockfiles", () => {
  it("accepts a coherent pnpm workspace snapshot", () => {
    const result = inspectNodeLockfiles({
      "package.json": packageJson,
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      '@scope/ui': {}\n      zod: {}\n    devDependencies:\n      vitest: {}\n"
    });

    expect(result).toMatchObject({
      ok: true,
      manager: "pnpm",
      lockfiles: [{ name: "pnpm-lock.yaml", manager: "pnpm", version: "9.0" }],
      diagnostics: []
    });
  });

  it("reports multiple lockfiles and manager mismatch", () => {
    const result = inspectNodeLockfiles({
      "package.json": packageJson,
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": {} } }),
      "yarn.lock": "zod@^3.0.0:\n  version \"3.0.0\"\n"
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "multiple-lockfiles",
      "manager-mismatch",
      "manager-mismatch",
      "missing-dependency-in-lockfile",
      "missing-dependency-in-lockfile",
      "workspace-missing-lockfile"
    ]);
  });

  it("reports missing and invalid project inputs", () => {
    expect(inspectNodeLockfiles({}).diagnostics.map((item) => item.code)).toEqual([
      "missing-package-json",
      "missing-lockfile"
    ]);

    expect(inspectNodeLockfiles({ "package.json": "{", "package-lock.json": "{}" }).diagnostics[0]).toMatchObject({
      code: "invalid-package-json",
      severity: "error"
    });

    expect(inspectNodeLockfiles({ "package.json": "null", "package-lock.json": "{}" }).diagnostics[0]).toMatchObject({
      code: "invalid-package-json",
      severity: "error"
    });

    const invalidInput = inspectNodeLockfiles(null as never).diagnostics[0];
    expect(invalidInput?.code).toBe("invalid-files");
  });

  it("handles runtime-invalid options without throwing", () => {
    const result = inspectNodeLockfiles(
      {
        "package.json": JSON.stringify({ packageManager: "npm@10.0.0" }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 3 })
      },
      "bad options" as never
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-options" }));

    const invalidManager = inspectNodeLockfiles(
      {
        "package.json": JSON.stringify({ packageManager: "npm@10.0.0" }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 3 })
      },
      { expectedManager: "pnpmish" as never }
    );

    expect(invalidManager.manager).toBe("npm");
    expect(invalidManager.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-options" }));
  });

  it("detects merge conflict markers in lockfiles", () => {
    const result = inspectNodeLockfiles({
      "package.json": JSON.stringify({ packageManager: "npm@10.0.0" }),
      "package-lock.json": "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n"
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "merge-conflict-marker", file: "package-lock.json", severity: "error" })
    );
  });

  it("detects dependencies absent from provided lockfiles", () => {
    const result = inspectNodeLockfiles({
      "package.json": JSON.stringify({ packageManager: "npm@10.0.0", dependencies: { leftpad: "1.0.0" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} })
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-dependency-in-lockfile",
        expected: "leftpad"
      })
    );
  });

  it("handles packageManager absence and unknown managers", () => {
    expect(
      inspectNodeLockfiles({
        "package.json": JSON.stringify({ dependencies: { zod: "^3.0.0" } }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": {} } })
      })
    ).toMatchObject({ manager: "npm" });

    expect(
      inspectNodeLockfiles({
        "package.json": JSON.stringify({ dependencies: { zod: "^3.0.0" } }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": {} } })
      }).diagnostics
    ).toContainEqual(expect.objectContaining({ code: "missing-package-manager" }));

    expect(
      inspectNodeLockfiles({
        "package.json": JSON.stringify({ packageManager: "volta@1.0.0" }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 3 })
      }).diagnostics
    ).toContainEqual(expect.objectContaining({ code: "unknown-package-manager" }));
  });

  it("summarizes binary Bun lockfiles without parsing them", () => {
    const result = inspectNodeLockfiles({
      "package.json": JSON.stringify({ packageManager: "bun@1.1.0" }),
      "bun.lockb": new Uint8Array([0, 1, 2])
    });

    expect(result.lockfiles[0]).toMatchObject({ name: "bun.lockb", manager: "bun", binary: true });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported-binary-lockfile" }));
  });

  it("formats a stable text report and creates a reusable doctor", () => {
    const doctor = createNodeLockfileDoctor({ expectedManager: "npm" });
    const result = doctor.inspect({
      "package.json": JSON.stringify({ dependencies: { "accentué": "^1.0.0" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/accentué": {} } })
    });

    expect(doctor.format(result)).toBe(formatNodeLockfileDoctorReport(result));
    expect(doctor.format(result)).toContain("Manager: npm");
    expect(createNodeLockfileDoctor("bad defaults" as never).inspect({}).diagnostics[0]?.code).toBe(
      "missing-package-json"
    );
  });
});
