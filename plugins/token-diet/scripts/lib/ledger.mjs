// Local savings ledger.
//
// Records what the guard blocked and what the MCP tools returned. It is a local
// JSONL file under ~/.zcode/token-diet/ (override with $TOKEN_DIET_DATA); it
// never leaves the machine and never throws into a hook or a tool call.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
const CHARS_PER_TOKEN = 3.6;

export function dataDir() {
  if (process.env.TOKEN_DIET_DATA) return process.env.TOKEN_DIET_DATA;
  const shared = path.join(os.homedir(), ".token-diet");
  const zcode = path.join(os.homedir(), ".zcode", "token-diet");
  if (fs.existsSync(zcode) && !fs.existsSync(shared)) return zcode;
  return shared;
}

export function ledgerPath() {
  return path.join(dataDir(), "ledger.jsonl");
}

export function appendLedger(entry) {
  try {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = ledgerPath();
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {}
    fs.appendFileSync(file, JSON.stringify({ at: Date.now(), ...entry }) + "\n");
  } catch {}
}

function readLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

export function readLedger(days = 1) {
  const since = Date.now() - Math.max(1, days) * 86400000;
  const entries = [];
  for (const file of [ledgerPath(), `${ledgerPath()}.1`]) {
    for (const line of readLines(file)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.at >= since) entries.push(e);
      } catch {}
    }
  }
  return entries;
}

function formatTokens(n) {
  const tokens = Math.round(n / CHARS_PER_TOKEN);
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

export function savingsReport(days = 1) {
  const entries = readLedger(days);
  const denies = entries.filter((e) => e.t === "deny");
  const tools = entries.filter((e) => e.t === "tool");

  const blockedBytes = denies.reduce((n, e) => n + (e.bytes || 0), 0);
  const byEvent = new Map();
  for (const d of denies) byEvent.set(d.event, (byEvent.get(d.event) || 0) + 1);

  const byTool = new Map();
  for (const t of tools) {
    const cur = byTool.get(t.tool) || { calls: 0, out: 0, ms: 0 };
    cur.calls++;
    cur.out += t.outChars || 0;
    cur.ms += t.ms || 0;
    byTool.set(t.tool, cur);
  }

  const lines = [];
  lines.push(`token-diet ledger — last ${days} day(s)`);
  lines.push(`file: ${ledgerPath()}`);
  lines.push("");
  lines.push(`Blocked calls: ${denies.length}`);
  if (denies.length) {
    lines.push(`  bytes kept out of context: ${(blockedBytes / 1024).toFixed(0)} KB (~${formatTokens(blockedBytes)} tokens)`);
    for (const [event, count] of [...byEvent.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${event}: ${count}`);
    }
    const recent = denies.slice(-3).map((d) => `  - ${d.reason || d.event}`.slice(0, 180));
    if (recent.length) {
      lines.push("  recent reasons:");
      lines.push(...recent);
    }
  }
  lines.push("");
  lines.push("Tool calls through token-diet:");
  if (byTool.size === 0) {
    lines.push("  (none)");
  } else {
    for (const [tool, v] of [...byTool.entries()].sort((a, b) => b[1].out - a[1].out)) {
      lines.push(
        `  ${tool.padEnd(8)} ${String(v.calls).padStart(4)} calls  ` +
          `out ${formatTokens(v.out)} tok  avg ${Math.round(v.ms / v.calls)} ms`
      );
    }
  }
  lines.push("");
  lines.push(
    "Note: blocked bytes are an upper bound (the model would have received the file). " +
      "These are local estimates, not provider-reported usage."
  );
  return { text: lines.join("\n"), stats: { denies: denies.length, blockedBytes, toolCalls: tools.length } };
}
