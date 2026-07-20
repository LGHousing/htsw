import { exportProjectContextFromParsedImportJson } from "../../importables/exportContext";
import {
    captureOpenChest,
    exportCapturedChest,
    type CapturedChest,
} from "../../importables/menus/exportChest";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { parentDirOf } from "../../project/paths";
import { TaskManager } from "../../tasks/manager";
import { closeAllPopovers } from "../lib/popovers";
import { shortPath } from "../lib/pathDisplay";
import { getParseAt, markParseStale } from "../parsing/parses";
import { openConfirmPopover } from "../popovers/confirm";
import { openTextPromptPopover } from "../popovers/text-prompt";
import { getNewExportTarget } from "../state/newExportTarget";
import { showToast } from "../toast";
import { getExportDestinationStatus } from "./destinationStatus";

function menuExists(importJsonPath: string, name: string): boolean {
    const parsed = getParseAt(importJsonPath)?.parsed;
    if (parsed === null || parsed === undefined) return false;
    for (const importable of parsed.value) {
        if (importable.type === "MENU" && importable.name === name) return true;
    }
    return false;
}

function runChestExport(
    captured: CapturedChest,
    name: string,
    importJsonPath: string
): void {
    const rootDir = parentDirOf(importJsonPath);
    const newExportTargetImportJson = getNewExportTarget() ?? undefined;
    runHousingSyncTask("export", (ctx) =>
        exportCapturedChest(ctx, captured, {
            ...exportProjectContextFromParsedImportJson(
                { rootDir, importJsonPath },
                getParseAt(importJsonPath)?.parsed
            ),
            name,
            newExportTargetImportJson,
        })
    )
        .then((result) => {
            if (result === undefined) return;
            markParseStale(importJsonPath);
            showToast(
                `Exported chest '${name}' (${result.populatedSlots} slots, ${result.newItemsWritten} new items) → ${shortPath(importJsonPath)}`,
                0xff5cb85c
            );
        })
        .catch((error: unknown) => {
            showToast(`Chest export failed: ${String(error)}`, 0xffe85c5c, 8000);
        });
}

function confirmChestExport(
    captured: CapturedChest,
    name: string,
    importJsonPath: string
): void {
    const run = (): void => runChestExport(captured, name, importJsonPath);
    if (!menuExists(importJsonPath, name)) {
        run();
        return;
    }
    openConfirmPopover({
        title: `Overwrite existing menu '${name}'?`,
        lines: ["Export replaces the local version with the open chest."],
        confirmLabel: "Export anyway",
        danger: true,
        onConfirm: run,
    });
}

export function startChestExport(): void {
    closeAllPopovers();
    const destination = getExportDestinationStatus();
    if (destination.kind === "none") {
        showToast(
            "Export stopped — choose or create an export project first",
            0xffe85c5c,
            8000
        );
        return;
    }
    if (destination.kind === "missing") {
        showToast(
            "Export stopped — the selected project no longer exists",
            0xffe85c5c,
            8000
        );
        ChatLib.chat("&c[htsw] Export stopped: the selected project no longer exists.");
        ChatLib.chat(`&7  ${destination.path}`);
        ChatLib.chat("&7Choose another project from Houses → Export project.");
        return;
    }
    if (TaskManager.isBusy()) {
        showToast("A task is already running — wait for it to finish", 0xffe5bc4b);
        return;
    }

    let captured: CapturedChest | null;
    try {
        captured = captureOpenChest();
    } catch (error) {
        showToast(`Chest export failed: ${String(error)}`, 0xffe85c5c, 8000);
        return;
    }
    if (captured === null) {
        showToast(
            "Open a chest first — the HTSW overlay stays open while a chest is open",
            0xffe5bc4b
        );
        return;
    }
    if (captured.slots.length === 0) {
        showToast("The open chest has no items to export", 0xffe5bc4b);
        return;
    }

    const importJsonPath = destination.path;
    openTextPromptPopover({
        title: "Export open chest as menu",
        description: ["Choose the menu name to write into your export project."],
        placeholder: "menu name",
        prefill: "chest",
        submitLabel: "Export",
        onEmptySubmit: () => showToast("Enter a menu name", 0xffe5bc4b),
        onSubmit: (name) => {
            confirmChestExport(captured, name, importJsonPath);
        },
    });
}
