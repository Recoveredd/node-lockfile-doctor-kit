export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export type LockfileName =
  | "package-lock.json"
  | "npm-shrinkwrap.json"
  | "pnpm-lock.yaml"
  | "yarn.lock"
  | "bun.lock"
  | "bun.lockb";

export type NodeLockfileDoctorDiagnosticCode =
  | "invalid-options"
  | "invalid-files"
  | "missing-package-json"
  | "invalid-package-json"
  | "missing-lockfile"
  | "multiple-lockfiles"
  | "manager-mismatch"
  | "missing-package-manager"
  | "unknown-package-manager"
  | "missing-dependency-in-lockfile"
  | "workspace-missing-lockfile"
  | "merge-conflict-marker"
  | "unsupported-binary-lockfile";

export type Severity = "info" | "warning" | "error";

export type NodeLockfileDoctorDiagnostic = {
  code: NodeLockfileDoctorDiagnosticCode;
  severity: Severity;
  message: string;
  file?: string;
  expected?: string;
  actual?: string;
};

export type ProjectFiles = Record<string, string | Uint8Array | undefined>;

export type NodeLockfileDoctorOptions = {
  expectedManager?: PackageManager;
  packageJsonPath?: string;
  workspaceGlobs?: string[];
};

export type LockfileSummary = {
  name: LockfileName;
  manager: PackageManager;
  version?: string;
  binary: boolean;
};

export type PackageSummary = {
  name?: string;
  packageManager?: string;
  declaredManager: PackageManager;
  dependencyNames: string[];
  workspaceGlobs: string[];
};

export type NodeLockfileDoctorResult = {
  ok: boolean;
  manager: PackageManager;
  packageJson?: PackageSummary;
  lockfiles: LockfileSummary[];
  diagnostics: NodeLockfileDoctorDiagnostic[];
};

type PackageJsonLike = {
  name?: unknown;
  packageManager?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
  workspaces?: unknown;
};

const lockfileManagers: Record<LockfileName, PackageManager> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun"
};

const managerLockfiles: Record<PackageManager, LockfileName[]> = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"],
  unknown: []
};

export function inspectNodeLockfiles(
  files: ProjectFiles,
  options: NodeLockfileDoctorOptions = {}
): NodeLockfileDoctorResult {
  const diagnostics: NodeLockfileDoctorDiagnostic[] = [];
  const safeOptions = normalizeOptions(options, diagnostics);

  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return {
      ok: false,
      manager: "unknown",
      lockfiles: [],
      diagnostics: [
        diagnostic("invalid-files", "error", "Expected a file map keyed by relative project paths.")
      ]
    };
  }

  const packageJsonPath =
    typeof safeOptions.packageJsonPath === "string" && safeOptions.packageJsonPath.trim() !== ""
      ? safeOptions.packageJsonPath
      : "package.json";
  const packageJsonSource = readText(files[packageJsonPath]);
  let packageJson: PackageSummary | undefined;

  if (packageJsonSource === undefined) {
    diagnostics.push(diagnostic("missing-package-json", "error", "package.json was not provided.", packageJsonPath));
  } else {
    try {
      const parsed = JSON.parse(packageJsonSource) as unknown;
      if (!isPlainObject(parsed)) {
        diagnostics.push(diagnostic("invalid-package-json", "error", "package.json must be a JSON object.", packageJsonPath));
      } else {
        packageJson = summarizePackageJson(parsed, safeOptions);
      }
    } catch {
      diagnostics.push(diagnostic("invalid-package-json", "error", "package.json is not valid JSON.", packageJsonPath));
    }
  }

  const lockfiles = findLockfiles(files);
  if (lockfiles.length === 0) {
    diagnostics.push(diagnostic("missing-lockfile", "error", "No supported Node lockfile was provided."));
  }

  for (const lockfile of lockfiles) {
    const source = readText(files[lockfile.name]);
    if (lockfile.binary) {
      diagnostics.push(
        diagnostic(
          "unsupported-binary-lockfile",
          "warning",
          "Binary Bun lockfiles can be detected but not inspected in the browser-friendly core.",
          lockfile.name
        )
      );
    }
    if (source && hasMergeConflictMarker(source)) {
      diagnostics.push(
        diagnostic("merge-conflict-marker", "error", "Lockfile contains merge conflict markers.", lockfile.name)
      );
    }
  }

  const declaredManager = packageJson?.declaredManager;
  const expectedManager =
    safeOptions.expectedManager ?? (declaredManager && declaredManager !== "unknown" ? declaredManager : inferManager(lockfiles));
  if (packageJson && packageJson.packageManager === undefined) {
    diagnostics.push(
      diagnostic("missing-package-manager", "warning", "package.json has no packageManager field.", packageJsonPath)
    );
  } else if (packageJson?.declaredManager === "unknown") {
    diagnostics.push(
      diagnostic(
        "unknown-package-manager",
        "warning",
        "package.json declares an unknown package manager.",
        packageJsonPath,
        undefined,
        packageJson.packageManager
      )
    );
  }

  const lockfileManagersFound = new Set(lockfiles.map((lockfile) => lockfile.manager));
  if (lockfileManagersFound.size > 1) {
    diagnostics.push(
      diagnostic(
        "multiple-lockfiles",
        "warning",
        "Multiple package-manager lockfiles were found.",
        undefined,
        expectedManager,
        [...lockfileManagersFound].join(", ")
      )
    );
  }

  if (expectedManager !== "unknown") {
    for (const lockfile of lockfiles) {
      if (!managerLockfiles[expectedManager].includes(lockfile.name)) {
        diagnostics.push(
          diagnostic(
            "manager-mismatch",
            "warning",
            `Expected ${expectedManager} but found ${lockfile.name}.`,
            lockfile.name,
            expectedManager,
            lockfile.manager
          )
        );
      }
    }
  }

  if (packageJson && lockfiles.length > 0) {
    const combinedLockText = lockfiles.map((lockfile) => readText(files[lockfile.name]) ?? "").join("\n");
    for (const dependencyName of packageJson.dependencyNames) {
      if (!combinedLockText.includes(dependencyName)) {
        diagnostics.push(
          diagnostic(
            "missing-dependency-in-lockfile",
            "warning",
            `Declared dependency ${dependencyName} was not found in provided lockfiles.`,
            packageJsonPath,
            dependencyName
          )
        );
      }
    }
  }

  if (packageJson && packageJson.workspaceGlobs.length > 0 && expectedManager !== "unknown") {
    const expected = managerLockfiles[expectedManager];
    const hasExpectedLockfile = lockfiles.some((lockfile) => expected.includes(lockfile.name));
    if (!hasExpectedLockfile) {
      diagnostics.push(
        diagnostic(
          "workspace-missing-lockfile",
          "warning",
          "Workspace project does not include the lockfile expected for its package manager.",
          packageJsonPath,
          expected.join(" or ")
        )
      );
    }
  }

  const result: NodeLockfileDoctorResult = {
    ok: !diagnostics.some((item) => item.severity === "error"),
    manager: expectedManager,
    lockfiles,
    diagnostics
  };
  if (packageJson) result.packageJson = packageJson;
  return result;
}

export function formatNodeLockfileDoctorReport(result: NodeLockfileDoctorResult): string {
  const lines = [
    `Status: ${result.ok ? "ok" : "needs attention"}`,
    `Manager: ${result.manager}`,
    `Lockfiles: ${result.lockfiles.map((lockfile) => lockfile.name).join(", ") || "none"}`
  ];

  if (result.diagnostics.length === 0) {
    lines.push("Diagnostics: none");
  } else {
    lines.push("Diagnostics:");
    for (const item of result.diagnostics) {
      const location = item.file ? ` (${item.file})` : "";
      lines.push(`- ${item.severity.toUpperCase()} ${item.code}${location}: ${item.message}`);
    }
  }

  return lines.join("\n");
}

export function createNodeLockfileDoctor(defaultOptions: NodeLockfileDoctorOptions = {}) {
  const safeDefaultOptions = normalizeOptions(defaultOptions, []);

  return {
    inspect(files: ProjectFiles, options: NodeLockfileDoctorOptions = {}) {
      const mergedOptions = isPlainObject(options) ? { ...safeDefaultOptions, ...options } : options;
      return inspectNodeLockfiles(files, mergedOptions as NodeLockfileDoctorOptions);
    },
    format(result: NodeLockfileDoctorResult) {
      return formatNodeLockfileDoctorReport(result);
    }
  };
}

function findLockfiles(files: ProjectFiles): LockfileSummary[] {
  return (Object.keys(lockfileManagers) as LockfileName[])
    .filter((name) => files[name] !== undefined)
    .map((name) => {
      const summary: LockfileSummary = {
        name,
        manager: lockfileManagers[name],
        binary: files[name] instanceof Uint8Array || name === "bun.lockb"
      };
      const version = readLockfileVersion(name, readText(files[name]));
      if (version) summary.version = version;
      return summary;
    });
}

function summarizePackageJson(pkg: PackageJsonLike, options: NodeLockfileDoctorOptions): PackageSummary {
  const packageManager = typeof pkg.packageManager === "string" ? pkg.packageManager : undefined;
  const declaredManager = normalizeExpectedManager(options.expectedManager) ?? parsePackageManager(packageManager);
  const workspaceGlobs = Array.isArray(options.workspaceGlobs) ? options.workspaceGlobs : readWorkspaceGlobs(pkg.workspaces);

  const summary: PackageSummary = {
    declaredManager,
    dependencyNames: unique([
      ...objectKeys(pkg.dependencies),
      ...objectKeys(pkg.devDependencies),
      ...objectKeys(pkg.peerDependencies),
      ...objectKeys(pkg.optionalDependencies)
    ]),
    workspaceGlobs
  };
  if (typeof pkg.name === "string") summary.name = pkg.name;
  if (packageManager) summary.packageManager = packageManager;
  return summary;
}

function parsePackageManager(value: string | undefined): PackageManager {
  if (!value) return "unknown";
  const name = value.split("@")[0];
  if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name;
  return "unknown";
}

function inferManager(lockfiles: LockfileSummary[]): PackageManager {
  const [lockfile] = lockfiles;
  return lockfiles.length === 1 && lockfile ? lockfile.manager : "unknown";
}

function readLockfileVersion(name: LockfileName, source: string | undefined): string | undefined {
  if (!source) return undefined;
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") {
    try {
      const parsed = JSON.parse(source) as { lockfileVersion?: unknown };
      return typeof parsed.lockfileVersion === "number" ? String(parsed.lockfileVersion) : undefined;
    } catch {
      return undefined;
    }
  }
  const pnpmVersion = source.match(/^lockfileVersion:\s*['"]?([^'"\n]+)['"]?/m);
  if (pnpmVersion?.[1]) return pnpmVersion[1].trim();
  if (name === "yarn.lock") return source.includes("__metadata:") ? "berry" : "classic";
  if (name === "bun.lock") return "text";
  return undefined;
}

function readWorkspaceGlobs(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object" && Array.isArray((value as { packages?: unknown }).packages)) {
    return (value as { packages: unknown[] }).packages.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function objectKeys(value: unknown): string[] {
  return isPlainObject(value) ? Object.keys(value) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function readText(value: string | Uint8Array | undefined): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptions(
  options: unknown,
  diagnostics: NodeLockfileDoctorDiagnostic[]
): NodeLockfileDoctorOptions {
  if (options === undefined) return {};

  if (!isPlainObject(options)) {
    diagnostics.push(diagnostic("invalid-options", "warning", "Options must be an object; defaults were used."));
    return {};
  }

  const normalized: NodeLockfileDoctorOptions = {};
  const expectedManager = normalizeExpectedManager(options.expectedManager);
  if (expectedManager) normalized.expectedManager = expectedManager;
  if (typeof options.packageJsonPath === "string") normalized.packageJsonPath = options.packageJsonPath;
  if (Array.isArray(options.workspaceGlobs)) {
    normalized.workspaceGlobs = options.workspaceGlobs.filter((item): item is string => typeof item === "string");
  }

  if (options.expectedManager !== undefined && !expectedManager) {
    diagnostics.push(
      diagnostic(
        "invalid-options",
        "warning",
        "expectedManager must be npm, pnpm, yarn, bun, or unknown."
      )
    );
  }

  return normalized;
}

function normalizeExpectedManager(value: unknown): PackageManager | undefined {
  if (value === "npm" || value === "pnpm" || value === "yarn" || value === "bun" || value === "unknown") {
    return value;
  }
  return undefined;
}

function hasMergeConflictMarker(source: string): boolean {
  return /^(<<<<<<<|=======|>>>>>>>) /m.test(source);
}

function diagnostic(
  code: NodeLockfileDoctorDiagnosticCode,
  severity: Severity,
  message: string,
  file?: string,
  expected?: string,
  actual?: string
): NodeLockfileDoctorDiagnostic {
  const result: NodeLockfileDoctorDiagnostic = { code, severity, message };
  if (file) result.file = file;
  if (expected) result.expected = expected;
  if (actual) result.actual = actual;
  return result;
}
