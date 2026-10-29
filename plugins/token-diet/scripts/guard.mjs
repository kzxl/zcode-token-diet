#!/usr/bin/env node
// PreToolUse guard: blocks tool calls whose result would flood the context.
// Contract: stdin = hook payload JSON, stdout = hook output JSON (or nothing), exit 0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { appendLedger } from "./lib/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

function fileSize(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st.size : -1;
  } catch {
    return -1;
  }
}

// Resolve a possibly relative path from a hook payload. Accepts Git-Bash style
// "/c/Users/..." in addition to native Windows paths.
function resolveExisting(p, cwd) {
  const candidates = [];
  const msys = String(p).match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) candidates.push(`${msys[1].toUpperCase()}:/${msys[2]}`);
  candidates.push(path.resolve(cwd || process.cwd(), p));
  candidates.push(path.resolve(p));
  for (const c of candidates) {
    if (fileSize(c) >= 0) return c;
  }
  return candidates[0];
}

function approxLines(bytes) {
  return Math.round(bytes / 38);
}

function deny(reason, meta = {}) {
  appendLedger({ t: "deny", event: meta.event || "unknown", bytes: meta.bytes || 0, file: meta.file || "", reason });
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

// Flatten every path-looking argument, not just the last one.
function pathArgs(command) {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  const out = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i].replace(/^["']|["']$/g, "");
    if (!t) continue;
    if (/^[|&>]/.test(t)) break;
    if (t.startsWith("-")) continue;
    if (/^\d+$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

// A 128 KB minified bundle is far more expensive than a 128 KB source file:
// few lines, very long ones. Lower the budget when the file looks minified.
function isMinified(file, size) {
  if (/\.min\.(js|css)$/i.test(file)) return true;
  if (size < 20000) return false;
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    if (n < 500) return false;
    let nl = 0;
    for (let i = 0; i < n; i++) if (buf[i] === 10) nl++;
    return nl <= 3;
  } catch {
    return false;
  }
}

function effectiveMax(file, size, maxBytes) {
  return isMinified(file, size) ? Math.floor(maxBytes / 4) : maxBytes;
}

async function main() {
  const raw = await readStdin();
  let ev;
  try {
    ev = JSON.parse(raw || "{}");
  } catch {
    return;
  }

  const cfg = loadConfig(here, ev.cwd || process.cwd());
  const g = cfg.guard || {};
  if (g.enabled === false) return;

  const tool = ev.tool_name || "";
  const input = ev.tool_input || {};

  // --- Read without a usable limit on a large file --------------------------
  if (tool === "Read") {
    const r = g.read || {};
    const maxBytes = r.maxBytes ?? 131072;
    const maxLimitLines = r.maxLimitLines ?? 400;
    const p = input.file_path;
    const limit = typeof input.limit === "number" ? input.limit : null;
    const hasLimit = limit !== null && limit > 0;
    const tooBig = hasLimit && limit > maxLimitLines;
    if (p && (!hasLimit || tooBig)) {
      const full = resolveExisting(p, ev.cwd || process.cwd());
      const size = fileSize(full);
      const budget = effectiveMax(full, size, maxBytes);
      if (size > budget) {
        const name = path.basename(p);
        const kb = Math.round(size / 1024);
        const lines = approxLines(size);
        const approxK = Math.round(size / 3.6 / 1000);
        const suggest = Math.min(r.suggestLines ?? maxLimitLines, maxLimitLines);
        const compact = budget < maxBytes ? ` It looks minified, so the read budget is ${Math.round(budget / 1024)} KB.` : "";
        const reason = tooBig
          ? `token-diet blocked Read with limit=${limit}: on ${name} (${kb} KB) that is effectively a full read (~${approxK}k tokens).${compact} ` +
            `Use limit<=${maxLimitLines} with an offset, or the token-diet "outline" tool.`
          : `token-diet blocked a full read of ${name} (${kb} KB, ~${lines} lines): roughly ${approxK}k tokens.${compact} ` +
            `Use limit<=${maxLimitLines} with an offset, or the token-diet "outline" tool; ` +
            `if you have no MCP tools, locate what you need with grep -n -m 20 "<symbol>" ${name}.`;
        deny(reason, { event: "read", bytes: size, file: name });
      }
    }
  }

  // --- Bash commands that dump unbounded output ----------------------------
  if (tool === "Bash") {
    const b = g.bash || {};
    if (b.enabled === false) return;
    const cmd = String(input.command || "").trim();
    if (!cmd) return;

    if (b.denyRecursiveGrep !== false) {
      const recursiveGrep = /\bgrep\s+(-\S*r\S*|--recursive)\b/.test(cmd);
      const recursiveFindstr = /\bfindstr\s+\/s\b/i.test(cmd) && !/\/m\b/i.test(cmd);
      const rg = /\brg\b/.test(cmd);
      const bounded =
        /\bgrep\s+-\S*l/.test(cmd) ||
        /(?:^|\s)-[a-zA-Z]*l[a-zA-Z]*(?=\s|$)/.test(cmd) ||
        /--files-with-matches/.test(cmd) ||
        /\s-m\s*\d/.test(cmd) ||
        /--max-count/.test(cmd) ||
        /\|\s*head\b/.test(cmd);
      const rgBounded =
        /\s-l\b/.test(cmd) || /--files-with-matches/.test(cmd) || /\s-m\s*\d/.test(cmd) || /--max-count/.test(cmd) || /\|\s*head\b/.test(cmd);
      if (recursiveGrep && !bounded) {
        deny(
          `token-diet blocked an unbounded recursive grep. Add -m 5 or -l, pipe through head, ` +
            `or use the token-diet "search" tool (returns file:line with 2 context lines, capped at 8 KB).`,
          { event: "grep" }
        );
      }
      if (recursiveFindstr) {
        deny(`token-diet blocked "findstr /s" without /m. Add /m, or use the token-diet "search" tool.`, { event: "grep" });
      }
      if (rg && !rgBounded) {
        deny(`token-diet blocked rg without a cap. Add -l, -m 5, or pipe through head; or use the token-diet "search" tool.`, { event: "grep" });
      }
    }

    if (b.denyPatchLog !== false) {
      if (/\bgit\s+log\b/.test(cmd) && /(\s-p\b|--patch)/.test(cmd) && !/(-n\s*\d|--max-count)/.test(cmd)) {
        deny(`token-diet blocked "git log --patch" without a limit. Add -n 20, or use --stat for a summary.`, { event: "git-log" });
      }
    }

    if (b.denyVerboseBuild === true) {
      if (/\b(dotnet\s+build|msbuild)\b/.test(cmd) && !/(-v:\s*[qm]\b|--verbosity\s+(quiet|minimal))/.test(cmd)) {
        deny(
          `token-diet: verbose build logs are huge. Use the token-diet "build" tool (returns only errors and grouped warnings), ` +
            `or add -v:q.`,
          { event: "build" }
        );
      }
    }

    if (/\b(cat|type|more|Get-Content|gc)\b/i.test(cmd)) {
      const maxBytes = b.catMaxBytes ?? 131072;
      for (const p of pathArgs(cmd)) {
        const full = resolveExisting(p, ev.cwd || process.cwd());
        const size = fileSize(full);
        const budget = effectiveMax(full, size, maxBytes);
        if (size > budget) {
          const isCode = /\.(cs|ts|tsx|js|mjs|cjs|java|kt|py|go|rb|php|cpp|h|hpp|c|xaml)$/i.test(p);
          deny(
            `token-diet blocked dumping ${path.basename(p)} (${Math.round(size / 1024)} KB) to the terminal. ` +
              (isCode
                ? `Use the token-diet "outline" tool first, or head -n 100.`
                : `Read a slice instead: head -n 100, sed -n '1,100p', or the token-diet "search" tool.`),
            { event: "cat", bytes: size, file: path.basename(p) }
          );
        }
      }
    }

    // PowerShell: [IO.File]::ReadAllText("...") bypasses Get-Content wording.
    const readAll = cmd.match(/\bReadAllText\(\s*['"]([^'"]+)['"]/i);
    if (readAll) {
      const full = resolveExisting(readAll[1], ev.cwd || process.cwd());
      const size = fileSize(full);
      const budget = effectiveMax(full, size, b.catMaxBytes ?? 131072);
      if (size > budget) {
        deny(
          `token-diet blocked ReadAllText on ${path.basename(readAll[1])} (${Math.round(size / 1024)} KB). ` +
            `Read a slice instead: Get-Content -TotalCount 100, or the token-diet "outline" tool.`,
          { event: "readall", bytes: size, file: path.basename(readAll[1]) }
        );
      }
    }
  }
}

main().catch(() => process.exit(0));
