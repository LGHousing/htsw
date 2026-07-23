import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";

import { tagChild, type TagLike } from "../../housingSync/items/itemTag";
import { IMPORT_CACHE_ROOT } from "../../importCache/paths";
import { atomicWriteText } from "../../utils/filesystem";
import { stableStringify } from "../../utils/helpers";
import { runtimeString } from "../../utils/java";
import type { ItemDependencyIndex } from "./dependencyIndex";

export type InteractDataExpectation =
    { kind: "absent" } | { kind: "cached"; snbt: string } | { kind: "uncached" };

export function hasItemClickActions(item: ImportableItem): boolean {
    return (
        (item.leftClickActions?.length ?? 0) > 0 ||
        (item.rightClickActions?.length ?? 0) > 0
    );
}

export function expectedInteractData(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string | undefined
): InteractDataExpectation {
    if (!hasItemClickActions(item)) return { kind: "absent" };
    if (housingUuid === undefined) return { kind: "uncached" };
    const snbt = readInteractDataCache(item, dependencies, housingUuid);
    return snbt === undefined ? { kind: "uncached" } : { kind: "cached", snbt };
}

export function readInteractDataCache(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string
): string | undefined {
    const path = cachePath(item, dependencies, housingUuid);
    try {
        if (!FileLib.exists(path)) return undefined;
        const value = FileLib.read(path) as unknown as string | null;
        if (value === null) return undefined;
        const snbt = runtimeString(value);
        return isInteractDataSnbt(snbt) ? snbt : undefined;
    } catch (_error) {
        return undefined;
    }
}

export function hasInteractDataCache(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string
): boolean {
    return readInteractDataCache(item, dependencies, housingUuid) !== undefined;
}

export function hasRequiredInteractDataCache(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string
): boolean {
    return (
        !hasItemClickActions(item) ||
        hasInteractDataCache(item, dependencies, housingUuid)
    );
}

export function writeInteractDataCache(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string,
    interactDataSnbt: string
): boolean {
    if (!hasItemClickActions(item)) return false;
    const path = cachePath(item, dependencies, housingUuid);
    return atomicWriteText(path, interactDataSnbt);
}

function cachePath(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string
): string {
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/interact_data/${dependencies.clickActionsFingerprint(item)}.snbt`;
}

export function itemInteractDataMatches(
    itemSnbt: string,
    expected: InteractDataExpectation
): boolean {
    if (expected.kind === "uncached") return false;
    const observed = interactDataTag(itemSnbt);
    if (expected.kind === "absent") return observed === null;
    if (observed === null) return false;
    return canonicalSnbt(observed) === canonicalSnbt(expected.snbt);
}

function interactDataTag(itemSnbt: string): unknown {
    try {
        const item = htsw.nbt.parseSnbtText(itemSnbt) as TagLike;
        return (
            tagChild(
                tagChild(tagChild(item, "tag"), "ExtraAttributes"),
                "interact_data"
            ) ?? null
        );
    } catch (_error) {
        return null;
    }
}

function canonicalSnbt(value: unknown): string | null {
    try {
        const parsed = typeof value === "string" ? htsw.nbt.parseSnbtText(value) : value;
        return stableStringify(parsed);
    } catch (_error) {
        return null;
    }
}

function isInteractDataSnbt(value: string): boolean {
    try {
        return htsw.nbt.parseSnbtText(value).type === "compound";
    } catch (_error) {
        return false;
    }
}
