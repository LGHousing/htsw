/// <reference types="../../CTAutocomplete" />

import { Icons } from "./lib/icons.generated";
import { type MenuAction } from "./lib/menu";
import { shortPath } from "./lib/pathDisplay";
import {
    canonicalPath,
    getParseAt,
    invalidateParseCacheEntry,
    requestParse,
    touchParseCacheFile,
} from "./parsing/parses";
import { openConfirmPopover } from "./popovers/confirm";
import { getHousingUuid, setExportImportJsonPath } from "./state";
import { houseDisplayName } from "../importCache/aliases";
import { recordHouseBinding } from "../importCache/houseBindings";
import { setHouseUuidKey } from "../project/importJsonMutations";

export function boundHouseUuidOf(fullPath: string): string | null {
    const parse = requestParse(fullPath);
    if (parse === null || parse.parsed === null) return null;
    return parse.parsed.gcx.houseUuid;
}

function rebindFile(fullPath: string, rawUuid: string | null): void {
    const startedAt = Date.now();
    const uuid = rawUuid === null ? null : rawUuid.toLowerCase();
    if (!setHouseUuidKey(fullPath, uuid)) {
        ChatLib.chat(`&c[htsw] Couldn't update ${shortPath(fullPath)}`);
        return;
    }
    const wroteAt = Date.now();
    const entry = getParseAt(fullPath);
    if (entry !== null && entry.parsed !== null) {
        entry.parsed.gcx.houseUuid = uuid;
        touchParseCacheFile(fullPath);
        recordHouseBinding(uuid, canonicalPath(fullPath));
    } else {
        invalidateParseCacheEntry(fullPath);
        requestParse(fullPath);
    }
    const total = Date.now() - startedAt;
    if (total > 250) {
        ChatLib.chat(
            `&8[htsw] bind took ${total}ms (file write ${wroteAt - startedAt}ms, cache ${Date.now() - wroteAt}ms)`
        );
    }
    if (uuid !== null) {
        if (uuid === getHousingUuid()) {
            setExportImportJsonPath(fullPath);
        }
        ChatLib.chat(`&a[htsw] Bound ${shortPath(fullPath)} to ${houseDisplayName(uuid)}.`);
    } else {
        ChatLib.chat(`&a[htsw] Removed house binding from ${shortPath(fullPath)}.`);
    }
}

export function confirmRebind(fullPath: string, uuid: string | null): void {
    const bound = boundHouseUuidOf(fullPath);
    if (uuid === null) {
        openConfirmPopover({
            title: `Unbind ${shortPath(fullPath)}?`,
            lines:
                bound !== null
                    ? [`Removes the houseUuid key linking it to ${houseDisplayName(bound)}.`]
                    : [],
            confirmLabel: "Unbind",
            onConfirm: () => rebindFile(fullPath, null),
        });
        return;
    }
    const rebinding = bound !== null && bound !== uuid.toLowerCase();
    const lines = [
        "Writes a houseUuid key into the file; entering",
        `${houseDisplayName(uuid)} then auto-selects it as destination.`,
    ];
    if (rebinding && bound !== null) {
        lines.unshift(`Currently bound to ${houseDisplayName(bound)}.`);
    }
    openConfirmPopover({
        title: `${rebinding ? "Rebind" : "Bind"} ${shortPath(fullPath)} to ${houseDisplayName(uuid)}?`,
        lines,
        confirmLabel: rebinding ? "Rebind" : "Bind",
        onConfirm: () => rebindFile(fullPath, uuid),
    });
}

export function houseBindingActions(fullPath: string): MenuAction[] {
    const parse = requestParse(fullPath);
    if (parse === null || parse.parsed === null) return [];
    const bound = parse.parsed.gcx.houseUuid;
    const current = getHousingUuid();
    const actions: MenuAction[] = [];
    if (current !== null && current !== bound) {
        actions.push({
            label: `Bind to ${houseDisplayName(current)}`,
            icon: Icons.house,
            onClick: () => confirmRebind(fullPath, current),
        });
    }
    if (bound !== null) {
        actions.push({
            label: `Unbind from ${houseDisplayName(bound)}`,
            onClick: () => confirmRebind(fullPath, null),
        });
    }
    return actions;
}
