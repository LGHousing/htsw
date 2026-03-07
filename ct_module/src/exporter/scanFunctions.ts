import TaskContext from "../tasks/context";
import { removedFormatting } from "../helpers";
import { clickGoBack, waitForMenuToLoad } from "../importer/helpers";
import type { DiscoveredFunction } from "./types";

const CONTROL_SLOT_NAMES = new Set([
    "Go Back",
    "Close",
    "Search",
    "Create New Function",
    "Create Function",
    "Left-click for next page!",
    "Right-click for previous page!",
]);

function isFunctionLikeSlotName(name: string): boolean {
    if (name.length === 0) return false;
    if (CONTROL_SLOT_NAMES.has(name)) return false;
    if (name === " ") return false;
    return true;
}

function parseRepeatTicksFromLore(lore: string[]): number | undefined {
    for (const line of lore) {
        const raw = removedFormatting(line);
        if (!raw.toLowerCase().includes("automatic execution")) continue;
        const match = raw.match(/(\d+)/);
        if (!match) return undefined;
        const ticks = Number(match[1]);
        if (!Number.isFinite(ticks)) return undefined;
        return ticks;
    }
    return undefined;
}

function pageSignature(names: string[]): string {
    return names.sort((a, b) => a.localeCompare(b)).join("\n");
}

export async function discoverFunctions(ctx: TaskContext): Promise<DiscoveredFunction[]> {
    ctx.runCommand("/functions");
    await waitForMenuToLoad(ctx);

    const discovered = new Map<string, DiscoveredFunction>();
    const seenPageSignatures = new Set<string>();

    while (true) {
        const slots = ctx.getAllItemSlots() ?? [];
        const pageNames: string[] = [];

        for (const slot of slots) {
            const name = removedFormatting(slot.getItem().getName()).trim();
            if (!isFunctionLikeSlotName(name)) continue;

            const lore = slot.getItem().getLore().map((it) => removedFormatting(it));
            const hasFunctionHint = lore.some((line) => {
                const lower = line.toLowerCase();
                return lower.includes("left-click to edit")
                    || lower.includes("right-click to edit settings")
                    || lower.includes("automatic execution");
            });

            if (!hasFunctionHint) continue;

            const repeatTicks = parseRepeatTicksFromLore(lore);
            discovered.set(name, { name, repeatTicks });
            pageNames.push(name);
        }

        const signature = pageSignature(pageNames);
        if (seenPageSignatures.has(signature)) {
            break;
        }
        seenPageSignatures.add(signature);

        const nextPage = ctx.tryGetItemSlot("Left-click for next page!");
        if (nextPage == null) break;

        nextPage.click();
        await waitForMenuToLoad(ctx);
    }

    if (ctx.tryGetItemSlot("Go Back")) {
        clickGoBack(ctx);
    }

    return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

