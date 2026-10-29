#!/usr/bin/env node
// Filesystem layer tests: .gitignore handling, UTF-16 without BOM, caching.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { search, outline } from "../plugins/token-diet/scripts/lib/scan.mjs";
import { clearCaches } from "../plugins/token-diet/scripts/lib/fsindex.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "token-diet-fs-"));
const write = (name, text, encoding = "utf8") => {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, encoding);
  return p;
};

write(".gitignore", "generated/\n*.log\n!keep.log\n");
write("src/a.ts", "const NeedleToken = 1;\n");
write("src/new.ts", "const NotYet = 0;\n");
write("generated/g.ts", "const NeedleToken = 2;\n");
write("x.log", "NeedleToken in a log\n");
write("keep.log", "NeedleToken kept\n");
write("node_modules/m.js", "const NeedleToken = 3;\n");
// UTF-16LE without BOM: ASCII-heavy, so NULs land on odd offsets.
fs.writeFileSync(path.join(tmp, "u16.cs"), Buffer.from("class U16 { string NeedleToken; }\n", "utf16le"));
// Binary with the needle and mixed NULs must be skipped.
fs.writeFileSync(path.join(tmp, "blob.dat"), Buffer.concat([Buffer.from([0, 1, 0, 2, 0]), Buffer.from("NeedleToken")]));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("gitignore-aware search");
clearCaches();
const s1 = search({ pattern: "NeedleToken", path: tmp, maxMatches: 50, cacheTtlMs: 0 }).text;
check("keeps normal source", /src[\\/]a\.ts:1:/.test(s1), s1.split("\n")[0]);
check("keeps negated file", /keep\.log:1:/.test(s1));
check("drops ignored directory", !/generated[\\/]g\.ts/.test(s1));
check("drops ignored extension", !/(^|\W)x\.log:1:/.test(s1));
check("drops node_modules", !/node_modules/.test(s1));
check("drops binary", !/blob\.dat/.test(s1));
check("decodes UTF-16 without BOM", /u16\.cs:1:/.test(s1));

clearCaches();
const s2 = search({ pattern: "NeedleToken", path: tmp, maxMatches: 50, respectGitignore: false, cacheTtlMs: 0 }).text;
check("respectGitignore=false includes generated", /generated[\\/]g\.ts:1:/.test(s2));
check("respectGitignore=false includes *.log", /(^|\W)x\.log:1:/.test(s2));

console.log("search header");
write("src/many.ts", Array.from({ length: 300 }, (_, i) => `const NeedleToken = ${i};`).join("\n") + "\n");
clearCaches();
const stopped = search({ pattern: "NeedleToken", path: tmp, maxMatches: 200, maxBytes: 600, cacheTtlMs: 0 }).text;
check("byte-cap stop reports a lower bound", /Found at least \d+ match/.test(stopped), stopped.split("\n")[0]);
const capped = search({ pattern: "NeedleToken", path: tmp, maxMatches: 3, maxBytes: 65536, cacheTtlMs: 0 }).text;
check("match-cap keeps an exact count", /Found \d+ match\(es\) in/.test(capped), capped.split("\n")[0]);

console.log("cache");clearCaches();
const first = search({ pattern: "NotYet", path: tmp, cacheTtlMs: 60000 }).text;
check("first search sees existing file", /src[\\/]new\.ts:1:/.test(first));
write("src/later.ts", "const NotYet = 1;\n");
const cached = search({ pattern: "NotYet", path: tmp, cacheTtlMs: 60000 }).text;
check("fresh cache may miss a new file (expected)", !/later\.ts/.test(cached));
const bypass = search({ pattern: "NotYet", path: tmp, cacheTtlMs: 0 }).text;
check("cacheTtlMs=0 sees the new file", /later\.ts:1:/.test(bypass));

console.log("outline");
clearCaches();
write("pkg/main.go", "package main\n\ntype Server struct {\n}\n\nfunc (s *Server) Run() {\n}\n");
const o = outline(tmp, { maxFiles: 20, cacheTtlMs: 0 }).text;
check("outline honours gitignore", !/generated[\\/]g\.ts/.test(o));
check("outline decodes UTF-16", /class U16/.test(o));

fs.rmSync(tmp, { recursive: true, force: true });
clearCaches();
console.log(failures === 0 ? "\nall fs tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
