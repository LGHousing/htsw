---
name: gui-development
description: Guardrails for changing the HTSW in-game GUI under ct_module/src/gui/, especially retained layout, rendering and coordinate boundaries, popovers, input, scrolling, icons, and ChatTriggers/Rhino 1.8.9 behavior. Read before editing that directory; use the current TypeScript as the source of truth for APIs and feature structure.
---

# GUI development

HTSW's overlay is a declarative element tree running in ChatTriggers on Rhino and Forge 1.8.9. Read the code you are changing first; types, APIs, feature inventories, and current behavior belong there. Update this skill only for non-obvious constraints or verified runtime traps.

## Ownership

- Keep `gui/lib/` project-agnostic. Code in it must not import feature or application code from outside `lib/`.
- Keep mutable state with the feature that owns it. Put state in `gui/state/` only when it is genuinely shared across unrelated GUI features.
- Keep action-tree locations as structured `ActionPath` / `ActionListPath` values. Serialize them only for IDs, map keys, or trace output; never reconstruct structure by splitting a serialized key.

## Retained layout

Panels retain their laid-out trees between rebuilds. Extracted draw values such as text and color remain live; element membership, dimensions, ordering, and other layout structure do not.
- Call `markGuiDirty()` at the state owner when a mutation changes layout or interaction geometry. Do not rely on the timed rebuild backstop for async changes; scroll easing can postpone it. Do not make every caller reproduce the bookkeeping.
- Let the panel advance cached scroll layouts while easing. Do not add a fresh full-tree layout to wheel handling or animation frames.
- Only `Extractable` fields in `layout.ts` are reactive; do not assume adjacent properties or closures are.
- Set `truncate` on constrained `grow` text containing user or path data. A grow width constrains layout allocation, not text drawing.
- Keep scissor pushes and pops balanced on every path, including early returns.

Click dispatch walks topmost-first. A first click fires immediately; a qualifying second click fires `onClick` again with `isDoubleClickSecond`, then `onDoubleClick`. Suppress repeated single-click work explicitly when that is not desired.

## Rendering and coordinates

Panel rendering and topmost overlay rendering happen at different stages:

- Panels draw from `guiRender`, which maps to Forge's background-drawn event and therefore runs before Minecraft's slot foreground and tooltip rendering.
- Popovers and HTSW hover UI draw from the late `postGuiRender` path so they appear above Minecraft UI.
- If a panel begins covering the inventory rectangle, re-evaluate its Forge render event; the existing panel event will paint underneath inventory contents.

All layout, hit-testing, and clipping use HTSW overlay coordinates. At boundaries, use `mcToOverlay` for Minecraft-scaled input, overlay screen and bounds helpers for geometry, and `scissor.ts` for real-pixel conversion and Y flip. Do not copy scale math into feature code or use `Renderer.screen` dimensions and raw container bounds directly.

Run `Renderer.*` drawing inside the shared overlay begin/end draw boundary.

## Popovers and hover cards

- Use `togglePopover` for a popover owned by a re-clickable anchor. Its anchor exclusion prevents the dismissing click from immediately reopening it.
- Use `openMenu` for cursor-anchored context menus; they intentionally close on the next click.
- Let an outside click close an ordinary popover and continue to the panel below. Modal popovers absorb the dismissing click and own wheel input before panels.
- Keep popover click dispatch inside the panel click path and guarded so multiple registered panels cannot dispatch the same popover click twice.
- Keep informational hover cards separate from explicit popovers.
- Close popovers and clear focus when the inventory overlay disappears.

## Keyboard and mouse input

Use Forge's keyboard-input Pre event for text input. ChatTriggers' `guiKey` character argument is undefined in this build; read both the LWJGL event character and key code, forward them to the focused `GuiTextField`, and cancel the Forge event so Minecraft does not also act on the key.

Preserve these input rules:

- `cancel(event)` does not stop other ChatTriggers handlers. Handlers that must yield to earlier work need to check `event.isCanceled()`.
- Do not let global shortcuts steal typed characters from native screens such as Housing's anvil rename UI.
- Poll the LWJGL wheel accumulator on the render path for frame-rate application; use Forge's mouse-input Pre event only to cancel vanilla handling. Applying in both paths doubles scrolling, while using only Forge makes easing pulse. Do not use ChatTriggers' non-cancellable `scrolled` trigger for this.
- Prefer explicit trigger priorities when ordering truly matters, but do not set `HIGHEST` on `guiMouseClick`: that priority has been observed to double-fire in this ChatTriggers build.

Use the existing `javaType` helper for new Java class lookups. Follow nearby interop when a code path deliberately uses Rhino's `java` / `javax` globals instead.

## ChatTriggers and Minecraft traps

- ChatTriggers' `guiOpened` trigger drops events whose new GUI is `null`. Subscribe to Forge's `GuiOpenEvent` directly when screen closure matters.
- An active Housing sync task owns the fullscreen task overlay while it runs, even when the cached `/wtfmap` verdict is unknown or stale. Use live presence to gate idle containers, not active task UI.
- Protected `GuiContainer` bounds require reflection. Preserve the cached field lookup; repeated failed reflection walks create expensive Rhino-wrapped exceptions.
- Use `Renderer.getStringWidth` for proportional text measurement. Never substitute character count times a constant.
- `ChatLib.chat()` output does not re-enter ChatTriggers' chat trigger, and bridge chat readback cannot see it. Write runtime probes to `gui-debug.log`.

## Icons

Use generated `Icons.*` literals through `Icon`. The build copies only literal icon names, so dynamic choices must enumerate every possibility. The normal build regenerates the list; run `npm run generate:icons` only when an immediate refresh is needed.

## Change checklist

Build styled compositions from existing elements. Wire genuinely new primitives through measurement, layout, drawing, dispatch, their component builder, and exports, deriving the exact edits from the current `Element` code.

For in-game investigation:

- `/htsw gui debug <seconds>` writes GUI probes to the deployed module's `gui-debug.log`.
- `/htsw debug guiperf [clear]` reports frame gaps and retained-layout rebuild/draw costs. Clear it immediately before reproducing a hitch.
