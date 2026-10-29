# ZCode Token Diet

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
| Read one large C# file (whole file) | 38,749 | 1,474 | 96.2% |
| Find one symbol across the repo (`grep -rn`) | 9,218 | 1,698 | 81.6% |
| Read a warning-heavy build log | 55,783 | 461 | 99.2% |
| *real* 59-project .NET Framework solution via MSBuild | 27,258 | 2,048 | 92.5% |
| *real* SDK-style solution via `dotnet build` | 1,624 | 1,493 | 8.1% |

The last row is the honest floor: when the build already runs with `-v:q` and fails early, there is little to compress. The plugin earns its keep on large files, repo-wide searches, and warning-heavy builds.

Its own permanent cost is about **600 tokens per session** (4 MCP tool schemas ≈ 447, skill and agent descriptions ≈ 154). One blocked 38k-token read pays for a month of that.

See [`bench/RESULTS.md`](bench/RESULTS.md) for the generated report.

## What it does not do

ZCode hooks cannot rewrite or truncate tool output, compress conversation history, or touch the system prompt. Those events and keys do not exist. This plugin does not pretend otherwise: it prevents expensive calls, it does not clean up after them.

The guard also never auto-approves a tool. It can only deny with a reason, so your permission rules stay in charge.

## Components

| Component | Behaviour |
|---|---|
| MCP tool `outline` | Type and method signatures with line numbers for a file or directory. Replaces a blind read. |
| MCP tool `search` | Literal or `/regex/` search, returns `file:line` plus 2 context lines, capped at 30 matches / 8 KB. |
| MCP tool `build` | Runs MSBuild or `dotnet build`, keeps the full log in `.token-diet/build.log`, returns errors plus warnings grouped by code. |
| MCP tool `diet` | Reports which installed skills and MCP schemas cost context every session. |
| Agent `token-diet:scout` | Read-only subagent for questions spanning many files. Returns `file:line` pointers, never code. |
| Hook `PreToolUse` | Blocks unbound `Read` of files over 128 KB, `cat`/`Get-Content` of large files, `grep -r` without `-l`/`-m`, `git log -p` without `-n`. |
| Hook `PostToolUse` | Warns once when the same tool call repeats three times with identical input. |
| Skill `token-diet` | The behaviour rules that make the cheap path the default. |
| Commands `/build`, `/diet` | Manual entry points for the two most-used tools. |

## Install

In ZCode:

```text
/plugin marketplace add kzxl/zcode-token-diet
/plugin install token-diet@zcode-token-diet
```

Or use **Plugin Marketplace → + → Add Plugin Marketplace**, paste `kzxl/zcode-token-diet`, then install **Token Diet** from **Personal → zcode-token-diet**.

Start a new task after installing. ZCode loads skills, MCP tools, agents and hooks at session start.

### Make it the default

The plugin ships a skill, so it activates when selected. To apply the rules even when the skill is not chosen, copy [`plugins/token-diet/AGENTS.md.sample`](plugins/token-diet/AGENTS.md.sample) into `~/.zcode/AGENTS.md` (or a repo's `AGENTS.md`). It costs roughly 260 tokens per session; keep it if it changes behaviour, drop it if it does not.

## Build toolchain

`build` chooses from the project itself, not from a path list:

| Project style | Toolchain |
|---|---|
| `ToolsVersion`, `TargetFrameworkVersion`, msbuild 2003 xmlns | MSBuild.exe |
| `<Project Sdk="Microsoft.NET.Sdk">` | `dotnet build` |

MSBuild is located in this order: `build.msbuildPath`, VS 2019 Build Tools, Visual Studio 2022/18 installs, then `vswhere`. If no MSBuild is found for a legacy project, the tool says so and refuses to guess — `dotnet build` on .NET Framework projects produces misleading errors.

## Configuration

`plugins/token-diet/scripts/config.json`:

| Key | Default | Meaning |
|---|---|---|
| `guard.enabled` | `true` | Master switch for the PreToolUse guard. |
| `guard.read.maxBytes` | `131072` | Files above this are blocked on a read with no `limit`. |
| `guard.read.suggestLines` | `200` | Limit suggested in the deny reason. |
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

Edits take effect on the next tool call.

## Benchmark

```sh
node bench/mcp-smoke.mjs          # MCP handshake + all four tools
node bench/measure.mjs            # synthetic scenarios, writes bench/RESULTS.md
```

Real solutions are opt-in so the harness stays portable:

```sh
TOKEN_DIET_REAL_SLN=/path/to/App.sln     node bench/measure.mjs   # SDK or legacy
TOKEN_DIET_ERP_SLN=/path/to/Legacy.sln   node bench/measure.mjs   # forces a large legacy build
TOKEN_DIET_REAL_REPO=/path/to/repo       node bench/measure.mjs   # spot check on a real file
```

On Windows, prefix with the variables in PowerShell (`$env:TOKEN_DIET_REAL_SLN="..."`) or Git Bash.

## Safety

- Hooks execute as your user on every matching tool call. Read [`guard.mjs`](plugins/token-diet/scripts/guard.mjs) and [`loop-breaker.mjs`](plugins/token-diet/scripts/loop-breaker.mjs) before enabling; both are dependency-free and under 200 lines.
- The guard denies, it never approves. Permission prompts still happen.
- The MCP server is a single Node process; `outline`/`search` only read, `build` runs the project's own build, `diet` only reads `~/.zcode` metadata.
- Nothing leaves your machine.

## Limitations

- No savings in short chat sessions; the tool schemas cost more than they save there.
- `outline` is regex-based, not a Roslyn parser. It catches declarations reliably, not everything inside them.
- The PostToolUse warning fires once per fingerprint, not continuously.
- Build compaction depends on the log. Small clean builds barely shrink.
- The plugin cannot reduce the baseline cost of your other skills and plugins — use `/diet` and disable what you do not use.

## License

MIT
