/// <reference types="../../../CTAutocomplete" />

import * as htsw from "htsw";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { TaskManager } from "../../tasks/manager";
import { atomicWriteText } from "../../utils/filesystem";
import { StringFileLoader } from "../../utils/fileLoaders";
import { runtimeString, type RuntimeString } from "../../utils/java";
import { compactFileLabel } from "../lib/pathDisplay";
import { openFileBrowserWithHtslDestination } from "../popovers/file-browser";
import { showToast } from "../toast";
import { StandaloneItemCaptures } from "./standaloneItemCaptures";

function standaloneHtsl(actions: readonly htsw.types.Action[]): string {
    const printed = htsw.htsl.printActionsWithDiagnostics(actions);
    if (printed.diagnostics.length > 0) {
        throw new Error(
            printed.diagnostics.map((diagnostic) => diagnostic.message).join(" ")
        );
    }

    const parsed = htsw.parseActionsResult(
        new htsw.SourceMap(new StringFileLoader(printed.source)),
        "open-action-list.htsl"
    );
    const errors = parsed.diagnostics.filter(
        (diagnostic) => diagnostic.level === "error" || diagnostic.level === "bug"
    );
    if (errors.length > 0) {
        throw new Error(
            `Printed HTSL did not parse cleanly: ${errors.map((error) => error.message).join("; ")}`
        );
    }
    return printed.source;
}

export async function exportOpenActionListTo(
    path: string,
    replaceExisting: boolean
): Promise<void> {
    if (!path.toLowerCase().endsWith(".htsl")) {
        ChatLib.chat("&c[htsw] Open action-list exports require a .htsl destination.");
        return;
    }
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }

    try {
        await runHousingSyncTask("export", async (ctx) => {
            if (ctx.tryGetMenuItemSlot("Add Action") === null) {
                throw new Error("Open a supported Housing action-list menu first.");
            }

            const itemCaptures = new StandaloneItemCaptures((reference) =>
                readExistingItem(path, reference)
            );
            const actions = await readActionListFully(ctx, {
                itemReadMode: "export",
                itemCaptures,
            });
            const source = standaloneHtsl(actions);
            const itemEntries = itemCaptures.entriesToWrite();
            for (const entry of itemEntries) {
                const target = itemTarget(path, entry.reference);
                if (
                    !atomicWriteText(target, prettySnbt(entry.snbt), {
                        replaceExisting: false,
                    })
                ) {
                    throw new Error(
                        `Could not safely create ${target}; it may now exist`
                    );
                }
            }
            if (!atomicWriteText(path, source, { replaceExisting })) {
                throw new Error(
                    replaceExisting
                        ? `Could not write ${path}`
                        : `Could not safely create ${path}; it may now exist`
                );
            }

            const count = actions.length;
            const itemCountSuffix =
                itemEntries.length > 0
                    ? ` (+${itemEntries.length} item file${itemEntries.length === 1 ? "" : "s"})`
                    : "";
            ChatLib.chat(
                `&a[htsw] Exported ${count} action${count === 1 ? "" : "s"} → ${path}${itemCountSuffix}`
            );
            if (itemEntries.length > 0) {
                ChatLib.chat(
                    "&7[htsw] Custom items were written as inline .snbt files next to the export; keep them together with the .htsl."
                );
            }
            const clickActionItems = itemCaptures.clickActionItemCount();
            if (clickActionItems > 0) {
                ChatLib.chat(
                    `&e[htsw] ${clickActionItems} item${clickActionItems === 1 ? "" : "s"} include${clickActionItems === 1 ? "s" : ""} click actions as raw interact_data in their .snbt; they reimport correctly only into this house, and those click actions are not editable HTSL.`
                );
            }
            showToast(
                `Exported ${compactFileLabel(path)} (${count} actions)${itemCountSuffix}`,
                0xff5cb85c
            );
        });
    } catch (err) {
        ChatLib.chat(`&c[htsw] Open action-list export failed: ${String(err)}`);
        showToast(`Export failed: ${String(err)}`, 0xffe85c5c, 8000);
    }
}

function prettySnbt(snbt: string): string {
    try {
        return htsw.nbt.printSnbt(htsw.nbt.parseSnbtText(snbt), { pretty: true });
    } catch (_error) {
        return snbt;
    }
}

function readExistingItem(htslPath: string, reference: string): string | null {
    const content = FileLib.read(itemTarget(htslPath, reference)) as
        RuntimeString | null | undefined;
    return content === null || content === undefined ? null : runtimeString(content);
}

function itemTarget(htslPath: string, reference: string): string {
    const separator = htslPath.lastIndexOf("\\") > htslPath.lastIndexOf("/") ? "\\" : "/";
    const lastSeparator = Math.max(htslPath.lastIndexOf("/"), htslPath.lastIndexOf("\\"));
    const parent = lastSeparator < 0 ? "" : htslPath.slice(0, lastSeparator);
    const relative = reference.split("/").join(separator);
    return parent.length === 0 ? relative : `${parent}${separator}${relative}`;
}

export function startOpenActionListExport(): void {
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }
    openFileBrowserWithHtslDestination(undefined, (path, replaceExisting) => {
        void exportOpenActionListTo(path, replaceExisting);
    });
}
