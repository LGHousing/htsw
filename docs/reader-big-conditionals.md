# Incomplete function reads (HTSW 1.3.6)

## Investigation, before the fix

The reader must either return the complete observed content or throw before it
can be exported, compared, applied, or cached. Unknown slots and missing lore
are not empty actions, empty conditions, or default values.

### Source and exports

Compared `/home/opc/housing-llm/house/fns/F00{4..7}.htsl` with
`/home/opc/housing-llm-live/full/F00{4..7}.live.htsl`. The source files were last
changed in `9f9e22f93da49453a2e5d83dd1647dc4a4ce1343`; they are unchanged in
`800cbe8`, the imported revision recorded in housing-llm's TASK.md. These four
files each contain 25 conditionals, 50 branches of exactly 25 actions, and only
one level of indentation. This is not excessive nesting. Each branch spans
two list pages (21 + 4 actions).

| Function | Source lines | Export lines excluding diagnostic comments | Missing-name notes | Empty conditionals (1-based) |
| --- | ---: | ---: | ---: | --- |
| F004 | 1325 | 1318 | 38 | 3, 13, 16 |
| F005 | 1325 | 1321 | 15 | 10, 15 |
| F006 | 1325 | 1315 | 18 | 16 |
| F007 | 1325 | 1315 | 34 | 2, 4, 7, 13, 17, 21 |

These counts describe the copies first examined. The original F004 export's
SHA-256 was `baaddbf717efb21848e57695396e80ae9198325c63ef451d5a9b5493f8eb4bb3`.
That shared file was replaced at 14:16:34Z during this investigation; its new
hash is `9e72271d431299c03ac12821aa03eaa848a72c49b361ef80e320356440306f79`.
The replacement has 1,325 lines, no missing-name notes, and matches the source
after normalizing the division operator spelling. The original measurements
above were retained rather than reinterpreting the replacement as the failed read.

All missing-name objects are `CHANGE_VAR` with only the default Player holder.
They occur inside branches on both pages, including positions 1 and 25; this
is not solely a page-boundary off-by-one. For example F004 conditional 3's if
branch has 24 actions and missing-name entries at exported positions 1 and 4;
conditional 10's else branch has 24 actions and a missing-name entry at 22.
F004's short branches are 3.if, 7.else, 10.else, 14.else, 21.else (23 actions),
and 24.else. There are also substitutions of otherwise readable values, not
just missing lines. The known division spelling `…/=` was normalized only for
comparison, not treated as a reader omission.

### Packet evidence (read in place)

`bb25674d6f2f7e45/game/htsw/import-errors/import-error-2026-10-21T07-28-43-939Z.json`
under `/home/opc/lg-engine/state/bots/` records a v1.3.5 F004 export crash:

* 07:28:32.994Z: window 73 opens `(2/2) Edit Actions`.
* 07:28:32.995–.997Z: SetSlot packets name slots 10/11 `Change Variable`,
  but slots 12/13 `Head`. The latter have NBT tags of 327/328 characters;
  they are not absent slots. The log stores tag hashes, not their full lore.
* 07:28:33.203Z: the first matching WindowItems packet arrives, expected count 8.
* 07:28:33.204Z: the live menu still lists `Change Variable, Change Variable,
  Head, Head` plus four controls. `waitForMenu` reports ready: 8/8 items,
  zero ticks waited.
* 07:28:33.547Z: another WindowItems for window 73 arrives, 343 ms after ready.
  Its contents are not retained. Window 74 opens at .591Z.

The retained trace has all 100 branch-page waits at the expected counts
(50 first pages with 25 menu items, 50 final pages with 8). All 287 recorded
waits finish with zero ticks waited. Other retained F003–F007 failure logs
show the same count pattern. Packet retention is limited to 500 records, so
these logs cannot reconstruct every bad field or the later successful 1.3.6
exports. They do prove that a counted, populated menu can contain unreadable
entries. The count check does not establish semantic completeness.

### Code path and cause

`waitForMenu` anchors a window-open/WindowItems pair, then checks window ID
and non-null item count. It does not check names or lore. Its visible-GUI
fallback can also succeed while readers use `Player.getContainer()`.
The comment that the first WindowItems is the complete final menu is too
strong: another snapshot can arrive after ready.

`readActionsListPage`/`readConditionsListPage` accept unknown item names as
null entries. `observedSlotsToActions` and `observedActionToAction` discard
null actions and conditions, producing shorter branches and `if ()`.
`parseLoreFields` accepts missing fields; `parseActionListItem` adds a Player
holder when Holder cannot be read. Scalar hydration only detects an ellipsis,
not absent fields. Thus a name-only Change Variable is considered hydrated.
Ordinary pagination also skips the complete-page checks used by conflict reads.

Child hydration reads the same paginated lists. Export does not recover these
values from an import cache. Trust and comparison caches are downstream of
the scan; allowing malformed scans to reach them is unsafe.

**Proven:** malformed visible items pass readiness, and the reader silently
converts unknown/missing data into successful partial results. This explains
the observed omission and empty-variable failure modes without a size/depth
limit. **Unproven:** whether later packets repair each item, whether the server
or client/bridge produces the malformed NBT, and the mechanism behind valid
but substituted values. Reported correlation with four simultaneous exports
and load is a possible amplifier, not established causation; failures exist
before that load window. No live bot operations were used in this investigation.

Subsequent evidence: `/home/opc/housing-llm-live/serial/F005.live.htsl` is
byte-for-byte identical to the source (SHA-256
`ef29dc872482e8690d38a5cb368feaf9b26ae30bc22ec40aabdbae30f318f24e`), with
1,325 lines and no diagnostic comments or empty conditions. The parallel-read
copy differs as shown above. This independently confirms intermittency, though
it does not isolate machine load from other timing differences.

### Required behavior

Reject unknown list entries and missing or invalid scalar lore before planning
or export; check pagination on ordinary action and condition reads as well as
conflict reads. Preserve explicit empty-list placeholders and valid abbreviated
values (which use existing editor hydration). Never silently filter an unread
entry when converting an observed tree to complete actions. Failure messages
must identify the unreadable menu/slot/field. A fixed delay alone cannot prove
that a server-supplied malformed item has become readable.

## Fix

* Menu waits compare the actual reader container's size and every menu slot's
  NBT with the received snapshot, within the existing bounded wait. Equal counts
  with stale lore, wrong slots, or a different visible GUI are insufficient.
* Both action and condition readers reject unknown entries, mixed empty-list
  placeholders, and missing/invalid scalar lore before parser defaults are
  applied. This also rejects incomplete Holder/Team fields.
* All action and condition reads use the existing strict pagination checks.
  Hydrated child lists must agree in count and type with a fully readable parent
  summary, including the final page. Abbreviated/unknown summaries still trigger
  the existing full child-list read.
* Full export uses the existing strict conversion of observed actions, which
  rejects unread entries instead of filtering them out. Partial observations
  used by the UI remain explicitly partial.

This is a fail-closed fix, not a claim to repair malformed Housing state. It
does not add a fixed sleep or assume that a later snapshot will repair data.
If Housing supplies internally consistent but incorrect values, the reader has
no independent source of truth for those values; this change cannot identify
that case solely from the GUI. No release or live import is part of this change.

## Verification

Dependencies were installed with `npm ci --ignore-scripts` in `language`,
`editors/common`, and `ct_module`; `language` was built with `npx tsc`.
Affected tests ran through `/home/opc/light-lock.sh`. Full checks used
`/home/opc/heavy-lock.sh`, also wrapping ct_module Vitest with `light-lock.sh`
as requested; both suites used `--maxWorkers=2`.

Actual final results:

```text
ct_module — npx vitest run --maxWorkers=2
Test Files  164 passed (164)
Tests       1298 passed | 1 skipped (1299)
Duration    42.20s

language — npx vitest run --maxWorkers=2
Test Files  14 passed (14)
Tests       201 passed (201)
Duration    2.68s

Final affected recheck — menuReadiness, readerCompleteness, conflictReadCompleteness
Test Files  3 passed (3)
Tests       81 passed (81)
```

`ct_module npm run typecheck`, `language npx tsc --noEmit`, ct_module lint,
ct_module knip, and `git diff --check` passed. Typecheck/lint findings were
corrected and rechecked; the unused-export check also caught the two GUI
diagnostic exports left behind by removing the fallback, now private.

Regressions exercise full reads, import planning, and sync; malformed names on
both pages; absent scalar fields; unreadable conditions; final-page omissions;
and a complete 25-conditional/1,250-action read. Menu-wait tests hold the item
count constant while changing lore, slot positions, window size, and window ID,
then either apply the snapshot or exhaust the bounded wait.
