# Changelog

## 0.6.0

- Panel: Reload button and auto-refresh interval (off / 3s / 5s / 10s / 30s,
  remembered in localStorage). Refresh calls `diet({scope:"panel"})` through the
  MCP Apps bridge and re-renders in place.
- `diet scope=panel` returns structured metrics for the panel.
- Panel refreshes are not written to the ledger, so watching the dashboard does
  not inflate its own numbers.

## 0.5.4

- The panel now speaks the MCP Apps handshake: it sends `ui/initialize` to the
  host, waits for the response, then sends `ui/notifications/initialized` and a
  size notification. Without it the host timed out with
  "plugin-ui: ui/initialize handshake timed out".

## 0.5.3

- Panel redesign: headline tokens kept out of context with a per-file average;
  compact blocks/files/tool calls/tool output; labelled pattern denials instead
  of a meaningless 0; update time; the per-tool list removed as noise.
- Guard ignores heredoc bodies and quoted strings when matching shell patterns,
  so a commit message mentioning a patch log command is not blocked.

## 0.5.2

- The panel asks for inline display (`_meta.ui.showInline` and
  `preferredDisplayMode: "inline"`), so `/saved` renders it in the conversation
  instead of requiring the side panel to be opened manually.

## 0.5.1

- `diet({scope:"savings"})` returns MCP Apps metadata
  (`_meta["ui/resourceUri"]`), so the host can render the panel when `/saved`
  runs. The manifest surface alone did not surface in the side panel.

## 0.5.0

- Experimental MCP App panel (`ui://token-diet/panel.html`) declared through
  `ui.surfaces`: blocked calls, tokens kept out, tool calls and tool output for
  the last 24 hours. No conversation tokens; reopening refreshes it.
- The MCP server now advertises `resources` and implements `resources/list` and
  `resources/read`.

## 0.4.0

- Local savings ledger: every blocked call and MCP tool call is appended to
  `~/.zcode/token-diet/ledger.jsonl` (`TOKEN_DIET_DATA` overrides the directory),
  and `diet({scope:"savings"})` / `/saved` summarises it.
- Guard checks every path argument of `cat`/`type`, not only the last one.
- Minified files (`.min.js`, or >20 KB with almost no newlines) get a quarter of
  the read budget, so a 49 KB bundle is blocked like a large source file.
- Per-repository config at `<repo>/.token-diet.json`, merged over the user file.
- Search header reports "at least N matches" when the 8 KB output cap stopped the
  scan, instead of implying the exact count.
- New benchmarks: `repo-bench.mjs` (nine real repositories across C, C#, Go,
  PHP, TypeScript, Rust, Kotlin, Python) and `hook-bench.mjs` (hook latency).

## 0.3.0

- `search` honours `.gitignore` and caches the file list and decoded text
  between calls (`search.respectGitignore`, `search.cacheTtlMs`,
  `search.cacheMaxBytes`).
- UTF-16 without a BOM is detected from NUL-byte parity instead of being
  treated as binary.
- New `run` tool: build/test/lint for npm/pnpm/yarn, cargo, go, maven, gradle,
  make and pytest, with per-ecosystem error extraction and `dryRun`.
- Tests: gitignore rules, UTF-16 without BOM, cache behaviour, ecosystem
  detection, command planning and log compaction (tsc, rustc, go, pytest, npm,
  maven, gradle).

## 0.2.1

- `outline` also recognises unmodified class and object methods in JS/TS
  (`run() {`, `async load(): Promise<void> {`), which 0.2.0 missed.

## 0.2.0

- Guard checks the value of `limit`, not just its presence: `limit=99999` on a
  large file is blocked like a full read (`guard.read.maxLimitLines`, default 400).
- Guard also blocks `rg` without a cap, `findstr /s` without `/m`, and
  PowerShell `[IO.File]::ReadAllText` on large files.
- Build parser no longer drops code-less errors (`error : ...`), deduplicates
  identical error lines with a count, and shows the log tail when a failed build
  produced no recognizable error line. Spawn failures are reported instead of
  producing a misleading empty summary.
- `search` is language-agnostic: no extension allowlist by default, binary
  files and NUL bytes are skipped, and an optional `search.extensions` filter
  can be set. UTF-16BE/LE sources are decoded instead of mangled.
- `outline` recognises declarations in C-family, JS/TS, Python, Ruby, PHP, Go,
  Rust, Swift/Kotlin, Scala, Dart, shell, Lua, Perl and SQL.
- User-level config override at `~/.zcode/token-diet.config.json` (or
  `$TOKEN_DIET_CONFIG`) survives plugin updates.
- New regression tests: `npm test` covers guard branches, config override,
  loop breaker, multi-language outline and UTF-16 search.

## 0.1.2

- `build` tool picks its toolchain from project style: legacy .NET Framework
  (`ToolsVersion`, `TargetFrameworkVersion`, msbuild 2003 xmlns) runs MSBuild.exe,
  SDK-style projects run `dotnet build`.
- MSBuild discovery: `build.msbuildPath`, then VS 2019 Build Tools, then Visual
  Studio 2022/18 installs, then `vswhere`.
- New `build` parameters: `toolchain`, `configuration`, `platform`, `timeoutMs`.
  The configured platform applies to the MSBuild path only.
- Guard message for oversized reads now includes a Bash fallback for agents that
  have no MCP tools.
- Agent references use the namespaced form `token-diet:scout`.
- MCP server reports its version from the manifest instead of a hardcoded string.

## 0.1.1

- Documentation fixes: namespaced agent name, branch-aware build rules.

## 0.1.0

- First working version: MCP tools `outline`, `search`, `build`, `diet`; `scout`
  agent; PreToolUse guard and PostToolUse loop breaker; `token-diet` skill;
  `/build` and `/diet` commands; local dev marketplace.
