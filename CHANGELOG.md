# Changelog

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
