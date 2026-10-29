// Panel test: run the embedded MCP Apps script against a fake host and check
// the handshake, the data refresh and the controls.

import { spawn } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = process.argv[2] || path.join(here, "..", "plugins", "token-diet", "scripts", "mcp-server.mjs");

const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
let nextId = 1;
const pending = new Map();
child.stdout.on("data", (c) => {
  buf += c;
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await rpc("initialize", {});
const read = await rpc("resources/read", { uri: "ui://token-diet/panel.html" });
const html = read.result?.contents?.[0]?.text || "";
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.log("FAIL: panel has no script");
  process.exit(1);
}

const sent = [];
const handlers = {};
const elements = new Map();
let intervalMs = null;
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      textContent: "",
      innerHTML: "",
      value: "0",
      listeners: {},
      addEventListener(type, cb) {
        this.listeners[type] = cb;
      },
    });
  }
  return elements.get(id);
}
const sandbox = {
  window: {
    parent: { postMessage: (msg) => sent.push(msg) },
    addEventListener(type, cb) {
      handlers[type] = cb;
    },
  },
  document: {
    getElementById: el,
    documentElement: { scrollWidth: 320, scrollHeight: 480 },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: () => 1,
  setInterval: (fn, ms) => {
    intervalMs = ms;
    return 1;
  },
  clearInterval: () => {},
  console,
  Promise,
};
vm.runInNewContext(scriptMatch[1], sandbox);

const tick = () => new Promise((r) => setImmediate(r));
let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

await tick();
const init = sent.find((m) => m.method === "ui/initialize");
check("sends ui/initialize first", !!init && sent[0] === init);
check("initialize carries appInfo and protocol", !!init && init.params?.appInfo?.name === "token-diet" && typeof init.params?.protocolVersion === "string");

handlers.message({
  data: { jsonrpc: "2.0", id: init.id, result: { protocolVersion: "2025-11-21", hostInfo: {}, hostCapabilities: {}, hostContext: {} } },
});
await tick();
await tick();
check("sends ui/notifications/initialized", sent.some((m) => m.method === "ui/notifications/initialized"));
check("sends size notification", sent.some((m) => m.method === "ui/notifications/size-changed"));

const call = sent.find((m) => m.method === "tools/call");
check("requests panel data through the bridge", !!call && call.params?.name === "diet" && call.params?.arguments?.scope === "panel");

handlers.message({
  data: {
    jsonrpc: "2.0",
    id: call.id,
    result: {
      structuredContent: {
        blockedCalls: 7,
        blockedBytes: 70000,
        avgBytes: 70000,
        files: 2,
        toolCalls: 3,
        outChars: 1000,
        recent: [{ label: "a.cs", bytes: 70000 }],
        updatedAt: Date.now(),
      },
    },
  },
});
await tick();
await tick();
check("renders the refreshed hero", el("hero").textContent.includes("19.4k"), el("hero").textContent);
check("renders the refreshed blocks", el("blocks").textContent === 7, String(el("blocks").textContent));
check("renders the refreshed file row", /a\.cs/.test(el("recentWrap").innerHTML));

const before = sent.filter((m) => m.method === "tools/call").length;
el("reload").listeners.click();
await tick();
await tick();
check("reload button requests data again", sent.filter((m) => m.method === "tools/call").length === before + 1);

el("interval").value = "5000";
el("interval").listeners.change();
check("selecting an interval starts the timer", intervalMs === 5000, String(intervalMs));

child.kill();
console.log(failures === 0 ? "\npanel test passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
