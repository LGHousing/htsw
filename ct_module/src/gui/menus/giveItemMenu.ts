import type { Importable, ImportableItem } from "htsw/types";

import {
    giveItemsInBackground,
    resolveImportableItemToGive,
    resolveRawSnbtToGive,
    unsignedGiveReason,
    type GiveableItem,
    type GiveSummary,
} from "../../housingSync/items/giveItem";
import { Icons } from "../lib/icons.generated";
import type { MenuAction } from "../lib/menu";
import { shortPath } from "../lib/pathDisplay";
import { ACCENT_DANGER, ACCENT_SUCCESS, ACCENT_WARN } from "../lib/theme";
import { getHousingUuid } from "../state";
import { showToast } from "../toast";

/** Give for one declared item: its project SNBT with the cached signature. */
export function giveItemMenuAction(importable: ImportableItem): MenuAction {
    const reason = unsignedGiveReason(importable, getHousingUuid());
    return {
        label: "Give",
        icon: Icons.handCoins,
        disabled: () => reason !== null,
        tooltip: reason ?? undefined,
        onClick: () => {
            const resolved = resolveImportableItemToGive(importable, getHousingUuid());
            if (!resolved.ok) {
                showToast(`Cannot give ${importable.name}: ${resolved.reason}`, ACCENT_WARN);
                return;
            }
            startGive([{ label: importable.name, item: resolved.item }]);
        },
    };
}

/** Give for every declared item under a file row; absent when there are none. */
export function giveAllItemsMenuAction(importables: readonly Importable[]): MenuAction[] {
    const items: ImportableItem[] = [];
    for (const importable of importables) {
        if (importable.type === "ITEM") items.push(importable);
    }
    if (items.length === 0) return [];
    return [
        {
            label: `Give all items (${items.length})`,
            icon: Icons.handCoins,
            onClick: () => {
                const housingUuid = getHousingUuid();
                const giveable: GiveableItem[] = [];
                const skipped: string[] = [];
                for (const item of items) {
                    const resolved = resolveImportableItemToGive(item, housingUuid);
                    if (resolved.ok) giveable.push({ label: item.name, item: resolved.item });
                    else skipped.push(`${item.name} (${resolved.reason})`);
                }
                if (skipped.length > 0) {
                    ChatLib.chat(
                        `&e[htsw] Not giving ${skipped.length} item${skipped.length === 1 ? "" : "s"}: ${skipped.join(", ")}`
                    );
                }
                if (giveable.length === 0) {
                    showToast("No items to give", ACCENT_WARN);
                    return;
                }
                startGive(giveable);
            },
        },
    ];
}

/** Give for a loose .snbt path: the file as-is, never signed. */
export function giveRawSnbtMenuAction(path: string): MenuAction {
    return {
        label: "Give (raw, no click actions)",
        icon: Icons.handCoins,
        onClick: () => {
            const resolved = resolveRawSnbtToGive(path);
            if (!resolved.ok) {
                showToast(`Cannot give ${shortPath(path)}: ${resolved.reason}`, ACCENT_WARN);
                return;
            }
            startGive([{ label: shortPath(path), item: resolved.item }]);
        },
    };
}

function startGive(items: readonly GiveableItem[]): void {
    const started = giveItemsInBackground(
        items,
        (summary) => reportGive(items, summary),
        (message) => showToast(`Give failed: ${message}`, ACCENT_DANGER, 6000)
    );
    if (!started) showToast("Another task is running; wait for it to finish", ACCENT_WARN);
}

function reportGive(items: readonly GiveableItem[], summary: GiveSummary): void {
    const stopped = summary.stopped;
    if (stopped === null) {
        showToast(
            summary.total === 1
                ? `Gave ${items[0].label}`
                : `Gave ${summary.given} item${summary.given === 1 ? "" : "s"}`,
            ACCENT_SUCCESS
        );
        return;
    }
    if (stopped.kind === "full") {
        showToast(
            `Inventory full: gave ${summary.given} of ${summary.total}`,
            ACCENT_WARN,
            6000
        );
        return;
    }
    showToast(
        `Gave ${summary.given} of ${summary.total}; ${stopped.label} failed`,
        ACCENT_DANGER,
        6000
    );
    ChatLib.chat(`&c[htsw] Could not give ${stopped.label}: ${stopped.message}`);
}
