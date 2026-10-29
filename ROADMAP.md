# Roadmap

Current release: **v0.4.0**. This file records what is next, why it is next, and
what was deliberately dropped. Every item here came out of a measurement; items
without a number either have not been measured yet or are not worth measuring.

Guiding rule: the plugin can only act on tool **inputs**, config, and its own
MCP tools. Anything that needs tool-output rewriting, history compaction, system
prompt changes, or UI injection is out of scope by platform design.

## 1. Reduce hook scope and latency

**Measurement.** Each guarded tool call costs ~70 ms on Windows, almost entirely
Node process spawn. The ledger append is 0.35 ms. A 50-call session pays 3.5–7 s
of hook time.

**Why it matters.** Latency is now the largest runtime cost of the plugin, larger
than the guard logic itself. It is paid even when nothing is blocked.

**Plan.**

- Default the `PostToolUse` matcher to `Bash` only. Loop retries are almost
  entirely a shell phenomenon, and this removes 70 ms from every `Read`.
- Document `loopBreaker.enabled: false` as the zero-latency option.
- Keep `PreToolUse` on `Read|Bash`; it is the part that saves tokens.

**Acceptance.** No test regressions; hook-bench shows one fewer spawn per `Read`;
a session with 50 mixed calls saves 2–3.5 s.

**Expected token impact.** None. This is a latency fix.

## 2. Adaptive context for sparse search results

**Measurement.** Savings range from 98.9% (C repo, 6,304 matches) down to 36.6%
(Python repo, 111 matches). When matches are few, the two context lines per match
cost more than the matching lines themselves.

**Plan.** When the total match count is small (≤10), return one context line
instead of two. Expose `search.contextSparse` and `search.sparseThreshold` in
config so it can be tuned or disabled.

**Acceptance.** Recoit, Mobile and ZPanl move from 36–54% to at least 60% saved in
`repo-bench`, with no test regressions. Output must still show enough surrounding
text to judge a match.

**Expected impact.** +20–30% token savings on repositories with sparse matches; no
change on match-heavy repositories where the 30-match cap already binds.

## 3. Legacy encoding fallback

**Measurement.** `E:/00.ERP/ERP` has 8,009 code files: 7,941 UTF-8, 18 UTF-16LE
with BOM, 50 invalid UTF-8 (0.6%). The other surveyed repositories are pure UTF-8.

**Plan.** Only when UTF-8 decoding produces replacement characters, try
Windows-1258 and TCVN3/VNI. Never touch files that already decode as valid UTF-8.
Add `search.legacyEncodings` (default `["windows-1258"]`) and report the detected
encoding in the search header.

**Acceptance.** The 50 affected ERP files become searchable for Vietnamese strings
with diacritics; UTF-8 files remain byte-identical; no false positive on binary
files.

**Expected impact.** Turns failed searches into correct hits on 0.6% of the ERP
code base. Medium priority, not urgent — the measured share is small.

## 4. Outline quality audit before more outline features

**Measurement.** Outline returns plausible counts (1,388 C, 630 TS, 626 PHP, 576
Go, 474 C#, 295 Rust, 195 Python, 164 Kotlin symbols across up to 30 files), but
precision and recall have not been sampled.

**Plan.** Sample 20 files per language, compare declarations reported against the
actual file, and record both misses and false positives. Only then decide whether
hierarchy, glob filters, or generated-file exclusion are worth adding.

**Acceptance.** A written table of misses and false positives per language. Feature
work is justified by that table, not by intuition.

**Expected impact.** Unknown until measured. This is deliberately a validation
task, not a feature task.

## 5. Ledger-driven tuning (no code)

**Plan.** Run `/saved` for a week on real work, then adjust thresholds:

- blocked calls near zero → `guard.read.maxBytes` is too high for this workflow;
- frequent blocks on the same file type → add a rule or a workspace config;
- frequent denials followed by manual reads → lower `guard.read.maxLimitLines`
  is counter-productive; raise it instead.

**Acceptance.** A short note in this repository recording the observed deny rate
and the chosen configuration.

## Deferred, with reasons

| Idea | Why deferred |
|---|---|
| On-disk search index | Cold search is ≤220 ms on every real repository tested; the index adds invalidation complexity for no token gain. |
| SQLite usage integration | Needs an external dependency (Node 20 has no `node:sqlite`). Wait until the ledger proves the plugin is used enough to justify exact numbers. |
| Tree-sitter outline | 5–10 MB of WASM/native payload; improves structure detection but does not reduce tool output much. |
| Bundled ripgrep | Faster search, but search is already the cheap part; adds per-platform binaries and licensing surface. |
| More ecosystems in `run` | Only useful if those toolchains are actually used. `npm`, `cargo`, `go`, `maven`, `gradle`, `make` and `pytest` cover the common cases. |
| Desktop overlay / statusbar | No supported UI injection for third-party plugins; an external overlay is a separate product. |
| Auto-open the panel | ZCode does not auto-open plugin surfaces; the official document panels are manual too. Blocked on the host. Alternative if needed: an opt-in OS toast at `Stop`, which costs no conversation tokens. |

## Non-goals

These cannot be implemented by any ZCode plugin, regardless of effort:

- trimming or rewriting tool output after it returns;
- compacting or summarising conversation history;
- reducing the system prompt or another plugin's tool schemas;
- reading live token/context usage inside a hook;
- guaranteeing that the model chooses the compact path;
- sandboxing build or test commands.

## How to reproduce the numbers

```sh
npm test
node bench/measure.mjs
TOKEN_DIET_BENCH_REPOS="/repo/a;/repo/b" node bench/repo-bench.mjs
node bench/hook-bench.mjs
```

Synthetic scenarios are reproducible anywhere. Real-repository rows depend on the
local workspace; `bench/repo-after.json` records the run that produced the table
in the README.
