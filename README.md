# ZCode Zero Token

A ZCode plugin that stops a coding session from flooding its own context with whole-file reads, unbounded `grep -r`, and raw build logs — without compressing history or rewriting tool output.

[Tiếng Việt](README.vi.md) · MIT · Node 18+

```text
before   Read OrderService.cs (136 KB)          ~38,700 tokens
after    outline OrderService.cs                 ~1,470 tokens
         Read offset=412 limit=40
```

## Why

A ZCode session pays for every character a tool returns, and pays again on every later turn because the transcript keeps it. The expensive calls are predictable:

- opening a 3,000-line file to find one method;
- a recursive grep that returns 9,000 matches;
- a build log with 1,800 warning lines, of which 3 codes matter.

None of these need model judgement to fix — they need a cap. That is all this plugin does.

## Measured results

Token estimates use 3.6 chars/token for code and 4 for logs. Rows marked *real* were measured on actual solutions; the rest use synthetic fixtures sized like enterprise files.

| Scenario | Before | After | Saved |
|---|---:|---:|---:|
| Read one large C# file (whole file) | 38,749 | 1,761 | 95.5% |
| Find one symbol across the repo (`grep -rn`) | 9,218 | 1,698 | 81.6% |
| Read a warning-heavy build log | 55,783 | 461 | 99.2% |
| *real* 59-project .NET Framework solution via MSBuild | 27,258 | 2,104 | 92.3% |
| *real* SDK-style solution via `dotnet build` | 1,624 | 1,493 | 8.1% |

The last row is the honest floor: when the build already runs with `-v:q` and fails early, there is little to compress. The plugin earns its keep on large files, repo-wide searches, and warning-heavy builds.

Its own permanent cost is about **780 tokens per session** (5 MCP tool schemas ≈ 626, skill and agent descriptions ≈ 154). One blocked 38k-token read pays for a month of that.

See [`bench/RESULTS.md`](bench/RESULTS.md) for the generated report.

## What it does not do

ZCode hooks cannot rewrite or truncate tool output, compress conversation history, or touch the system prompt. Those events and keys do not exist. This plugin does not pretend otherwise: it prevents expensive calls, it does not clean up after them.

The guard also never auto-approves a tool. It can only deny with a reason, so your permission rules stay in charge.

## Language support

| Layer | Coverage |
|---|---|
| Guard | Any language. It judges file size and shell commands, not syntax. |
| `search` | Any text file. Binaries and NUL bytes are skipped; UTF-16LE/BE sources are decoded, with or without a BOM. Obeys `.gitignore` and caches decoded text between calls. Optional `search.extensions` narrows the scan. |
| `outline` | Heuristic declaration detection for C/C++/C#/Java/Kotlin, JS/TS, Python, Ruby, PHP, Go, Rust, Swift, Scala, Dart, shell, Lua, Perl and SQL. It is a regex, not a parser. |
| `build` / `run` | `build` is .NET only (MSBuild or `dotnet`). `run` covers npm/pnpm/yarn, cargo, go, maven, gradle, make and pytest with fixed commands per ecosystem. |
| Skill, agent, `AGENTS.md` sample | Language-agnostic. |

## Components

| Component | Behaviour |
|---|---|
| MCP tool `outline` | Type and method signatures with line numbers for a file or directory. Replaces a blind read. |
| MCP tool `search` | Literal or `/regex/` search, returns `file:line` plus 2 context lines, capped at 30 matches / 8 KB. |
| MCP tool `build` | Runs MSBuild or `dotnet build`, keeps the full log in `.zero-token/build.log`, returns errors plus warnings grouped by code. |
| MCP tool `run` | Build/test/lint for npm/pnpm/yarn, cargo, go, maven, gradle, make and pytest, with per-ecosystem error extraction. |
| MCP tool `diet` | Reports which installed skills and MCP schemas cost context every session. |
| Agent `zero-token:scout` | Read-only subagent for questions spanning many files. Returns `file:line` pointers, never code. |
| Hook `PreToolUse` | Blocks unbound `Read` of files over 128 KB, `cat`/`Get-Content` of large files, `grep -r` without `-l`/`-m`, `git log -p` without `-n`. |
| Hook `PostToolUse` | Warns once when the same tool call repeats three times with identical input. |
| Skill `zero-token` | The behaviour rules that make the cheap path the default. |
| Commands `/build`, `/diet`, `/saved` | Manual entry points: compact build, baseline report, savings ledger. |

## Install

In ZCode:

```text
/plugin marketplace add kzxl/zcode-zero-token
/plugin install zero-token@zcode-zero-token
```

Or use **Plugin Marketplace → + → Add Plugin Marketplace**, paste `kzxl/zcode-zero-token`, then install **Zero Token** from **Personal → zcode-zero-token**.

Start a new task after installing. ZCode loads skills, MCP tools, agents and hooks at session start.

### Make it the default

The plugin ships a skill, so it activates when selected. To apply the rules even when the skill is not chosen, copy [`plugins/zero-token/AGENTS.md.sample`](plugins/zero-token/AGENTS.md.sample) into `~/.zcode/AGENTS.md` (or a repo's `AGENTS.md`). It costs roughly 260 tokens per session; keep it if it changes behaviour, drop it if it does not.

## Build toolchain

`build` chooses from the project itself, not from a path list:

| Project style | Toolchain |
|---|---|
| `ToolsVersion`, `TargetFrameworkVersion`, msbuild 2003 xmlns | MSBuild.exe |
| `<Project Sdk="Microsoft.NET.Sdk">` | `dotnet build` |

MSBuild is located in this order: `build.msbuildPath`, VS 2019 Build Tools, Visual Studio 2022/18 installs, then `vswhere`. If no MSBuild is found for a legacy project, the tool says so and refuses to guess — `dotnet build` on .NET Framework projects produces misleading errors.

### Other ecosystems

`run` detects the manifest (package.json, Cargo.toml, go.mod, pom.xml, build.gradle, Makefile, pyproject.toml/pytest.ini), runs `build`, `test` or `lint` with fixed commands, and compacts the log using that ecosystem's error markers (tsc, rustc, go, pytest, npm, maven, gradle). `dryRun: true` shows the command without running it. It never accepts arbitrary shell, so it cannot become a second Bash tool.

## Configuration

`plugins/zero-token/scripts/config.json`:

| Key | Default | Meaning |
|---|---|---|
| `guard.enabled` | `true` | Master switch for the PreToolUse guard. |
| `guard.read.maxBytes` | `131072` | Files above this are blocked on a read with no `limit`. |
| `guard.read.suggestLines` | `200` | Limit suggested in the deny reason. |
| `guard.read.maxLimitLines` | `400` | A larger explicit `limit` on a big file is treated as a full read. |
| `guard.bash.catMaxBytes` | `131072` | `cat`/`Get-Content` target size that gets blocked. |
| `guard.bash.denyRecursiveGrep` | `true` | Block `grep -r` without `-l`, `-m`, or `head`. |
| `guard.bash.denyPatchLog` | `true` | Block `git log -p` without `-n`. |
| `guard.bash.denyVerboseBuild` | `false` | Block `dotnet build`/`msbuild` without `-v:q`. |
| `loopBreaker.enabled` | `true` | Repeated-call detection. |
| `loopBreaker.threshold` | `3` | Identical calls before the warning. |
| `build.toolchain` | `auto` | `auto`, `msbuild`, or `dotnet`. |
| `build.msbuildPath` | `""` | Pin MSBuild.exe. |
| `build.configuration` | `Debug` | Passed to both toolchains. |
| `build.platform` | `Any CPU` | MSBuild only; SDK builds use their default. |
| `search.extensions` | `[]` | Empty scans every text file; a list like `[".cs",".ts"]` narrows it. |
| `search.respectGitignore` | `true` | Honour `.gitignore` files at or below the search root. |
| `search.cacheTtlMs` | `30000` | File-list cache TTL; repeated searches reuse it. |
| `search.cacheMaxBytes` | `33554432` | LRU budget for decoded text kept between calls. |
| `run.timeoutMs` | `600000` | Timeout for the `run` tool. |

Edits take effect on the next tool call.

The shipped `scripts/config.json` lives in the installed plugin and is replaced on update. Put personal overrides in `~/.zcode/zero-token.config.json` (or the path in `TOKEN_DIET_CONFIG`); per-repository overrides go in `<repo>/.zero-token.json`. Files are deep-merged, the most specific wins.

## Panel (experimental)

The plugin declares an MCP App surface (`ui://zero-token/panel.html`) that renders the ledger in ZCode's side panel: tokens kept out of context as the headline, the average per file block, blocks, distinct files, tool calls and tool output for the last 24 hours, plus the most recent blocks with their size. It costs no conversation tokens. A **Reload** button and an auto-refresh interval (off / 3s / 5s / 10s / 30s, remembered) call the panel data tool through the MCP Apps bridge, so the numbers update in place without reloading the page. Panel refreshes are not written to the ledger.

ZCode treats plugin surfaces as **manually opened panels**: it does not auto-open them, even when a tool result requests inline display. The official document plugins behave the same way. Open the **Zero Token** panel once from the side panel; after that it is one click, and it costs no conversation tokens. `/saved` always returns the text report, so nothing is lost if the panel is closed. The inline metadata is kept for hosts that support it.

## Savings ledger

Every blocked call and every MCP tool call is appended to `~/.zcode/zero-token/ledger.jsonl` (override the directory with `TOKEN_DIET_DATA`). `/saved [days]` summarises it. The ledger is local, append-only, rotates once at 5 MB, and an append costs about 0.35 ms. It records what the plugin saw, not provider-reported usage.

## Measured on real repositories

Nine repositories from a mixed-language workspace, one query per repo, cold cache. Naive is every matching line (a `grep -rn` with no cap).

| Repo | Lang | Code files | Naive | Tool | Saved | Cold ms |
|---|---|---:|---:|---:|---:|---:|
| ZeroLantern5D2 | C | 721 | 155,625 | 1,679 | 98.9% | 215 |
| php | PHP | 291 | 57,998 | 2,109 | 96.4% | 74 |
| grand-strategy-rpg | C# | 82 | 36,678 | 2,375 | 93.5% | 16 |
| dotnet | C# | 85 | 26,249 | 2,288 | 91.3% | 40 |
| go | Go | 49 | 13,159 | 1,719 | 86.9% | 22 |
| Simulation | TS | 201 | 17,063 | 2,337 | 86.3% | 35 |
| ZPanl | Rust | 30 | 4,371 | 2,001 | 54.2% | 11 |
| Mobile | Kotlin | 66 | 4,830 | 2,355 | 51.2% | 28 |
| Recoit | Python | 27 | 3,013 | 1,910 | 36.6% | 9 |

The low rows are the honest ones: when a repo has few matches, the 30-match cap never binds and two context lines per match dominate. Cold search stays under 220 ms on every repo, so an on-disk index is not worth its complexity at this scale. The raw run is in [`bench/repo-after.json`](bench/repo-after.json).

Hook overhead on Windows: **70 ms per guarded call**, almost entirely Node process spawn; the ledger append is 0.35 ms. A session with 50 tool calls pays roughly 3.5–7 seconds of hook latency.

## Benchmark

```sh
npm test                          # guard, ledger, languages, build parser, gitignore/UTF-16, runner
node bench/mcp-smoke.mjs          # MCP handshake + all five tools
node bench/measure.mjs            # synthetic scenarios, writes bench/RESULTS.md
node bench/repo-bench.mjs         # real repositories (set TOKEN_DIET_BENCH_REPOS)
node bench/hook-bench.mjs         # hook spawn latency and ledger cost
```

Real solutions are opt-in so the harness stays portable:

```sh
TOKEN_DIET_REAL_SLN=/path/to/App.sln     node bench/measure.mjs   # SDK or legacy
TOKEN_DIET_ERP_SLN=/path/to/Legacy.sln   node bench/measure.mjs   # forces a large legacy build
TOKEN_DIET_REAL_REPO=/path/to/repo       node bench/measure.mjs   # spot check on a real file
```

On Windows, prefix with the variables in PowerShell (`$env:TOKEN_DIET_REAL_SLN="..."`) or Git Bash.

## Safety

- Hooks execute as your user on every matching tool call. Read [`guard.mjs`](plugins/zero-token/scripts/guard.mjs) and [`loop-breaker.mjs`](plugins/zero-token/scripts/loop-breaker.mjs) before enabling; both are dependency-free and under 200 lines.
- The guard denies, it never approves. Permission prompts still happen.
- The MCP server is a single Node process; `outline`/`search` only read, `build` and `run` execute the project's own build/test commands, `diet` only reads `~/.zcode` metadata.
- Nothing leaves your machine.

## Roadmap

Detailed plan and acceptance criteria: [ROADMAP.md](ROADMAP.md). Next five, in order:

1. Reduce hook scope: `PostToolUse` on `Bash` only — removes ~70 ms from every `Read`.
2. Adaptive context: one line when a search has 10 or fewer matches — raises sparse-repo savings from 36–54% to roughly 60–70%.
3. Legacy encoding fallback, only for files that fail UTF-8 — covers the 50 affected ERP files.
4. Outline quality audit on 20 files per language before adding outline features.
5. Tune thresholds from `/saved` data after a week of real use.

Deliberately deferred: on-disk index (cold search is already ≤220 ms), SQLite usage integration, tree-sitter, bundled ripgrep.

## Limitations

- No savings in short chat sessions; the tool schemas cost more than they save there.
- `outline` is regex-based, not a Roslyn parser. It catches declarations reliably, not everything inside them.
- The PostToolUse warning fires once per fingerprint, not continuously.
- Build compaction depends on the log. Small clean builds barely shrink.
- `.gitignore` support covers the common subset (anchoring, negation, `*`, `**`, `?`, directory-only). Explicitly targeting an ignored subdirectory still searches it.
- The guard ignores quoted strings and heredoc bodies when matching shell patterns. The trade-off favours not blocking legitimate commits and scripts; a command hidden inside `bash -c "..."` is not inspected.
- UTF-16 without a BOM is inferred from NUL-byte parity; unusual files may be classified as binary.
- `run` uses fixed commands per ecosystem. It cannot run an arbitrary command, and a project whose test script is named unusually needs Bash.
- The plugin cannot reduce the baseline cost of your other skills and plugins — use `/diet` and disable what you do not use.
- Hook latency is real: about 70 ms per guarded tool call on Windows, because every event spawns a process.
- Search savings fall to ~36% when matches are sparse; two context lines per match cost more than the matches themselves.
- The ledger measures blocked bytes, not provider tokens; it has no idea what the model would actually have done with the file.

## License

MIT
