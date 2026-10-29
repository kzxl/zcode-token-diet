# token-diet

Cuts the tokens a coding session spends on file dumps, unbounded greps and raw build logs. It never compresses history or rewrites tool output — ZCode hooks cannot do that. It makes the calls themselves cheap.

## Components

| Component | What it does |
|---|---|
| MCP tools `outline`, `search`, `build`, `diet` | Structure-only reads, capped search, compact build (MSBuild for legacy .NET Framework, dotnet for SDK-style), baseline context report |
| Agent `token-diet:scout` | Read-only subagent that returns `file:line` pointers instead of code |
| PreToolUse hook | Blocks unbounded `Read`, `cat` of large files, `grep -r` without a cap, `git log -p` without `-n` |
| PostToolUse hook | Warns once when the same tool call runs three times with identical input |
| Skill `token-diet` | The behaviour rules that make the model choose the cheap path |
| Commands `/build`, `/diet` | Manual entry points for the two most useful tools |

## Install

```text
/plugin marketplace add kzxl/zcode-token-diet
/plugin install token-diet@zcode-token-diet
```

Start a new task afterwards. Check **Settings → Plugin Management → token-diet** to confirm the tools, the agent and both hooks are runnable.

## Tuning

Edit `scripts/config.json`:

- `guard.read.maxBytes` (default 128 KB) — files above this are blocked on a full read.
- `guard.bash.denyRecursiveGrep` / `denyPatchLog` — set `false` to stop blocking those.
- `guard.bash.denyVerboseBuild` (default `false`) — set `true` to force the `build` tool instead of `dotnet build`.
- `loopBreaker.threshold` (default 3).
- `build.toolchain` — `auto` (default), `msbuild`, or `dotnet`. `auto` reads the project style: legacy .NET Framework uses MSBuild.exe, SDK-style uses `dotnet build`.
- `build.msbuildPath` — pin MSBuild.exe; empty means VS 2019 Build Tools first, then other Visual Studio installs, then `vswhere`.
- `build.configuration` / `build.platform` — defaults `Debug` / `Any CPU` for the MSBuild path. SDK builds ignore `platform` unless you pass it explicitly.

Changes take effect on the next tool call; no restart needed.

## Honest limits

- Savings are real only on large files, repo-wide searches and builds. A short chat session saves nothing.
- Tool schemas and the skill description cost roughly 600 tokens per session — the plugin pays for itself only if it prevents one medium-sized dump.
- Build compaction depends on the log. A real 59-project .NET Framework solution through MSBuild shrank 92.5% (27,258 → 2,048 tokens). A small failing build already run with `-v:q` shrank only 8%.
- The plugin cannot reduce the baseline cost of your other skills or MCP servers; use `/diet` and disable what you do not use.
