/// <reference types="../../CTAutocomplete" />

import TaskContext from "../tasks/context";
import { waitForMenu } from "../importer/gui/helpers";
import { removedFormatting } from "../utils/helpers";

export type CaptureType = "FUNCTION" | "MENU";

export type CaptureResult =
    | { kind: "captured"; type: CaptureType; name: string }
    | { kind: "cancelled" };

type CaptureSpec = {
    /** Command to open the list view in Housing (with leading slash). */
    command: string;
    /**
     * Strip Hypixel's display affixes off the slot's display name.
     * Returns the bare importable name, or null if this slot doesn't
     * look like a valid entry (e.g. pagination button, empty slot,
     * back-to-housing arrow, etc.) — null tells the listener to
     * ignore the click and keep waiting.
     */
    extractName: (slotDisplayName: string) => string | null;
};

const SPECS: Record<CaptureType, CaptureSpec> = {
    FUNCTION: {
        command: "/functions",
        // "Find Free Slot (#0395)" -> "Find Free Slot"
        // The trailing (#NNNN) is Hypixel's per-housing function id, not
        // part of the function name we pass to /function edit.
        extractName: (raw) => {
            const ignored = raw.toLowerCase();
            if (
                ignored === "go back" ||
                ignored === "close" ||
                ignored.indexOf("previous page") >= 0 ||
                ignored.indexOf("next page") >= 0
            ) {
                return null;
            }
            const m = raw.match(/^(.+?)\s*\(#\d+\)\s*$/);
            return m !== null ? m[1] : raw.length > 0 ? raw : null;
        },
    },
    MENU: {
        command: "/menus",
        // VERIFY in-game — current guess: menu list-view shows raw names.
        // If Hypixel adds a suffix like "(N slots)" we'll strip it here.
        extractName: (raw) => (raw.length > 0 ? raw : null),
    },
};

const WAIT_FOR_OPEN_TIMEOUT_MS = 5000;

/**
 * Open the Hypixel list view for `type`, then wait for the user to
 * left-click an entry. Cancels Hypixel's normal click handler so the
 * server never sees the click — we run our own export instead.
 *
 * Resolves `cancelled` if the user closes the GUI without picking, so
 * the caller can chat a friendly note and bail.
 */
export async function captureFromHousing(
    ctx: TaskContext,
    type: CaptureType
): Promise<CaptureResult> {
    const spec = SPECS[type];

    void ctx.runCommand(spec.command);
    await ctx.withTimeout(
        waitForMenu(ctx),
        `waiting for ${spec.command} to open`,
        WAIT_FOR_OPEN_TIMEOUT_MS
    );

    // Capture the chest GuiScreen reference NOW so the close listener
    // can ignore unrelated guiClosed events. Without this, the inventory
    // close that fires when /functions opens its chest can race our
    // listener registration and resolve us as cancelled before the user
    // ever clicks anything.
    const chestGui = Client.currentGui.get();

    return await new Promise<CaptureResult>((resolve) => {
        let resolved = false;
        let mouseTrigger: { unregister: () => void } | null = null;
        let closedTrigger: { unregister: () => void } | null = null;

        const cleanup = (): void => {
            if (mouseTrigger !== null) {
                mouseTrigger.unregister();
                mouseTrigger = null;
            }
            if (closedTrigger !== null) {
                closedTrigger.unregister();
                closedTrigger = null;
            }
        };

        const finish = (result: CaptureResult): void => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(result);
        };

        mouseTrigger = register(
            "guiMouseClick",
            (
                _x: number,
                _y: number,
                button: number,
                _gui: any,
                event: any
            ) => {
                if (button !== 0) return;
                const slot = Client.currentGui.getSlotUnderMouse();
                if (slot === null || slot === undefined) return;
                const item = slot.getItem();
                if (item === null || item === undefined) return;
                const rawName = removedFormatting(item.getName());
                const extracted = spec.extractName(rawName);
                if (extracted === null) return;

                cancel(event);
                // Resolve & unregister BEFORE closing the chest, so the
                // synchronous guiClosed that close() fires lands after
                // our listener is gone (otherwise the chest-gui filter
                // would route it to finish-cancelled and the resolved
                // guard would still need to win — this is just cleaner).
                finish({ kind: "captured", type, name: extracted });
                try {
                    Client.currentGui.close();
                } catch (_e) {
                    // ignore
                }
            }
        );

        closedTrigger = register("guiClosed", (gui: any) => {
            // Only the chest we opened counts as a real cancellation.
            // The inventory close that races chest-open during /functions
            // would otherwise be treated as the user backing out before
            // they had a chance to click.
            if (gui !== chestGui) return;
            finish({ kind: "cancelled" });
        });
    });
}
