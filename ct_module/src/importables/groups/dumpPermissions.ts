/// <reference types="../../../CTAutocomplete" />

import TaskContext from "../../tasks/context";
import { TaskManager } from "../../tasks/manager";
import {
    forEachPaginatedPage,
    tryGetSlotPaginateBy,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { ItemSlot, MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { listAllGroupNames, openEditGroup } from "./listGroups";
import { openGroupPermissions } from "./shared";

const REPORT_PATH = "./htsw/group-permissions.json";

type PermItemReport = {
    slotId: number;
    name: string;
    label: string;
    value: string;
    type: "toggle" | "cycle" | "other";
    warning: boolean;
    lore: string[];
};

type PermPageReport = {
    page: number;
    title: string | null;
    items: PermItemReport[];
};

function stripTooltipDebugSuffix(name: string): string {
    return name.replace(/\s*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/, "").trim();
}

function classify(name: string, lore: string[]): PermItemReport {
    const lastColon = name.lastIndexOf(": ");
    const label = lastColon >= 0 ? name.substring(0, lastColon).trim() : name;
    const value = lastColon >= 0 ? name.substring(lastColon + 2).trim() : "";
    const loreText = lore.join(" ");
    const type: PermItemReport["type"] =
        loreText.toLowerCase().indexOf("cycle") >= 0
            ? "cycle"
            : value === "On" || value === "Off"
                ? "toggle"
                : "other";
    return {
        slotId: -1,
        name,
        label,
        value,
        type,
        // Only the real confirm marker is the uppercase "WARNING:" line; plain
        // prose like "errors and warnings" (View Logger) must not count.
        warning: loreText.indexOf("WARNING:") >= 0,
        lore,
    };
}

function labelPrefixMatch(label: string): (slot: ItemSlot) => boolean {
    const prefix = `${label}: `;
    return (slot) => {
        const item = slot.getItem();
        if (item === null || item === undefined) return false;
        const name = stripTooltipDebugSuffix(removedFormatting(item.getName()).trim());
        return name.indexOf(prefix) === 0;
    };
}

function valueForLabel(slot: ItemSlot, label: string): string {
    const name = stripTooltipDebugSuffix(removedFormatting(slot.getItem().getName()).trim());
    return name.substring(`${label}: `.length).trim();
}

// Discover a cycle's full value set by clicking forward until it loops back to
// the starting value. Because the last click restores the start value, the
// group's setting is left where it began.
async function enumerateCycle(ctx: TaskContext, label: string): Promise<string[]> {
    const match = labelPrefixMatch(label);
    const located = await tryGetSlotPaginateBy(ctx, match);
    if (located === null) return [];
    const values: string[] = [valueForLabel(located, label)];
    for (let i = 0; i < 25; i++) {
        const slot = ctx.tryGetMenuItemSlot(match);
        if (slot === null) break;
        slot.click(MouseButton.LEFT);
        await timedWaitForMenu(ctx, "menuClickWait");
        const after = ctx.tryGetMenuItemSlot(match);
        if (after === null) break;
        const value = valueForLabel(after, label);
        if (value === values[0]) break;
        values.push(value);
    }
    return values;
}

function readPage(ctx: TaskContext, page: number): PermPageReport {
    const slots = ctx.getMenuItemSlots();
    const items: PermItemReport[] = [];
    if (slots !== null) {
        for (let i = 0; i < slots.length; i++) {
            const item = slots[i].getItem();
            if (item === null || item === undefined) continue;
            const name = stripTooltipDebugSuffix(removedFormatting(item.getName()).trim());
            const rawLore = item.getLore();
            const lore: string[] = [];
            for (let j = 0; j < rawLore.length; j++) {
                const line = removedFormatting(rawLore[j]).trim();
                if (line.length > 0) lore.push(line);
            }
            if (name.length === 0 && lore.length === 0) continue;
            const report = classify(name, lore);
            report.slotId = slots[i].getSlotId();
            items.push(report);
        }
    }
    return { page: page + 1, title: ctx.getOpenContainerTitle(), items };
}

async function dumpGroupPermissions(
    ctx: TaskContext,
    groupName?: string
): Promise<void> {
    const names = await listAllGroupNames(ctx);
    if (names.length === 0) {
        ctx.displayMessage("&c[htsw groupperms] no groups in this house.");
        return;
    }
    let target = names[0];
    if (groupName !== undefined && groupName.trim() !== "") {
        if (names.indexOf(groupName) < 0) {
            ctx.displayMessage(
                `&c[htsw groupperms] no group "${groupName}"; groups: ${names.join(", ")}`
            );
            return;
        }
        target = groupName;
    }

    ctx.displayMessage(`&7[htsw groupperms] reading permissions for &f${target}`);
    await openEditGroup(ctx, target);
    await openGroupPermissions(ctx);

    const pages: PermPageReport[] = [];
    await forEachPaginatedPage(ctx, (page) => {
        pages.push(readPage(ctx, page));
    });

    // Each permission renders twice per page (a paper label + a colored state
    // item), so dedupe by label to count the real set. `other` items are menu
    // controls (Go Back / Search / paging arrows), not permissions.
    const toggles = new Set<string>();
    const cycleLabels: string[] = [];
    const warned: string[] = [];
    for (let p = 0; p < pages.length; p++) {
        const items = pages[p].items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type === "toggle") {
                toggles.add(item.label);
                if (item.warning && warned.indexOf(item.label) < 0) warned.push(item.label);
            } else if (item.type === "cycle" && cycleLabels.indexOf(item.label) < 0) {
                cycleLabels.push(item.label);
            }
        }
    }

    const cycleValues: Record<string, string[]> = {};
    for (let i = 0; i < cycleLabels.length; i++) {
        cycleValues[cycleLabels[i]] = await enumerateCycle(ctx, cycleLabels[i]);
    }

    FileLib.write(
        REPORT_PATH,
        JSON.stringify({ group: target, cycleValues, pages }, null, 2),
        true
    );

    ctx.displayMessage(
        `&a[htsw groupperms] ${target}: ${pages.length} page(s), ` +
        `${toggles.size} toggles, ${cycleLabels.length} cycles, ${warned.length} confirm-warned`
    );
    for (let i = 0; i < cycleLabels.length; i++) {
        const label = cycleLabels[i];
        ctx.displayMessage(`&7  cycle &f${label}&7: ${cycleValues[label].join(", ")}`);
    }
    if (warned.length > 0) {
        ctx.displayMessage(`&7  confirm-warned: ${warned.join(", ")}`);
    }
    ctx.displayMessage(`&7[htsw groupperms] full report -> &f${REPORT_PATH}`);
}

export function commandGroupPerms(args: string[]): void {
    if (TaskManager.isBusy()) {
        ChatLib.chat("&c[htsw groupperms] a task is already running.");
        return;
    }
    const groupName = args.length > 0 ? args.join(" ") : undefined;
    TaskManager.run(async (ctx) => {
        await dumpGroupPermissions(ctx, groupName);
    }).catch((err) => {
        ChatLib.chat(`&c[htsw groupperms] failed: ${err}`);
    });
}
