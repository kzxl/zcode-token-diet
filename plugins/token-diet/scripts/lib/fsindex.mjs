// Filesystem layer shared by search and outline.
//
// - .gitignore-aware walking (pragmatic subset: negation, anchoring, dir-only,
//   *, **, ?), so generated output and node_modules-like folders stay out.
// - A short-TTL file-list cache and an LRU text cache, because the MCP server is
//   long-lived and repeated searches would otherwise re-read the whole repo.
// - UTF-8 / UTF-16 (BOM or sniffed) decoding; unreadable binaries return null.

import fs from "node:fs";
import path from "node:path";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".vs", "bin", "obj", "packages", "dist",
  "build", ".next", ".angular", "TestResults", "artifacts", ".idea",
]);

export const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tif", ".tiff",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".exe", ".dll", ".pdb", ".so", ".dylib", ".class", ".jar", ".war", ".ear",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac", ".ogg",
  ".sqlite", ".sqlite3", ".db", ".bin", ".dat", ".cache", ".nupkg", ".snupkg",
  ".vsix", ".obj", ".o", ".a", ".lib", ".pyc", ".pyo", ".wasm", ".pfx", ".snk",
]);

const DEFAULT_TTL_MS = 30000;
const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_LIST_ENTRIES = 64;

// ---------------------------------------------------------------- decoding

function sniffUtf16(buf) {
  const n = Math.min(buf.length, 4096);
  let evenZero = 0;
  let oddZero = 0;
  let evenTotal = 0;
  let oddTotal = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      evenTotal++;
      if (buf[i] === 0) evenZero++;
    } else {
      oddTotal++;
      if (buf[i] === 0) oddZero++;
    }
  }
  if (!evenTotal || !oddTotal) return null;
  const evenRatio = evenZero / evenTotal;
  const oddRatio = oddZero / oddTotal;
  // ASCII-heavy UTF-16LE puts the NULs on odd offsets; BE puts them on even.
  if (oddRatio > 0.3 && evenRatio < 0.05) return "le";
  if (evenRatio > 0.3 && oddRatio < 0.05) return "be";
  return null;
}

// Returns text, or null when the buffer looks binary.
export function decodeBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const copy = Buffer.from(buf.subarray(2));
    copy.swap16();
    return copy.toString("utf16le");
  }
  if (buf.includes(0)) {
    const enc = sniffUtf16(buf);
    if (enc === "le") return buf.toString("utf16le");
    if (enc === "be") {
      const copy = Buffer.from(buf);
      copy.swap16();
      return copy.toString("utf16le");
    }
    return null;
  }
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

// ---------------------------------------------------------------- gitignore

function globToRegExp(glob) {
  let pattern = glob;
  let anchored = false;
  if (pattern.startsWith("/")) {
    anchored = true;
    pattern = pattern.slice(1);
  }
  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }
  const hasSlash = pattern.includes("/");
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const prefix = anchored || hasSlash ? "^" : "(?:^|/)";
  return new RegExp(prefix + out + (dirOnly ? "(?:/.*)?$" : "$"));
}

export function parseGitignore(content, baseDir) {
  const rules = [];
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);
    try {
      rules.push({ baseDir, negate, re: globToRegExp(line) });
    } catch {}
  }
  return rules;
}

function loadRules(dir) {
  const file = path.join(dir, ".gitignore");
  try {
    return parseGitignore(fs.readFileSync(file, "utf8"), dir);
  } catch {
    return [];
  }
}

export function isIgnored(fullPath, rules) {
  let ignored = false;
  for (const rule of rules) {
    const rel = path.relative(rule.baseDir, fullPath);
    if (!rel || rel.startsWith("..")) continue;
    if (rule.re.test(rel.split(path.sep).join("/"))) ignored = !rule.negate;
  }
  return ignored;
}

// ---------------------------------------------------------------- caching

const listCache = new Map();
const textCache = new Map();
let textBytes = 0;

export function clearCaches() {
  listCache.clear();
  textCache.clear();
  textBytes = 0;
}

export function readTextCached(file, stat, maxBytes = DEFAULT_CACHE_BYTES) {
  const key = `${file}|${stat.mtimeMs}|${stat.size}`;
  const hit = textCache.get(key);
  if (hit !== undefined) {
    textCache.delete(key);
    textCache.set(key, hit);
    return hit;
  }
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  const text = decodeBuffer(buf);
  if (text === null) return null;
  const cost = text.length * 2 + 64;
  if (cost <= maxBytes) {
    textCache.set(key, text);
    textBytes += cost;
    for (const [k, v] of textCache) {
      if (textBytes <= maxBytes) break;
      textCache.delete(k);
      textBytes -= v.length * 2 + 64;
    }
  }
  return text;
}

// ---------------------------------------------------------------- walking

function walk(dir, rules, out, exts, opts) {
  const local = opts.respectGitignore ? [...rules, ...loadRules(dir)] : rules;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= opts.limit) return out;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (opts.respectGitignore && isIgnored(full, local)) continue;
      walk(full, local, out, exts, opts);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      if (exts && !exts.has(ext)) continue;
      if (opts.respectGitignore && isIgnored(full, local)) continue;
      out.push(full);
    }
  }
  return out;
}

export function collectFiles(target, exts, opts = {}) {
  const root = path.resolve(target);
  let st;
  try {
    st = fs.statSync(root);
  } catch {
    return { files: [], error: `Path not found: ${target}` };
  }
  const allow = exts ? new Set([...exts].map((x) => x.toLowerCase())) : null;
  const respect = opts.respectGitignore !== false;
  if (st.isFile()) {
    const ext = path.extname(root).toLowerCase();
    if (BINARY_EXT.has(ext) || (allow && !allow.has(ext))) return { files: [] };
    return { files: [root] };
  }

  const ttl = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
  const key = `${root}|${respect}|${allow ? [...allow].sort().join(",") : "*"}`;
  const now = Date.now();
  const cached = listCache.get(key);
  if (cached && now - cached.at <= ttl) return { files: cached.files };

  const files = walk(root, [], [], allow, { respectGitignore: respect, limit: opts.limit ?? 20000 });
  listCache.set(key, { at: now, files });
  if (listCache.size > MAX_LIST_ENTRIES) listCache.delete(listCache.keys().next().value);
  return { files };
}
