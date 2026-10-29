---
name: token-diet
description: Keep context small when working in a large codebase. Use before reading big files, searching across the repo, building .NET solutions, or answering questions that need many files.
---

# Token diet

Use the cheap path first. The built-in tools are not wrong, they are just unbounded.

## Rules

1. **Never read a file blind.** Call `outline` first on any file you have not seen, especially generated/designer files. Then `Read` with `limit` (200) and `offset` for the part you need.
2. **Search with the tool, not grep -r.** `search` returns `file:line` plus two context lines and caps itself at 8 KB. A raw recursive grep can return megabytes.
3. **Build with the tool.** `build` keeps the full log on disk and returns only errors plus warnings grouped by code. It picks MSBuild for legacy .NET Framework solutions (the ERP branch) and `dotnet build` for SDK-style projects; when a repo has its own build skill, pass its `configuration` and `platform` so the result matches. If a specific error needs the surrounding log, read `.token-diet/build.log` with `offset`.
4. **Dispatch `token-diet:scout` for breadth.** If a question needs more than five files — "where is X handled", "what calls Y", "find every place that does Z" — dispatch the `token-diet:scout` agent instead of reading them yourself. It returns `file:line` pointers, not code.
5. **Respect the guard.** If a tool call is blocked with a reason, follow the reason. Do not retry the same call.
6. **Do not re-read what you already have.** If a file was read earlier in the session and has not been edited since, use what you have.

## What not to do

- Do not `cat`, `type`, or `Get-Content` a whole source file.
- Do not pipe generator/designer files into the conversation.
- Do not run `git log -p` without `-n`, or `find` without a name filter.
- Do not paste a full build log; quote the error lines only.

## When the guard blocks you

The message names the alternative. The normal recovery is: `outline` → `Read` with `limit` + `offset`, or `search` with a narrower pattern. One extra call is cheaper than one flooded context.
