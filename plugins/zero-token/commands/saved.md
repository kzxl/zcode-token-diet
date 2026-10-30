---
description: Show what zero-token blocked and which tools it ran, from the local ledger.
argument-hint: "[days]"
---
Use the `zero-token` diet tool with `scope: "savings"` and `days` set to the argument (default 1).

Present the report as-is, then add one short recommendation: if blocked calls are zero, the thresholds are probably too high for this repo; if they are frequent, consider raising `guard.read.maxBytes` or narrowing the rules. Do not edit the ledger.
