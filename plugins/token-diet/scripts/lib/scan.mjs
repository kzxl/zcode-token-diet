// Shared scanning helpers for the outline and search tools.

import fs from "node:fs";
import path from "node:path";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".vs", "bin", "obj", "packages", "dist",
  "build", ".next", ".angular", "TestResults", "artifacts", ".idea",
]);

const CODE_EXT = new Set([
  ".cs", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".java", ".kt", ".py",
  ".go", ".rb", ".php", ".cpp", ".h", ".hpp", ".c", ".xaml",
]);

const TEXT_EXT = new Set([
  ...CODE_EXT, ".csproj", ".sln", ".json", ".md", ".config", ".sql",
  ".ps1", ".sh", ".yml", ".yaml", ".xml", ".props", ".targets", ".txt",
]);

const TYPE_RE = /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|async|virtual|override|new|extern|unsafe|const|event|required|file|scoped|ref)\s+)*(?:class|interface|struct|enum|record|delegate)\s+[A-Za-z_]/;
const METHOD_RE = /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|async|virtual|override|extern|unsafe|new)\s+)+[\w<>[\],.?]+\s+[A-Za-z_]\w*\s*[<(]/;
const PROP_RE = /^\s*(?:(?:public|private|protected|internal|static|readonly|virtual|override|required)\s+)+[\w<>[\],.?]+\s+[A-Za-z_]\w*\s*\{\s*(?:get|set|init)/;
const NAMESPACE_RE = /^\s*namespace\s+[A-Za-z_]/;
const GENERIC_DEF_RE = /^\s*(?:export\s+)?(?:async\s+)?(?:function|def|class|interface|struct|enum|record|type|const|let|var)\s+[A-Za-z_$]/;

function walk(dir, out, limit = 4000) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= limit) return out;
    if (e.name.startsWith(".") && e.name !== ".") {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out, limit);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function collectFiles(target, exts) {
  const p = path.resolve(target);
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { files: [], error: `Path not found: ${target}` };
  }
  if (st.isFile()) return { files: [p] };
  const all = walk(p, []);
  return { files: all.filter((f) => exts.has(path.extname(f).toLowerCase())) };
}

function symbolKind(line) {
  if (NAMESPACE_RE.test(line)) return "ns";
  if (TYPE_RE.test(line)) return "type";
  if (PROP_RE.test(line)) return "prop";
  if (METHOD_RE.test(line)) return "method";
  if (GENERIC_DEF_RE.test(line)) return "def";
  return null;
}

export function outline(target, opts = {}) {
  const maxFiles = opts.maxFiles ?? 10;
  const maxPerFile = opts.maxPerFile ?? 60;
  const { files, error } = collectFiles(target, CODE_EXT);
  if (error) return { text: error, stats: { files: 0, symbols: 0 } };
  if (files.length === 0) {
    return { text: `No source files (.cs/.ts/.js/...) under ${target}`, stats: { files: 0, symbols: 0 } };
  }

  const sized = files
    .map((f) => {
      try {
        return { f, size: fs.statSync(f).size };
      } catch {
        return { f, size: 0 };
      }
    })
    .sort((a, b) => b.size - a.size);

  const selected = sized.slice(0, maxFiles);
  const lines = [];
  let symbols = 0;

  for (const { f } of selected) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const rows = text.split(/\r?\n/);
    const rel = path.relative(process.cwd(), f) || f;
    const found = [];
    for (let i = 0; i < rows.length; i++) {
      if (symbolKind(rows[i])) found.push(`${String(i + 1).padStart(5)}  ${rows[i].trim().slice(0, 160)}`);
      if (found.length > maxPerFile) break;
    }
    if (found.length === 0) continue;
    symbols += found.length;
    lines.push(`${rel} (${rows.length} lines)`);
    lines.push(...found.slice(0, maxPerFile));
    if (found.length > maxPerFile) lines.push(`      ... more symbols omitted`);
    lines.push("");
  }

  const body = lines.join("\n").trimEnd();
  const skipped = sized.length - selected.length;
  const header =
    `Outline: ${selected.length} file(s), ${symbols} symbols` +
    (skipped > 0 ? `, ${skipped} smaller file(s) not shown (raise maxFiles)` : "");
  return { text: `${header}\n\n${body}`, stats: { files: selected.length, symbols } };
}

export function search(opts) {
  const pattern = String(opts.pattern ?? "");
  if (!pattern) return { text: "search: pattern is required", stats: { matches: 0 } };
  const maxMatches = Math.min(opts.maxMatches ?? 30, 200);
  const context = Math.min(opts.context ?? 2, 5);
  const maxBytes = opts.maxBytes ?? 8192;

  let re;
  let literal = pattern;
  const m = pattern.match(/^\/(.*)\/([gimsuy]*)$/);
  try {
    if (m) {
      re = new RegExp(m[1], m[2].replace("g", ""));
      literal = "";
    } else {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      literal = pattern.toLowerCase();
    }
  } catch (e) {
    return { text: `search: invalid pattern (${e.message})`, stats: { matches: 0 } };
  }

  const target = opts.path || ".";
  const { files, error } = collectFiles(target, TEXT_EXT);
  if (error) return { text: error, stats: { matches: 0 } };

  const out = [];
  let matches = 0;
  let totalMatches = 0;
  const hitFiles = new Set();
  let bytes = 0;
  let capped = false;

  for (const f of files) {
    if (capped) break;
    let text;
    try {
      const size = fs.statSync(f).size;
      if (size > 2_000_000) continue;
      text = fs.readFileSync(f, "utf8");
      if (text.includes("\u0000")) continue;
    } catch {
      continue;
    }
    const rows = text.split(/\r?\n/);
    const rel = path.relative(process.cwd(), f) || f;
    for (let i = 0; i < rows.length; i++) {
      const hit = re.test(rows[i]);
      re.lastIndex = 0;
      if (!hit) continue;
      totalMatches++;
      if (matches >= maxMatches) continue;
      matches++;
      hitFiles.add(rel);
      const from = Math.max(0, i - context);
      const to = Math.min(rows.length - 1, i + context);
      for (let j = from; j <= to; j++) {
        const prefix = j === i ? `${rel}:${j + 1}: ` : `  ${j + 1}| `;
        const line = prefix + rows[j].slice(0, 240);
        bytes += line.length + 1;
        out.push(line);
      }
      out.push("");
      if (bytes >= maxBytes) {
        capped = true;
        matches = maxMatches;
        break;
      }
    }
  }

  const header =
    `Found ${totalMatches} match(es) in ${hitFiles.size} file(s)` +
    (totalMatches > matches ? `, showing ${matches} (capped; narrow the pattern or set maxMatches)` : "");
  if (out.length === 0) return { text: `${header}\nNo matching lines.`, stats: { matches: 0 } };
  return { text: `${header}\n\n${out.join("\n").trimEnd()}`, stats: { matches } };
}
