# token-diet

Cuts the tokens a coding session spends on file dumps, unbounded greps and raw build logs. It never compresses history or rewrites tool output — ZCode hooks cannot do that. It makes the calls themselves cheap.

## Components

| Component | What it does |
|---|---|
| MCP tools `outline`, `search`, `build`, `run`, `diet` | Structure-only reads, capped search, compact build (MSBuild for legacy .NET Framework, dotnet for SDK-style), build/test/lint for other ecosystems, baseline context report |
| Agent `token-diet:scout` | Read-only subagent that returns `file:line` pointers instead of code |
| PreToolUse hook | Blocks unbounded `Read`, `cat` of large files, `grep -r` without a cap, `git log -p` without `-n` |
| PostToolUse hook | Warns once when the same tool call runs three times with identical input |
| Skill `token-diet` | The behaviour rules that make the model choose the cheap path |
| Commands `/build`, `/diet`, `/saved` | Manual entry points: compact build, baseline report, savings ledger |
| Panel `ui://token-diet/panel.html` | Experimental side-panel dashboard of the ledger (no conversation tokens) |

Language coverage: the guard is language-agnostic; `search` scans any text file, decodes UTF-16 (BOM or sniffed) and honours `.gitignore`; `outline` has declaration heuristics for C-family, JS/TS, Python, Ruby, PHP, Go, Rust, Swift/Kotlin, Scala, Dart, shell, Lua, Perl and SQL; `build` is .NET only; `run` covers npm/pnpm/yarn, cargo, go, maven, gradle, make and pytest.

## Install

```text
/plugin marketplace add kzxl/zcode-token-diet
/plugin install token-diet@zcode-token-diet
```

Start a new task afterwards. Check **Settings → Plugin Management → token-diet** to confirm the tools, the agent and both hooks are runnable.

## Tuning

Edit `scripts/config.json`:

- `guard.read.maxBytes` (default 128 KB) — files above this are blocked on a full read.
- `guard.read.maxLimitLines` (default 400) — a larger explicit `limit` on a big file is treated as a full read.
- `guard.bash.denyRecursiveGrep` / `denyPatchLog` — set `false` to stop blocking those.
- `guard.bash.denyVerboseBuild` (default `false`) — set `true` to force the `build` tool instead of `dotnet build`.
- `loopBreaker.threshold` (default 3).
- `build.toolchain` — `auto` (default), `msbuild`, or `dotnet`. `auto` reads the project style: legacy .NET Framework uses MSBuild.exe, SDK-style uses `dotnet build`.
- `build.msbuildPath` — pin MSBuild.exe; empty means VS 2019 Build Tools first, then other Visual Studio installs, then `vswhere`.
- `build.configuration` / `build.platform` — defaults `Debug` / `Any CPU` for the MSBuild path. SDK builds ignore `platform` unless you pass it explicitly.
- `search.extensions` — empty scans every text file; a list like `[".cs",".ts"]` narrows it.
- `search.respectGitignore` (default `true`), `search.cacheTtlMs` (30000), `search.cacheMaxBytes` (32 MB) — ignore handling and caches for repeated searches.
- `run.timeoutMs` (default 600000) — timeout for the `run` tool.

Changes take effect on the next tool call; no restart needed.

The shipped `scripts/config.json` is replaced when the plugin updates. Put personal overrides in `~/.zcode/token-diet.config.json` (or the path in `TOKEN_DIET_CONFIG`); the files are deep-merged and user values win.

## Honest limits

- Savings are real only on large files, repo-wide searches and builds. A short chat session saves nothing.
- Tool schemas and the skill description cost roughly 780 tokens per session — the plugin pays for itself only if it prevents one medium-sized dump.
- Build compaction depends on the log. A real 59-project .NET Framework solution through MSBuild shrank 92.3% (27,258 → 2,104 tokens). A small failing build already run with `-v:q` shrank only 8%.
- The plugin cannot reduce the baseline cost of your other skills or MCP servers; use `/diet` and disable what you do not use.
- Every guarded tool call costs about 70 ms on Windows (process spawn). The ledger append itself is 0.35 ms.
- Search savings drop to ~36% on repositories with sparse matches, where context lines dominate.

## Ledger

Blocked calls and MCP tool calls are appended to `~/.zcode/token-diet/ledger.jsonl` (override with `TOKEN_DIET_DATA`). `/saved [days]` summarises it.

## Roadmap

See [ROADMAP.md](../../ROADMAP.md) in the repository for the measurement-driven next steps and the deliberately deferred items.
