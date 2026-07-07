---
name: gui-development
description: How the in-game GUI overlay (panels, layout, components, focus, popovers, scroll) is structured and the CT 1.8.9 quirks you must know when changing it. Read this BEFORE touching anything under ct_module/src/gui/.
---

# GUI development

The HTSW in-game overlay is a small declarative UI framework that runs inside ChatTriggers (Rhino + Forge 1.8.9). It is not React, but the mental model is similar: a tree of immutable element descriptions is laid out and rendered every frame, with reactive values pulled through `Extractable<T>` callbacks.

**KEEP THIS DOCUMENT IN SYNC.** Whenever you change anything in `ct_module/src/gui/` — adding an element kind, changing layout semantics, swapping a CT trigger, fixing a Rhino quirk — update this file in the same change. Future agents (and you) rely on it to avoid relearning the same traps.

## Files

The library code (project-agnostic UI primitives) lives in `gui/lib/`. Project-specific implementation (panel wiring, inventory anchoring, panel content) lives directly under `gui/`. Implementations import from `../lib/...`; library files never import from outside `lib/`.

Library — `gui/lib/` (project-agnostic UI primitives + screen/theme):
- `layout.ts` — element types, padding, sizing, container/scroll layout algorithm.
- `extractable.ts` — `Extractable<T> = T | (() => T)` and `extract`.
- `dirty.ts` — retained-layout invalidation (`markGuiDirty`, `GUI_REBUILD_BACKSTOP_MS`). Panels reuse claid-out trees until a dirty revision, bounds change, or backstop rebuild.
- `anchors.ts` — per-frame registry of named region rects. A container with `anchorKey: "…"` reports its laid-out rect every rendered frame (written from `renderElement`'s item loop); `getAnchorRect(key)` returns it, or null once it's ~300ms stale (region stopped rendering, e.g. tab switched away). Used by the tour's spotlight; usable by anything that must point at live UI from outside the tree.
- `render.ts` — single tree renderer + click dispatcher (used by panels and popovers).
- `images.ts` — icon `Image` cache + texture warming, and MC item-stack rendering for the `mcItem` element. See **Icons** below for the load-path quirks.
- `panel.ts` — `Panel` class: bounds, visibility, click trigger, render trigger.
- `popovers.ts` — global popover stack, anchored/modal render, click dispatch helper, hover-suppression query.
- `hoverCards.ts` — delayed, scrollable informational hover cards that absorb wheel/click input without becoming modal.
- `anchoredRect.ts` — shared below/above placement and screen clamping used by popovers and hover cards. Right-aligns to the anchor by default; pass `align: "left"` for cursor-anchored placement (hover cards anchor at the mouse x, so right-aligning would put the card entirely left of the pointer).
- `menu.ts` — `openMenu(x, y, actions[])` builds a context-menu popover from `{label, onClick, icon?}` actions, plus `{kind: "separator"}` dividers. Auto-closes on click. Menu width auto-sizes to the widest label via `Renderer.getStringWidth` (floored at `MIN_MENU_WIDTH`, plus an icon allowance when any action has an `icon`); callers don't need to truncate. The `(x, y)` is a 0×0 anchor and the popover **right-aligns** to it (menu's right edge sits at `x`), so for a split-button drop-up pass the trigger's right edge (`rect.x + rect.w`). Idle menu items use the panel background (only hover lights up) — with the default button gray, the item rectangle reads as the menu's box and the menu's symmetric padding looks like a lopsided border. For a menu opened from a **re-clickable trigger** (a split-button caret, not the cursor), pass `{key, trigger: rect}`: the menu toggles shut on a second click of the same trigger, anchored to the trigger rect with `excludeAnchor` on so the outside-click close pass doesn't race the reopen (a bare cursor menu with `excludeAnchor: false` would close-then-reopen and get stuck open). Cursor menus opt out of that guard on purpose (`excludeAnchor: false`) so any click closes them.
- `focus.ts` — single global focused-input id.
- `inputState.ts` — per-input `GuiTextField` instances (cursor, selection, clipboard, arrow keys).
- `scissor.ts` — GL scissor stack. Multiplies overlay coords by `getEffectiveOverlayScale()` to get real pixels (see Coordinate space).
- `overlayScale.ts` — scale boundary helpers. `OVERLAY_SCALE_TARGET = 4` (the cap), `getEffectiveOverlayScale()` (per-frame actual), `mcToOverlay`, `getOverlayScreen{W,H}`. See **Coordinate space** below.
- `bounds.ts` — reads the open Minecraft `GuiContainer`'s bounds via Java reflection and converts them to overlay space; provides fullscreen panel rect + chat rect helpers.
- `theme.ts` — color/size/glyph constants. `lib/popovers` reads its panel/scrim colors from here, so `theme` is treated as part of `lib`.
- `components/` — thin element-builder functions (`Button`, `Container`, `Row`, `Col`, `Input`, `Scroll`, `Text`, `Icon`, `McItem`).

App state — `gui/state/` (genuinely-global mutable state ONLY; split by concern, with `index.ts` as a convenience re-export barrel — nothing else lives here):
- `paths.ts` — active + export `import.json` path. The active path starts empty on module load; recents are user-picked, not auto-opened. `getExportImportJsonPath()` is the *effective* destination: a manual pick wins, else it falls back to the current house's bound file (so a bound house Just Works even after a `/ct reload` where no uuid transition fired `housing.ts`'s auto-select), else the active path.
- `newExportTarget.ts` — the sticky "new exports land here" file, keyed by the base export destination and persisted to `export-targets.json`. `getNewExportTarget()` (null when unset), `getEffectiveNewExportTarget()` (falls back to the base), `setNewExportTarget()`. Only NEW importables honor it — routing lives in `exportTargets.ts`; re-exports stay on their declaring file.
- `housing.ts` — current housing UUID. `setHousingUuid` has one deliberate side effect: on a uuid *transition* into a house with a bound import.json (`importCache/houseBindings` reverse index, fed by the file's top-level `houseUuid` key), it auto-selects that file as the export/compare destination via `setExportImportJsonPath`. Manual destination picks made afterwards still win.
- `trust.ts` — **per-house trust set** with `isHouseTrusted` / `setHouseTrust` / `isCurrentHouseTrusted`, persisted to `trusted-houses.json`.
- `selectionSet.ts` — Importables-tab multi-select checkbox set.
- `autoTrack.ts` — auto-track source set.
- `flags.ts` — `parseInProgress` + import-sound mute.
- `index.ts` — re-export barrel over the above, plus cross-area re-exports of `knowledge/rows` and `import-tab/importProgress` so existing `from "../state"` call sites resolve. Owns no state itself.

Parse cache service — `gui/parsing/` (a service, not "state"):
- `parses.ts` — the single parse authority + per-file cache. Decides freshness by a **fingerprint** (mtimes of the import.json and every file it references via `allReferencedPaths`), re-validated throttled (`FP_RECHECK_MS`) so a referenced-file edit is picked up within ~0.4s without a separate watcher. The recheck stats referenced files on the game thread, so it is doubly bounded: the overlay tick polls only while `frameVisible()` — with no GUI open HTSW must do zero per-tick disk I/O (an always-on poll caused a confirmed in-world FPS-lag report; external edits are picked up on the next GUI open instead) — and each sweep stats at most `FP_SWEEP_BUDGET` files per call, assembling across ticks, so a big project never lands its whole fingerprint as a one-tick stat spike mid-import. Owns the disk snapshot and is the only thing that calls the htsw parser. `invalidateParseCacheEntry` forces a fresh parse; `touchParseCacheMtime` marks a file in-sync after an in-place edit.
  - **Never call `parseImportJsonBlocking` from render/element-build code (or any per-frame getter).** A cold parse (no in-memory entry) runs a full htsw parse of the import.json *and every referenced file* on the calling thread — for a big project that is the hundreds-of-ms-to-second client freeze that keeps recurring. Render code MUST use `requestParse(path)`: it returns the warm cache immediately, or `null` while it queues the cold parse to run off-frame (drained one-per-tick by `processPendingParses`, pumped from the overlay tick). Callers render an empty/"pending" state (use `isParsePending(path)`) until the cache warms a frame or two later. `getParseAt(path)` is a pure read (never parses). `parseImportJsonBlocking` is reserved for the reparse driver and user-initiated import/export tasks, where a brief freeze is expected. This is a single-threaded "non-blocking" — the parse still runs on the main thread, just deferred off the paint path, never concurrently (Rhino has no safe background-thread parse).
- `parseSnapshot.ts` — on-disk persisted parse output, keyed by import.json path; skips the ~1s cold full parse after `/ct reload` when the user opens a project and nothing referenced has changed.
- `reparse.ts` — thin DRIVER over `parses.ts`: loads on active-path change (gentle, snapshot-served), polls the authority each tick the overlay is visible, and runs selected-parse side effects when the cache entry changes. It does not store a second parsed result; selected parse reads derive from the parse cache. It does not auto-discover or parse a remembered project on `/ct reload`; recents stay available in the picker until the user opens one. `reparseNow()` is the one explicit lever: immediate force-fresh of the active path for user-initiated "I know it changed" moments (recompile, rename). Forced refreshes go through `markParseStale` (keeps the last-good parse for readers, re-parses on next authority read); `invalidateParseCacheEntry` is only for files that are actually gone. Owns no parsing/snapshot/mtime logic itself.
- `selectedParse.ts` — read-only helper for the selected import.json's cached parse (`getSelectedParsedResult`). This is derived from `paths.ts` + `parses.ts`; never add a mutable active-parse store.
- `importablePaths.ts` — centralized importable→path lookups: `importableSourcePath` (htsl/.snbt/json), `importableSubListPath(imp, kind)` for sub-lists (`onEnterActions`/`onExitActions` on REGION; `leftClickActions`/`rightClickActions` on ITEM), and `allReferencedPaths`. Resolves spans through `sourceMap.getFileByPos` so a list with `actionsPath: "..."` returns the htsl while inline JSON returns the import.json.

Code-view data — `gui/code-view/` (the ONE renderer + everything it parses/colors):
- `htslParse.ts` — `parseHtslFile` + `actionsToLines`, consumed by `lineModel.ts` for the source preview.
- `diffPalette.ts` — the `DiffState` union + color tables (`COLOR_BY_STATE` / `ROW_BG_BY_STATE`) + `COLOR_CURSOR` (the focus-cursor color; the cursor is NOT a diff state). Shared vocabulary; holds no logic.
- `sourceDiff.ts` — STATIC diff producer: per-action `DiffState` comparing source vs the import cache ("what would change vs last import"), for the View tab. Lazy, cached per file. Also `houseActionAt(filePath, actionPath)` — the cache's (house's) version of one action, backing the hover card on edited lines.
- Diagnostic spans and formatted diagnostic blocks live in `src/diagnostics/`; chat and View-pane hover cards consume the same presentation.
- `selection.ts` — read-only text selection for the code view (the View pane is NOT editable; deliberate — editing lives in VS Code/Monaco). One active selection across both code views, keyed by `(scrollId, line id, source column)`. The enabling trick is `TokenSpan.srcStart`, stamped by `wrapTokensIntoVisualRows`: it records where each (possibly wrapped/space-stripped) visual token begins in the unwrapped source line, so a click on a wrapped row maps back to a source column. `identity` (the file path, or `__live__`) is published every frame by the code view; a changed identity drops the selection so same-line-id collisions across files can't mis-copy. Copy reconstructs from `joinTokenText` by source column — **independent of the highlight**, so a highlight glitch can never corrupt the copied text.

Code-view text selection mechanics: every line row is now clickable+hoverable. Left-press = `beginSelection` (caret), drag = `onRowDrag` from the row's `onHover` gated on `Mouse.isButtonDown(0)` (same press→hover→release pattern as `tabDrag`; wheel-scroll mid-drag extends because the row under a stationary cursor changes). Double-click = `selectWord`. A plain click on a *link* token still opens the link and skips selection — starting a drag from a linked token isn't supported (acceptable: links are rare/short). The highlight is built in `lineRow.ts` by splitting tokens at the selection bounds and wrapping the selected run in a background `Container` (auto-width shrink-wraps to the text, so it aligns pixel-exact since `TEXT_PAD=0` and MC's font has no kerning) plus a `grow` margin box to show an included trailing newline — no new render-layer code. Selection mutations call `markGuiDirty()` because the highlight changes row structure from hover/keyboard paths, not only clicks. Ctrl+C / Ctrl+A are handled in `overlay.ts`'s keyboard handler when no input is focused AND `frameVisible()` (so other screens keep their Ctrl+C); clipboard write is AWT `Toolkit`+`StringSelection` via lazy `javaType` (what `GuiScreen.setClipboardString` does internally). Selection clears on file switch and on overlay hide.

Code-view row hover: each row gets at most ONE hover card, built by `gui/code-view/diagnosticHover.ts:offerLineHover` — the row's diagnostics (if any) followed by the decorator's `LineDecorations.hoverLines` (lazy callback, invoked only while hovered). Don't add a second hover path per row; merge into this one.

Diff decorators — `gui/right-panel/decorators.ts` (kept OUT of `code-view/` so the renderer stays generic; the `LineDecorator` interface lives in `code-view/lineTypes.ts`):
- `diffDecorator` — View tab; reads `sourceDiff`. Supplies `hoverLines` on edit ("In the house: <printed action>") and add lines.
- `progressDecorator` — live import tab; reads `import-tab/livePreview` (each `PreviewLine`'s own `diffState`/`completed`, plus the live cursor + phase scalars). There is no separate overlay map — `livePreview` is the single live store.

Right-panel state — `gui/right-panel/`:
- `selection.ts` — preview/confirm + file-tab state for the right-panel source preview, plus the synthetic live-import tab. The live tab is not stored with confirmed/preview file tabs; it is derived from the active import path and can stay open after a run for final diff review. Tab-state mutators call `markGuiDirty()` because tour/starter-project setup can switch previews outside a click.

Import-session state — `gui/right-panel/import-tab/`:
- `livePreview.ts` — LIVE diff producer: per-action `DiffState` driven by import events during an actual import (was `previewLines.ts` + the `importPreviewState.ts` barrel). It renders through the right-panel live pseudo-file tab. Preview line/cursor mutators call `markGuiDirty()` so diff rows and cursor movement repaint at event speed.
- `focusedLine.ts` — per-file focused-line id for the code view. Mutations call `markGuiDirty()`.
- `importProgress.ts` — import-session progress, ETA, per-queue-row run state. `setImportProgress` and active-path/session-label setters call `markGuiDirty()` because the progress bar, live tab, and footer shape are layout-driven.
- `queue.ts` — the dynamic import `QueueItem` queue. Queue/session mutators call `markGuiDirty()` so delayed import/export cleanup updates immediately.

Knowledge — `gui/knowledge/`:
- `rows.ts` — knowledge-row storage (`getKnowledgeRows` / `setKnowledgeRows` / `refresh*`).
- `knowledgeBuild.ts` — time-sliced/progressive rebuild of the per-importable dots.
- `diagnosticCounts.ts` — per-importable diagnostic bucketing for the left-rail badges.

Persistence — `gui/persistence/`:
- `recents.ts` — persisted MRU list of recently opened import.json paths (`gui-recents.json`). Used by `popovers/file-browser.ts` and the Importables Recent button.

Menus — `gui/menus/`:
- `fileMenu.ts` — shared file-row context menu (Add/Remove from queue + OS-shell actions), used by both the left-panel rows and the right-panel tab right-click.

Importer hookup — `importer/diffSink.ts`:
- Defines `ImportDiffSink` (`markMatch`/`beginOp`/`completeOp`/`end`) and a single global active sink. `applyActionListDiff` captures and clears the sink on entry (so nested syncs in CONDITIONAL/RANDOM bodies stay silent), pre-marks untouched desired actions as `match`, and emits per-op events. The session (`importables/importSession.ts`) sets/clears the sink around each importable; the GUI's `startImport` (in `right-panel/import-tab/importController.ts`) wires sink events into the single `import-tab/livePreview` store — `markPlanned*` / `markMatch` / `applyComplete` for per-line state and `setCurrent` for the cursor — keyed by the importable's source-file path.

Popovers — `gui/popovers/`:
- `confirm.ts` — `openConfirmPopover({title, lines, confirmLabel, danger, onConfirm})`: modal yes/no, width auto-fits the widest line (`Renderer.getStringWidth`, truncate as backstop). Use this for destructive/surprising actions, never a "confirm" context-menu entry.
- `text-prompt.ts` — `openTextPromptPopover({title, description?, placeholder, prefill, submitLabel, width?, onSubmit})`: the one shared "ask for a string" modal. `description` renders dim hint lines under the title (put guidance/examples there, not crammed into the placeholder); the popover height grows per line and `width` widens it to fit them. Use it before writing another bespoke single-input popover (rename-file and the export new-project popover predate it; new-project needs its layout checkbox, so it stays bespoke).
- `tour.ts` — first-load walkthrough. Each step can spotlight a region (via `lib/anchors` keys: `tour:project-tabs` — only the Importables + Houses tabs, NOT Settings, since the "two sides of your project" step is about those two; `tour:left-body`; and `tour:right-view` / `tour:right-import` — the right View pane reports two anchors so the View step spotlights the reading area and the Import step spotlights the queue/Import footer, not the whole pane) — a border is drawn around the rect from a default-priority `postGuiRender` (paints before the LOWEST popover pass, so the card sits on top) — and can run a `setup` that switches the left tab or previews a source file so the user looks at the actual UI being described. The card is a `sticky` anchored popover (outside clicks fall through; using the GUI mid-tour is allowed), reopened per step because the anchor changes. Auto-starts once per session from the overlay tick when the GUI is visible, no import running, and `gui-onboarding.json` says it hasn't been done. `/htsw tour` resets onboarding (also restores the dismissed sample-project block) and re-arms the auto-start. If you move/rename an anchored region, keep its `anchorKey` or the step falls back to screen-center with no spotlight.
- `includeTreePicker.ts` — the shared selectable include-tree UI (collapsible import.json rows via the parser's `fileTree`, plus a pinned "New …" action) used by BOTH the Importables "Move to…" picker (`left-panel/importables/moveDestinationPicker.ts`) and the export sub-target selector (`export/destinationPicker.ts`). Owns the node model + row rendering; each caller keeps its own expansion/filter state and opens its own popover. Don't re-implement a second include-tree renderer.
- The name-a-new-project prompt lives in `gui/export/newProjectPopover.ts` (opened from the export destination picker, `gui/export/destinationPicker.ts`). It has a "Folder per type" toggle (default ON) that scaffolds `<section>/import.json` includes via `createEmptyProjectFiles(..., {sectionFolders})`. The picker's lower half is a **"New exports land in"** include-tree selector (rooted at the base destination, via `includeTreePicker`) whose selected node is stored as the sticky sub-target (`state/newExportTarget.ts`), plus a **"New import.json…"** row that creates a nested — possibly double-nested — `<folder>/import.json` via `createIncludedFolderInTree` and routes exports there; flat projects still get the one-shot "Split by type…" migration (`restructureProjectPerSection`). New-export routing itself is decided in `htsw-editor-common/project` (`importJsonTargetForSectionEntry` in `exportTargets.ts`: existing declaration wins, else the reachable sticky sub-target, else the section folder, else the base), not in the GUI. There is **no** in-game "add importable" popover — new importables are created from the VS Code tools view.
- `rename-file.ts` / `rename-importable.ts` — in-place rename of a project file / an importable.
- `edit-function.ts` — in-place editor for a single importable field (a value, an x/y/z position, or full region bounds), written via `updateImportableField`; despite the name it edits any importable type, not just functions.
- `alias.ts` — per-house alias editor. `openAliasPopover(rect, uuid)` takes the target UUID explicitly so the Houses tab can edit any known house, not just the currently-detected one.
- `file-browser.ts` — modal file browser for picking an `import.json`.
- `open-menu.ts` — Hypixel `/functions /eventactions /regions …` shortcut menu.

App shell — `gui/`:
- `overlay.ts` — wires everything: registers triggers, owns the single fullscreen panel, runs the tick handler (reparse, focus, popover cleanup).
- `root.ts` — root tree builder: arranges LeftPanel / center cutouts (transparent above + below the inventory) / RightPanel / ChatPanel around the inventory bounds. Right column gets `padding-left: SCREEN_PAD` so it mirrors the screen-edge gap on the inventory-facing side. The left column is rail (grow) + `ChatPanel` (fixed height pinned to the bottom, reaching the screen-edge gutter).
- `chat/` — the bottom-left chat surface. `index.ts` builds `ChatPanel` (a vanilla-style scrollback `Scroll` above the `ChatInputBar`) and owns the input/submit logic + `CHAT_INPUT_ID`; the global `T` shortcut (in `overlay.ts`) focuses that input. The scrollback sticks to the newest line unless the user scrolls up (resumes following on scroll-back-to-bottom). `mcChat.ts` reads MC's own chat-line buffer (`GuiNewChat.drawnChatLines` via reflection, formatted text with `§` codes) so server messages, `/htsw` output, and printed diagnostics all appear with vanilla ordering/formatting; rows render with NO `color` so `Renderer.drawString` honors their `§` codes. Reflection is try/caught (degrades to empty). `overlay.ts` calls `refreshChatLines()` every `guiRender`; it probes the buffer's line count + newest line's text and calls `markGuiDirty()` only when the cached row set changes, so a new message appears within a frame while idle frames cost two reflective reads.
- `knowledge-status.ts` — derives `STATUS_COLOR` / `STATUS_LABEL` / `statusForImportable` / `knowledgeStatusByImportable` from `state` for the left-rail badges.
- `bottom-toolbar/` — slim, no-background strip under the inventory: only Housing Menu + the `/functions …` shortcut split-button.
- `left-panel/` — three tabs: **Importables** (importables list + Open file/folder/Browse buttons), **Houses** (per-house browser: `houses/index.ts` owns the house selector/Trust/Alias/Detect chrome and composition, `houses/contentBrowser.ts` owns the per-type content tabs, rows, and export action bar — `typeBrowserSection(getViewedUuid)` is the seam), and **Settings** (global Mute import sounds + Auto-proceed imports + Smooth scrolling toggles).
- `right-panel/` — single **View** pane: file-tab strip, source/live code view, and footer. The tab strip always paints, with a muted `No file` placeholder when no file tabs exist. File labels come from `compactFileLabel`, so `.../functions/import.json` displays as `functions.import.json` instead of every tab saying `import.json`. The live import diff appears as a synthetic upload tab that follows the currently importing `.htsl`; the footer holds the scrollable queue, the import progress strip during a run, and the Import button. During an import, the footer progress strip shows ETA/progress and Pause/Step/Cancel controls.
- `right-panel/import-tab/importController.ts` — `startImport()` (reads per-house trust via `isCurrentHouseTrusted()`) and `importablesForImport()`. The diff-sink wiring lives here now (was previously in `bottom-toolbar/index.ts`).

Importables rows (`gui/left-panel/importables/rows.ts` + `tree.ts`) deliberately separate the row body from local controls. File/import.json headers, included import.json group headers, importable rows, and sub-list rows use body single-click to preview in the View pane (`previewSelect`) and body double-click to pin/keep the tab (`confirmSelect`). Queue membership changes only through the checkbox control, whose hit box spans the row prefix before the type marker. Expansion changes only through caret controls, whose hit box spans the row prefix before the file icon: import.json headers expand parsed contents, included import.json headers expand nested include groups, and expandable importables show metadata/sub-list rows. Included import.json headers are actual file rows, so they use the JSON file icon affordance instead of a type-color marker. Right-click menus still come from `composeFileMenu` / `composeImportableMenu`.

Expanded MENU importables additionally list one row per slot (`menuSlotRow`), between sub-list and metadata rows: real item icon via `McItem` when the slot NBT has an `id`, `Slot N` label, and the item's display name (no `color` prop, so its `§` codes render). Slot-row body click previews the slot's actions file when the slot declares actions, else its item file; each slot row's own caret (keyed by `menuSlotExpansionKey`, same `importableExpansion` set) expands two file child rows (`menuSlotFileRow`: Item → `.snbt`, Actions → `.htsl`). Inline slot JSON (no `nbtPath`/`actionsPath`) falls back to the declaring import.json and labels the file column `inline`. Slot rows carry their own diagnostic badge via `diagnosticCountsForFile` (per-file bucket of the same memoized attribution as the per-importable badge), so a menu's badge count can be traced to the slot file that produced it. They also carry a per-slot link-status dot (`cache-status/menuSlotStatus.ts`: parsed slot vs the house's cached menu via the shared `menuSlotCanonical`, matched by Housing slot NUMBER — the two slots arrays can be ordered differently); the dot renders only for a trusted house with a cached copy of the menu, since the menu row's own icon covers every other state. The View pane's house-diff coloring works for slot `.htsl` files too: `findFileTarget` resolves them to a `slots[<parsedIdx>].actions` target carrying `menuSlot`, and cache-side lookups re-locate the slot by number through `cacheListPrefix` (`sourceDiff.ts`).

The per-row file↔house status icon comes from ONE shared vocabulary (`gui/cache-status/linkStatus.ts`: `linkStatusIcon` / `LinkStatusKey` — `matches`/`differs`/`present`/`oneSided`/`unknown`) used by **both** this page and the Houses tab, so the same relationship renders with the same icon+color on each. The two pages are opposite projections of that one relationship (Importables iterates your files, Houses iterates a house's contents), so their overlap is expected, not redundant. Each page maps its own state set into the shared keys and supplies its own tooltip (file-side framing on Importables, house-side on Houses). Don't re-introduce status dots or a second icon/color table — and on Importables, a *scanned* absence must keep overriding any Knowledge match/differ state. Types with no house-side listing (ITEM — anything not in `HOUSE_CONTENT_TYPES`, tested via `isScannableType`) can't be scanned for presence at all: an item exists only where an action/menu references it. Their Importables status skips the presence/scan branch and reads the import baseline only (`cacheStateForImportable` → matches/differs, else a neutral "import to place it"); never show them the "scan this house" tooltip. NPCs ARE scannable (enumerated by `listAllNpcs`), but keyed by POSITION, not name — `importableIdentity` returns `x,y,z`. A house row carries an optional display `label` (`HouseImportable.label`, stored in the presence record by the scan and derived from the importable for content records) so the browser shows the NPC's name over the position; `item.name` stays the identity for all matching/diff/export lookups. When you add a position-identified scannable type, set the label at both write paths in `importCache/cache.ts` (`writePresence` + `houseDisplayLabel`), not just in the row renderer.

Importables tree perf invariants: the tree is **virtualized** (`renderRows` in `left-panel/importables/tree.ts` materializes only viewport rows from `TreeRow` descriptors) and the descriptor list itself is **cached across frames** (`treeRows()` — rebuilt on a revision bump or a 300ms TTL). Descriptors encode structure only; per-frame state (dots, checkboxes, colors) lives in `content()` closures that still run per visible row per frame. **Any interaction that changes which rows exist — expansion toggles, search, filter, sort, source add/remove — must call `bumpTreeRevision()` (`rowModel.ts`); it also calls `markGuiDirty()` so the retained panel layout rebuilds immediately.** Async changes (reparses, enumeration refreshes) ride the TTL on purpose. `/htsw treeperf` prints row count + rebuild timings. Relatedly, `memoizedImportableHash` has a 250ms wrapper-keyed front cache so per-row dot checks don't stringify importable metadata every frame; the TTL exists because edit popovers mutate parsed importables in place.

Include groups: an expanded import.json's contents mirror the parse's include structure instead of rendering the merged flat list. The parser builds the structure itself — `parse.gcx.fileTree` (`ImportJsonFileNode`: path + declared importables + included child nodes, recorded as data during parse, NOT derived from spans, precisely so snapshot-restored parses keep working); `left-panel/importables/includeTree.ts` just re-exports it (`IncludeNode`) with a single-node fallback for parse-less rows. Included files render as nested collapsible group rows (`includeGroupRow` in rows.ts), emitted BEFORE the file's own importables — folders-before-files, so groups don't hide under a long flat run. Expansion lives in `includeGroupExpansion`; an explicit toggle wins over the default (collapsed normally, expanded while search/type filter narrows; narrowing also hides match-less groups). An import.json that another file in the same source includes loses its own top-level row (`resultsForSource` in tree.ts); mutual includes (a cycle, already a parse error) keep both rows rather than hiding both. A file included from several places has exactly ONE full ("home") group in the tree — the parser homes it at the include edge whose parent directory contains it (`rehomeFileTree` in the language metadata; falls back to first-parsed for cross-folder-only files) and records every other edge as a `reference: true` leaf. Reference nodes render as unexpandable jump rows (`includeReferenceRow` in rows.ts): click expands the home's ancestor groups, scrolls the virtualized tree to the home row (by `TreeRow.key`, set only on home group rows), and flashes it (`jumpToIncludeNode` in tree.ts + `setJumpFlash` in rows.ts). While search/filter narrows, reference rows disappear with the other content-less groups. Paths inside the parse (`fileTree` node paths) are in the language fileLoader's format — backslashes on Windows — so run them through `canonicalPath` before comparing with GUI-side fullPaths. The parse snapshot (v13) round-trips `fileTree` (importables stored as indices into the flat array, plus the `reference` flag); forgetting a future include-related field there silently flattens the tree on every snapshot-served reload.

Move to…: importable rows get a "Move to…" context-menu action (`openMoveDestinationPicker` in `left-panel/importables/moveDestinationPicker.ts`) that opens a collapsible destination tree of the include structure — caret expands, clicking a row moves, with a filter input above `MOVE_SEARCH_THRESHOLD` destinations. The tree model + row rendering come from the shared `popovers/includeTreePicker.ts` (same component the export sub-target selector uses); this file just owns the move state and action. It is NOT gated on the project already having includes: a pinned "New folder…" row (via `popovers/text-prompt.ts`) creates `<folder>/import.json` and moves in one step — `createIncludedFolderInTree` in `htsw-editor-common/project` hangs the include off the DEEPEST existing file whose folder contains it, so `functions/combat` includes from `functions/import.json` and the include tree keeps mirroring the directory tree. The anchor coordinates are passed in from rows.ts's `lastMenuX/Y` (captured in `rowHandler`, since a `MenuAction.onClick` gets no coordinates — chaining works because `openMenu` items close the menu BEFORE running onClick). The mechanics live behind `project/importJsonMutations.ts:moveImportableEntry` (delegating to `htsw-editor-common/project`): re-declare in the destination, remove from the source (rolling back the insert if removal fails, so a half-move can't leave a duplicate declaration), and relocate every referenced .htsl/.snbt — re-relativized to the destination, suffixed on filename collision, COPIED instead of moved when another declaration anywhere in the tree still references the file, and left in place (reference shortened) when it already lives under the destination folder. Shared row furniture (`caretButton`, `SECTION_BY_TYPE`, row colors) lives in `rowModel.ts` so the picker and rows.ts don't import each other.

Importables click scheme (deliberate, user-set): **single-click row body = preview** (`previewSelect`; preview tabs render with `§o` and are replaced by the next preview). **Double-click row body = pin/keep open** (`confirmSelect`). **Checkbox click = queue toggle only.** **Caret click = expand/collapse only.** Child controls early-return on `isDoubleClickSecond` so a double-click on a checkbox/caret does not also open the row.

House binding on Importables file rows: an import.json header row (`resultRow` in `left-panel/importables/rows.ts`) shows a house chip (icon + alias, green when it's the house you're standing in) when the file declares a top-level `houseUuid`, read render-safely from `requestParse(path).parsed.gcx.houseUuid`. The row's right-click menu offers "Bind to <current house>" / "Unbind from <bound house>", which write the key through `exporter/importJsonWriter.ts:setHouseUuidKey` (jsonc-parser surgical edit) and then `invalidateParseCacheEntry` + `requestParse` so the parse, chip, and `housing-bindings.json` reverse index refresh off-frame.

## Element model

`Element` is a discriminated union (`layout.ts`). Six kinds today:

| kind | extra fields | clickable? | notes |
|------|---|---|---|
| `container` | `style: ContainerStyle`, `children: Extractable<Child[]>`, optional `onClick(rect, info)`, `onDoubleClick(rect)`, `onHover(rect, mouseX, mouseY)` | yes if `onClick` or `onDoubleClick` set | `onHover` is observational and does not make a container clickable. Otherwise this is the flex-layout primitive used by buttons and rows. |
| `text` | `style`, `text: Extractable<string>`, optional `color`, `underlineColor`, `tooltip`, `tooltipColor`, `truncate` | no | `underlineColor` draws a one-pixel underline across the laid-out fragment and is used for exact diagnostic spans. Simple tooltips still use the deferred `postGuiRender` path. `truncate: true` clips the string with a trailing `...` to the laid-out rect width — opt-in, because bare text is allowed to overflow (some rows rely on a later sibling painting over the spill). Hovering a truncated text with no explicit `tooltip` reveals the full string as an **in-place** deferred tooltip: the box paints over the anchor with the revealed glyphs aligned exactly on the original ones (spilling over siblings to the right), in the label's own color; an explicit `tooltip` suppresses the reveal. **`width: grow` does NOT constrain the draw** — the renderer paints the full string from the rect's left edge and only clips when `truncate` is set, so any `grow` text holding dynamic/user content (file names, house/importable names, paths, queue labels) must also set `truncate` or it bleeds over the next sibling. Tab-style `Button`s have no constrained width to truncate against: the left tab bar (`tabs.ts`) measures its `availW` and drops to icon-only (+ tooltip) when the widest label doesn't fit; the houses content tabs use the same measured drop-to-icon-only fallback via the shared fit helper in `tabs.ts`, keeping the truncating label for the in-between case. |
| `input` | `style`, `id: string`, `value: Extractable<string>`, `onChange(v)`, optional `placeholder` | focusable | id is used for global focus + key dispatch |
| `scroll` | `style: ContainerStyle`, `id: string`, `children: Extractable<Element[]>`, optional `axis: "x" \| "y"`, optional `locked: Extractable<boolean>` | passes through | scroll viewport with internal offset state, scrollbar overlay, mouse-wheel + drag. `axis` defaults to `"y"` (vertical); `axis: "x"` is a horizontal strip (e.g. the View-tab file-tab bar) — wheel-scrolls only, no scrollbar is drawn. `locked: true` consumes wheel + thumb-drag input without moving the viewport (the live-import code view, where autoFollow drives the offset). |
| `image` | `style`, `name: Extractable<IconName>`, optional `color: Extractable<number>` (ARGB tint), optional `tooltip` + `tooltipColor` (same as `text`) | no | 16×16 default; loaded via the `ImageIO` pattern in `lib/images.ts` and cached per name (NOT `Image.fromAsset` — see **Icons** below). The icon PNGs are monochrome white, so `color` recolors them — implemented with `Renderer.colorize(...)` before `drawImage`, **not** `GlStateManager.color` (CT's `drawImage` resets GL color to white when its internal `colorized` is null, so only `colorize()` survives the draw). `Icon({ color, tooltip })` exposes both. |
| `mcItem` | `style`, `item: string` (e.g. `"diamond_sword"`, `minecraft:` prefix optional), `count: number` | no | renders an actual MC item stack via the vanilla `RenderItem` (in `lib/images.ts`), with a count overlay when `count > 1`. 16×16 default. Builder is `McItem`. |

Children of `container` and `scroll` are `Extractable<Element[]>` so the list can be dynamic on rebuild (e.g. filter results). Panels retain their laid-out tree between dirty revisions; value closures still resolve during every draw, but changing which elements exist or their sizes requires `markGuiDirty()` or waiting for the 200ms backstop.

## Retained Layout Dirtying

Panels cache laid-out element trees to avoid rebuilding every `children: () => [...]` closure on idle frames. `drawLaid` still runs every frame, so text/color/background/input value closures and hover/click-flash stay live. Structural changes — rows added/removed, scroll offsets, selection highlight boxes, tab order, progress-bar segments — need a dirty revision.

Dirty sources live at interaction boundaries and GUI state-store boundaries:
- `panel.ts` marks dirty for clicks.
- `overlay.ts` marks dirty for wheel scroll, scrollbar drag/eased wheel frames, typed input, Enter submit, chat refresh, and tab-drag autoscroll.
- Stores that mutate layout-driving state call `markGuiDirty()` themselves: Importables `bumpTreeRevision`, right-panel tab selection/drag, code-view selection/focused line, import progress/live preview/queue, and the Importables checkbox set.

Async one-shots such as parse completion, housing detection, and toasts may ride `GUI_REBUILD_BACKSTOP_MS`; keep them explicit only when a user-visible interaction or live-progress surface needs frame-rate updates.

## Layout (flex)

`Style` keys: `width`, `height` (`{kind:"px",value} | {kind:"auto"} | {kind:"grow",factor?}`), `padding`, `background`, `hoverBackground`. `ContainerStyle` adds `direction` (`"row"` | `"col"`, default `"col"`), `gap`, `align` (`"start" | "center" | "end" | "stretch"`, default `"stretch"`).

Padding accepts `number | {side, value} | {side, value}[]`. Sides: `all|x|y|top|right|bottom|left`. Resolved last-write-wins.

Layout algorithm (per container):
1. Resolve each child's main-axis size (`px`/`auto` → number, `grow` → null).
2. `leftover = mainLen - fixedSum - gapSum`. Distribute proportionally across grow children. Last grow child eats the floor remainder so totals match exactly.
3. For each child resolve cross-axis size + alignment offset and emit `{element, rect, clipRect?}`.
4. Recurse into containers/scrolls.

**`align: "stretch"` (default) only stretches children that have no explicit cross-axis size.** A child with `width: {kind:"px",...}` keeps that width even with stretch. This matches CSS flex.

**Measurement is per-axis on purpose (`intrinsicAxis`/`measuredAxis`/`containerAxis`, NOT a both-axes `measure`).** Resolving a text element's HEIGHT returns the constant `LINE_H` *without* calling `Renderer.getStringWidth` (`func_78256_a`) — the font measurement only runs when a WIDTH is actually needed. This matters because `layoutScroll` resolves every child's main-axis size each frame to total `contentLength`; for a vertical scroll that's height, so an unvirtualized list (e.g. the 100-line chat scrollback) would otherwise font-measure every line every frame purely to sum constant heights — a confirmed FPS sink on drag/scroll. **Don't reintroduce a both-axes `measure()` in the content-length / main-axis path**; keep height resolution font-free.

`scroll` lays out children along its axis with no main-axis bound, applies the scroll offset (clamped to `[0, contentLength - viewportMain]` where main is height for `"y"`, width for `"x"`), and tags every descendant `LaidOut` with `clipRect = viewport`. The renderer pushes a GL scissor for items with `clipRect`. The `ScrollState` (in `layout.ts`) carries `axis` + `contentLength` (size along the scroll axis), plus the eased-scroll pair `offset` (rendered position) and `target` (where it's heading); vertical scrolls reserve the scrollbar track width on the cross axis, horizontal strips draw no scrollbar (wheel-scroll only) and steal no height.

Wheel scrolling is **delta-proportional** and **eased**: the overlay wheel handler converts `Mouse.getEventDWheel()` to notches (`dwheel / 120`, keeping real magnitude — fractional for high-res wheels/touchpads, >1 when a fast flick coalesces into one event) and every wheel path (panels, popovers, hover cards) receives that float. `dispatchWheel` accumulates `WHEEL_SCROLL_STEP` (3 rows) per notch into the scroll's `target` (via `setScrollTarget`), and `layoutScroll` eases the rendered `offset` toward that target each frame. Don't collapse the delta back to ±1 — that made fast scrolling crawl. Offsets can be fractional; the layout cursor rounds at placement.

The easing exists because MC drains mouse-wheel events in `runTick` (~20Hz) while panels repaint every frame (60Hz+), so applying the target directly makes a continuous/trackpad scroll travel in visible ~50ms steps. `advanceScrollOffset` (in `layout.ts`) does `offset = target + (offset − target)·exp(−dt/τ)` with wall-clock `dt` and `τ = SCROLL_SMOOTH_TAU_MS` (~20ms) — the exponential form is **exact under split dt**, so advancing more than once per frame (the wheel hit-test relays out, then the paint relays out) integrates to the same result; no per-frame guard needed. It snaps (no ease) on first use, after a >100ms gap (tab switch / sub-10-FPS), or within ½px of target. **Only the wheel is eased.** Thumb-drag (`updateScrollbarDrag`) and every programmatic jump — `setScrollOffset` (chat stick-to-bottom, code-view autofollow, tab-strip edge autoscroll) — set `offset` and `target` together so they track instantly.

Easing is **user-toggleable** ("Smooth scrolling" in the Settings tab, persisted in `gui-settings.json`, default on). `layout.ts` is project-agnostic so it can't read the setting directly — it calls an injected predicate `scrollEasingEnabled` (default `() => true`); `initHtswGui` wires it to `getSmoothScrolling` via `setScrollEasingProvider`. When off, `advanceScrollOffset` snaps to target (the original instant-but-tick-stepped feel). If a "scroll lags" report persists with easing **off**, it's framerate, not input cadence — profile per-frame layout cost (e.g. `layoutScroll` measures every child's main-axis size each frame; for a vertical scroll that needlessly runs `Renderer.getStringWidth` on every text row to get a constant height).

## Reactivity (`Extractable`)

`Extractable<T>` is `T | (() => T)`. `extract(v)` calls the function or returns the value.

Extractable today: `button.text`, `input.value`, `text.text`, `text.color`, `text.tooltip`, `text.tooltipColor`, `container.children`, `scroll.children`, `style.background`, `style.hoverBackground`, `Panel.bounds`, `Panel.shouldBeVisible`. Anything else is static.

Pattern: keep a module-level mutable, expose it via `() => state` and mutate it via the `onChange`/onClick callback.

```ts
let searchQuery = "";
Input({
  id: "left-search",
  value: () => searchQuery,
  onChange: v => { searchQuery = v; },
});
Scroll({
  id: "results",
  children: () => filteredResults().map(resultRow),
});
```

## Render + dispatch

`renderElement(root, x, y, w, h, mouseX, mouseY, interactive)` (in `render.ts`):
- Computes layout via `layoutElement`.
- Renders items in pre-order (parent first, children on top).
- For items with `clipRect`, pushes a scissor before rendering and pops after.
- `interactive=false` disables hover effects entirely — used so panels don't show hover when a popover is intercepting clicks.
- After items, draws scrollbar overlays for any `scroll` whose content overflows.
- Calls a container's `onHover(rect)` only when the normal clipping, interactivity, and scrollbar-interception hover checks pass.

`dispatchClick(laid, mouseX, mouseY)`:
- Topmost-first walk in reverse.
- Skips items where the click is outside the `clipRect`.
- Stops at first hit on `button`, clickable `container`, or `input`.
- Sets/clears global focused-input.
- Detects double-clicks: if a click lands within the previously-clicked rect within `DOUBLE_CLICK_MS` (350ms), the second click fires `onClick(rect, true)` and then `onDoubleClick(rect)` if defined. The first click always fires `onClick(rect, false)` immediately — there is no delay-and-coalesce. Handlers that should *not* repeat work on the second click should early-return when `isDoubleClickSecond` is true. The double-click latch resets after firing so triple-clicks don't chain into a second double.

## Panels

`Panel` (in `panel.ts`) registers two triggers per panel: `guiRender` and `guiMouseClick`. It calls `renderElement` for rendering and `dispatchClick` for clicking. It checks `event.isCanceled()` first; this lets higher-priority handlers (popover render at LOWEST + popover-click-from-panel guard) short-circuit.

CT's `guiRender` maps to Forge's `GuiScreenEvent$BackgroundDrawnEvent` — it fires after MC's dim gradient but **before** slot/foreground/tooltip rendering. Painting here means MC's hover tooltip (rendered later in `drawScreen`) overlays our right panel instead of being covered by it. The inventory bg + slot items also paint after us, but our panels sit *around* the inventory bounds (not over them), so they don't actually overlap pixel-wise. If you ever change the panel layout to cover the inventory rect, this will paint underneath — switch to a custom Forge event (e.g. `GuiContainerEvent$DrawForeground` after translation back) instead.

**Multiple panels share dispatch state.** Both left and right panel handlers fire for every click. The popover dispatch is invoked from inside the panel handler, gated by `claimPopoverClick(x,y)` so it runs exactly once even with two panel triggers active.

## Popovers

`openPopover({anchor, content, width, height, key?, onClose?})` pushes a popover onto a stack. They render on `postGuiRender` at LOWEST priority — i.e. *after* MC's drawScreen completes — so they paint on top of everything including MC's hover tooltips, keeping them modal. (Panels by contrast paint at `guiRender`/BackgroundDrawnEvent, before MC's tooltip; see the Panels section.) Position auto-flips: anchored *below* the trigger when the trigger is in the top half of the screen, *above* otherwise.

`sticky: true` popovers are never dismissed by outside clicks, and those clicks fall through to the panels — the GUI stays fully usable underneath (the tour card). Close them programmatically. `closeAllPopovers()` also leaves sticky popovers alone (it's for clearing transient menus/forms — e.g. `openMenu` calls it, and a context menu opening must not whisk the tour away); pass `closeAllPopovers(true)` only for a genuine teardown when the overlay/inventory is gone.

`togglePopover({key, ...})` is the toggle-style helper for re-clickable triggers (e.g. a Filter button that reopens-or-dismisses): if a popover with the same `key` is open it closes it; otherwise it opens a new one.

Click flow when a popover is open:
- Panel handler runs, sees `popoverIsOpen()`, and calls `tryDispatchPopoverClick(x,y)` (guarded so it runs once per click via `claimPopoverClick`).
- Click inside popover rect → dispatch into popover content, panel cancels the event, returns.
- Click outside every popover → auto-close popovers and **fall through** to the panel's normal `dispatchClick`. This is intentional: the same click that closes a popover should also focus an input or hit a button under the cursor. **Exception:** modals (`placement: "modal"`) absorb the dismissing click — closing a modal does NOT propagate to the panel underneath, since modals are interaction-blocking by design.
- The exception: if the click lands on the popover's own anchor AND `excludeAnchor` is true (default), the popover stays open. This avoids a race with `togglePopover` where auto-close fires first, then the trigger's `onClick` reopens a fresh popover, requiring a second click to dismiss. Cursor-anchored menus (`openMenu`) opt out by passing `excludeAnchor: false` since they have no re-clickable trigger — any subsequent click should close them.

Hover follows click propagation: panels pass `interactive = !mouseIsOverPopover(x, y)` to `renderElement`, so panel elements light up on hover anywhere a click would still reach them — only positions actually under a popover suppress panel hover.

Scrollable hover cards are separate from popovers. They open after a stable hover delay, remain alive while crossing from anchor to card, and absorb wheel/click input inside the card. Explicit popovers always suppress and close hover cards.

When the inventory closes (`getContainerBounds() === null`), the tick handler in `overlay.ts` calls `closeAllPopovers(true)` and clears focus so popovers don't linger across opens (the `true` forces sticky popovers like the tour card to close too, since nothing can render once the overlay is gone).

Scrollbar hover suppression: items under a scrollbar **thumb** do not show hover (the click would start a thumb drag, not reach the item). Hover suppression, drag start, and the scrollbar render all share one geometry source — `scrollbarThumbRect` / `getClickInterceptor` in `render.ts` — so visual feedback always matches click propagation. Clicks on the empty part of the track fall through to the element underneath.

## Focus + keyboard

Single global focused-input id (`focus.ts`). `dispatchClick` sets it when an `input` is clicked, clears it on any other click — including clicks on inert panel space (the dispatch's no-hit fallthrough also calls `setFocusedInput(null)`). A separate `guiMouseClick` handler in `overlay.ts` clears focus when the click misses every visible panel entirely.

Inputs delegate to vanilla MC's `GuiTextField`. We keep one instance per input id in `inputState.ts`; it handles cursor placement, drag-select, arrow keys, home/end, shift-select, Ctrl+A/C/V/X, backspace/delete, and the blinking cursor. We disable its built-in background drawing (`setEnableBackgroundDrawing(false)`) and `setCanLoseFocus(false)` so external focus state is the source of truth. Width/height are final on the field, so we recreate the field if the laid-out size changes (text + cursor are copied across); xPosition/yPosition are mutable and updated each frame.

Keyboard input is routed via Forge's `GuiScreenEvent$KeyboardInputEvent$Pre` (registered via `register(ForgeClass, cb)`). Inside the handler we read the real char with `Keyboard.getEventCharacter()` and the keycode with `Keyboard.getEventKey()` — **CT's `guiKey` `char` argument is `undefined`**, which is why we don't use that trigger. Esc/Enter are handled by us (clear focus); everything else is forwarded to `GuiTextField.textboxKeyTyped(char, key)`. After forwarding, we read `getText()` and call `onChange` if the text changed. We always `cancel(event)` when an input is focused — this is what stops `e` from closing the inventory.

`tickAllFields()` calls `updateCursorCounter` on every field each tick (cursor blink); `applyFocus(focusedId)` syncs our focus state into each field's `setFocused`.

## Mouse wheel

We hook Forge's `GuiScreenEvent$MouseInputEvent$Pre` (registered via `register(ForgeClass, cb)`). It fires per `Mouse.next()` event *before* `GuiScreen.handleMouseInput` runs. In the handler we read `Mouse.getEventDWheel()` (per-event wheel), compute scaled mouse coords from `Mouse.getEventX/Y` + `ScaledResolution`, and if the cursor is over one of our scroll viewports we dispatch the scroll AND `cancel(event)` to suppress MC's reaction.

Open popovers see the wheel first via `tryDispatchPopoverWheel(mx, my, dir)` — popovers paint on top, so they should also intercept scroll. Modals absorb wheel anywhere on screen even outside their rect (their scrim already blocks click fall-through). Only when no popover is under the cursor do we fall through to the panel scroll walk.

**Important:** an earlier approach polled `Mouse.getDWheel()` from `guiRender`. That is too late — MC processes mouse events in `runTick` before rendering. It also doesn't suppress: `getDWheel()` is the accumulator, while `GuiContainer`/`GuiContainerCreative` read per-event via `Mouse.getEventDWheel()`, and the two are independent. Cancelling the Pre event is the only thing that actually stops creative-inventory scroll/tab change.

CT's `register("scrolled", ...)` exists but doesn't pass the underlying event, so it can't cancel. CT's `register(ForgeClass, ...)` *does* fire for `GuiScreenEvent$MouseInputEvent$Pre` despite earlier docs claiming Forge events were unreliable in this build.

`MouseClass = Java.type("org.lwjgl.input.Mouse")`. `KeyboardClass = Java.type("org.lwjgl.input.Keyboard")`. `ForgeMouseInputEventPre = Java.type("net.minecraftforge.client.event.GuiScreenEvent$MouseInputEvent$Pre")`. All defined at the top of `overlay.ts`.

## Bounds reading (Hypixel inventory anchoring)

`bounds.ts` reads the open `GuiContainer` from `Client.getMinecraft().field_71462_r` and reflects on protected fields:
- `field_146294_l` / `field_146295_m` — screen W/H (public, direct access works)
- `field_147003_i` / `field_147009_r` — guiLeft / guiTop (**protected**, requires reflection)
- `field_146999_f` / `field_147000_g` — xSize / ySize (**protected**, requires reflection)

Rhino's property access only sees public fields, so the protected ones use `getDeclaredField + setAccessible(true)` with a class-hierarchy walk (creative inventory class doesn't declare them itself; `GuiContainer` does).

Returns `null` for non-`GuiContainer` screens (main menu, settings, etc.). The panel's `shouldBeVisible` callback uses this — when bounds are null, panels hide.

## Coordinate space

The overlay caps at `OVERLAY_SCALE_TARGET = 4` real pixels per overlay unit, but otherwise tracks MC's current GUI scale. All internal coordinates (layout rects, mouse coords used by hit-testing, screen dims, scissor inputs) live in this overlay space.

The effective scale per frame is `getEffectiveOverlayScale() = min(OVERLAY_SCALE_TARGET, mcScale)`. When MC is at-or-below the cap (vanilla, which maxes at 4), we match it exactly — so on Normal (scale 2) the overlay also renders at 2 and looks the same size as the inventory it sits next to. When a mod pushes MC above the cap (scale 5+), the overlay stays at 4 so it doesn't become unusably large. MC's own auto-clamp on small windows is handled implicitly, since `mcScale` is the post-clamp value.

How it works:
- `getMcScale()` computes the actual scale via `realW / scaledW` rather than `ScaledResolution.func_78325_e()`, because vanilla 1.8.9 caps `scaleFactor` at 4 and mods that allow scale 5+ typically override `getScaledWidth/Height` but leave `scaleFactor` untouched.
- `beginHtswOverlayDraw()` (in `panel.ts`) applies `glScale(effectiveOverlayScale / mcScale)` **on the projection matrix** (not modelview — projection survives intermediate matrix manipulation by font/icon rendering paths). It also pushes a Z-translate on modelview so the overlay paints above other GUI. `postGuiRender` popovers go through the same begin/end so they pick up the transform.
- Triggers receive coords in MC's current scaled space. We convert at the boundary via `mcToOverlay(coord)` (in `lib/overlayScale.ts`):
  - `Panel`'s render + click handlers (`panel.ts`)
  - `overlay.ts` mouse-wheel handler (uses raw real-pixel `Mouse.getEventX/Y` and divides by `getEffectiveOverlayScale()` — equivalent)
  - `overlay.ts` scrollbar-drag `guiRender` and focus-clear `guiMouseClick`
  - popovers' `postGuiRender` (`popovers.ts`)
- `bounds.ts` returns raw MC-scaled coords (untouched). `getContainerBoundsOverlay()` in `lib/overlayScale.ts` is the wrapper that converts; consumers (`overlay.ts:frameBounds`, `root.ts:getStableBounds`) route through it.
- `scissor.ts` multiplies rect by `getEffectiveOverlayScale()` to reach real pixels.
- Code that wants the screen in overlay coords calls `getOverlayScreenW/H` (NOT `Renderer.screen.getWidth/Height`, which return MC's current scaled dims).

If you add a new entry point that receives MC scaled coords, **convert with `mcToOverlay` before passing into layout / dispatch / popovers**. If you add code that draws via `Renderer.*`, make sure it runs inside a `beginHtswOverlayDraw()`/`endHtswOverlayDraw()` pair.

## Scissor

GL scissor uses pixel coordinates (origin bottom-left), but our layout uses overlay coords (origin top-left, scale per-frame from `getEffectiveOverlayScale()`). `scissor.ts` multiplies by `getEffectiveOverlayScale()` and y-flips against `getOverlayScreenH()`. It maintains a stack so nested scrolls work. **If a render path early-returns between push and pop, the stack is unbalanced.** Render code is structured so `pushScissor`/`popScissor` always happen in pairs.

## Trigger registration order matters

Within a single trigger type, CT fires handlers in registration order unless you call `setPriority(Trigger.Priority.X)`. `HIGHEST` runs first; `LOWEST` runs last.

- Popover `postGuiRender` is registered with `setPriority(LOWEST)` so it paints last (on top of MC's tooltip too — they're modal). Panel render uses `guiRender` (BackgroundDrawnEvent), which is the *earlier* event; the two don't compete.
- A tooltip queued by **popover content** is drawn at the end of `drawPopovers` (inside its GL block), not by the standalone deferred-tooltip pass. Both passes run at `postGuiRender`/LOWEST and CT's tie-break among equal-priority handlers isn't stable, so relying on the standalone pass to run *after* the popover pass left the chip painting behind the popover. Drawing it in `drawPopovers` guarantees it lands on top; the standalone pass then finds nothing queued and only covers the no-popover (panel) case.
- Panels `guiMouseClick` runs at default priority. The popover click logic is invoked **from within the panel click handler**, not as its own trigger — that earlier (separate-trigger) approach caused the popover dispatch to fire twice per click (toggleType ran twice and undid itself).

If you add a new trigger that needs to fire before/after others, prefer `setPriority` over reordering registration calls. Be aware: setting `HIGHEST` on `guiMouseClick` was observed to double-fire in this CT build for unknown reasons; if a similar symptom appears, drop the explicit priority and use registration order or guards instead.

## CT/Rhino quirks (gotchas)

These bit us; they will bite you again. Read these before touching CT trigger code.

- `register("scrolled", ...)` doesn't expose the event so you can't cancel it — useless for suppressing vanilla wheel handling. Use Forge `GuiScreenEvent$MouseInputEvent$Pre` instead (see Mouse wheel section).
- `register(ForgeEventClass, ...)` *does* work for at least `GuiScreenEvent$MouseInputEvent$Pre`. Earlier notes claiming it didn't fire were wrong (or specific to a different event class).
- `register("guiOpened", ...)` **silently drops null gui events.** CT's `ClientListener.onGuiOpened` opens with `if (event.gui == null) return;` (verified by disassembling `ctjs-2.2.1-1.8.9.jar`), so the JS handler never sees `displayGuiScreen(null)`. If you need to intercept screen *closures* — e.g. the placeholder-screen swap in `overlay.ts` that hides the mid-import flash and keeps the cursor put — subscribe to `javaType("net.minecraftforge.client.event.GuiOpenEvent")` directly.
- `guiKey` fires (good), but its `char` argument is `undefined`. Use `keyCode` and translate manually.
- `cancel(event)` cancels the underlying Forge event but does **not** stop other CT handlers from firing — those handlers must check `event.isCanceled()` themselves.
- CT's chat trigger does **not** fire for messages we display via `ChatLib.chat()`. The MCP bridge can't see our own debug chat, so the diagnostic loop writes to a file (`gui-debug.log`) instead. See `armHtswGuiDebug` and `debug()` in `overlay.ts`.
- Vite-bundled `net.minecraftforge.client.event.MouseEvent` style references work at runtime (Rhino bridge), but `Java.type("…")` is safer. Use it for new Java class references.
- `Renderer.getStringWidth` returns the actual proportional-font width — use it for centering text. Do not use `text.length * CHAR_W`.
- `Java.type("…").class` is **undefined** in this Rhino build, so `SomeClass.class.isInstance(obj)` throws (this silently broke `T`-to-chat for a release — the throw aborted the focus handler). To class-check a screen/object, use the string pattern the rest of the overlay uses: `String(obj.getClass().getName()).indexOf("GuiRepair") >= 0`, inside a try/catch.
- IDE diagnostics shown after edits are often stale. Always confirm with `npx tsc --noEmit` from `ct_module/`.

## Icons

PNGs live in `ct_module/assets/icons/*.png` (16×16, kebab-case filenames). Two pieces of build automation make this useable + small:

1. **Enum generator** (`scripts/generateIconsList.ts`, runs before `tsc` via `npm run build`'s prefix step): scans `assets/icons/` and writes `src/gui/lib/icons.generated.ts` exporting `Icons` (a `{ camelKey: "kebab-name" } as const` object) and `IconName` (the union type). Re-run manually with `npm run generate:icons` after adding/removing PNGs.
2. **Tree-shake plugin** (`iconShakePlugin` in `vite.config.ts`, fires in `closeBundle`): reads every emitted `.js` in `dist/`, scans for each known icon-name as a quoted string literal, and copies *only* the matched PNGs **flat into `dist/assets/`** (no `icons/` subfolder — CT 1.8.9 was observed to hang at `/ct reload` when the deployed module dir contained a nested assets subfolder; HTSL and HousingEditor also keep PNGs flat). `install.py` then mirrors `dist/assets/` to the deploy.

Usage:

```ts
import { Icon } from "./gui/lib/components";
import { Icons } from "./gui/lib/icons.generated";

Row({ children: [
  Icon({ name: Icons.aArrowDown }),
  Text({ text: "Sort ascending" }),
]});
```

`IconProps.name` is typed as `IconName`, not plain `string`, so dynamic lookups (`Icons[someVar]`) fail typecheck — that's deliberate. The shake is string-based: it greps the bundle for `"<icon-name>"`, and a dynamic key would silently drop the PNG. If you need dynamic icons, list every possible name in a literal-typed array first so they all land in the bundle:

```ts
const ARROWS: IconName[] = [Icons.arrowUp, Icons.arrowDown];
```

Icons load lazily on first render and are cached per name in `lib/images.ts`, via `new Image(javax.imageio.ImageIO.read(java.io.File(...)))` — **not** `Image.fromAsset`/`Image.fromFile`, which other CT 1.8.9 modules also avoid (the convenience helpers don't load reliably in this CT build; `Java.type(...)` at module top level was also observed to hang CT, hence the bare `java`/`javax` globals). There is no module-load icon predecode; `warmIconTextures()` (called from the panel paint path) draws each newly cached icon once offscreen so its GL texture upload doesn't flash a gray box on first real draw. A failed load is cached as `null` (so no per-frame retry/log spam) — if a missing-icon symptom appears, the cause is almost always that the shake didn't pick it up.

## Adding a new element kind

1. Extend the `Element` union in `layout.ts` with the new variant.
2. Add a per-axis intrinsic-size branch in `intrinsicAxis` (the `case`s for `text`/`input`/`image`/`mcItem`/`scroll` are the existing examples) — return the size for the requested axis only; don't compute the other axis.
3. If it can drive layout sizing, `resolveAxis`/`measuredAxis` already route through `intrinsicAxis`, so usually no extra wiring is needed.
4. Add a render branch in `renderItem` (`render.ts`).
5. Add click semantics in `dispatchClick` if it should be interactive.
6. Add a builder in `components/<kind>.ts` and re-export from `components/index.ts`.
7. **Update this SKILL.md.**

## Adding a new component (no new kind)

If the new component is just a styled wrapper around existing element kinds, add a new file in `components/` that returns a tree built from `Container`/`Button`/etc. No layout/render changes required.

## Debugging in-game

`/htsw gui debug <seconds>` arms the diagnostic logger (`lib/debugLog.ts`) for that window. Output goes to `gui-debug.log` in the deployed module dir. While armed, the overlay tick samples state (frameVisible, popover count, parseInProgress, housing uuid) ~4×/s via `debugLog(...)`. **Render exceptions are logged ALWAYS, not just while armed**: panel renders, per-popover renders, and tinted `drawImage` calls are individually try/caught and land in the log with a truncated stack via `debugLogError(where, e)`. The drawImage catch also calls `Renderer.finishDraw()` — CT's drawImage can throw from `image.getTexture()` BEFORE its own finishDraw (verified in CT 2.2.1 source), which leaves `Renderer.colorized` set; while set, CT's `drawString`/`drawRect` override every requested color, turning the rest of the frame gray with invisible text. Never call `Renderer.colorize` without an immediately-following draw that completes.

The MCP bridge (`/htsw recompile`, `/htsw gui debug N`, etc.) is the way to drive testing from outside the game. Note that bridge chat readback does **not** capture our `ChatLib.chat()` output — only inbound server messages — so always log to file when probing.
