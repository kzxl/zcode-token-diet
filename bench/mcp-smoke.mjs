#!/usr/bin/env node
// Smoke test: talk MCP over stdio to the plugin server exactly as ZCode will.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const server = path.join(root, "plugins", "token-diet", "scripts", "mcp-server.mjs");

const child = spawn(process.execPath, [server], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (c) => {
  buf += c;
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("NON-JSON STDOUT:", line.slice(0, 120));
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on("data", (c) => process.stderr.write("[server] " + c));

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 20000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

const out = [];
try {
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  out.push(`initialize -> ${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}, tools=${"tools" in (init.result?.capabilities || {})}`);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await rpc("tools/list", {});
  const tools = list.result?.tools || [];
  out.push(`tools/list -> ${tools.map((t) => t.name).join(", ")}`);
  const schemaChars = JSON.stringify(tools).length;
  out.push(`tool schema size -> ${schemaChars} chars (~${Math.round(schemaChars / 4)} tokens)`);

  const outline = await rpc("tools/call", { name: "outline", arguments: { path: path.join(root, "bench", "fixtures", "src") } });
  const oText = outline.result?.content?.[0]?.text || "";
  out.push(`outline -> ${oText.split("\n")[0]} (${oText.length} chars)`);
  out.push("  " + (oText.split("\n").slice(2, 5).join("\n  ") || "(empty)"));

  const search = await rpc("tools/call", { name: "search", arguments: { pattern: "OrderStatus.Cancelled", path: path.join(root, "bench", "fixtures", "src"), maxMatches: 5 } });
  const sText = search.result?.content?.[0]?.text || "";
  out.push(`search -> ${sText.split("\n")[0]} (${sText.length} chars)`);

  const diet = await rpc("tools/call", { name: "diet", arguments: {} });
  const dText = diet.result?.content?.[0]?.text || "";
  out.push(`diet -> ${dText.split("\n").find((l) => l.startsWith("TOTAL")) || "(no total)"}`);

  const bad = await rpc("tools/call", { name: "nope", arguments: {} });
  out.push(`unknown tool -> isError=${bad.result?.isError}`);
} catch (e) {
  out.push(`FAILED: ${e.message}`);
} finally {
  child.kill();
  console.log(out.join("\n"));
}
