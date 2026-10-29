#!/usr/bin/env node
// Real-repository benchmark for search, outline and encoding handling.
//
// Usage:
//   TOKEN_DIET_BENCH_REPOS="/path/a;/path/b" node bench/repo-bench.mjs
//   TOKEN_DIET_BENCH_OUT=bench/repo-baseline.json node bench/repo-bench.mjs
//
// It compares the tool against a naive grep-equivalent (every matching line,
// no cap), and reports cold/warm search time, outline coverage and how many
// source files are unreadable because of encoding.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { search, outline } from "../plugins/token-diet/scripts/lib/scan.mjs";
import { collectFiles, clearCaches, decodeBuffer } from "../plugins/token-diet/scripts/lib/fsindex.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = new Set([
  ".cs", ".fs", ".vb", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".java", ".kt", ".kts", ".scala", ".groovy", ".py", ".rb", ".php",
  ".go", ".rs", ".swift", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh",
  ".m", ".mm", ".lua", ".pl", ".pm", ".r", ".jl", ".dart", ".ex", ".exs",
  ".erl", ".hrl", ".hs", ".clj", ".cljs", ".sh", ".bash", ".zsh", ".ps1", ".psm1",
  ".sql", ".vue", ".svelte", ".astro", ".zig", ".nim", ".sol",
]);

const PATTERN = {
  ".cs": "public ", ".fs": "let ", ".vb": "Public ",
  ".ts": "function ", ".tsx": "function ", ".js": "function ", ".jsx": "function ",
  ".mjs": "function ", ".cjs": "function ",
  ".java": "public ", ".kt": "fun ", ".kts": "fun ", ".scala": "def ",
  ".py": "def ", ".rb": "def ", ".php": "function ",
  ".go": "func ", ".rs": "fn ", ".swift": "func ",
  ".c": "return ", ".h": "return ", ".cpp": "return ", ".hpp": "return ",
  ".lua": "function ", ".pl": "sub ",
  ".sql": "CREATE ", ".sh": "function ", ".ps1": "function ",
};

const TOK = 3.6;

function pct(before, after) {
  return before === 0 ? "0" : (((before - after) / before) * 100).toFixed(1);
}

function dominantExt(files) {
  const counts = new Map();
  for (const f of files) {
    const e = path.extname(f).toLowerCase();
    if (CODE.has(e)) counts.set(e, (counts.get(e) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
}

function encodingOf(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "utf16le-bom";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "utf16be-bom";
  if (!buf.includes(0)) return "utf8";
  const n = Math.min(buf.length, 4096);
  let ez = 0, oz = 0;
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) (i % 2 === 0 ? ez++ : oz++);
  }
  if (oz > n / 8 && ez < n / 40) return "utf16le-nobom";
  if (ez > n / 8 && oz < n / 40) return "utf16be-nobom";
  return "binary";
}

function naiveScan(files, pattern) {
  let matches = 0;
  let bytes = 0;
  for (const f of files) {
    let st;
    try {
      st = fs.statSync(f);
      if (st.size > 2_000_000) continue;
    } catch {
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(f);
    } catch {
      continue;
    }
    const text = decodeBuffer(buf);
    if (text === null) continue;
    const rel = path.relative(process.cwd(), f);
    const rows = text.split(/\r?\n/);
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].toLowerCase().includes(pattern.toLowerCase())) continue;
      matches++;
      bytes += rel.length + String(i + 1).length + rows[i].length + 3;
      if (matches >= 500_000) return { matches, bytes, capped: true };
    }
  }
  return { matches, bytes, capped: false };
}

function benchOne(repo) {
  const started = Date.now();
  const { files } = collectFiles(repo, null, { respectGitignore: true, cacheTtlMs: 0 });
  const codeFiles = files.filter((f) => CODE.has(path.extname(f).toLowerCase()));
  const [ext, count] = dominantExt(codeFiles);
  const pattern = PATTERN[ext] || "return";

  // Encoding survey over source files only.
  const enc = new Map();
  for (const f of codeFiles) {
    try {
      const size = fs.statSync(f).size;
      if (size > 2_000_000) {
        enc.set("too-large", (enc.get("too-large") || 0) + 1);
        continue;
      }
      const buf = fs.readFileSync(f);
      const kind = encodingOf(buf);
      enc.set(kind, (enc.get(kind) || 0) + 1);
    } catch {}
  }

  clearCaches();
  const t0 = Date.now();
  const naive = naiveScan(files, pattern);
  const naiveMs = Date.now() - t0;

  clearCaches();
  const c0 = Date.now();
  const cold = search({ pattern, path: repo, maxMatches: 30, context: 2, respectGitignore: true, cacheTtlMs: 0 });
  const coldMs = Date.now() - c0;

  const w0 = Date.now();
  const warm = search({ pattern, path: repo, maxMatches: 30, context: 2, respectGitignore: true, cacheTtlMs: 30000 });
  const warmMs = Date.now() - w0;

  clearCaches();
  const o0 = Date.now();
  const out = outline(repo, { maxFiles: 30, maxPerFile: 60, respectGitignore: true, cacheTtlMs: 0 });
  const outlineMs = Date.now() - o0;

  const results = {
    repo: path.basename(repo),
    path: repo,
    files: files.length,
    codeFiles: codeFiles.length,
    language: ext || "?",
    pattern,
    encoding: Object.fromEntries([...enc.entries()].sort((a, b) => b[1] - a[1])),
    search: {
      matches: naive.matches,
      matchesCapped: naive.capped,
      naiveTokens: Math.round(naive.bytes / TOK),
      toolTokens: Math.round(cold.text.length / TOK),
      reduction: pct(naive.bytes, cold.text.length),
      naiveMs,
      coldMs,
      warmMs,
      speedup: warmMs > 0 ? (coldMs / warmMs).toFixed(1) : "-",
      header: cold.text.split("\n")[0],
    },
    outline: {
      symbols: out.stats.symbols,
      tokens: Math.round(out.text.length / TOK),
      ms: outlineMs,
      symbolsPerFile: codeFiles.length ? (out.stats.symbols / Math.min(codeFiles.length, 30)).toFixed(1) : "0",
    },
    totalMs: Date.now() - started,
  };
  clearCaches();
  return results;
}

const repos = (process.env.TOKEN_DIET_BENCH_REPOS || "")
  .split(path.delimiter)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((p) => fs.existsSync(p));

if (repos.length === 0) {
  console.error("Set TOKEN_DIET_BENCH_REPOS to one or more repository paths (path.delimiter-separated).");
  process.exit(2);
}

const rows = [];
for (const repo of repos) {
  process.stdout.write(`scanning ${path.basename(repo)} ... `);
  try {
    const r = benchOne(repo);
    rows.push(r);
    console.log(`done (${r.totalMs} ms)`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}

const lines = [];
lines.push("# Real-repository benchmark");
lines.push("");
lines.push(`Generated ${new Date().toISOString()} | ${rows.length} repositories | ${TOK} chars/token`);
lines.push("");
lines.push("| Repo | Lang | Code files | Naive (tok) | Tool (tok) | Saved | Cold ms | Warm ms | Outline sym | Encodings |");
lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
for (const r of rows) {
  const enc = Object.entries(r.encoding)
    .filter(([k]) => k !== "utf8")
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  lines.push(
    `| ${r.repo} | ${r.language} | ${r.codeFiles} | ${r.search.naiveTokens.toLocaleString()} | ${r.search.toolTokens.toLocaleString()} | ${r.search.reduction}% | ${r.search.coldMs} | ${r.search.warmMs} | ${r.outline.symbols} | ${enc || "-"} |`
  );
}
lines.push("");
lines.push("Notes:");
lines.push("- Naive = every matching line from every text file, the equivalent of `grep -rn` with no cap.");
lines.push("- Tool = the search tool with 30 matches and 2 context lines, cold cache.");
lines.push("- Warm = a second identical search with the 30s file-list cache.");
lines.push("- Outline = up to 30 largest source files, 60 symbols per file.");

const report = lines.join("\n");
console.log("\n" + report);
const outFile = process.env.TOKEN_DIET_BENCH_OUT;
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ rows, report }, null, 2));
  console.log(`\nwrote ${outFile}`);
}
