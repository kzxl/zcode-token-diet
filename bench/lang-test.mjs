#!/usr/bin/env node
// Language coverage test: outline/search must work beyond C#, decode UTF-16,
// and skip binaries and dependency folders.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { outline, search } from "../plugins/token-diet/scripts/lib/scan.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "token-diet-lang-"));
const write = (name, text, encoding = "utf8") => {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, encoding);
  return p;
};

write("a.py", "class Foo:\n    def bar(self):\n        return 1\n");
write("b.go", "package main\n\ntype S struct {\n\tX int\n}\n\nfunc (s *S) Run() {\n}\n\nfunc main() {\n}\n");
write("c.rs", "pub struct X;\n\nimpl X {\n    pub fn go(&self) -> u8 { 1 }\n}\n");
write("d.ts", "export class A {\n}\n\nexport function f() {\n}\n\nexport const g = () => 1;\n");
write("e.sql", "CREATE PROCEDURE dbo.Sync\nAS\nBEGIN\nEND\n");
write("f.sh", "function deploy() {\n  echo hi\n}\n");
write("g.rb", "def hello\n  1\nend\n");
write("h.cs", "namespace N {\n  public class OrderService {\n    public string Get(int id) { return \"x\"; }\n  }\n}\n");

// UTF-16LE with BOM: a legacy repository is likely to contain this.
const utf16 = write("i-utf16.cs", "", "utf8");
fs.writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("class Utf16Marker { string NeedleSymbol; }\n", "utf16le")]));

// Binary file and dependency folder that must not be searched.
fs.writeFileSync(path.join(tmp, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2, 3, 0]), Buffer.from("NeedleSymbol")]));
write("node_modules/hidden.js", "const NeedleSymbol = 1;\n");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("outline: declarations per language");
const o = outline(tmp, { maxFiles: 20, maxPerFile: 30 }).text;
for (const [lang, needle] of [
  ["C# class", "public class OrderService"],
  ["C# method", "public string Get"],
  ["Python class", "class Foo"],
  ["Python def", "def bar"],
  ["Go type", "type S struct"],
  ["Go method", "func (s *S) Run"],
  ["Go func", "func main"],
  ["Rust struct", "pub struct X"],
  ["Rust fn", "pub fn go"],
  ["TS class", "export class A"],
  ["TS function", "export function f"],
  ["TS arrow", "export const g"],
  ["SQL DDL", "CREATE PROCEDURE"],
  ["Shell function", "function deploy"],
  ["Ruby def", "def hello"],
  ["UTF-16 class", "class Utf16Marker"],
]) {
  check(lang, o.includes(needle), needle);
}

console.log("search: language and encoding coverage");
const s = search({ pattern: "NeedleSymbol", path: tmp, maxMatches: 20 }).text;
check("finds UTF-16 source", /i-utf16\.cs:1:/.test(s), s.split("\n")[0]);
check("skips binary file", !/blob\.bin/.test(s));
check("skips node_modules", !/node_modules/.test(s));

const pyOnly = search({ pattern: "def ", path: tmp, extensions: [".py"] }).text;
check("extension filter applies", /a\.py:2:/.test(pyOnly) && !/b\.go/.test(pyOnly), pyOnly.split("\n")[0]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall language tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
