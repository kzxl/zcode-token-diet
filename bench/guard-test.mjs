#!/usr/bin/env node
// Guard/loop-breaker regression test. No framework, no dependencies.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const guard = path.join(root, "plugins", "token-diet", "scripts", "guard.mjs");
const loopBreaker = path.join(root, "plugins", "token-diet", "scripts", "loop-breaker.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "token-diet-test-"));
const dataDir = path.join(tmp, "data");
process.env.TOKEN_DIET_DATA = dataDir;
const big = path.join(tmp, "Big.cs");
const big2 = path.join(tmp, "Big2.cs");
const small = path.join(tmp, "Small.cs");
const minified = path.join(tmp, "bundle.min.js");
fs.writeFileSync(big, "// pad\n".repeat(20000)); // ~120 KB
fs.writeFileSync(big2, "// pad\n".repeat(20000)); // ~120 KB
fs.writeFileSync(small, "class A { void B() {} }\n");
fs.writeFileSync(minified, "var a=1;".repeat(7000)); // ~49 KB, one line

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function run(script, payload, env = {}) {
  const res = spawnSync(process.execPath, [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, TOKEN_DIET_DATA: dataDir, ...env },
  });
  return { out: (res.stdout || "").trim(), err: (res.stderr || "").trim(), status: res.status };
}

const read = (file, extra = {}) => ({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: file, ...extra }, cwd: root, session_id: "test" });
const bash = (command) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, session_id: "test" });

console.log("guard: Read");
check("large file, no limit -> deny", run(guard, read(big)).out.includes("deny"));
check("large file, limit=99999 -> deny", run(guard, read(big, { limit: 99999 })).out.includes("deny"));
check("large file, limit=200 -> allow", run(guard, read(big, { limit: 200 })).out === "");
check("small file, limit=99999 -> allow", run(guard, read(small, { limit: 99999 })).out === "");

console.log("guard: Bash");
check("grep -rn -> deny", run(guard, bash("grep -rn OrderStatus .")).out.includes("deny"));
check("grep -rn -m 5 -> allow", run(guard, bash("grep -rn -m 5 OrderStatus .")).out === "");
check("grep -rn -l -> allow", run(guard, bash("grep -rn -l OrderStatus .")).out === "");
check("rg -> deny", run(guard, bash('rg "OrderStatus" .')).out.includes("deny"));
check("rg -m 5 -> allow", run(guard, bash('rg -m 5 "OrderStatus" .')).out === "");
check("git log -p -> deny", run(guard, bash("git log -p")).out.includes("deny"));
check("git log -p -n 20 -> allow", run(guard, bash("git log -p -n 20")).out === "");
check("cat large file -> deny", run(guard, bash(`cat "${big}"`)).out.includes("deny"));
check("cat small+large (first small) -> deny", run(guard, bash(`cat "${small}" "${big2}"`)).out.includes("deny"));
check("cat small only -> allow", run(guard, bash(`cat "${small}"`)).out === "");
check("minified 49 KB under byte cap -> deny", run(guard, read(minified)).out.includes("deny"));
check("minified with explicit limit=99999 -> deny", run(guard, read(minified, { limit: 99999 })).out.includes("deny"));
check("ReadAllText large file -> deny", run(guard, bash(`[IO.File]::ReadAllText("${big}")`)).out.includes("deny"));
check("quoted mention of git log -p -> allow", run(guard, bash('git commit -m "docs: mention git log -p"')).out === "");
check("heredoc mentioning grep -rn -> allow", run(guard, bash("node - <<'EOF'\nconst s = 'grep -rn x';\nEOF")).out === "");

console.log("guard: robustness");
check("invalid JSON -> silent allow", run(guard, "not json").out === "");
check("empty stdin -> silent allow", run(guard, "").out === "");

console.log("guard: config override");
const override = path.join(tmp, "override.json");
fs.writeFileSync(override, JSON.stringify({ guard: { read: { maxBytes: 10, maxLimitLines: 5 } } }));
check(
  "home config raises strictness -> small file denied",
  run(guard, read(small, { limit: 50 }), { TOKEN_DIET_CONFIG: override }).out.includes("deny")
);
fs.writeFileSync(override, JSON.stringify({ guard: { enabled: false } }));
check(
  "home config disables guard -> large file allowed",
  run(guard, read(big), { TOKEN_DIET_CONFIG: override }).out === ""
);

const workspace = path.join(tmp, "workspace");
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, ".token-diet.json"), JSON.stringify({ guard: { read: { maxBytes: 10 } } }));
const wsPayload = { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: path.join(workspace, "file.cs") }, cwd: workspace, session_id: "test" };
fs.writeFileSync(path.join(workspace, "file.cs"), "class A {}\n");
check("workspace config applies -> small file denied", run(guard, wsPayload).out.includes("deny"));

console.log("ledger");
const ledgerFile = path.join(dataDir, "ledger.jsonl");
check("deny is recorded", fs.existsSync(ledgerFile) && fs.readFileSync(ledgerFile, "utf8").includes('"event":"read"'));
const { savingsReport } = await import("../plugins/token-diet/scripts/lib/ledger.mjs");
const report = savingsReport(1).text;
check("savings report counts blocked calls", /Blocked calls: [1-9]/.test(report), report.split("\n")[2]);
check("savings report mentions blocked bytes", /bytes kept out of context/.test(report));

console.log("loop breaker");
const loopPayload = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "grep -rn x ." }, session_id: `test-${Date.now()}` };
run(loopBreaker, loopPayload);
run(loopBreaker, loopPayload);
const third = run(loopBreaker, loopPayload);
check("third identical call -> warning", third.out.includes("additionalContext"));
check("same call remains silent afterwards", run(loopBreaker, loopPayload).out === "");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall guard tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
