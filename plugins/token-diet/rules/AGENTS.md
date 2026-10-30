# Token Diet Operational Rules

<!-- token-diet:begin -->
TOKEN-DIET MODE IS ACTIVE. Cut wasted words, unnecessary round-trips, and bloated context without sacrificing substance, correctness, or precision.

## 1. User Communication
- **Lead with direct answers**: Eliminate preamble ("Sure!", "Certainly!", "I can help with that...") and postamble ("Let me know if you need anything else...").
- **Never restate the request**: Do not paraphrase or echo user prompts back to the user.
- **Report deltas**: State changes and status ("Done: X; Tests: PASS; Y still failing") rather than chronological narration.
- **Dense and skimmable**: Prefer bullet points and concise statements over lengthy prose.

## 2. Context & Tool Efficiency (Highest Leverage - Recursive Cost Minimization)
- **Targeted inspection**: Locate targets before reading. Use `outline` or `search` tools (or grep) first; read only relevant line ranges (`StartLine`/`EndLine`). Never read entire files blindly.
- **Tool call batching**: Batch independent tool calls into a single turn instead of serializing across multiple turns.
- **Turn minimization**: Plan complete modifications, apply edits together, and run verification once. Avoid iterative read-edit-read loops across turns.
- **Zero re-reading**: Never re-read files that were just edited or are already present in context history.
- **Stop on sufficiency**: Cease searching the moment sufficient data is acquired to execute the task. Avoid speculative rabbit holes.

## 3. Specialized Tools (.NET & Codebase)
- **Reading files**: Call `outline` first on unfamiliar source files (>200 lines) or designer files. Never read >200 lines in one call.
- **Searching**: Use `search` (capped at 30 matches / 8 KB) rather than unbounded recursive greps.
- **Building**: Prefer compact build tools over verbose standard output. For ERP legacy .NET Framework solutions, invoke MSBuild with errors and grouped warnings summary; keep full logs in `.token-diet/build.log`.
- **Breadth exploration**: Dispatch `token-diet:scout` sub-agent when questions span >5 files across the codebase to obtain `file:line` pointers without flooding context with raw code.

## 4. Sub-Agent Optimization
- **Model delegation**: Delegate broad exploratory tasks to cheaper models (`flash` / `flash_lite`) so verbose intermediate output stays out of the parent conversation context.
- **Critical path isolation**: Retain correctness-sensitive logic, cross-cutting architectural validation, and core implementation on the primary model.
- **Compact instructions**: Write sub-agent prompts with exact targets, constraints, and output schema in minimal words.

## 5. Code & Artifact Generation
- **Strict YAGNI**: Implement only requested behavior. Avoid speculative config, dead code, or unrequested abstractions.
- **Self-documenting code**: Comment only non-obvious *why*; eliminate comments describing obvious syntax or boilerplate.
- **Focused tests**: Test critical and edge paths; avoid bloated combinatorial test matrices.

## 6. Non-Negotiable Guardrails
1. **Never sacrifice correctness**: Deep thinking and rigorous validation must not be traded for brevity.
2. **Never compromise security or critical logic**: Money, authentication, authorization, and data-integrity paths must be verified thoroughly.
3. **Exact precision**: Code snippets, commands, file paths, identifiers, and error strings must remain verbatim and fully functional.
<!-- token-diet:end -->
