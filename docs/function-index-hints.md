# Optional function list index hints

Hosts that run one import per scheduler task can call
`setFunctionListIndexHints(housingUuid, entries)` from
`ct_module/src/importables/functions/listFunctions.ts` immediately before
starting an import (also exported from the module entry point). An entry is `{name, index}`, with a zero-based position
across the 21-entry Functions pages. An empty array enables live name probes
without any navigation hints. Omit this call to retain the existing full scan.

The next import consumes a copy of the hints only when its house UUID matches.
A later import needs another explicit seed. An ordinary session reset, failed
seed, or `setFunctionListIndexHints(housingUuid, null)` discards them. No hints
are persisted to disk, and no icon or content baseline is accepted.

Requested names use the existing `/function edit <name>` reader. Both positive
and negative results come from Housing, including names absent from the hints.
Enumeration without a requested-name list still scans every page. Settings
navigation checks the live slot name before returning it; an index mismatch
clears all positions and falls back to the existing list search. Icons are
read from that verified slot, never from the seed.

The host must discard its index on house transfer, reset, create, delete or
rename. It can continue opting in with an empty index. HTSW also invalidates
positions on its own shell creation and Housing's existing create/delete/rename
chat confirmations, including ambiguous rename messages. Unannounced external
edits remain safe because names and slots are verified live. As with ordinary
HTSW, another editor can change the house between a read and a later write;
this API does not provide a server transaction or concurrent-edit isolation.

This change needs a human in-game check before merge: repeat imports against a
multi-page Functions list, edit settings near the end, and create/delete/rename
functions between imports. Confirm no wrong-slot edits, missing shells or
read-back differences. The headless engine must capability-check the export;
older pins continue their existing behavior.
