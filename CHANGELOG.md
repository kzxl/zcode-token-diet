# Changelog

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
