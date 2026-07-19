import type { Action, ImportableItem } from "htsw/types";

import { canonicalStringify } from "../housingSync/fields/compare";
import {
    canonicalItemTag,
    type TagLike,
} from "../housingSync/fields/itemTagCanonical";

export type ItemChanges = {
    nbt: string[];
    leftClickActions: boolean;
    rightClickActions: boolean;
};

function actionListsMatch(
    left: readonly Action[] | undefined,
    right: readonly Action[] | undefined
): boolean {
    return canonicalStringify(left ?? []) === canonicalStringify(right ?? []);
}

function leafValues(
    tag: TagLike,
    path: string,
    output: Map<string, unknown>
): void {
    if (tag.type === "compound") {
        const value = tag.value as Record<string, TagLike>;
        const keys = Object.keys(value).sort();
        for (const key of keys) {
            leafValues(value[key], path === "" ? key : `${path}.${key}`, output);
        }
        return;
    }
    if (tag.type === "list") {
        const list = tag.value as { type: string; value: unknown[] };
        for (let i = 0; i < list.value.length; i++) {
            const itemPath = `${path}[${i}]`;
            if (list.type === "compound") {
                leafValues(
                    { type: "compound", value: list.value[i] },
                    itemPath,
                    output
                );
            } else {
                output.set(itemPath, list.value[i]);
            }
        }
        if (list.value.length === 0) output.set(path, []);
        return;
    }
    output.set(path, tag.value);
}

function shown(value: unknown): string {
    if (value === undefined) return "(missing)";
    const serialized = JSON.stringify(value);
    const text = serialized === undefined ? String(value) : serialized;
    return text.length > 48 ? text.substring(0, 45) + "..." : text;
}

function nbtChanges(file: TagLike, house: TagLike): string[] {
    const fileValues = new Map<string, unknown>();
    const houseValues = new Map<string, unknown>();
    leafValues(canonicalItemTag(file), "", fileValues);
    leafValues(canonicalItemTag(house), "", houseValues);
    const paths = new Set<string>();
    for (const path of fileValues.keys()) paths.add(path);
    for (const path of houseValues.keys()) paths.add(path);
    const result: string[] = [];
    for (const path of Array.from(paths).sort()) {
        const fileValue = fileValues.get(path);
        const houseValue = houseValues.get(path);
        if (JSON.stringify(fileValue) === JSON.stringify(houseValue)) continue;
        result.push(`${path}: ${shown(houseValue)} -> ${shown(fileValue)}`);
    }
    return result;
}

export function itemChanges(
    file: ImportableItem,
    house: ImportableItem
): ItemChanges {
    return {
        nbt: nbtChanges(file.nbt as TagLike, house.nbt as TagLike),
        leftClickActions: !actionListsMatch(
            file.leftClickActions,
            house.leftClickActions
        ),
        rightClickActions: !actionListsMatch(
            file.rightClickActions,
            house.rightClickActions
        ),
    };
}

export function itemChangeLines(changes: ItemChanges): string[] {
    const lines = changes.nbt.slice();
    if (changes.leftClickActions) lines.push("Left click actions changed");
    if (changes.rightClickActions) lines.push("Right click actions changed");
    return lines;
}
