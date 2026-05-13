# Debugging imports

When an import does something unexpected — a CONDITIONAL flagged for re-edit when nothing changed, an action that stays gray-pending, dup lines in the live preview, etc. — the in-game chat usually doesn't have enough information to diagnose. Field values get truncated to ~30 chars by `shortVal`, and CONDITIONAL edit details are logged as just `~EDIT [N] CONDITIONAL:` with no payload.

Use the **import trace log** for the full picture.

## Turning it on

In Minecraft chat:

```
/htsw trace on
```

Trace stays on until you `/htsw trace off` (or `/ct reload`). Run your import normally — `/import <path>` or the GUI "Import" button. When the run finishes, the chat shows:

```
[trace] wrote ./htsw/imports-trace/2026-05-13T20-04-58-789Z.json
```

That's the path *relative to the deployed module folder*. The actual absolute path is:

```
~/Library/Application Support/ModrinthApp/profiles/Housing 1.0.0/config/ChatTriggers/modules/HTSW/htsw/imports-trace/<timestamp>.json
```

(Adjust for your launcher / profile.)

When done debugging:

```
/htsw trace off
```

## File shape

```jsonc
{
  "startedAt": "2026-05-13T20:04:58.789Z",
  "finishedAt": "2026-05-13T20:06:21.450Z",
  "elapsedMs": 82661,
  "sourcePath": "/path/to/import.json",
  "queueSize": 1,
  "summary": { "imported": 1, "skipped": 0, "failed": 0, "cancelled": false },
  "events": [
    { "t": 0,    "phase": "run-begin",       "importable": null,  "data": {...} },
    { "t": 12,   "phase": "importable-begin","importable": "FUNCTION:Compass Cycle Test", "data": {...} },
    { "t": 14,   "phase": "importable-prime","importable": "...", "data": { "cacheHit": true, "cachedImportable": {...}, "desired": {...} } },
    { "t": 421,  "phase": "read-top-level-complete", "importable": "...", "data": { "count": 30, "observed": [...] } },
    { "t": 1832, "phase": "hydrate-entry-begin",     "importable": "...", "data": { "index": 5, "actionType": "CONDITIONAL", "propsToRead": ["conditions","ifActions"], "nestedSummaries": {...} } },
    { "t": 2104, "phase": "conditional-conditions-read", "importable": "...", "data": { "actionPath": "5", "conditions": [...] } },
    { "t": 2890, "phase": "conditional-ifActions-read",  "importable": "...", "data": { "actionPath": "5", "count": 3, "ifActions": [...] } },
    { "t": 2895, "phase": "hydrate-entry-complete",      "importable": "...", "data": { "index": 5, "actionAfter": {...}, "nestedReadState": "full" } },
    { "t": 8104, "phase": "diff-computed",   "importable": "...", "data": { "summary": {...}, "observed": [...], "desired": [...], "operations": [...] } },
    { "t": 8200, "phase": "apply-op-begin",  "importable": "...", "data": { "kind": "edit", "path": "5.ifActions.2", "observedAction": {...}, "desired": {...}, "fieldDiffs": [...] } },
    { "t": 9120, "phase": "apply-op-complete","importable": "...", "data": { "kind": "edit", "path": "...", "durationMs": 920 } },
    { "t": 82660,"phase": "run-end",          "importable": null,  "data": { "imported": 1, "skipped": 0, "failed": 0, "elapsedMs": 82661 } }
  ]
}
```

Key fields:

- `t` — milliseconds since `run-begin`. Lets you see WHEN something happened relative to the rest of the run.
- `phase` — what's happening (see "Event phases" below).
- `importable` — `<TYPE>:<identity>` of the importable this event belongs to, or `null` for run-level events. Lets you filter.
- `data` — the full structured payload, **not truncated**. JSON-cloned at capture time so it's a snapshot of what the importer thought, not a live reference.

## Event phases

| Phase | What it tells you |
|---|---|
| `run-begin` | Run started — queue size, source path, trust mode |
| `importable-begin` | Importer is starting work on this importable — type, identity, path |
| `importable-prime` | Cache lookup result. `cacheHit: true` + `cachedImportable: {...}` → cache primed the preview. Includes `desired` — the source-side parsed importable |
| `read-top-level-complete` | The TOP-LEVEL slot scan finished. Includes `observed[]` (each entry's `index`, `action`, `nestedSummaries`, `nestedReadState`). Nested fields are still null at this point — only the count is known via summaries |
| `hydrate-entry-begin` | About to click into a CONDITIONAL/RANDOM and read its nested content |
| `hydrate-entry-complete` | Done reading. `actionAfter` is the fully-hydrated action object |
| `conditional-conditions-read` | Sub-step: just read the CONDITIONAL's `conditions` array (full, no truncation) |
| `conditional-ifActions-read` / `conditional-elseActions-read` | Sub-step: just read the inner action list |
| `diff-computed` | The diff between observed and desired. Includes `summary` (counts), `observed[]`, `desired[]`, `operations[]`. **For each edit op, `fieldDiffs[]` lists which scalar fields differed and their full observed/desired values** — this is the most valuable piece for diagnosing false positives |
| `apply-op-begin` | Importer is starting to apply one diff operation. Different fields per kind: edit has `fieldDiffs`, move has `fromIndex`/`toIndex`, add has `desired`, delete has `observedAction` |
| `apply-op-complete` | Op finished. `durationMs` shows how long the housing menu work took |
| `run-end` | Final summary — imported / skipped / failed / cancelled / elapsed |

## Common things to look for

### "Why is this CONDITIONAL flagged for edit?"

Find the `diff-computed` event whose `data.operations[]` includes an edit on the conditional's path. Look at that op's payload. For CONDITIONAL edits, the scalar diff (matchAny) is shown — but if the diff is purely in NESTED content, the edit is driven by the inner ifActions sync.

Inner ifActions sync runs as a NESTED applyDiff during the CONDITIONAL's apply-op. Look for a later `diff-computed` event with a `pathPrefix` like `"5.ifActions"` — that's the one with the inner operations causing the parent to look "different".

### "Why is this scalar field considered changed?"

Find the `diff-computed` event with the relevant op. For an edit op, `fieldDiffs[]` looks like:

```json
[
  { "prop": "value", "kind": "value", "observed": "%var.global/p%s%var.player/s&...", "desired": "%var.global/p%s%var.player/s%g%" }
]
```

If `observed` ends in `…` (truncation marker) and `desired` is a longer string starting with the same prefix, that's a **lore-truncation false positive** — Hypixel truncated the value in the lore, the importer parsed the truncated form, and the comparison fails even though housing actually has the full value.

If `observed.holder` is `{"type":"Team"}` (no team field) and `desired.holder` is `{"type":"Team","team":"Red"}`, that's the **team-name-not-in-lore false positive** — Hypixel doesn't include the team name in the lore for team-holder conditions/actions.

### "Why did this action stay gray-pending until the end?"

Find the `apply-op-begin` for that path. If there's no matching `apply-op-complete`, the op threw mid-flight (look for `run-end` with `failed > 0` or `cancelled: true`). If both events exist, the op ran but the live-preview's morph hook didn't strip the `__add::` prefix on the line — check the prefix-stripping code in `importPreviewState.ts:applyComplete kind === "add"`.

### "Why are there duplicate lines?"

Find consecutive `apply-op-begin` events for the same actionPath but different kinds (e.g., `edit` AND `add`, or `move` AND `add`). The diff matcher emitted two ops at the same source path; the model inserted both lines and the dedup heuristic kept both.

### Time-ordered grep pattern

To pull just the operations for one importable in order:

```bash
jq '.events[] | select(.importable == "FUNCTION:Compass Cycle Test")
                 | select(.phase | startswith("apply-op-")) ' trace.json
```

To find all edit ops with field diffs:

```bash
jq '.events[]
    | select(.phase == "diff-computed")
    | .data.operations[]
    | select(.kind == "edit")
    | { observedIndex, desired: .desired.type, fieldDiffs }' trace.json
```

## Caveats

- Trace files contain the **full action / condition payloads**, including any string fields. If your source has secrets / private chat strings, treat the trace files like logs — don't paste them publicly without redacting.
- One file per import run. They're not auto-cleaned. Old traces accumulate in `./htsw/imports-trace/`. Periodically clean if disk space matters.
- `traceEvent` calls are no-ops when tracing is off, so leaving the code paths in is free. The `setTraceEnabled(true)` cost is only paid during a run.
- If `FileLib.write` fails (filesystem permission, missing parent dirs that `ensureParentDirs` couldn't create, etc.), the chat shows `[trace] failed to write trace file (was planned at ...)` and the import otherwise proceeds normally. The trace is debug aid, not import-critical.

## When to share a trace with the AI

Whenever you're investigating import behavior with the AI pair-programmer ("this conditional shouldn't have re-edited", "the animation showed dup lines", "why was this action slow"), **enable tracing, run the problematic import, then point the AI at the latest trace file.** The AI can read the JSON directly and identify exact field-level differences, op timing, cache state, etc. — which is much faster than paging through the chat output and asking back-and-forth questions.
