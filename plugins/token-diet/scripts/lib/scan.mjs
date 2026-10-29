// Shared scanning helpers for the outline and search tools.
//
// Design notes:
// - search() is language-agnostic: it walks any text file under the target and
//   only skips known-binary extensions, NUL bytes, and oversized files.
// - outline() is heuristic, not a parser. It recognises declaration shapes for
//   C-family, JS/TS, Python, Ruby, PHP, Go, Rust, Swift/Kotlin, Scala, Dart,
//   shell, Lua, Perl and SQL. False negatives are expected for exotic syntax;
//   the caller can always fall back to Read with offset/limit.
// - Files are decoded from UTF-8 or UTF-16 (BOM), because legacy repositories
//   on Windows often store source as UTF-16.

import fs from "node:fs";
import path from "node:path";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".vs", "bin", "obj", "packages", "dist",
  "build", ".next", ".angular", "TestResults", "artifacts", ".idea",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tif", ".tiff",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".exe", ".dll", ".pdb", ".so", ".dylib", ".class", ".jar", ".war", ".ear",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac", ".ogg",
  ".sqlite", ".sqlite3", ".db", ".bin", ".dat", ".cache", ".nupkg", ".snupkg",
  ".vsix", ".obj", ".o", ".a", ".lib", ".pyc", ".pyo", ".wasm", ".pfx", ".snk",
]);

const CODE_EXT = new Set([
  ".cs", ".fs", ".vb", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".java", ".kt", ".kts", ".scala", ".groovy", ".py", ".rb", ".php",
  ".go", ".rs", ".swift", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh",
  ".m", ".mm", ".lua", ".pl", ".pm", ".r", ".jl", ".dart", ".ex", ".exs",
  ".erl", ".hrl", ".hs", ".clj", ".cljs", ".sh", ".bash", ".zsh", ".ps1", ".psm1",
  ".sql", ".vue", ".svelte", ".astro", ".zig", ".nim", ".sol",
  ".tf", ".hcl", ".proto", ".graphql", ".gql", ".xaml",
]);

// ---------------------------------------------------------------- decoding

export function decodeBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const copy = Buffer.from(buf.subarray(2));
    copy.swap16();
    return copy.toString("utf16le");
  }
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function readText(file) {
  return decodeBuffer(fs.readFileSync(file));
}

function hasBom(buf) {
  if (buf.length < 2) return false;
  return (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
}

// ---------------------------------------------------------------- walking

function walk(dir, out, limit = 20000) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= limit) return out;
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
  const allow = exts ? new Set([...exts].map((x) => x.toLowerCase())) : null;
  const ok = (f) => {
    const ext = path.extname(f).toLowerCase();
    if (BINARY_EXT.has(ext)) return false;
    return allow ? allow.has(ext) : true;
  };
  if (st.isFile()) return { files: ok(p) ? [p] : [] };
  return { files: walk(p, []).filter(ok) };
}

// ---------------------------------------------------------------- outline

const COMMENT_RE = /^\s*(?:\/\/|#(?!\[)|--|\*|\/\*|<!--)/;
const CONTROL_RE = /^\s*(?:if|for|while|switch|catch|return|new|using|lock|foreach|do|else|try|throw|await|yield|case|default|break|continue|goto|sizeof|typeof|nameof|assert|raise|pass|del|import|from|require|include|echo|print|puts)\b/;

const PATTERNS = [
  { kind: "ns", re: /^\s*(?:namespace|package|module|defmodule)\s+[A-Za-z_$@]/ },
  {
    kind: "type",
    re: /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|async|virtual|override|new|extern|unsafe|const|event|required|file|scoped|ref|pub|export|default|declare|inline|final|open|data|value|case|actor)\s+)*(?:class|interface|struct|enum|record|delegate|trait|impl|object|protocol|contract|extension|union|type)\b/,
  },
  {
    kind: "func",
    re: /^\s*(?:(?:export|default|pub(?:\([^)]*\))?|async|static|inline|unsafe|extern|public|private|protected|internal|local|constexpr|virtual|override)\s+)*(?:function|def|defp|defn|func|fun|fn|sub|proc|method|constructor|task)\b/,
  },
  { kind: "sql", re: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|PROCEDURE|PROC|FUNCTION|VIEW|INDEX|TRIGGER|TYPE|SCHEMA|DATABASE)\b/i },
  {
    kind: "func",
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|class\b)/,
  },
  { kind: "func", re: /^\s*(?:function\s+[A-Za-z_][\w-]*|[A-Za-z_][\w-]*\s*\(\)\s*\{)/ },
  {
    kind: "method",
    re: /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|async|virtual|override|extern|unsafe|new|synchronized|final|native|default)\s+)+[\w<>[\],.?*&:~]+\s+[A-Za-z_]\w*\s*(?:<[^>]*>)?\s*\(/,
  },
  {
    kind: "prop",
    re: /^\s*(?:(?:public|private|protected|internal|static|readonly|virtual|override|required|lateinit|const)\s+)+[\w<>[\],.?]+\s+[A-Za-z_]\w*\s*(?::\s*[\w<>[\],.?]+)?\s*(?:=|\{\s*(?:get|set|init))/,
  },
  // Return-type declarations with no modifiers: C, Go, Dart, old-style Java.
  {
    kind: "func",
    re: /^\s*(?:[\w:*&<>,[\].]+\s+)+[*&]?\s*[A-Za-z_]\w*\s*\([^;{}]*\)\s*(?:const)?\s*\{?\s*$/,
  },
];

function symbolKind(line) {
  if (!line.trim()) return null;
  if (COMMENT_RE.test(line)) return null;
  if (CONTROL_RE.test(line)) return null;
  for (const p of PATTERNS) if (p.re.test(line)) return p.kind;
  return null;
}

export function outline(target, opts = {}) {
  const maxFiles = opts.maxFiles ?? 10;
  const maxPerFile = opts.maxPerFile ?? 60;
  const { files, error } = collectFiles(target, CODE_EXT);
  if (error) return { text: error, stats: { files: 0, symbols: 0 } };
  if (files.length === 0) {
    return { text: `No source files under ${target}`, stats: { files: 0, symbols: 0 } };
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
      text = readText(f);
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

// ---------------------------------------------------------------- search

export function search(opts) {
  const pattern = String(opts.pattern ?? "");
  if (!pattern) return { text: "search: pattern is required", stats: { matches: 0 } };
  const maxMatches = Math.min(opts.maxMatches ?? 30, 200);
  const context = Math.min(opts.context ?? 2, 5);
  const maxBytes = opts.maxBytes ?? 8192;

  let re;
  const m = pattern.match(/^\/(.*)\/([gimsuy]*)$/);
  try {
    re = m ? new RegExp(m[1], m[2].replace("g", "")) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (e) {
    return { text: `search: invalid pattern (${e.message})`, stats: { matches: 0 } };
  }

  const target = opts.path || ".";
  const allow = Array.isArray(opts.extensions) && opts.extensions.length > 0 ? opts.extensions : null;
  const { files, error } = collectFiles(target, allow);
  if (error) return { text: error, stats: { matches: 0 } };

  const out = [];
  let matches = 0;
  let totalMatches = 0;
  const hitFiles = new Set();
  let bytes = 0;
  let capped = false;

  for (const f of files) {
    if (capped) break;
    let buf;
    try {
      const size = fs.statSync(f).size;
      if (size > 2_000_000) continue;
      buf = fs.readFileSync(f);
      // UTF-16 source has NUL bytes but is text; only skip BOM-less binaries.
      if (!hasBom(buf) && buf.includes(0)) continue;
    } catch {
      continue;
    }
    const text = decodeBuffer(buf);
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
