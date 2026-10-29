// Compact .NET build: run the build, keep the full log on disk, return only
// errors and warnings grouped by diagnostic code.
//
// Toolchain is chosen from the project style, not from a path list:
//   legacy .NET Framework (ToolsVersion / xmlns 2003 / TargetFrameworkVersion)
//     -> MSBuild.exe (VS Build Tools or Visual Studio, found via config or vswhere)
//   SDK-style (Sdk="Microsoft.NET.Sdk")
//     -> dotnet build.
// This keeps the ERP solutions on their established MSBuild workflow while new
// projects get the SDK path.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SKIP_DIRS = new Set(["node_modules", ".git", ".vs", "bin", "obj", "packages", "TestResults"]);

const MSBUILD_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft Visual Studio/2019/BuildTools/MSBuild/Current/Bin/MSBuild.exe",
  "C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe",
  "C:/Program Files/Microsoft Visual Studio/2022/Professional/MSBuild/Current/Bin/MSBuild.exe",
  "C:/Program Files/Microsoft Visual Studio/2022/Enterprise/MSBuild/Current/Bin/MSBuild.exe",
  "C:/Program Files/Microsoft Visual Studio/2022/BuildTools/MSBuild/Current/Bin/MSBuild.exe",
  "C:/Program Files/Microsoft Visual Studio/18/Insiders/MSBuild/Current/Bin/MSBuild.exe",
];

function findProject(start) {
  const root = path.resolve(start || ".");
  if (/\.(sln|csproj|fsproj|vbproj)$/i.test(root) && fs.existsSync(root)) return root;

  const slns = [];
  const projs = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        const full = path.join(dir, e.name);
        if (/\.sln$/i.test(e.name)) slns.push(full);
        else if (/\.(csproj|fsproj|vbproj)$/i.test(e.name)) projs.push(full);
      }
    }
  };
  walk(root, 0);
  const pick = (list) =>
    list.sort((a, b) => {
      const da = a.split(path.sep).length;
      const db = b.split(path.sep).length;
      return da - db || a.length - b.length;
    })[0];
  return pick(slns) || pick(projs) || null;
}

// "legacy", "sdk", or "unknown" for a project or solution.
export function detectStyle(project) {
  const isSln = /\.sln$/i.test(project);
  let files;
  if (isSln) {
    files = [];
    const walk = (dir, depth) => {
      if (depth > 3 || files.length > 200) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          walk(path.join(dir, e.name), depth + 1);
        } else if (/\.(csproj|fsproj|vbproj)$/i.test(e.name)) {
          files.push(path.join(dir, e.name));
        }
      }
    };
    walk(path.dirname(project), 0);
  } else {
    files = [project];
  }

  let legacy = 0;
  let sdk = 0;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8").slice(0, 4000);
    } catch {
      continue;
    }
    if (/<Project\b[^>]*\bSdk\s*=/i.test(text)) sdk++;
    else if (/TargetFrameworkVersion|schemas\.microsoft\.com\/developer\/msbuild\/2003/i.test(text)) legacy++;
  }
  if (legacy > 0) return "legacy";
  if (sdk > 0) return "sdk";
  return "unknown";
}

function viaVswhere() {
  if (process.platform !== "win32") return "";
  const vswhere = "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe";
  if (!fs.existsSync(vswhere)) return "";
  const res = spawnSync(vswhere, ["-latest", "-requires", "Microsoft.Component.MSBuild", "-find", "MSBuild\\**\\Bin\\MSBuild.exe"], {
    encoding: "utf8",
    timeout: 15000,
  });
  const line = (res.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return line && fs.existsSync(line) ? line : "";
}

export function findMsBuild(cfg = {}) {
  const configured = cfg?.build?.msbuildPath;
  if (configured && fs.existsSync(configured)) return configured;
  for (const c of MSBUILD_CANDIDATES) if (fs.existsSync(c)) return c;
  return viaVswhere();
}

// Exposed for tests: decide what would run, without running it.
export function resolveBuildPlan(project, opts = {}, cfg = {}) {
  const style = detectStyle(project);
  const requested = opts.toolchain || cfg?.build?.toolchain || "auto";
  let toolchain = requested;
  if (requested === "auto") toolchain = style === "legacy" ? "msbuild" : "dotnet";

  const configuration = opts.configuration || cfg?.build?.configuration || "Debug";
  // The configured platform belongs to the MSBuild/legacy path ("Any CPU").
  // SDK projects use their own default unless a platform is passed explicitly.
  const platform = opts.platform ?? (toolchain === "msbuild" ? cfg?.build?.platform || "" : "");

  if (toolchain === "msbuild") {
    const exe = findMsBuild(cfg);
    const args = [project, `/p:Configuration=${configuration}`, `/nologo`, `/v:q`];
    if (platform) args.splice(2, 0, `/p:Platform=${platform}`);
    return { style, toolchain, exe, args, configuration, platform };
  }
  const args = ["build", project, "-v:q", "-nologo", "-c", configuration];
  if (platform) args.push(`-p:Platform=${platform}`);
  return { style, toolchain, exe: "dotnet", args, configuration, platform };
}

function codeOf(line) {
  const m = line.match(/\b(?:error|warning)\s+([A-Z]{1,4}\d{3,5})\b/);
  return m ? m[1] : "OTHER";
}

export function compactBuildLog(text, opts = {}) {
  const maxErrors = opts.maxErrors ?? 40;
  const maxGroups = opts.maxGroups ?? 15;
  const tail = opts.tail ?? 5;

  const rows = text.split(/\r?\n/);
  const errors = [];
  const warnGroups = new Map();
  const summary = [];

  for (const line of rows) {
    if (/: error [A-Z]{1,4}\d{3,5}:/.test(line)) {
      if (errors.length < maxErrors) errors.push(line.trim());
      continue;
    }
    if (/: warning [A-Z]{1,4}\d{3,5}:/.test(line)) {
      const code = codeOf(line);
      let g = warnGroups.get(code);
      if (!g) {
        g = { count: 0, sample: line.trim() };
        warnGroups.set(code, g);
      }
      g.count++;
      continue;
    }
    if (/(Build (FAILED|succeeded)|^\s*\d+ Error\(s\)|\d+ Warning\(s\)|Time Elapsed)/.test(line)) {
      summary.push(line.trim());
    }
  }

  const sortedGroups = [...warnGroups.entries()].sort((a, b) => b[1].count - a[1].count);
  const warningTotal = sortedGroups.reduce((n, [, g]) => n + g.count, 0);

  const out = [];
  out.push(
    `errors: ${errors.length}${errors.length >= maxErrors ? "+" : ""} | warnings: ${warningTotal} (${sortedGroups.length} distinct codes)`
  );
  if (errors.length) {
    out.push("", "ERRORS");
    out.push(...errors.map((e) => "  " + e.slice(0, 220)));
  }
  if (sortedGroups.length) {
    out.push("", "WARNINGS (grouped by code)");
    for (const [code, g] of sortedGroups.slice(0, maxGroups)) {
      out.push(`  ${code} x${g.count}  e.g. ${g.sample.slice(0, 160)}`);
    }
    if (sortedGroups.length > maxGroups) out.push(`  ... ${sortedGroups.length - maxGroups} more codes omitted`);
  }
  if (summary.length) {
    out.push("", "SUMMARY");
    out.push(...summary.slice(-6).map((s) => "  " + s));
  }
  if (errors.length === 0 && warningTotal === 0) {
    out.push("", "TAIL");
    out.push(...rows.slice(-tail).filter(Boolean).map((s) => "  " + s.trim().slice(0, 160)));
  }
  return out.join("\n");
}

export function runBuild(opts = {}, cfg = {}) {
  const project = findProject(opts.project || opts.cwd || process.cwd());
  if (!project) return { text: "build: no .sln/.csproj found under the working directory." };

  const plan = resolveBuildPlan(project, opts, cfg);
  if (!plan.exe) {
    return {
      text:
        `build: this is a legacy .NET Framework project (${path.basename(project)}), which needs MSBuild.exe, ` +
        `and none was found. Set "build.msbuildPath" in the token-diet config, or install Visual Studio Build Tools. ` +
        `Do not run dotnet build on it.`,
    };
  }

  const started = Date.now();
  const timeout = Math.min(opts.timeoutMs ?? 600000, 900000);
  const res = spawnSync(plan.exe, plan.args, {
    cwd: path.dirname(project),
    encoding: "utf8",
    timeout,
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
  });

  const text = `${res.stdout || ""}\n${res.stderr || ""}`;
  const logDir = path.join(process.cwd(), ".token-diet");
  const logFile = path.join(logDir, "build.log");
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(logFile, text);
  } catch {}

  const compact = compactBuildLog(text, opts);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const status = res.status === 0 ? "ok" : `FAILED (exit ${res.status ?? "?"})`;
  const kb = (Buffer.byteLength(text) / 1024).toFixed(0);
  const timing = res.error?.code === "ETIMEDOUT" ? ` | timed out after ${Math.round(timeout / 1000)}s` : "";
  return {
    text:
      `build ${status} in ${seconds}s${timing} | ${plan.toolchain} | project: ${path.basename(project)}\n` +
      `full log: ${path.relative(process.cwd(), logFile)} (${kb} KB)\n\n${compact}`,
    status: res.status,
    toolchain: plan.toolchain,
    style: plan.style,
  };
}
