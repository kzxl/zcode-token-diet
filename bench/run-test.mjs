#!/usr/bin/env node
// Generic runner tests: ecosystem detection, command planning, and log
// compaction for the formats that matter (tsc, rustc, go, pytest, npm, maven).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectEcosystem, planAction, compactCommandLog, runAction } from "../plugins/token-diet/scripts/lib/run.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "token-diet-run-"));
function mk(name, files) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

const dirs = {
  node: mk("node", { "package.json": "{}", "package-lock.json": "{}" }),
  yarn: mk("yarn", { "package.json": "{}", "yarn.lock": "" }),
  pnpm: mk("pnpm", { "package.json": "{}", "pnpm-lock.yaml": "" }),
  cargo: mk("cargo", { "Cargo.toml": "[package]" }),
  go: mk("go", { "go.mod": "module x" }),
  maven: mk("maven", { "pom.xml": "<project/>" }),
  gradle: mk("gradle", { "build.gradle": "", "gradlew.bat": "", "gradlew": "" }),
  make: mk("make", { Makefile: "build:\n\t@echo build\ntest:\n\t@echo test\n" }),
  python: mk("python", { "pyproject.toml": "" }),
  dotnet: mk("dotnet", { "App.sln": "" }),
  empty: mk("empty", {}),
};

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("detection");
const expected = { node: "node", yarn: "node", pnpm: "node", cargo: "cargo", go: "go", maven: "maven", gradle: "gradle", make: "make", python: "python", dotnet: "dotnet" };
for (const [name, eco] of Object.entries(expected)) {
  check(`${name} manifest`, detectEcosystem(dirs[name]) === eco, String(detectEcosystem(dirs[name])));
}
check("empty directory returns null", detectEcosystem(dirs.empty) === null);

console.log("planning");
const label = (dir, action = "build") => planAction({ project: dir, action }).label || "";
check("npm is chosen without other lockfiles", /^npm run build/.test(label(dirs.node)), label(dirs.node));
check("yarn lock selects yarn", /^yarn run build/.test(label(dirs.yarn)), label(dirs.yarn));
check("pnpm lock selects pnpm", /^pnpm run build/.test(label(dirs.pnpm)), label(dirs.pnpm));
check("cargo build", /^cargo build/.test(label(dirs.cargo)), label(dirs.cargo));
check("go build", /^go build/.test(label(dirs.go)), label(dirs.go));
check("maven skips tests for build", /^maven build/.test(label(dirs.maven)), label(dirs.maven));
check("gradle wrapper is used", /^gradle build/.test(label(dirs.gradle)), label(dirs.gradle));
check("make uses an existing target", planAction({ project: dirs.make, action: "test" }).args?.[0] === "test");
check("make missing target is reported", planAction({ project: dirs.make, action: "lint" }).unsupported === true);
check("pytest for python test", /^pytest/.test(label(dirs.python, "test")), label(dirs.python, "test"));
check("dotnet defers to the build tool", /use the build tool/.test(planAction({ project: dirs.dotnet }).message || ""));
check("unknown project is reported", /no supported project/.test(planAction({ project: dirs.empty }).error || ""));
check("invalid action is reported", /action must be/.test(planAction({ project: dirs.node, action: "deploy" }).error || ""));

const dry = runAction({ project: dirs.node, action: "test", dryRun: true }).text;
check("dryRun never executes", /would run:/.test(dry) && /npm|yarn|pnpm/.test(dry), dry);
check("dryRun includes the action", /test/.test(dry), dry);

console.log("compaction");
const tsc = compactCommandLog([
  "src/a.ts(1,2): error TS1234: Bad",
  "src/a.ts(1,2): error TS1234: Bad",
  "src/b.ts(3,4): error TS5678: Worse",
  "src/c.ts(5,6): warning TS9999: Hmm",
  "Found 2 errors.",
].join("\n"));
check("tsc errors counted with dedupe", /^errors: 3/.test(tsc) && /x2 .*TS1234/.test(tsc), tsc.split("\n")[0]);
check("tsc summary kept", /Found 2 errors/.test(tsc));

const rust = compactCommandLog(["error[E0308]: mismatched types", "warning: unused variable: `x`", "error: aborting due to 1 previous error"].join("\n"));
check("rustc error codes detected", /errors: 2/.test(rust), rust.split("\n")[0]);
check("rustc warning detected", /warning: unused variable/.test(rust));

const go = compactCommandLog(["./main.go:10:5: undefined: x", "FAIL\tpkg [build failed]"].join("\n"));
check("go diagnostics detected", /errors: 2/.test(go), go.split("\n")[0]);

const py = compactCommandLog([
  "FAILED tests/test_a.py::test_x - assert 1 == 2",
  "E   assert 1 == 2",
  "ModuleNotFoundError: No module named 'foo'",
  "1 failed, 2 passed in 0.10s",
].join("\n"));
check("pytest failures detected", /errors: 3/.test(py), py.split("\n")[0]);
check("pytest summary kept", /1 failed, 2 passed/.test(py));

const npm = compactCommandLog(["npm ERR! code ELIFECYCLE", "npm ERR! errno 1"].join("\n"));
check("npm errors detected", /errors: 2/.test(npm), npm.split("\n")[0]);

const mvn = compactCommandLog(["[ERROR] /src/A.java:[10,5] cannot find symbol", "[WARNING] deprecated api"].join("\n"));
check("maven errors and warnings split", /errors: 1 \| warnings: 1/.test(mvn), mvn.split("\n")[0]);

const gradle = compactCommandLog(["> Task :compileJava FAILED", "* What went wrong:"].join("\n"));
check("gradle failed task detected", /errors: 1/.test(gradle), gradle.split("\n")[0]);

const clean = compactCommandLog(["All tests passed", "0 errors, 0 warnings"].join("\n"));
check("clean output has no ERRORS block", !/ERRORS/.test(clean), clean);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall runner tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
