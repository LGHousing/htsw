import type { GlobalCtxt } from "../context";
import { Diagnostic } from "../diagnostic";
import { parseSnbt, parseSnbtText, type Tag } from "../nbt";
import { MINECRAFT_ITEMS, type ImportableItem } from "../types";

export type ResolvedItemReference =
    | {
          kind: "named";
          key: string;
          name: string;
          importable: ImportableItem;
          nbt: Tag;
      }
    | {
          kind: "snbtPath";
          key: string;
          path: string;
          nbt: Tag;
      }
    | {
          kind: "vanilla";
          key: string;
          id: string;
          nbt: Tag;
      };

const VANILLA_ITEM_NAMES = new Set(MINECRAFT_ITEMS.map((item) => item.name));

export function vanillaVariationReferenceName(displayName: string): string {
    return displayName.toLowerCase().replace(/ /g, "_");
}

type VanillaVariationReference = {
    id: string;
    damage: number;
};

export const VANILLA_VARIATION_REFERENCE_OVERRIDES: Readonly<
    Record<string, VanillaVariationReference>
> = {
    acacia_wood: { id: "minecraft:log2", damage: 0 },
    dark_oak_wood: { id: "minecraft:log2", damage: 1 },
    wooden_slab: { id: "minecraft:wooden_slab", damage: 0 },
};

const VANILLA_VARIATION_REFERENCES = new Map<string, VanillaVariationReference>();
export const VANILLA_VARIATION_REFERENCE_COLLISIONS: readonly string[] = (() => {
    const collisions = new Set<string>();
    for (const item of MINECRAFT_ITEMS) {
        for (const variation of item.variations ?? []) {
            const name = vanillaVariationReferenceName(variation.displayName);
            if (VANILLA_VARIATION_REFERENCE_OVERRIDES[name] !== undefined) {
                continue;
            }
            if (VANILLA_ITEM_NAMES.has(name)) {
                if (name !== item.name || variation.metadata !== 0) {
                    collisions.add(name);
                }
                continue;
            }
            if (collisions.has(name)) {
                continue;
            }
            const existing = VANILLA_VARIATION_REFERENCES.get(name);
            if (
                existing !== undefined &&
                (existing.id !== `minecraft:${item.name}` ||
                    existing.damage !== variation.metadata)
            ) {
                collisions.add(name);
                VANILLA_VARIATION_REFERENCES.delete(name);
                continue;
            }
            VANILLA_VARIATION_REFERENCES.set(name, {
                id: `minecraft:${item.name}`,
                damage: variation.metadata,
            });
        }
    }
    for (const name in VANILLA_VARIATION_REFERENCE_OVERRIDES) {
        VANILLA_VARIATION_REFERENCES.set(
            name,
            VANILLA_VARIATION_REFERENCE_OVERRIDES[name]
        );
    }
    return [...collisions].sort();
})();

export function isDirectSnbtItemReference(value: string): boolean {
    return value.toLowerCase().endsWith(".snbt");
}

export function resolveItemReference(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    ownerNode: object,
    itemName: string
): ResolvedItemReference | undefined {
    const named = itemNames.get(itemName);
    if (named !== undefined) {
        return {
            kind: "named",
            key: itemName,
            name: named.name,
            importable: named,
            nbt: named.nbt,
        };
    }

    const vanilla = resolveVanillaItemReference(itemName);
    if (vanilla !== undefined) {
        return vanilla;
    }

    if (!isDirectSnbtItemReference(itemName)) {
        return undefined;
    }

    const resolvedPath = resolveItemPathFromOwner(gcx, ownerNode, itemName);
    return resolveDirectSnbtItemReference(gcx, itemName, resolvedPath, ownerNode);
}

export function resolveItemReferenceFromSourcePath(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    sourcePath: string,
    itemName: string
): ResolvedItemReference | undefined {
    const named = itemNames.get(itemName);
    if (named !== undefined) {
        return {
            kind: "named",
            key: itemName,
            name: named.name,
            importable: named,
            nbt: named.nbt,
        };
    }

    const vanilla = resolveVanillaItemReference(itemName);
    if (vanilla !== undefined) {
        return vanilla;
    }

    if (!isDirectSnbtItemReference(itemName)) {
        return undefined;
    }

    const resolvedPath = resolveItemPathFromSourcePath(gcx, sourcePath, itemName);
    return resolveDirectSnbtItemReference(gcx, itemName, resolvedPath);
}

export function resolveVanillaItemReference(
    itemName: string
): ResolvedItemReference | undefined {
    const prefixed = itemName.startsWith("minecraft:");
    const name = prefixed ? itemName.slice("minecraft:".length) : itemName;
    const variation = VANILLA_VARIATION_REFERENCES.get(name);
    const baseId = prefixed && VANILLA_ITEM_NAMES.has(name)
        ? `minecraft:${name}`
        : variation?.id;
    if (baseId === undefined) {
        return undefined;
    }

    const damage = variation?.damage ?? 0;

    return {
        kind: "vanilla",
        key: itemName,
        id: baseId,
        nbt: parseSnbtText(`{id:"${baseId}",Count:1b,Damage:${damage}s}`),
    };
}

function resolveDirectSnbtItemReference(
    gcx: GlobalCtxt,
    itemName: string,
    resolvedPath: string,
    ownerNode?: object
): ResolvedItemReference | undefined {
    if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
        const diagnostic = Diagnostic.error(
            `SNBT item file does not exist '${itemName}'`
        );
        if (ownerNode !== undefined) {
            diagnostic.addPrimarySpan(
                gcx.spans.getField(ownerNode as { itemName: string }, "itemName"),
                "not found"
            );
        }
        diagnostic.addSubDiagnostic(
            Diagnostic.help(
                "Direct item paths are resolved relative to the HTSL file that contains the item field."
            )
        );
        gcx.addDiagnostic(diagnostic);
        return undefined;
    }

    const nbt = parseSnbt(gcx, resolvedPath);
    if (nbt === undefined) {
        return undefined;
    }

    return {
        kind: "snbtPath",
        key: itemName,
        path: resolvedPath,
        nbt,
    };
}

export function resolveItemPathFromOwner(
    gcx: GlobalCtxt,
    ownerNode: object,
    itemName: string
): string {
    const fieldSpan = gcx.spans.getField(
        ownerNode as { itemName: string },
        "itemName"
    );
    const sourceFile = gcx.sourceMap.getFileByPos(fieldSpan.start);
    return resolveItemPathFromSourcePath(gcx, sourceFile.path, itemName);
}

export function resolveItemPathFromSourcePath(
    gcx: GlobalCtxt,
    sourcePath: string,
    itemName: string
): string {
    const parentPath = gcx.sourceMap.fileLoader.getParentPath(sourcePath);
    return gcx.sourceMap.fileLoader.resolvePath(parentPath, itemName);
}
