# Handoff — GUI scroll responsiveness (HTSW ct_module overlay)

**Status:** root cause found and fixed in code; changes are **staged but NOT deployed**
because the repo currently fails `tsc` due to *unrelated concurrent work* (see Blocker).
A follow-up audit ("any other dirty ones") was in progress when this handoff was requested.

Read `.claude/skills/gui-development/SKILL.md` first — it documents the overlay framework
and was kept in sync with every change below.

---

## User's prompts, verbatim (typos and all)

These are the user's messages in order. The user is on macOS (trackpad / high-res wheel).
The first message is a paste from a Discord chat with two other people (Callan, j_sse).

**1.**
```
gui scrolling is very bad and slow?
the chat part needs to be fully live (got slight delay now). and perhaps on click of it, we make it bigger
like its just delayed updates on the parts that should be moving basically
its pretty laggy updates
Image
idk but i feel like it should be instant
also heh i always wanted feature where i can filter chat by just typing but that might not be in scope of htsw
Callan [BUZZ],  — 9:45 AM
ohoh oh scrolling in chat i thguht u eant other scorlling
j_sse [::<>],  — 9:45 AM
also for other scrolling things
not just the chat section
```
(“Image” was a screenshot of the in-game chat panel.)

**2.**
```
.
```

**3.** (sent as interrupts)
```
Id dont think thats the issue its laggy/delayed shit but idk i might not like that eased wheel scrolling i gues ill try it
?
hello
```

**4.**
```
I think its better but still not super responsive when scorlling larger amounts
```

**5.** (sent as interrupts)
```
no
i was dragging the scroll bar
```

**6.**
```
Havent checked yet but it also was like delayed the scrolling basically
```

**7.**
```
The large scrolls still are just delyed its like its not updating as fast as it should refresh rate wise
```

**8.**
```
Any other dirty ones
```

**9.**
```
actually generate a handoff doc with my prompts word for word typo and all to handoff to another agent\
```

### Answers the user gave to multiple-choice questions
- Expand chat on click → **"Click chat to toggle"** (clicking the chat scrollback grows it; click again to restore). NOT yet built.
- Filter chat by typing → **"Not now"** (possibly out of scope). NOT built.
- Which scrollbar felt laggy → user's own words: **"i was scolling chat but i figured all of them actually"**
- Does FPS drop while dragging (F3) → **"Yes, FPS drops"**

---

## The actual root cause (confirmed)

The overlay is **retained-mode**: panels cache their laid-out element tree (`gui/lib/dirty.ts`,
`gui/lib/panel.ts`) and only re-run layout when `markGuiDirty()` is called or the
**`GUI_REBUILD_BACKSTOP_MS = 200ms`** backstop fires. The draw loop runs every frame (value
closures stay live), but element **positions/sizes** come from the cached layout.

`markGuiDirty()` was wired to **clicks only** (`panel.ts` `guiMouseClick`), even though
`dirty.ts`'s own comment says wheel, typed input, an in-progress drag, and active animation
should all mark dirty. They were never wired. **So scrolling never invalidated the cache and
scrolled content refreshed at ~5 Hz (every 200ms) regardless of the monitor's refresh rate.**
That is exactly the user's "delayed / not updating as fast as the refresh rate," and it's why
the easing felt like it "barely helped" — the eased frames weren't being repainted either.

### Investigation path (so you don't repeat the dead ends)
- ❌ First guess: 20 Hz wheel-input cadence + no interpolation → added easing. Helped a little, not the cause.
- ❌ Second guess: scroll acceleration for "larger amounts" → user clarified they were **dragging the scrollbar**, not wheeling. Scrapped.
- ✅ FPS-drops-on-drag (user's F3 check) pointed at per-frame cost → found `layoutScroll` was font-measuring every text row every frame just to total heights → fixed (lazy per-axis measure). Real improvement but still felt delayed.
- ✅ "not updating as fast as refresh rate" = the **dirty/backstop** gate. **This is the real fix.**

---

## Changes staged (typecheck-clean in isolation; NOT deployed)

The **core fix** is the `markGuiDirty()` wiring in `overlay.ts`. The rest are supporting wins.

1. **`ct_module/src/gui/overlay.ts`** — THE FIX
   - Import `markGuiDirty` (`./lib/dirty`) and `anyScrollAnimating` (`./lib/layout`).
   - Wheel handler: `markGuiDirty()` after a panel scroll is dispatched.
   - `guiRender` drag hook rewritten: `markGuiDirty()` every frame while dragging **or** while
     `anyScrollAnimating()` (so wheel-easing frames repaint at refresh rate).
   - Keyboard handler: `markGuiDirty()` after a typed-input `onChange` (search/chat filtering
     would otherwise lag 200ms — same latent bug).
   - `initHtswGui`: `setScrollEasingProvider(getSmoothScrolling)`.

2. **`ct_module/src/gui/lib/layout.ts`**
   - Eased wheel scrolling: `ScrollState` gained `target` + `animAt`; `setScrollTarget`,
     `advanceScrollOffset` (exponential ease, `SCROLL_SMOOTH_TAU_MS = 20`), `clampOffset`,
     `anyScrollAnimating`. `setScrollOffset` now sets offset+target (instant; used by
     autofollow/chat-stick/tab-autoscroll). Easing gated by injected `scrollEasingEnabled`
     provider (`setScrollEasingProvider`) so the lib stays project-agnostic.
   - **Lazy per-axis measurement** (perf): replaced `textContent/inputContent/imageContent/
     containerContent/measure` with `intrinsicAxis/measuredAxis/containerAxis`. Resolving a
     text element's HEIGHT no longer calls `Renderer.getStringWidth` — only WIDTH does.
     Numerically identical (135 tests pass); kills the per-frame font-measuring sink.

3. **`ct_module/src/gui/lib/render.ts`**
   - `dispatchWheel` accumulates into `target` via `setScrollTarget` (was direct offset).
   - `updateScrollbarDrag` sets offset+target together (thumb drag stays instant, no ease).

4. **`ct_module/src/gui/chat/mcChat.ts`** — chat liveness
   - Dropped the fixed `REFRESH_MS = 100` throttle. `getChatLines` now runs every frame with a
     cheap change-probe (line count + newest line's text); rebuilds the window only on change.
     New messages appear within a frame. Split `readMcBuffer` → `mcChatList` + `buildMcLines`.

5. **`ct_module/src/settings.ts`** (untracked new field) + **`gui/left-panel/settings/index.ts`**
   - New persisted `smoothScrolling` setting (default **on**) + a **"Smooth scrolling"** toggle
     in the Settings tab (`Icons.waves`/`Icons.mouse`). Off = instant/no ease. The user is
     ambivalent about easing ("might not like that eased wheel scrolling") — the toggle lets
     them decide by feel without a rebuild.

6. **`.claude/skills/gui-development/SKILL.md`** — updated for all of the above.

---

## ⛔ Blocker — cannot build/deploy right now

`git status` shows **~25 modified files I never touched** plus a new `gui/code-view/selection.ts`,
and `tsc` reports **~50 errors** about a new **`NPC` importable type**, **groups/teams/house-name**,
and `fileTree`/`ImportJsonFileNode`/`GlobalCtxt` members (matches language commit
`cb9dc21 "...add groups, teams, and house name."`). This is a **separate in-progress migration**.

- **None of the 50 errors are in files changed for this scroll work** (verified — `tsc` is clean
  for `layout.ts`/`render.ts`/`overlay.ts`/`mcChat.ts`/`settings.ts`/`settings/index.ts`).
- `install.py` runs `npm run build` whose **typecheck gate fails** on those 50 errors, and the
  deploy bundles the whole `src/` tree — so forcing it through would ship the half-finished
  migration too.

**Do not "fix" those 50 errors or touch `language/` without asking** (AGENTS.md: `language/`
is ask-before-edit; that migration is the user's active work). Wait for the tree to go green,
then deploy.

---

## Next task that was in progress: "Any other dirty ones"

The user asked whether other interactions have the same missing-`markGuiDirty` bug. After this
work, `markGuiDirty()` exists in exactly 4 places: click (`panel.ts`), wheel, drag, typed-input
(`overlay.ts`). **Everything else still rides the 200ms backstop.** Audit these (highest impact first):

- **Running import (most likely culprit).** `dirty.ts` lists "a running import" as a thing that
  should mark dirty, but nothing does. During an import the progress strip / ETA / live diff
  preview / queue rows update — anything structural (progress-bar fill width, new preview lines)
  refreshes at 5 Hz. Check the import loop / `right-panel/import-tab/*` and whether the overlay
  `tick`/`step` handler marks dirty while `isImportRunning()`. Likely fix: mark dirty each tick
  while an import is active (or while progress changes).
- **Keyboard non-typing actions** (`overlay.ts` keyboard handler, ~L531–603): `T` focuses chat
  (`setFocusedInput(CHAT_INPUT_ID)`), Esc clears focus + closes popovers, Enter/`onSubmit`,
  Ctrl+C/Ctrl+A on the code-view read-only selection (`copyActiveSelection`/`selectAllActive`).
  Focus/selection changes that affect what's drawn should mark dirty (some are value-level and
  fine — verify before adding).
- **Mouse release** (`guiMouseRelease` → `endScrollbarDrag`/`endTabDrag`) and **tab drag**
  (`right-panel/tabDrag.ts`): reordering tabs on release changes structure.
- **Async one-shots** (parse finishing, housing detection, toasts): backstop is acceptable per
  `dirty.ts` — probably leave them, but confirm a newly-shown toast at ≤200ms is fine.

Note `gui/left-panel/importables/tree.ts` has its OWN `bumpTreeRevision()` for "which rows exist"
(search/sort/expand) — separate from `markGuiDirty`. Confirm tree mutations bump BOTH where a
keyboard/async path drives them.

---

## Build / deploy / test

- Build+deploy: from `ct_module/`, run `python3 install.py` (full typecheck+lint+Vite+Java, then
  copies `dist/` to the deploy). In-game: `/ct reload`.
- **`JAVA_HOME` must be set** for the Java step. This machine had no JDK on PATH; used:
  `export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"`.
- Tests: `npm test` (from `ct_module/`) — 135 passing before the concurrent migration broke `tsc`.
- The htsw-bridge MCP was **not connected** this session, so in-game testing was hands-off
  (the user reloads + reports). Scroll *feel* needs a human regardless.

## Open product items (not started)
- "Click chat to toggle" bigger/smaller (user chose this variant). Touches `chat/index.ts` height
  + `root.ts` layout + a click handler + state.
- Chat type-to-filter: user said "Not now."
