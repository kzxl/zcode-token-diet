#!/usr/bin/env node
// Benchmark: naive context usage vs the token-diet path.
// Fixtures are synthetic so the numbers are reproducible; real files are also
// probed to show the guard stays out of the way below the threshold.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { outline, search } from "../plugins/token-diet/scripts/lib/scan.mjs";
import { compactBuildLog, runBuild } from "../plugins/token-diet/scripts/lib/build.mjs";
import { dietReport } from "../plugins/token-diet/scripts/lib/diet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixtures = path.join(here, "fixtures");
const src = path.join(fixtures, "src");
process.chdir(root);

const CODE_CPT = 3.6;
const TEXT_CPT = 4.0;
const tok = (s, cpt = CODE_CPT) => Math.round(String(s).length / cpt);
const pct = (before, after) => (before === 0 ? "0" : (((before - after) / before) * 100).toFixed(1));

// ---------------------------------------------------------------- fixtures
function writeFixtures() {
  fs.mkdirSync(src, { recursive: true });
  const file = path.join(src, "Erp.OrderService.cs");
  if (!fs.existsSync(file) || fs.statSync(file).size < 135000) {
    const ops = [
      "CreateOrder", "UpdateOrder", "CancelOrder", "ApproveOrder", "RejectOrder",
      "GetOrderById", "GetOrderByCode", "SearchOrders", "ExportOrders", "ImportOrders",
      "CalculateTotals", "RecalculateTax", "ApplyDiscount", "ValidateStock", "ReserveStock",
      "ReleaseStock", "PostToLedger", "ReverseLedger", "PrintInvoice", "EmailInvoice",
      "CloneOrder", "MergeOrders", "SplitOrder", "ChangeCustomer", "ChangeWarehouse",
      "AddLine", "RemoveLine", "UpdateLine", "SyncPrices", "SyncPromotions",
    ];
    const L = [];
    L.push("using System;", "using System.Collections.Generic;", "using System.Linq;", "using ERP.Common;", "using ERP.Data;", "");
    L.push("namespace ERP.Sales", "{");
    L.push("    /// <summary>Order application service.</summary>");
    L.push("    public partial class OrderService : IOrderService", "    {");
    L.push("        private readonly IUnitOfWork _uow;");
    L.push("        private readonly IStockService _stock;");
    L.push("        private readonly ILedgerService _ledger;", "");
    L.push("        public OrderService(IUnitOfWork uow, IStockService stock, ILedgerService ledger)", "        {");
    L.push("            _uow = uow;", "            _stock = stock;", "            _ledger = ledger;", "        }", "");
    let n = 0;
    while (L.length < 3800) {
      for (const op of ops) {
        const id = ++n;
        L.push(`        public ServiceResult<OrderDto> ${op}(int orderId, OrderCommand command)`);
        L.push("        {");
        L.push("            var order = _uow.Orders.FindById(orderId);");
        L.push("            if (order == null)");
        L.push("            {");
        L.push(`                Log.Warn("${op}: order {0} not found", orderId);`);
        L.push("                return ServiceResult<OrderDto>.Fail(\"ORDER_NOT_FOUND\");");
        L.push("            }");
        L.push("");
        L.push("            var status = order.Status;");
        L.push("            if (status == OrderStatus.Cancelled && !command.Force)");
        L.push("            {");
        L.push("                return ServiceResult<OrderDto>.Fail(\"ORDER_CANCELLED\");");
        L.push("            }");
        L.push("");
        L.push("            using (var scope = _uow.BeginScope())");
        L.push("            {");
        L.push("                var totals = CalculateTotals(order, command.Discount);");
        L.push("                order.TotalAmount = totals.Net;");
        L.push("                order.TaxAmount = totals.Tax;");
        L.push("                order.Status = OrderStatus.InProgress;");
        L.push("                _uow.Orders.Update(order);");
        L.push("                _uow.SaveChanges();");
        L.push("                scope.Complete();");
        L.push("            }");
        L.push("");
        L.push("            return ServiceResult<OrderDto>.Ok(OrderMapper.ToDto(order));");
        L.push("        }");
        L.push("");
        L.push(`        private OrderTotals Calculate${op}Totals(Order order, decimal discount)`);
        L.push("        {");
        L.push("            var lines = order.Lines.Where(l => !l.Deleted).ToList();");
        L.push("            var net = lines.Sum(l => l.Quantity * l.UnitPrice);");
        L.push("            var tax = Math.Round(net * order.TaxRate, 2);");
        L.push("            if (discount > 0) net -= Math.Round(net * discount, 2);");
        L.push("            return new OrderTotals(net, tax);");
        L.push("        }");
        L.push("");
        L.push(`        private void Audit${op}(Order order, string actor)`);
        L.push("        {");
        L.push("            _uow.Audit.Insert(new AuditEntry");
        L.push("            {");
        L.push(`                Action = "${op}",`);
        L.push("                EntityId = order.Id,");
        L.push("                Actor = actor,");
        L.push("                At = DateTime.UtcNow,");
        L.push("            });");
        L.push("        }");
        L.push("");
        if (L.length > 3800) break;
      }
    }
    L.push("    }", "}");
    fs.writeFileSync(file, L.join("\n"));

    const repo = path.join(src, "Erp.OrderRepository.cs");
    const R = [];
    R.push("using System;", "using System.Collections.Generic;", "using System.Linq;", "using ERP.Data;", "");
    R.push("namespace ERP.Sales", "{", "    public class OrderRepository : IOrderRepository", "    {");
    R.push("        private readonly ErpDbContext _db;", "");
    R.push("        public OrderRepository(ErpDbContext db) { _db = db; }", "");
    for (let i = 0; i < 140; i++) {
      R.push(`        public IReadOnlyList<Order> Query${i}(OrderStatus status, int page)`);
      R.push("        {");
      R.push("            return _db.Orders");
      R.push("                .Where(o => o.Status == status)");
      R.push("                .OrderByDescending(o => o.CreatedAt)");
      R.push("                .Skip(page * 50).Take(50)");
      R.push("                .ToList();");
      R.push("        }");
      R.push("");
    }
    R.push("    }", "}");
    fs.writeFileSync(repo, R.join("\n"));
  }

  const logFile = path.join(fixtures, "build.log");
  if (!fs.existsSync(logFile) || fs.statSync(logFile).size < 120000) {
    const W = ["CS8618", "CS0168", "CS1998", "NU1603", "CS0618", "MSB3277"];
    const L = [];
    L.push("Microsoft (R) Build Engine version 17.11.4 for .NET");
    L.push("Copyright (C) Microsoft Corporation. All rights reserved.");
    L.push("");
    for (let proj = 0; proj < 12; proj++) {
      L.push(`  ERP.Module${proj} -> C:\\Build\\ERP.Module${proj}\\bin\\Debug\\ERP.Module${proj}.dll`);
      for (let i = 0; i < 120; i++) {
        const code = W[(proj + i) % W.length];
        L.push(`C:\\Build\\ERP.Module${proj}\\Services\\Handler${i}.cs(${i + 12},9): warning ${code}: Non-nullable property 'Handler${i}.Value' contains no value.`);
      }
      for (let i = 0; i < 30; i++) {
        L.push(`C:\\Build\\ERP.Module${proj}\\Data\\Repository${i}.cs(${i + 20},13): warning CS0168: The variable 'ex' is declared but never used.`);
      }
    }
    L.push("C:\\Build\\ERP.Sales\\OrderService.cs(412,17): error CS0103: The name 'OrderStatus' does not exist in the current context.");
    L.push("C:\\Build\\ERP.Sales\\OrderService.cs(455,21): error CS1061: 'Order' does not contain a definition for 'TaxRate'.");
    L.push("C:\\Build\\ERP.Sales\\InvoiceService.cs(88,9): error CS0246: The type or namespace name 'IPrinter' could not be found.");
    L.push("C:\\Build\\ERP.Sales\\InvoiceService.cs(91,9): error CS0246: The type or namespace name 'IPrinter' could not be found.");
    L.push("C:\\Build\\ERP.Inventory\\StockService.cs(120,5): error CS0161: 'StockService.Reserve(int)': not all code paths return a value.");
    L.push("C:\\Build\\ERP.Inventory\\StockService.cs(140,5): error CS0161: 'StockService.Reserve(int)': not all code paths return a value.");
    L.push("C:\\Build\\ERP.Ledger\\LedgerService.cs(77,9): error CS1503: Argument 1: cannot convert from 'string' to 'int'.");
    L.push("");
    L.push("    214 Warning(s)");
    L.push("    7 Error(s)");
    L.push("");
    L.push("Time Elapsed 00:01:12.44");
    if (L.join("\n").length < 120000) {
      while (L.join("\n").length < 130000) {
        L.splice(3, 0, "  ERP.ModuleX -> C:\\Build\\ERP.ModuleX\\bin\\Debug\\ERP.ModuleX.dll");
      }
    }
    fs.writeFileSync(logFile, L.join("\n"));
  }
}

// ---------------------------------------------------------------- guard tests
function runGuard(payload) {
  const res = spawnSync(
    process.execPath,
    [path.join(root, "plugins", "token-diet", "scripts", "guard.mjs")],
    { input: JSON.stringify(payload), encoding: "utf8", timeout: 10000 }
  );
  return { out: (res.stdout || "").trim(), err: (res.stderr || "").trim(), status: res.status };
}

function runLoopBreaker(payload, times) {
  let last = { out: "" };
  for (let i = 0; i < times; i++) {
    const res = spawnSync(
      process.execPath,
      [path.join(root, "plugins", "token-diet", "scripts", "loop-breaker.mjs")],
      { input: JSON.stringify(payload), encoding: "utf8", timeout: 10000 }
    );
    last = { out: (res.stdout || "").trim() };
  }
  return last;
}

function naiveGrepFiles(dir, pattern) {
  const needle = pattern.toLowerCase();
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(cs|csproj|json|md)$/i.test(e.name)) {
        const rows = fs.readFileSync(full, "utf8").split(/\r?\n/);
        rows.forEach((r, i) => {
          if (r.toLowerCase().includes(needle)) out.push(`${path.relative(root, full)}:${i + 1}:${r}`);
        });
      }
    }
  };
  walk(dir);
  return out.join("\n");
}

// ---------------------------------------------------------------- report
function main() {
  writeFixtures();
  const bigFile = path.join(src, "Erp.OrderService.cs");
  const logFile = path.join(fixtures, "build.log");
  const rows = [];

  // 1. Read a large file
  const fullText = fs.readFileSync(bigFile, "utf8");
  const fullLines = fullText.split(/\r?\n/);
  const ol = outline(bigFile, { maxPerFile: 60 });
  const targetIdx = fullLines.findIndex((l) => l.includes("CalculateTotals"));
  const sliced = fullLines.slice(targetIdx, targetIdx + 40).join("\n");
  const readAfter = `${ol.text}\n\n[Read limit=40 offset=${targetIdx + 1}]\n${sliced}`;
  rows.push({
    scenario: "Read one large C# file (whole file)",
    before: tok(fullText),
    after: tok(readAfter),
  });

  // 2. Repo-wide search
  const naive = naiveGrepFiles(src, "OrderStatus");
  const s = search({ pattern: "OrderStatus", path: src, maxMatches: 30 });
  rows.push({
    scenario: "Find one symbol across the repo (grep -rn)",
    before: tok(naive),
    after: tok(s.text),
  });

  // 3. Build log
  const logText = fs.readFileSync(logFile, "utf8");
  const compact = compactBuildLog(logText);
  rows.push({
    scenario: "Read a build log (dotnet build)",
    before: tok(logText, TEXT_CPT),
    after: tok(compact, TEXT_CPT),
  });

  // 3b. Real build on the local solution (opt-in: 10s)
  let realBuild = null;
  const realSln = process.env.TOKEN_DIET_REAL_SLN || "";
  if (realSln && fs.existsSync(realSln)) {
    const rb = runBuild({ project: realSln });
    const logPath = path.join(root, ".token-diet", "build.log");
    const full = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    realBuild = { before: tok(full, TEXT_CPT), after: tok(rb.text, TEXT_CPT), status: rb.status, logKB: (Buffer.byteLength(full) / 1024).toFixed(0) };
    rows.push({ scenario: `Real build ${path.basename(realSln)} (${rb.toolchain}, exit ${rb.status}, log ${realBuild.logKB} KB)`, before: realBuild.before, after: realBuild.after });
  }

  // 3c. Real ERP solution build through the MSBuild branch (opt-in: ~90s)
  let erpBuild = null;
  const erpSln = process.env.TOKEN_DIET_ERP_SLN || "";
  if (erpSln && fs.existsSync(erpSln)) {
    const rb = runBuild({ project: erpSln, timeoutMs: 240000 }, { build: { configuration: "Debug", platform: "Any CPU" } });
    const logPath = path.join(root, ".token-diet", "build.log");
    const full = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    erpBuild = {
      before: tok(full, TEXT_CPT),
      after: tok(rb.text, TEXT_CPT),
      status: rb.status,
      toolchain: rb.toolchain,
      logKB: (Buffer.byteLength(full) / 1024).toFixed(0),
    };
    rows.push({
      scenario: `Legacy build ${path.basename(erpSln)} (${rb.toolchain}, exit ${rb.status}, log ${erpBuild.logKB} KB)`,
      before: erpBuild.before,
      after: erpBuild.after,
    });
  }

  // 4. Guard behaviour
  const bigKB = (fs.statSync(bigFile).size / 1024).toFixed(0);
  const guardBig = runGuard({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: bigFile }, cwd: root, session_id: "bench" });
  const guardGrep = runGuard({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "grep -rn OrderStatus ." }, cwd: root, session_id: "bench" });
  const guardSafeGrep = runGuard({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "grep -rn -m 5 OrderStatus ." }, cwd: root, session_id: "bench" });
  const realSmall = path.join(root, "plugins", "token-diet", "scripts", "guard.mjs");
  const guardSmall = runGuard({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: realSmall }, cwd: root, session_id: "bench" });
  const loop = runLoopBreaker(
    { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "grep -rn x ." }, session_id: `bench-loop-${Date.now()}` },
    3
  );

  // 4b. Real-file spot check (largest .cs on this machine's test repo)
  let realCheck = null;
  const realRepo = process.env.TOKEN_DIET_REAL_REPO || "";
  if (realRepo && fs.existsSync(realRepo)) {
    const all = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith(".cs")) all.push({ f, size: fs.statSync(f).size });
      }
    };
    walk(realRepo);
    all.sort((a, b) => b.size - a.size);
    if (all[0]) {
      const txt = fs.readFileSync(all[0].f, "utf8");
      const o = outline(all[0].f, { maxPerFile: 60 });
      realCheck = { name: path.basename(all[0].f), kb: (all[0].size / 1024).toFixed(0), before: tok(txt), after: tok(o.text), blocked: !!runGuard({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: all[0].f }, cwd: root, session_id: "bench-real" }).out };
    }
  }

  // 5. Baseline report
  const diet = dietReport(root);

  // 6. Plugin permanent cost
  const skillDesc = fs.readFileSync(path.join(root, "plugins", "token-diet", "skills", "token-diet", "SKILL.md"), "utf8");
  const descLine = (skillDesc.match(/description:\s*([\s\S]*?)\n---/) || [, ""])[1];
  const agentDesc = (fs.readFileSync(path.join(root, "plugins", "token-diet", "agents", "scout.md"), "utf8").match(/description:\s*([\s\S]*?)\ncolor:/) || [, ""])[1];
  const toolSchemas = fs.readFileSync(path.join(root, "plugins", "token-diet", "scripts", "mcp-server.mjs"), "utf8");
  const toolDescChars = (toolSchemas.match(/description:\s*\n?\s*"[^"]+"/g) || []).join("").length;
  const permanent = tok(descLine + agentDesc) + Math.round(toolDescChars / 4) + 200;

  // ---------------------------------------------------------------- output
  const L = [];
  L.push("# Token-diet benchmark");
  L.push("");
  L.push(`Generated ${new Date().toISOString()} | fixtures are synthetic, sized like real-world enterprise files.`);
  L.push(`Token estimate: ${CODE_CPT} chars/token for code, ${TEXT_CPT} for logs/prose.`);
  L.push("");
  L.push("| Scenario | Before (tokens) | After (tokens) | Saved |");
  L.push("|---|---:|---:|---:|");
  for (const r of rows) {
    L.push(`| ${r.scenario} | ${r.before.toLocaleString()} | ${r.after.toLocaleString()} | ${pct(r.before, r.after)}% |`);
  }
  L.push("");
  L.push("## Guard behaviour");
  L.push("");
  L.push(`- Read ${bigKB} KB with no limit -> ${guardBig.out ? "BLOCKED" : "allowed (wrong)"} (${tok(guardBig.out)}-token reason)`);
  L.push(`- \`grep -rn\` unbounded -> ${guardGrep.out ? "BLOCKED" : "allowed (wrong)"}`);
  L.push(`- \`grep -rn -m 5\` (bounded) -> ${guardSafeGrep.out ? "BLOCKED (wrong)" : "allowed"}`);
  L.push(`- Read a small ${(fs.statSync(realSmall).size / 1024).toFixed(0)} KB file -> ${guardSmall.out ? "BLOCKED (wrong)" : "allowed"}`);
  L.push(`- Same command repeated 3 times -> ${loop.out ? "warning emitted" : "no warning (wrong)"}`);
  L.push("");
  if (realCheck) {
    L.push("");
    L.push("## Spot check on a real C# file");
    L.push("");
    L.push(`- ${realCheck.name} (${realCheck.kb} KB): full read ~${realCheck.before.toLocaleString()} tokens -> outline ~${realCheck.after.toLocaleString()} tokens (${pct(realCheck.before, realCheck.after)}% saved), guard ${realCheck.blocked ? "blocked" : "did not block (under the 128 KB threshold)"}.`);
  }
  L.push("");
  L.push("## Plugin permanent cost");
  L.push("");
  L.push(`- Skill description + agent description: ~${tok(descLine + agentDesc)} tokens`);
  L.push(`- 4 MCP tool schemas: ~${permanent - tok(descLine + agentDesc)} tokens`);
  L.push(`- Total: ~${permanent} tokens per session`);
  L.push("");
  L.push("## Baseline on the generating machine (example)");
  L.push("");
  L.push("```");
  L.push(diet.text);
  L.push("```");

  const report = L.join("\n");
  fs.writeFileSync(path.join(here, "RESULTS.md"), report);
  console.log(report);

  // Machine-readable summary for the final message.
  fs.writeFileSync(
    path.join(here, "results.json"),
    JSON.stringify(
      {
        rows,
        guard: {
          bigReadBlocked: !!guardBig.out,
          grepBlocked: !!guardGrep.out,
          boundedGrepBlocked: !!guardSafeGrep.out,
          smallReadBlocked: !!guardSmall.out,
          loopWarned: !!loop.out,
          guardReasonTokens: tok(guardBig.out),
        },
        permanentTokens: permanent,
        baseline: diet.stats,
        fixtureBytes: { bigFile: fs.statSync(bigFile).size, log: fs.statSync(logFile).size },
        realCheck,
      },
      null,
      2
    )
  );
}

main();
