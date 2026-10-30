# Zero Token

Universal token firewall & compact-context optimizer for AI coding agents (**Google Antigravity 2.0** & **ZCode**).

Stops an AI coding session from flooding its own context window with whole-file reads, unbounded `grep`/`rg`, and raw multi-megabyte build logs — without lossy history truncation or rewriting tool outputs.

[Tiếng Việt](README.vi.md) · MIT · Node 18+

```text
before   Read / read_file OrderService.cs (136 KB)       ~38,700 tokens
after    outline OrderService.cs                          ~1,470 tokens
         read_file StartLine=412 EndLine=452 (or Read offset=412 limit=40)
```

## Why

An AI coding session pays for every single character a tool returns, and pays repeatedly on every subsequent turn because the transcript retains it. The most expensive calls are predictable:

- Opening a 3,000-line file just to inspect one method;
- Running an unconstrained recursive search that returns 9,000 matches;
- Dumping a build log with 1,800 warning lines, where only 3 error codes matter.

None of these need model judgement to fix — they need a strict, automated cap at the gateway. That is what **Zero Token** enforces.

## Measured Results

Token estimates use 3.6 chars/token for code and 4 chars/token for logs. Rows marked *real* were measured on actual enterprise solutions; the rest use synthetic fixtures sized like standard enterprise files.

| Scenario | Before | After | Saved |
|---|---:|---:|---:|
| Read one large C# file (whole file) | 38,749 | 1,761 | **95.5%** |
| Find one symbol across the repo (`grep -rn`) | 9,218 | 1,698 | **81.6%** |
| Read a warning-heavy build log | 55,783 | 461 | **99.2%** |
| *real* 59-project .NET Framework solution via MSBuild | 27,258 | 2,104 | **92.3%** |
| *real* SDK-style solution via `dotnet build` | 1,624 | 1,493 | **8.1%** |

The last row is the honest floor: when the build already runs with `-v:q` and fails early, there is little to compress. The plugin earns its keep on large files, repo-wide searches, and warning-heavy builds.

Its own permanent overhead is only about **780 tokens per session** (5 MCP tool schemas ≈ 626, skill and agent descriptions ≈ 154). One blocked 38k-token read pays for months of usage.

See [`bench/RESULTS.md`](bench/RESULTS.md) for the generated benchmark report.

## Platform Support

Zero Token natively supports both **Google Antigravity 2.0** and **ZCode** through a unified adapter layer:

| Platform | Hook Integration | Tools Covered | Interface & Surfaces |
|---|---|---|---|
| **Google Antigravity 2.0** | `PreToolUse` hook via `plugins/zero-token/hooks/` | `read_file`, `run_command` | Skills, MCP Server, always-on `rules/AGENTS.md` |
| **ZCode** | `PreToolUse` & `PostToolUse` via `.zcode-plugin/` | `Read`, `Bash` | Skills, Commands, Agents, MCP Apps Webview Panel |

## Components

| Component | Behaviour |
|---|---|
| **Universal Guard** (`guard.mjs`) | Intercepts oversized reads (`read_file` without line range or `Read` without limit on files >128 KB), blocks unbounded `cat`/`type`, unconstrained `grep -r`, and `git log -p` without limit. |
| **Loop Breaker** (`loop-breaker.mjs`) | Warns once when the agent repeats the exact same tool call with identical arguments 3 times. |
| **MCP Tool `outline`** | Extracts type and method signatures with line numbers across 16+ programming languages. Replaces blind whole-file reads. |
| **MCP Tool `search`** | Literal or `/regex/` search, returns `file:line` plus 2 context lines, capped at 30 matches / 8 KB. |
| **MCP Tool `build`** | Runs MSBuild or `dotnet build`, stores full logs in `.zero-token/build.log`, returns errors plus warnings grouped by code. |
| **MCP Tool `run`** | Build/test/lint for npm/pnpm/yarn, cargo, go, maven, gradle, make, and pytest with per-ecosystem error extraction. |
| **MCP Tool `diet`** | Analyzes token cost of all installed skills and MCP schemas in the environment. |
| **Savings Ledger** (`ledger.mjs`) | Logs every blocked call and saved byte into a local rotating JSONL ledger (`~/.zero-token/ledger.jsonl`). |
| **MCP App Panel** (`panel.html`) | Real-time webview dashboard visualizing tokens kept out of context, blocked calls, and recent interventions. |

## Installation

### Option 1: Fast Universal Install (PowerShell)

Clone the repository and run the installer script:

```powershell
git clone https://github.com/kzxl/zero-token.git
cd zero-token
./install.ps1
```

The script automatically sets up NTFS Junctions pointing to `plugins/zero-token` for both environments:
- Antigravity 2.0: `~/.gemini/config/plugins/zero-token`
- ZCode: `~/.zcode/plugins/zero-token`

### Option 2: ZCode Plugin Marketplace

In ZCode:

```text
/plugin marketplace add kzxl/zero-token
/plugin install zero-token@zero-token
```

Or navigate to **Plugin Marketplace → + → Add Plugin Marketplace**, paste `kzxl/zero-token`, then install **Zero Token**.

### Option 3: Antigravity 2.0 Manual MCP Registration

If you prefer registering Zero Token strictly as an MCP server in Antigravity:

Add to `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "zero-token": {
      "command": "node",
      "args": [
        "C:/Users/<Username>/source/repos/zero-token/plugins/zero-token/scripts/mcp-server.mjs"
      ],
      "env": {
        "ZERO_TOKEN_WORKSPACE": "C:/path/to/your/workspace"
      }
    }
  }
}
```

## Language Support

| Layer | Coverage |
|---|---|
| **Guard** | Any language. Evaluates file sizes, byte offsets, line ranges, and shell commands. |
| **`search`** | Any text file. Skips binaries/NUL bytes, handles UTF-16LE/BE (with/without BOM), respects `.gitignore`, and caches decoded text. Optional `search.extensions` narrows scope. |
| **`outline`** | Heuristic symbol extraction for C, C++, C#, Java, Kotlin, JS, TS, Python, Ruby, PHP, Go, Rust, Swift, Scala, Dart, Shell, Lua, Perl, and SQL. |
| **`build`** | .NET solutions (legacy MSBuild or modern SDK `dotnet build`). |
| **`run`** | npm, pnpm, yarn, cargo, go, maven, gradle, make, and pytest. |

## Configuration

Zero Token supports a 3-tier configuration hierarchy:
1. **Repository Overrides**: `<repo>/.zero-token.json` (highest priority)
2. **User Global Overrides**: `~/.zero-token/config.json` (or path in `ZERO_TOKEN_CONFIG`)
3. **Plugin Defaults**: `plugins/zero-token/scripts/config.json`

| Key | Default | Meaning |
|---|---|---|
| `guard.enabled` | `true` | Master switch for the PreToolUse guard. |
| `guard.read.maxBytes` | `131072` | Files above this (128 KB) are blocked without line/byte constraints. |
| `guard.read.suggestLines` | `200` | Suggested line count in deny messages. |
| `guard.read.maxLimitLines` | `400` | Reads requesting >400 lines on large files are treated as full reads and blocked. |
| `guard.bash.catMaxBytes` | `131072` | Size cap for files viewed via `cat`/`Get-Content`/`type`. |
| `guard.bash.denyRecursiveGrep` | `true` | Block `grep -r` without `-l`, `-m`, or `head`. |
| `guard.bash.denyPatchLog` | `true` | Block `git log -p` without `-n`. |
| `guard.bash.denyVerboseBuild` | `false` | Block `dotnet build`/`msbuild` without `-v:q`. |
| `loopBreaker.enabled` | `true` | Detect repetitive identical tool calls. |
| `loopBreaker.threshold` | `3` | Number of identical calls before triggering a warning. |
| `search.respectGitignore` | `true` | Honour `.gitignore` rules during search. |
| `search.cacheTtlMs` | `30000` | In-memory file cache TTL (ms). |
| `search.cacheMaxBytes` | `33554432` | LRU cache budget for decoded files (32 MB). |
| `run.timeoutMs` | `600000` | Command execution timeout for `run`. |

## Savings Ledger & Real-Time Dashboard

Every blocked call, preserved token count, and MCP execution is recorded in:
- `~/.zero-token/ledger.jsonl` (customizable via `ZERO_TOKEN_DATA`).

To inspect savings:
- In chat: Run `/zero-token status` or `/saved [days]` for a concise summary.
- In ZCode / MCP App hosts: Open `ui://zero-token/panel.html` in the sidebar for live metrics, visual gauges, and zero-token consumption.

## Benchmarks & Verification

Run the test suite locally:

```sh
npm test                          # Full test suite: guard, languages, build parser, gitignore, runner, panel
npm run smoke                     # MCP protocol handshake and tool verification
npm run bench                     # Synthetic scenario benchmark (writes bench/RESULTS.md)
node bench/repo-bench.mjs         # Benchmark against real multi-language repositories
node bench/hook-bench.mjs         # Measure hook spawn overhead and ledger append latency
```

Hook latency on Windows is **~70 ms per guarded call** (Node process spawn overhead); ledger appends take only **0.35 ms**. A typical session with 50 tool calls incurs ~3.5 seconds of total hook latency while saving tens of thousands of tokens.

## Safety & Security

- Zero Token runs entirely locally. Nothing leaves your machine.
- The guard **denies** dangerous calls; it **never auto-approves** permissions. Your host environment's permission boundaries remain in full control.
- MCP tools are read-only inspection tools, except `build` and `run` which execute existing local build scripts with bounded timeouts.

## License

MIT © [kzxl](https://github.com/kzxl)
