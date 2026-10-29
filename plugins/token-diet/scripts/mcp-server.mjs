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
import { appendLedger, readLedger, savingsReport } from "./lib/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(here, process.cwd());
const PANEL_URI = "ui://token-diet/panel.html";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTokens(chars) {
  const t = chars / 3.6;
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(Math.round(t));
}

// The panel is an MCP App: the host reads this resource and renders the HTML in
// a sandboxed iframe. Content is rebuilt on every read, so reopening it is a
// refresh. No conversation tokens are involved.
function panelHtml() {
  const entries = readLedger(1);
  const denies = entries.filter((e) => e.t === "deny");
  const tools = entries.filter((e) => e.t === "tool");
  const blocked = denies.reduce((n, e) => n + (e.bytes || 0), 0);
  const outChars = tools.reduce((n, e) => n + (e.outChars || 0), 0);

  const byTool = new Map();
  for (const t of tools) byTool.set(t.tool, (byTool.get(t.tool) || 0) + 1);
  const toolRows = [...byTool.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `<li><span>${esc(name)}</span><b>${count}</b></li>`)
    .join("");
  const deniedRows = denies
    .slice(-5)
    .reverse()
    .map((d) => `<li><span>${esc(d.file || d.event)}</span><b>${Math.round((d.bytes || 0) / 1024)} KB</b></li>`)
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Token Diet</title>
<style>
:root{color-scheme:light dark;--fg:#1b1b1f;--mut:#6b6b76;--bg:#fff;--card:#f6f6f8;--line:#e6e6ea;--accent:#2f6f4f}
@media (prefers-color-scheme:dark){:root{--fg:#e8e8ee;--mut:#9a9aa8;--bg:#1b1b1f;--card:#24242b;--line:#33333d;--accent:#7fd3a6}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:14px}
h1{font-size:15px;margin:0 0 2px}
.sub{color:var(--mut);font-size:11px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}
.card .k{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.card .v{font-size:22px;font-weight:650;margin-top:2px}
.card .u{font-size:11px;color:var(--mut)}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:14px 0 6px}
ul{list-style:none;margin:0;padding:0}
li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line)}
li:last-child{border-bottom:0}
li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li b{flex:none;color:var(--accent)}
.empty{color:var(--mut);font-size:12px;padding:6px 0}
.foot{margin-top:14px;color:var(--mut);font-size:10.5px}
</style></head>
<body>
<h1>Token Diet</h1>
<div class="sub">Last 24 hours · local estimate · reopen to refresh</div>
<div class="grid">
  <div class="card"><div class="k">Blocked</div><div class="v">${denies.length}</div><div class="u">calls</div></div>
  <div class="card"><div class="k">Kept out</div><div class="v">${fmtTokens(blocked)}</div><div class="u">tokens (upper bound)</div></div>
  <div class="card"><div class="k">Tool calls</div><div class="v">${tools.length}</div><div class="u">through token-diet</div></div>
  <div class="card"><div class="k">Tool output</div><div class="v">${fmtTokens(outChars)}</div><div class="u">tokens returned</div></div>
</div>
<h2>Recent blocked files</h2>
${deniedRows ? `<ul>${deniedRows}</ul>` : '<div class="empty">Nothing blocked yet.</div>'}
<h2>Tools used</h2>
${toolRows ? `<ul>${toolRows}</ul>` : '<div class="empty">No tool calls recorded yet.</div>'}
<div class="foot">Ledger: ~/.zcode/token-diet/ledger.jsonl · provider usage is not included</div>
</body></html>`;
}
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
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "token-diet", version },
    });
    return;
  }

  if (!method || method.startsWith("notifications/")) return;

  if (method === "ping") {
    result(id, {});
    return;
  }

  if (method === "resources/list") {
    result(id, {
      resources: [
        {
          uri: PANEL_URI,
          name: "Token Diet",
          description: "Blocked calls and tool output from the local ledger",
          mimeType: "text/html;profile=mcp-app",
        },
      ],
    });
    return;
  }

  if (method === "resources/templates/list") {
    result(id, { resourceTemplates: [] });
    return;
  }

  if (method === "resources/read") {
    if (params?.uri !== PANEL_URI) {
      error(id, -32602, `Unknown resource: ${params?.uri}`);
      return;
    }
    result(id, {
      contents: [
        {
          uri: PANEL_URI,
          mimeType: "text/html;profile=mcp-app",
          text: panelHtml(),
          _meta: { "ui/resourceUri": PANEL_URI, ui: { resourceUri: PANEL_URI } },
        },
      ],
    });
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
      const payload = { content: [{ type: "text", text: out.text }], isError: false };
      // MCP Apps: a tool result can point at a UI resource; the host renders it.
      // `diet scope=savings` is the natural trigger for the ledger panel.
      if (name === "diet" && params?.arguments?.scope === "savings") {
        payload._meta = { "ui/resourceUri": PANEL_URI, ui: { resourceUri: PANEL_URI } };
      }
      result(id, payload);
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
