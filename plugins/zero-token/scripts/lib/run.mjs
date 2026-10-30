// Generic build/test/lint runner for non-.NET projects.
//
// Detection is by manifest file, not by path. Commands are fixed per ecosystem;
// the model cannot inject arbitrary shell through this tool. Output is
// compacted with per-ecosystem error markers, because every toolchain prints
// its diagnostics differently.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function exists(dir, name) {
  return fs.existsSync(path.join(dir, name));
}

export function detectEcosystem(dir) {
  const entries = readDir(dir);
  const has = (name) => entries.includes(name);
  if (entries.some((e) => /\.(sln|csproj|fsproj|vbproj)$/i.test(e))) return "dotnet";
  if (has("package.json")) return "node";
  if (has("Cargo.toml")) return "cargo";
  if (has("go.mod")) return "go";
  if (has("pom.xml")) return "maven";
  if (has("build.gradle") || has("build.gradle.kts")) return "gradle";
  if (has("Makefile") || has("makefile") || has("GNUmakefile")) return "make";
  if (has("pyproject.toml") || has("setup.py") || has("pytest.ini") || has("tox.ini")) return "python";
  return null;
}

function detectNodeManager(dir) {
  if (exists(dir, "pnpm-lock.yaml")) return "pnpm";
  if (exists(dir, "yarn.lock")) return "yarn";
  return "npm";
}

// Windows needs cmd.exe for .cmd shims; args stay fixed, so no shell injection.
function winSafe(exe, args) {
  if (process.platform !== "win32") return { exe, args };
  if (/^(npm|npx|pnpm|yarn|mvn|gradle)$/i.test(exe)) return { exe: "cmd.exe", args: ["/c", `${exe}.cmd`, ...args] };
  return { exe, args };
}

function makeTargets(dir) {
  for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      return new Set([...text.matchAll(/^([A-Za-z0-9_.-]+)\s*:/gm)].map((m) => m[1]));
    } catch {}
  }
  return new Set();
}

export function planAction(opts = {}) {
  const project = path.resolve(opts.project || ".");
  let st;
  try {
    st = fs.statSync(project);
  } catch {
    return { error: `Path not found: ${opts.project}` };
  }
  const dir = st.isDirectory() ? project : path.dirname(project);
  const action = opts.action || "build";
  if (!["build", "test", "lint"].includes(action)) {
    return { error: `run: action must be build, test or lint (got ${action})` };
  }
  const eco = detectEcosystem(dir);
  if (!eco) {
    return {
      error:
        `run: no supported project manifest in ${dir}. Supported: package.json, Cargo.toml, go.mod, ` +
        `pom.xml, build.gradle, Makefile, pyproject.toml/pytest.ini.`,
    };
  }
  if (eco === "dotnet") {
    return { ecosystem: eco, cwd: dir, unsupported: true, message: "run: this is a .NET solution; use the build tool so MSBuild/dotnet is selected correctly." };
  }

  let exe;
  let args;
  let label;
  if (eco === "node") {
    const pm = detectNodeManager(dir);
    args = pm === "yarn" ? ["run", action] : ["run", action, "--if-present"];
    ({ exe, args } = winSafe(pm, args));
    label = `${pm} run ${action}`;
  } else if (eco === "cargo") {
    exe = "cargo";
    args = action === "build" ? ["build"] : action === "test" ? ["test", "--quiet"] : ["clippy"];
    label = `cargo ${action}`;
  } else if (eco === "go") {
    exe = "go";
    args = action === "build" ? ["build", "./..."] : action === "test" ? ["test", "./..."] : ["vet", "./..."];
    label = `go ${action}`;
  } else if (eco === "maven") {
    exe = "mvn";
    args = action === "test" ? ["-q", "test"] : ["-q", "-DskipTests", "package"];
    ({ exe, args } = winSafe(exe, args));
    label = `maven ${action}`;
  } else if (eco === "gradle") {
    const wrapper = exists(dir, "gradlew") || exists(dir, "gradlew.bat");
    const target = action === "build" ? "build" : action === "test" ? "test" : "check";
    if (wrapper) {
      if (process.platform === "win32") {
        exe = "cmd.exe";
        args = ["/c", "gradlew.bat", target, "-q"];
      } else {
        exe = "./gradlew";
        args = [target, "-q"];
      }
    } else {
      ({ exe, args } = winSafe("gradle", [target, "-q"]));
    }
    label = `gradle ${target}`;
  } else if (eco === "make") {
    exe = "make";
    const targets = makeTargets(dir);
    args = targets.has(action) ? [action] : action === "build" ? [] : null;
    if (args === null) return { ecosystem: eco, cwd: dir, unsupported: true, message: `run: the Makefile has no "${action}" target.` };
    label = `make ${args[0] || "(default)"}`;
  } else {
    // python
    if (action === "build") {
      exe = process.platform === "win32" ? "python" : "python3";
      args = ["-m", "build"];
      label = "python -m build";
    } else if (action === "test") {
      exe = process.platform === "win32" ? "python" : "python3";
      args = ["-m", "pytest", "-q"];
      label = "pytest";
    } else {
      return { ecosystem: eco, cwd: dir, unsupported: true, message: "run: no standard Python linter is assumed; run ruff or flake8 through Bash." };
    }
  }

  return { ecosystem: eco, cwd: dir, exe, args, label };
}

// ---------------------------------------------------------------- compaction

const ERROR_RE = new RegExp(
  [
    "\\berror\\b",
    "\\bfatal\\b",
    "\\[ERROR\\]",
    "npm ERR!",
    "^FAIL(?:ED)?\\b",
    "error\\[[A-Z]+\\d+\\]",
    "\\b[A-Z]\\w*Error\\b", // Python/Java exception names
    "^E\\s{2,}", // pytest assertion detail
    "> Task .* FAILED", // gradle
    "\\.[A-Za-z0-9]+:\\d+(?::\\d+)?:\\s", // gcc/tsc/go/rustc style diagnostics
  ].join("|"),
  "i"
);
const WARN_RE = /\bwarning\b|\[WARNING\]/i;
const SUMMARY_RE = /^(?:Found \d+ (?:errors?|warnings?)|\d+ (?:errors?|warnings?)|Tests?:|Test Suites?:|Test Files?:|\d+ (?:passed|failed|error)|=+.*=+$|\[INFO\] BUILD|BUILD (SUCCESS|FAILED)|FAIL(?:ED)?\b|--- FAIL:)/i;

function isZero(line) {
  return /\b0 (?:errors?|warnings?)\b/i.test(line);
}

export function compactCommandLog(text, opts = {}) {
  const maxErrors = opts.maxErrors ?? 40;
  const maxWarnSamples = opts.maxWarnSamples ?? 10;
  const tail = opts.tail ?? 8;

  const rows = text.split(/\r?\n/);
  const errors = new Map();
  const warnings = new Map();
  const summary = [];

  for (const raw of rows) {
    const line = raw.trim();
    if (!line) continue;
    if (SUMMARY_RE.test(line) && !ERROR_RE.test(line)) {
      summary.push(line);
      continue;
    }
    if (!isZero(line) && ERROR_RE.test(line)) {
      errors.set(line, (errors.get(line) || 0) + 1);
      continue;
    }
    if (!isZero(line) && WARN_RE.test(line)) {
      warnings.set(line, (warnings.get(line) || 0) + 1);
    }
  }

  const errorTotal = [...errors.values()].reduce((n, c) => n + c, 0);
  const warningTotal = [...warnings.values()].reduce((n, c) => n + c, 0);

  const out = [`errors: ${errorTotal} | warnings: ${warningTotal}`];
  if (errors.size) {
    out.push("", "ERRORS");
    for (const [line, count] of [...errors.entries()].slice(0, maxErrors)) {
      out.push(`  ${count > 1 ? `x${count} ` : ""}${line.slice(0, 240)}`);
    }
    if (errors.size > maxErrors) out.push(`  ... ${errors.size - maxErrors} more distinct errors omitted`);
  }
  if (warnings.size) {
    out.push("", "WARNINGS");
    for (const [line, count] of [...warnings.entries()].slice(0, maxWarnSamples)) {
      out.push(`  ${count > 1 ? `x${count} ` : ""}${line.slice(0, 200)}`);
    }
    if (warnings.size > maxWarnSamples) out.push(`  ... ${warnings.size - maxWarnSamples} more distinct warnings omitted`);
  }
  if (summary.length) {
    out.push("", "SUMMARY");
    out.push(...summary.slice(-8).map((s) => "  " + s.slice(0, 200)));
  }
  if (!errors.size) {
    out.push("", "TAIL");
    out.push(...rows.slice(-tail).filter(Boolean).map((s) => "  " + s.trim().slice(0, 180)));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- execution

export function runAction(opts = {}, cfg = {}) {
  const plan = planAction(opts);
  if (plan.error) return { text: plan.error };
  if (plan.unsupported) return { text: plan.message };
  if (opts.dryRun) {
    return { text: `would run: ${plan.exe} ${plan.args.join(" ")}\nin ${plan.cwd}` };
  }

  const timeout = Math.min(opts.timeoutMs ?? cfg?.run?.timeoutMs ?? 600000, 900000);
  const started = Date.now();
  const res = spawnSync(plan.exe, plan.args, {
    cwd: plan.cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
  });

  const text = `${res.stdout || ""}\n${res.stderr || ""}${res.error ? `\n${res.error.message}` : ""}`;
  const logDir = path.join(process.cwd(), ".token-diet");
  const logFile = path.join(logDir, "run.log");
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(logFile, text);
  } catch {}

  const compact = compactCommandLog(text, opts);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const status = res.error ? `FAILED (${res.error.code || res.error.message})` : res.status === 0 ? "ok" : `FAILED (exit ${res.status ?? "?"})`;
  const kb = (Buffer.byteLength(text) / 1024).toFixed(0);
  return {
    text:
      `run ${status} in ${seconds}s | ${plan.ecosystem} | ${plan.label}\n` +
      `full log: ${path.relative(process.cwd(), logFile)} (${kb} KB)\n\n${compact}`,
    status: res.status,
    ecosystem: plan.ecosystem,
  };
}
