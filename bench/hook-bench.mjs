#!/usr/bin/env node
// Hook latency benchmark: process spawn + guard logic + ledger append.
// Usage: node bench/hook-bench.mjs [iterations]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const guard = path.join(root, "plugins", "zero-token", "scripts", "guard.mjs");
const loop = path.join(root, "plugins", "zero-token", "scripts", "loop-breaker.mjs");
const N = Number(process.argv[2] || 10);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zero-token-hook-"));
const data = path.join(tmp, "data");
const big = path.join(tmp, "Big.cs");
const small = path.join(tmp, "Small.cs");
fs.writeFileSync(big, "// pad\n".repeat(20000));
fs.writeFileSync(small, "class A {}\n");

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const avg = s.reduce((n, v) => n + v, 0) / s.length;
  return { avg: +avg.toFixed(1), min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

function run(script, payload) {
  const t = process.hrtime.bigint();
  spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, TOKEN_DIET_DATA: data },
  });
  return Number(process.hrtime.bigint() - t) / 1e6;
}

const read = (file) => ({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: file }, cwd: tmp, session_id: "bench" });

const cases = [
  ["guard allow (small read)", guard, read(small)],
  ["guard deny (large read)", guard, read(big)],
  ["guard deny (grep -rn)", guard, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "grep -rn x ." }, cwd: tmp, session_id: "bench" }],
  ["loop breaker", loop, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "grep -rn x ." }, session_id: `b-${Date.now()}` }],
];

console.log(`Hook latency over ${N} runs (Windows process spawn dominates)\n`);
for (const [name, script, payload] of cases) {
  const samples = [];
  for (let i = 0; i < N; i++) samples.push(run(script, payload));
  const s = stats(samples);
  console.log(`${name.padEnd(26)} avg ${String(s.avg).padStart(6)} ms   p50 ${String(s.p50).padStart(6)}   max ${String(s.max).padStart(6)}`);
}

// Ledger append cost without spawn overhead.
const { appendLedger } = await import("../plugins/zero-token/scripts/lib/ledger.mjs");
process.env.TOKEN_DIET_DATA = data;
const t0 = process.hrtime.bigint();
for (let i = 0; i < 1000; i++) appendLedger({ t: "tool", tool: "bench", outChars: 100, ms: 1 });
const per = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
console.log(`\nledger append             avg ${per.toFixed(3)} ms/call`);

fs.rmSync(tmp, { recursive: true, force: true });
