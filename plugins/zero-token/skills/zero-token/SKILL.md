---
name: zero-token
description: Slash command and mode controller for Zero Token (compact context, oversized-read guard, capped search, and lean builds). Triggered by /zero-token [on|lite|ultra|off|status].
---

# Zero Token Skill

Provides operational control and dynamic strictness levels for the Zero Token optimization framework.

## Operating Levels

- **`on`** (Default): Activates full zero-token directives across communication, context caching, tool batching, and code generation.
- **`lite`**: Applies communication and artifact concision only; leaves tool execution and context exploration unconstrained.
- **`ultra`**: Activates telegraphic mode on low-stakes communication surfaces (~60% token reduction), while preserving full verbatim precision on high-stakes code and commands.
- **`off`**: Temporarily suspends zero-token rules. Triggered by `/zero-token off` or "verbose mode".
- **`status`**: Reports active mode and current token management directives.

---

## Ultra Mode Specification (Surface-Scoped)

When `/zero-token ultra` is selected:

### Low-Stakes Surfaces (Telegraphic)
Applies to: Chat responses, progress updates, and conversational status notes.
- **Lead immediately with the core answer**: No preamble, greetings, or pleasantries.
- **Drop function words**: Omit non-essential articles (`a`, `the`), auxiliary verbs (`is`, `are`, `will`), and pronouns when semantic meaning remains intact.
- **Use sentence fragments and shorthand**: Favor concise arrow chains (`Input -> Process -> Result`) and standard abbreviations (`fn`, `param`, `cfg`, `res`).
- **Eliminate formatting fluff**: Avoid decorative headers, bold markers on single lines, or emojis.

### High-Stakes Surfaces (Never Telegraph)
Never apply telegraphic fragments to:
- Executable code, diffs, and scripts.
- Shell commands, command-line arguments, and flags.
- File paths, URLs, symbols, classes, and variable names.
- Exact error messages, stack traces, and test assertions.
- Architectural design documents, sub-agent prompts, and security policies.

---

## Command Handling

- `/zero-token on`: Confirms activation of standard Zero Token rules.
- `/zero-token lite`: Switches to communication-only token savings.
- `/zero-token ultra`: Switches to aggressive telegraphic output mode for low-stakes text.
- `/zero-token off`: Pauses zero-token optimizations.
- `/zero-token status`: Displays current level and operational recommendations.

---

## Guardrails
1. Concision applies to external communication and context representation, **never** to the internal reasoning or analysis required to reach a correct solution.
2. Security boundaries, tests, and financial/data-integrity checks must never be skipped or degraded to save tokens.
