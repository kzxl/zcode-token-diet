#!/usr/bin/env node
// Build-log compaction tests: code-less errors, deduplication, and the
// failed-with-no-error fallback.

import { compactBuildLog } from "../plugins/token-diet/scripts/lib/build.mjs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("compactBuildLog");

const coded = [
  "C:\\src\\A.cs(10,5): error CS0103: The name 'x' does not exist",
  "C:\\src\\A.cs(10,5): error CS0103: The name 'x' does not exist",
  "C:\\src\\B.cs(20,5): error CS1061: 'Y' does not contain 'Z'",
  "C:\\src\\C.cs(30,5): warning CS8618: Non-nullable property",
  "C:\\src\\D.cs(40,5): warning CS8618: Non-nullable property",
  "    7 Error(s)",
  "    2 Warning(s)",
  "Build FAILED.",
].join("\n");
const c1 = compactBuildLog(coded);
check("coded errors are counted", /errors: 3/.test(c1), c1.split("\n")[0]);
check("identical errors are deduplicated with a count", /x2 .*CS0103/.test(c1), c1);
check("warnings are grouped by code", /CS8618 x2/.test(c1), c1);
check("summary lines are kept", /Build FAILED/.test(c1));

const codeless = [
  "C:\\src\\App.csproj : error : The OutputPath property is not set for project",
  "error : The OutputPath property is not set for project",
  "Build FAILED.",
].join("\n");
const c2 = compactBuildLog(codeless, { failed: true });
check("code-less errors are not dropped", /errors: [12]/.test(c2) && /OutputPath/.test(c2), c2);
check("code-less errors appear in the ERRORS block", /ERRORS/.test(c2), c2);

const localized = ["  错误 : 找不到项目文件", "Build FAILED."].join("\n");
const c3 = compactBuildLog(localized, { failed: true });
check("failed build with no parsed error still shows the tail", /TAIL/.test(c3) && /Build FAILED/.test(c3), c3);

const clean = ["  App -> bin\\Debug\\App.dll", "Build succeeded.", "    0 Warning(s)", "    0 Error(s)"].join("\n");
const c4 = compactBuildLog(clean, { failed: false });
check("clean build has no ERRORS block", !/ERRORS/.test(c4));
check("clean build shows the tail", /TAIL/.test(c4), c4);

console.log(failures === 0 ? "\nall build tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
