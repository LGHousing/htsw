import type { MenuAction } from "../../lib/menu";

import { acceptHouseLockAsCurrent } from "../../../importCache/acceptHouseLock";
import { houseDisplayName } from "../../../importCache/aliases";
import { readHouseLock } from "../../../importCache/houseLock";
import { TaskManager } from "../../../tasks/manager";
import { invalidateSourceDiffForImportable } from "../../code-view/sourceDiff";
import { Icons } from "../../lib/icons.generated";
import { parseImportJsonBlocking } from "../../parsing/parses";
import { openConfirmPopover } from "../../popovers/confirm";
import { setHouseTrust } from "../../state";
import { showToast } from "../../toast";

function acceptProjectLock(importJsonPath: string): void {
    if (TaskManager.isBusy()) {
        showToast("A task is already running — wait for it to finish", 0xffe5bc4b);
        return;
    }
    TaskManager.run(async (ctx) => {
        const cached = parseImportJsonBlocking(importJsonPath);
        if (cached.parsed === null) {
            showToast(
                `Project parse failed: ${cached.error ?? "unknown error"}`,
                0xffe85c5c,
                8000
            );
            return;
        }
        const blocking = cached.parsed.diagnostics.filter(
            (d) => d.level === "error" || d.level === "bug"
        );
        if (blocking.length > 0) {
            showToast(
                `Project has ${blocking.length} blocking diagnostic${blocking.length === 1 ? "" : "s"}`,
                0xffe85c5c,
                8000
            );
            return;
        }

        const result = acceptHouseLockAsCurrent(ctx, importJsonPath, cached.parsed.value);
        if (!result.ok) {
            showToast(
                result.reason === "missing-lock"
                    ? "This project has no house.lock.json"
                    : "This project lock is not bound to a house",
                0xffe85c5c,
                8000
            );
            return;
        }
        for (const importable of result.accepted) {
            invalidateSourceDiffForImportable(importable);
        }
        if (result.failed > 0) {
            showToast(
                `Accepted ${result.accepted.length}; ${result.failed} cache write${result.failed === 1 ? "" : "s"} failed`,
                0xffe85c5c,
                8000
            );
            return;
        }
        if (result.accepted.length === 0) {
            showToast(
                "No current project entries match this house lock",
                0xffe5bc4b,
                8000
            );
            return;
        }
        const trustSaved = setHouseTrust(result.housingUuid, true);
        const skipped = result.skipped > 0 ? `; ${result.skipped} skipped` : "";
        const markedPresent =
            result.markedPresent > 0
                ? `; ${result.markedPresent} changed (in house, not read)`
                : "";
        showToast(
            trustSaved
                ? `Accepted ${result.accepted.length} locked project entr${result.accepted.length === 1 ? "y" : "ies"}${markedPresent}${skipped}`
                : `Accepted ${result.accepted.length} locked project entr${result.accepted.length === 1 ? "y" : "ies"}, but couldn't save house trust${markedPresent}${skipped}`,
            trustSaved ? 0xff5cb85c : 0xffe85c5c,
            8000
        );
    }).catch((err: unknown) => {
        showToast(`Couldn't accept project lock: ${String(err)}`, 0xffe85c5c, 8000);
    });
}

export function confirmAcceptProjectLock(importJsonPath: string): void {
    const lock = readHouseLock(importJsonPath);
    if (lock === null) {
        showToast("This project has no house.lock.json", 0xffe85c5c, 8000);
        return;
    }
    if (lock.houseUuid === null) {
        showToast("This project lock is not bound to a house", 0xffe85c5c, 8000);
        return;
    }
    openConfirmPopover({
        title: "Sync cache from this project lock?",
        lines: [
            `Rebuilds local Knowledge for ${houseDisplayName(lock.houseUuid)}.`,
            "Housing and project files will not be changed.",
        ],
        confirmLabel: "Sync cache",
        danger: true,
        onConfirm: () => acceptProjectLock(importJsonPath),
    });
}

export function acceptHouseLockMenuAction(importJsonPath: string): MenuAction {
    return {
        label: "Sync cache from lock",
        icon: Icons.databaseBackup,
        onClick: () => confirmAcceptProjectLock(importJsonPath),
    };
}
