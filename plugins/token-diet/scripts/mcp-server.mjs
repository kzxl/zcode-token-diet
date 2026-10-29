#!/usr/bin/env node
// Minimal MCP stdio server exposing four compact-context tools.

import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outline, search } from "./lib/scan.mjs";
import { runBuild } from "./lib/build.mjs";
import { dietReport } from "./lib/diet.mjs";
import { runAction } from "./lib/run.mjs";
import { loadConfig } from "./lib/config.mjs";
import { appendLedger, savingsReport } from "./lib/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(here, process.cwd());
let version = "0.2.0";
try {
  version = JSON.parse(fs.readFileSync(path.join(here, "..", ".zcode-plugin", "plugin.json"), "utf8")).version;
} catch {}

const TOOLS = [
  {
    name: "outline",
    description:
      "List type and method signatures with line numbers for a source file or directory. Call before Read on files over 200 lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory" },
        maxFiles: { type: "number", description: "Directory mode: files to show, default 10" },
        maxPerFile: { type: "number", description: "Symbols per file, default 60" },
      },
      required: ["path"],
    },
  },
  {
    name: "search",
    description:
      "Search text or /regex/ under a path. Returns file:line with 2 context lines, capped at 8 KB. Use instead of grep -r.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Literal text or /regex/flags" },
        path: { type: "string", description: "File or directory, default cwd" },
        maxMatches: { type: "number", description: "Default 30, max 200" },
        context: { type: "number", description: "Context lines each side, default 2" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "build",
    description:
      "Build the .NET solution (MSBuild for legacy .NET Framework, dotnet for SDK-style) and return only errors plus grouped warnings. Use instead of dotnet build.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Solution or project path; auto-detected if omitted" },
        toolchain: { type: "string", description: "auto (default), msbuild, or dotnet" },
        configuration: { type: "string", description: "Default Debug" },
        platform: { type: "string", description: "e.g. \"Any CPU\"; empty for the project default" },
        tail: { type: "number", description: "Summary lines when clean, default 5" },
      },
    },
  },
  {
    name: "run",
    description:
      "Build, test or lint a non-.NET project (npm/pnpm/yarn, cargo, go, maven, gradle, make, pytest) and return only errors plus a summary. Use build for .NET.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project directory, default cwd" },
        action: { type: "string", description: "build (default), test, or lint" },
        dryRun: { type: "boolean", description: "Show the command without running it" },
        timeoutMs: { type: "number", description: "Default 600000" },
      },
    },
  },
  {
    name: "diet",
    description:
      "Report which installed skills and plugins consume context tokens every session, and what to disable. scope=savings reports what the guard blocked.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "context (default) or savings" },
        days: { type: "number", description: "savings window in days, default 1" },
      },
    },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function result(id, payload) {
  send({ jsonrpc: "2.0", id, result: payload });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callTool(name, args) {
  const a = args || {};
  const searchOpts = {
    extensions: config.search?.extensions || [],
    respectGitignore: config.search?.respectGitignore,
    cacheTtlMs: config.search?.cacheTtlMs,
    cacheMaxBytes: config.search?.cacheMaxBytes,
  };
  switch (name) {
    case "outline":
      return outline(a.path || ".", { ...a, ...searchOpts });
    case "search":
      return search({ ...a, ...searchOpts });
    case "build":
      return runBuild(a, config);
    case "run":
      return runAction(a, config);
    case "diet":
      if (a.scope === "savings") return savingsReport(a.days || 1);
      return dietReport(process.env.ZCODE_WORKSPACE_ROOT || process.cwd());
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  if (method === "initialize") {
    result(id, {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "token-diet", version },
    });
    return;
  }

  if (!method || method.startsWith("notifications/")) return;

  if (method === "ping") {
    result(id, {});
    return;
  }

  if (method === "tools/list") {
    result(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const started = Date.now();
    try {
      const out = await callTool(name, params?.arguments);
      appendLedger({
        t: "tool",
        tool: name,
        outChars: out.text?.length || 0,
        inChars: JSON.stringify(params?.arguments || {}).length,
        ms: Date.now() - started,
      });
      result(id, { content: [{ type: "text", text: out.text }], isError: false });
    } catch (e) {
      result(id, {
        content: [{ type: "text", text: `token-diet ${name} failed: ${e.message}` }],
        isError: true,
      });
    }
    return;
  }

  error(id ?? null, -32601, `Method not found: ${method}`);
});
