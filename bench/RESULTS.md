# Token-diet benchmark

Generated 2026-10-29T03:31:25.859Z | fixtures are synthetic, sized like real-world enterprise files.
Token estimate: 3.6 chars/token for code, 4 for logs/prose.

| Scenario | Before (tokens) | After (tokens) | Saved |
|---|---:|---:|---:|
| Read one large C# file (whole file) | 38,749 | 1,474 | 96.2% |
| Find one symbol across the repo (grep -rn) | 9,218 | 1,698 | 81.6% |
| Read a build log (dotnet build) | 55,783 | 461 | 99.2% |

## Guard behaviour

- Read 136 KB with no limit -> BLOCKED (116-token reason)
- `grep -rn` unbounded -> BLOCKED
- `grep -rn -m 5` (bounded) -> allowed
- Read a small 6 KB file -> allowed
- Same command repeated 3 times -> warning emitted


## Plugin permanent cost

- Skill description + agent description: ~154 tokens
- 4 MCP tool schemas: ~474 tokens
- Total: ~628 tokens per session

## Baseline on the generating machine (example)

```
token-diet report — estimated permanent context cost per session
formula: 4 chars/token, +90 chars per skill line

GROUP                 ITEMS   EST. TOKENS
user                     46         3052
zcode-guide@zcode-plugins-official      6         1011
browser-use@zcode-plugins-official      2          323
spreadsheets@zcode-plugins-official      2          306
pdf@zcode-plugins-official      2          300
presentations@zcode-plugins-official      2          289
documents@zcode-plugins-official      2          268
restore-legacy-sessions@zcode-plugins-official      1          122
visualize@zcode-plugins-official      1          100
skill-creator@zcode-plugins-official      1           83
plugin-creator@zcode-plugins-official      1           81
token-diet@dev-token-diet      1           67
computer-use@zcode-plugins-official      1           55
ios-simulator@zcode-plugins-official      1           46
android-emulator@zcode-plugins-official      1           45
plugin MCP schemas        8         9600

TOTAL ~15747 tokens, every session, before you type anything (70 skills).

AGENTS.md (user): 1.4 KB (~367 tokens, always loaded)

HEAVIEST SKILL DESCRIPTIONS
    214  pdf (pdf@zcode-plugins-official)
    208  xlsx (spreadsheets@zcode-plugins-official)
    192  web-gui-tester (browser-use@zcode-plugins-official)
    191  pptx (presentations@zcode-plugins-official)
    187  diagnosing-plugins (zcode-guide@zcode-plugins-official)
    177  diagnosing-hooks (zcode-guide@zcode-plugins-official)
    175  diagnosing-commands (zcode-guide@zcode-plugins-official)
    173  docx (documents@zcode-plugins-official)
    166  imagegen (user)
    164  zcode-configuration-guide (zcode-guide@zcode-plugins-official)
    157  diagnosing-skills (zcode-guide@zcode-plugins-official)
    151  diagnosing-mcp (zcode-guide@zcode-plugins-official)

WHAT TO DO
  - Disable plugins whose MCP tools you never use: Settings > Plugin Management > Installed.
  - Skills are discovered from disk; move rarely used ones out of ~/.zcode/skills to a backup folder.
  - Prefer one router skill per topic over many narrow skills: 46 descriptions cost the same every turn.
```