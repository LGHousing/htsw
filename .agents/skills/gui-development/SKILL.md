---
name: gui-development
description: Guardrails for changing the HTSW in-game GUI under ct_module/src/gui/, especially retained layout, rendering and coordinate boundaries, popovers, input, scrolling, icons, and ChatTriggers/Rhino 1.8.9 behavior. Read before editing that directory; use the current TypeScript as the source of truth for APIs and feature structure.
---

# GUI development

HTSW's overlay is a declarative element tree running in ChatTriggers on Rhino and Forge 1.8.9. Read the code you are changing before relying on this skill: types, element kinds, constants, filenames, and current UI behavior belong in code, not here.

Update this skill only when a non-obvious constraint below changes or a newly verified runtime trap would otherwise be rediscovered. Do not mirror current APIs or feature inventories.

## Ownership

- Keep `gui/lib/` project-agnostic. Code in it must not import feature or application code from outside `lib/`.
- Keep mutable state with the feature that owns it. Put state in `gui/state/` only when it is genuinely shared across unrelated GUI features.
- Keep action-tree locations as structured `ActionPath` / `ActionListPath` values. Serialize them only for IDs, map keys, or trace output; never reconstruct structure by splitting a serialized key.

## Retained layout

Panels retain their laid-out trees between rebuilds and draw those retained trees every frame.

- Treat extracted draw values such as text and color as live. Treat element membership, dimensions, ordering, and other layout structure as retained.
- Call `markGuiDirty()` at the state owner when a mutation changes layout or interaction geometry. Do not rely on the timed rebuild backstop for async changes; scroll easing can postpone it. Do not make every caller reproduce the bookkeeping.
- Let the panel advance cached scroll layouts while easing. Do not add a fresh full-tree layout to wheel handling or animation frames.
- Read `layout.ts` for the current `Element` union and `Extractable` fields. Do not assume every property or closure is reactive merely because adjacent properties are.
- Set `truncate` on constrained `grow` text containing user or path data. A grow width constrains layout allocation, not text drawing.
- Keep scissor pushes and pops balanced on every path, including early returns.

Click dispatch walks topmost-first. A first click fires immediately; a qualifying second click fires `onClick` again with `isDoubleClickSecond`, then `onDoubleClick`. Suppress repeated single-click work explicitly when that is not desired.

## Rendering and coordinates

Panel rendering and topmost overlay rendering happen at different stages:

- Panels draw from `guiRender`, which maps to Forge's background-drawn event and therefore runs before Minecraft's slot foreground and tooltip rendering.
- Popovers and HTSW hover UI draw from the late `postGuiRender` path so they appear above Minecraft UI.
- If a panel begins covering the inventory rectangle, re-evaluate its Forge render event; the existing panel event will paint underneath inventory contents.

All layout, hit-testing, and clipping use HTSW overlay coordinates. Convert only at boundaries:

- Convert coordinates received in Minecraft's scaled space with `mcToOverlay` before layout, dispatch, or popover use.
- Use the overlay screen-size helpers instead of `Renderer.screen` dimensions.
- Use the overlay bounds wrappers rather than mixing raw container bounds with overlay coordinates.
- Run `Renderer.*` drawing inside the shared overlay begin/end draw boundary.
- Let `scissor.ts` perform the overlay-to-real-pixel conversion and Y flip.

Do not copy the scale math into feature code.

## Popovers and hover cards

- Use `togglePopover` for a popover owned by a re-clickable anchor. Its anchor exclusion prevents the dismissing click from immediately reopening it.
- Use `openMenu` for cursor-anchored context menus; they intentionally close on the next click.
- Let an outside click close an ordinary popover and continue to the panel below. Modal popovers absorb the dismissing click and wheel input.
- Keep popover click dispatch inside the panel click path and guarded so multiple registered panels cannot dispatch the same popover click twice.
- Keep informational hover cards separate from explicit popovers. A code-view row offers at most one hover card; merge diagnostics and decorator information into that path.
- Close popovers and clear focus when the inventory overlay disappears.

## Keyboard and mouse input

Use Forge's keyboard-input Pre event for text input. ChatTriggers' `guiKey` character argument is undefined in this build; read both the LWJGL event character and key code, forward them to the focused `GuiTextField`, and cancel the Forge event so Minecraft does not also act on the key.

Preserve these input rules:

- `cancel(event)` does not stop other ChatTriggers handlers. Handlers that must yield to earlier work need to check `event.isCanceled()`.
- Do not let global shortcuts steal typed characters from native screens such as Housing's anvil rename UI.
- Keep wheel application and vanilla suppression as two cooperating paths. Poll the LWJGL wheel accumulator on the render path for frame-rate application; use Forge's mouse-input Pre event only to cancel vanilla handling. Applying in both paths doubles scrolling, while using only the Forge path makes eased scrolling pulse.
- Route wheel input to topmost popovers before panels. Modal popovers own the wheel across their scrim.
- Do not use ChatTriggers' `scrolled` trigger when vanilla scrolling must be cancelled; it does not expose the cancellable event.
- Prefer explicit trigger priorities when ordering truly matters, but do not set `HIGHEST` on `guiMouseClick`: that priority has been observed to double-fire in this ChatTriggers build.

Use the existing `javaType` helper for new Java class lookups. Follow nearby interop when a code path deliberately uses Rhino's `java` / `javax` globals instead.

## ChatTriggers and Minecraft traps

- ChatTriggers' `guiOpened` trigger drops events whose new GUI is `null`. Subscribe to Forge's `GuiOpenEvent` directly when screen closure matters.
- Protected `GuiContainer` bounds require reflection. Preserve the cached field lookup; repeated failed reflection walks create expensive Rhino-wrapped exceptions.
- Use `Renderer.getStringWidth` for proportional text measurement. Never substitute character count times a constant.
- `ChatLib.chat()` output does not re-enter ChatTriggers' chat trigger, and bridge chat readback cannot see it. Write runtime probes to `gui-debug.log`.

## Icons

Use generated `Icons.*` literals through the `Icon` component. The build copies only icon names it finds as string literals in the bundle, so a dynamic icon choice must still enumerate every possible generated icon literal in code. After adding or removing PNGs, let the normal build regenerate the icon list or run `npm run generate:icons` when an immediate refresh is needed.

## Change checklist

For a styled composition, add or reuse a component built from existing elements. For a genuinely new primitive, trace the current `Element` union through measurement, layout, drawing, dispatch, its component builder, and exports; derive the exact required edits from the code rather than this document.

For in-game investigation:

- `/htsw gui debug <seconds>` writes GUI probes to the deployed module's `gui-debug.log`.
- `/htsw debug guiperf [clear]` reports frame gaps and retained-layout rebuild/draw costs. Clear it immediately before reproducing a hitch.
