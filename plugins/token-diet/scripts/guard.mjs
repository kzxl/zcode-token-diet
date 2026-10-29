#!/usr/bin/env node
// PreToolUse guard: blocks tool calls whose result would flood the context.
// Contract: stdin = hook payload JSON, stdout = hook output JSON (or nothing), exit 0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig(path.join(here, "config.json"));

function loadConfig(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { guard: { enabled: false } };
  }
}

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

function deny(reason) {
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

// Pull the path argument out of a shell string well enough for the common cases.
function lastPathArg(command) {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  const skip = new Set([
    "cat",
    "type",
    "more",
    "get-content",
    "gc",
    "-r",
    "-n",
    "head",
    "tail",
    "less",
    "bat",
  ]);
  for (let i = tokens.length - 1; i >= 0; i--) {
    let t = tokens[i].replace(/^["']|["']$/g, "");
    if (t.startsWith("-") || t.startsWith("|") || skip.has(t.toLowerCase())) continue;
    if (/^[a-z]+:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) continue;
    return t;
  }
  return "";
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
}

async function main() {
  const g = cfg.guard || {};
  if (g.enabled === false) return;

  const raw = await readStdin();
  let ev;
  try {
    ev = JSON.parse(raw || "{}");
  } catch {
    return;
  }

  const tool = ev.tool_name || "";
  const input = ev.tool_input || {};

  // --- Read without an explicit limit on a large file -----------------------
  if (tool === "Read") {
    const r = g.read || {};
    const maxBytes = r.maxBytes ?? 131072;
    const p = input.file_path;
    const hasLimit = typeof input.limit === "number" && input.limit > 0;
    if (p && !hasLimit) {
      const size = fileSize(resolveExisting(p, ev.cwd || process.cwd()));
      if (size > maxBytes) {
        const name = path.basename(p);
        const lines = approxLines(size);
        const suggest = r.suggestLines ?? 200;
        deny(
          `token-diet blocked a full read of ${name} (${Math.round(size / 1024)} KB, ~${lines} lines). ` +
            `This single call would add roughly ${Math.round(size / 3.6 / 1000)}k tokens. ` +
            `Use the token-diet "outline" tool, or if you have no MCP tools, locate the part you need with ` +
            `grep -n -m 20 "<symbol>" ${name}, then Read with limit=${suggest} and an offset.`
        );
      }
    }
  }

  // --- Bash commands that dump unbounded output ----------------------------
  if (tool === "Bash") {
    const b = g.bash || {};
    if (b.enabled === false) return;
    const cmd = stripQuotes(String(input.command || ""));
    if (!cmd) return;

    if (b.denyRecursiveGrep !== false) {
      const recursive = /\bgrep\s+(-\S*r\S*|--recursive)\b/.test(cmd);
      const bounded =
        /\bgrep\s+-\S*l/.test(cmd) ||
        /--files-with-matches/.test(cmd) ||
        /\s-m\s*\d/.test(cmd) ||
        /--max-count/.test(cmd) ||
        /\|\s*head\b/.test(cmd);
      if (recursive && !bounded) {
        deny(
          `token-diet blocked an unbounded recursive grep. Add -m 5 or -l, pipe through head, ` +
            `or use the token-diet "search" tool (returns file:line with 2 context lines, capped at 8 KB).`
        );
      }
    }

    if (b.denyPatchLog !== false) {
      if (/\bgit\s+log\b/.test(cmd) && /(\s-p\b|--patch)/.test(cmd) && !/(-n\s*\d|--max-count)/.test(cmd)) {
        deny(
          `token-diet blocked "git log --patch" without a limit. Add -n 20, or use --stat for a summary.`
        );
      }
    }

    if (b.denyVerboseBuild === true) {
      if (/\b(dotnet\s+build|msbuild)\b/.test(cmd) && !/(-v:\s*[qm]\b|--verbosity\s+(quiet|minimal))/.test(cmd)) {
        deny(
          `token-diet: verbose build logs are huge. Use the token-diet "build" tool (returns only errors and grouped warnings), ` +
            `or add -v:q.`
        );
      }
    }

    if (/\b(cat|type|more|Get-Content|gc)\b/i.test(cmd)) {
      const maxBytes = b.catMaxBytes ?? 131072;
      const p = lastPathArg(cmd);
      if (p) {
        const size = fileSize(resolveExisting(p, ev.cwd || process.cwd()));
        if (size > maxBytes) {
          const isCode = /\.(cs|ts|tsx|js|mjs|cjs|java|kt|py|go|rb|php|cpp|h|hpp|c|xaml)$/i.test(p);
          deny(
            `token-diet blocked dumping ${path.basename(p)} (${Math.round(size / 1024)} KB) to the terminal. ` +
              (isCode
                ? `Use the token-diet "outline" tool first, or head -n 100.`
                : `Read a slice instead: head -n 100, sed -n '1,100p', or the token-diet "search" tool.`)
          );
        }
      }
    }
  }
}

main().catch(() => process.exit(0));
