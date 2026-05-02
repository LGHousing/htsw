---
name: gui-development
description: How the in-game GUI overlay (panels, layout, components, focus, popovers, scroll) is structured and the CT 1.8.9 quirks you must know when changing it. Read this BEFORE touching anything under ct_module/src/gui/.
---

# GUI development

The HTSW in-game overlay is a small declarative UI framework that runs inside ChatTriggers (Rhino + Forge 1.8.9). It is not React, but the mental model is similar: a tree of immutable element descriptions is laid out and rendered every frame, with reactive values pulled through `Extractable<T>` callbacks.

**KEEP THIS DOCUMENT IN SYNC.** Whenever you change anything in `ct_module/src/gui/` — adding an element kind, changing layout semantics, swapping a CT trigger, fixing a Rhino quirk — update this file in the same change. Future agents (and you) rely on it to avoid relearning the same traps.

## Files

- `layout.ts` — element types, padding, sizing, container/scroll layout algorithm.
- `extractable.ts` — `Extractable<T> = T | (() => T)` and `extract`.
- `render.ts` — single tree renderer + click dispatcher (used by panels and popovers).
- `panel.ts` — `Panel` class: bounds, visibility, click trigger, render trigger.
- `popovers.ts` — global popover stack, anchored render, click dispatch helper, hover-suppression query.
- `focus.ts` — single global focused-input id.
- `scissor.ts` — GL scissor stack (uses ScaledResolution to convert MC scaled coords → real pixels).
- `bounds.ts` — reads the open Minecraft `GuiContainer`'s bounds via Java reflection on protected fields.
- `overlay.ts` — wires everything: registers triggers (guiRender, guiMouseClick, guiKey, guiMouseRelease), builds left/right panels, owns global state.
- `components/` — thin element-builder functions (`Button`, `Container`, `Row`, `Col`, `Input`, `Scroll`, `Text`).
- `left-panel/`, `right-panel/` — tree builders for the two anchored panels. Duplicated on purpose; they will diverge.

## Element model

`Element` is a discriminated union (`layout.ts`). Five kinds today:

| kind | extra fields | clickable? | notes |
|------|---|---|---|
| `container` | `style: ContainerStyle`, `children: Extractable<Element[]>`, optional `onClick(rect)` | yes if `onClick` set | flex layout (row/col), gap, align, padding, optional bg/hoverBg |
| `button` | `style`, `text: Extractable<string>`, `onClick(rect)` | yes | bg + centered text, hover bg |
| `text` | `style`, `text: Extractable<string>`, optional `color` | no | plain label, intrinsic size = `Renderer.getStringWidth(text)` × `LINE_H` |
| `input` | `style`, `id: string`, `value: Extractable<string>`, `onChange(v)`, optional `placeholder` | focusable | id is used for global focus + key dispatch |
| `scroll` | `style: ContainerStyle`, `id: string`, `children: Extractable<Element[]>` | passes through | vertical scroll viewport with internal offset state, scrollbar overlay, mouse-wheel + drag |

Children of `container` and `scroll` are `Extractable<Element[]>` so the list can be dynamic each frame (e.g. filter results). Layout is recomputed every frame; **there is no layout cache** — anything in the tree may change between frames.

## Layout (flex)

`Style` keys: `width`, `height` (`{kind:"px",value} | {kind:"auto"} | {kind:"grow",factor?}`), `padding`, `background`, `hoverBackground`. `ContainerStyle` adds `direction` (`"row"` | `"col"`, default `"col"`), `gap`, `align` (`"start" | "center" | "end" | "stretch"`, default `"stretch"`).

Padding accepts `number | {side, value} | {side, value}[]`. Sides: `all|x|y|top|right|bottom|left`. Resolved last-write-wins.

Layout algorithm (per container):
1. Resolve each child's main-axis size (`px`/`auto` → number, `grow` → null).
2. `leftover = mainLen - fixedSum - gapSum`. Distribute proportionally across grow children. Last grow child eats the floor remainder so totals match exactly.
3. For each child resolve cross-axis size + alignment offset and emit `{element, rect, clipRect?}`.
4. Recurse into containers/scrolls.

**`align: "stretch"` (default) only stretches children that have no explicit cross-axis size.** A child with `width: {kind:"px",...}` keeps that width even with stretch. This matches CSS flex.

`scroll` lays out children in a column with no main-axis bound, applies the scroll offset (clamped to `[0, contentH - viewportH]`), and tags every descendant `LaidOut` with `clipRect = viewport`. The renderer pushes a GL scissor for items with `clipRect`.

## Reactivity (`Extractable`)

`Extractable<T>` is `T | (() => T)`. `extract(v)` calls the function or returns the value.

Extractable today: `button.text`, `input.value`, `text.text`, `container.children`, `scroll.children`, `Panel.bounds`, `Panel.shouldBeVisible`. Anything else is static.

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

`dispatchClick(laid, mouseX, mouseY)`:
- Topmost-first walk in reverse.
- Skips items where the click is outside the `clipRect`.
- Stops at first hit on `button`, clickable `container`, or `input`.
- Sets/clears global focused-input.

## Panels

`Panel` (in `panel.ts`) registers two triggers per panel: `guiRender` and `guiMouseClick`. It calls `renderElement` for rendering and `dispatchClick` for clicking. It checks `event.isCanceled()` first; this lets higher-priority handlers (popover render at LOWEST + popover-click-from-panel guard) short-circuit.

**Multiple panels share dispatch state.** Both left and right panel handlers fire for every click. The popover dispatch is invoked from inside the panel handler, gated by `claimPopoverClick(x,y)` so it runs exactly once even with two panel triggers active.

## Popovers

`openPopover({anchor, content, width, height, onClose?})` pushes a popover onto a stack. They render last (LOWEST guiRender priority) so they appear on top. Position auto-flips: anchored *below* the trigger when the trigger is in the top half of the screen, *above* otherwise.

Click flow when a popover is open:
- Panel handler runs, sees `popoverIsOpen()`, and calls `tryDispatchPopoverClick(x,y)` (guarded so it runs once per click).
- Click inside popover rect → dispatch into popover content.
- Click outside any popover → close stale popovers (older than `OPEN_GRACE_MS = 250ms` — protects the click that just opened them).
- Either way the panel cancels the event so the inventory below doesn't see it.

Hover suppression: `mouseIsOverPopover` is exposed but the easier hook is the `interactive` flag panels pass to `renderElement` — when a popover is open, the panel passes `false` and no panel element shows hover.

Scrollbar hover suppression: items whose rect is under a visible scrollbar track *and* live inside that scroll's viewport do not show hover (the click would land on the scrollbar, not the item). Tracks are precomputed once per `renderElement` call — see `collectScrollbarTracks` in `render.ts`.

## Focus + keyboard

Single global focused-input id (`focus.ts`). `dispatchClick` sets it when an `input` is clicked, clears it when anything else clickable is clicked.

`overlay.ts` registers `guiKey` and routes key events to the focused input. **CT's `char` argument is unreliable in this version — it is `undefined` for every key.** Translate `keyCode` → character ourselves using the `KEY_TO_CHAR` map, considering shift via `KeyboardClass.isKeyDown(42|54)`. Esc/Backspace/Enter are special-cased on `keyCode` (1 / 14 / 28).

When focused, the handler calls `cancel(event)` for any printable key — this is what stops `e` from closing the inventory. Without focus, the handler returns early and MC processes the key normally.

## Mouse wheel

CT's `register("scrolled", ...)` and `register(ForgeMouseEventClass, ...)` did **not** fire reliably in this CT/Forge build (no events came through). The working approach is **polling `MouseClass.getDWheel()` from inside a `guiRender` trigger**, but only when the cursor is over a scroll viewport. `getDWheel()` consumes the wheel buffer, so calling it suppresses the inventory's own scroll handling. Skipping the call when the cursor is not over our scroll leaves vanilla wheel scroll (e.g. creative tab change) intact.

`MouseClass = Java.type("org.lwjgl.input.Mouse")`. `KeyboardClass = Java.type("org.lwjgl.input.Keyboard")`. Both are defined at the top of `overlay.ts`.

## Bounds reading (Hypixel inventory anchoring)

`bounds.ts` reads the open `GuiContainer` from `Client.getMinecraft().field_71462_r` and reflects on protected fields:
- `field_146294_l` / `field_146295_m` — screen W/H (public, direct access works)
- `field_147003_i` / `field_147009_r` — guiLeft / guiTop (**protected**, requires reflection)
- `field_146999_f` / `field_147000_g` — xSize / ySize (**protected**, requires reflection)

Rhino's property access only sees public fields, so the protected ones use `getDeclaredField + setAccessible(true)` with a class-hierarchy walk (creative inventory class doesn't declare them itself; `GuiContainer` does).

Returns `null` for non-`GuiContainer` screens (main menu, settings, etc.). The panel's `shouldBeVisible` callback uses this — when bounds are null, panels hide.

## Scissor

GL scissor uses pixel coordinates (origin bottom-left), but our layout uses MC scaled coords (origin top-left). `scissor.ts` converts via `ScaledResolution` and maintains a stack so nested scrolls work. **If a render path early-returns between push and pop, the stack is unbalanced.** Render code is structured so `pushScissor`/`popScissor` always happen in pairs.

## Trigger registration order matters

Within a single trigger type, CT fires handlers in registration order unless you call `setPriority(Trigger.Priority.X)`. `HIGHEST` runs first; `LOWEST` runs last.

- Popover `guiRender` is registered with `setPriority(LOWEST)` so it paints on top.
- Panels `guiMouseClick` runs at default priority. The popover click logic is invoked **from within the panel click handler**, not as its own trigger — that earlier (separate-trigger) approach caused the popover dispatch to fire twice per click (toggleType ran twice and undid itself).

If you add a new trigger that needs to fire before/after others, prefer `setPriority` over reordering registration calls. Be aware: setting `HIGHEST` on `guiMouseClick` was observed to double-fire in this CT build for unknown reasons; if a similar symptom appears, drop the explicit priority and use registration order or guards instead.

## CT/Rhino quirks (gotchas)

These bit us; they will bite you again. Read these before touching CT trigger code.

- `register("scrolled", ...)` does not fire in inventory contexts in this build. Use `Mouse.getDWheel()` polling.
- `register(ForgeEventClass, ...)` did not fire either despite the d.ts comment claiming it works. Stick to named string triggers + polling.
- `guiKey` fires (good), but its `char` argument is `undefined`. Use `keyCode` and translate manually.
- `cancel(event)` cancels the underlying Forge event but does **not** stop other CT handlers from firing — those handlers must check `event.isCanceled()` themselves.
- CT's chat trigger does **not** fire for messages we display via `ChatLib.chat()`. The MCP bridge can't see our own debug chat, so the diagnostic loop writes to a file (`gui-debug.log`) instead. See `armHtswGuiDebug` and `debug()` in `overlay.ts`.
- Vite-bundled `net.minecraftforge.client.event.MouseEvent` style references work at runtime (Rhino bridge), but `Java.type("…")` is safer. Use it for new Java class references.
- `Renderer.getStringWidth` returns the actual proportional-font width — use it for centering text. Do not use `text.length * CHAR_W`.
- IDE diagnostics shown after edits are often stale. Always confirm with `npx tsc --noEmit` from `ct_module/`.

## Adding a new element kind

1. Extend the `Element` union in `layout.ts` with the new variant.
2. Add intrinsic-size computation if needed (`buttonContent`, `textContent`, `inputContent` are the existing examples).
3. Handle the variant in `measure`/`resolveAxis` if it can drive layout sizing.
4. Add a render branch in `renderItem` (`render.ts`).
5. Add click semantics in `dispatchClick` if it should be interactive.
6. Add a builder in `components/<kind>.ts` and re-export from `components/index.ts`.
7. **Update this SKILL.md.**

## Adding a new component (no new kind)

If the new component is just a styled wrapper around existing element kinds, add a new file in `components/` that returns a tree built from `Container`/`Button`/etc. No layout/render changes required.

## Debugging in-game

`/htsw gui debug <seconds>` arms the diagnostic logger for that window. Output goes to `gui-debug.log` in the deployed module dir (`%appdata%/.minecraft/config/ChatTriggers/modules/HTSW/`). Per-frame state (focus, popoverOpen, bounds) is logged ~twice a second. Ad-hoc `debug(...)` calls inside trigger handlers also land there. Read with `Read` on the absolute path.

The MCP bridge (`/htsw recompile`, `/htsw gui debug N`, etc.) is the way to drive testing from outside the game. Note that bridge chat readback does **not** capture our `ChatLib.chat()` output — only inbound server messages — so always log to file when probing.
