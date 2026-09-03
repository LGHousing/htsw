import type { GlobalCtxt } from "../context";
import { Diagnostic } from "../diagnostic";
import { parseSnbt, parseSnbtText, type Tag } from "../nbt";
import { MINECRAFT_ITEMS, type ImportableItem } from "../types";

export type ResolvedItemReference = (
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
      }
) & {
    /** The `@<count>` suffix's stack size, when the reference carried a valid one. */
    count?: number;
};

/**
 * Bounds for an item reference's `@<count>` suffix. A Housing item field holds
 * a single stack, so the same 1..64 range the import.json schema already
 * applies to a function icon's count applies here.
 */
export const ITEM_COUNT_MIN = 1;
export const ITEM_COUNT_MAX = 64;

export type ItemReferenceParts = {
    /** The reference with its `@<count>` suffix removed, or the whole reference when it has none. */
    base: string;
    /**
     * The suffix's stack size, present whenever a `@<digits>` suffix was found.
     * Out-of-range values are reported here too so callers can diagnose them;
     * check `isValidItemCount` before applying one.
     */
    count?: number;
};

const ITEM_COUNT_SUFFIX_RE = /^[0-9]+$/;

/**
 * Split a `name@<count>` stack-count suffix off an item reference.
 *
 * The suffix must be all digits, which is what keeps direct `.snbt` paths
 * unambiguous: a path always ends in `.snbt`, so a file named `oak@8.snbt`
 * splits to the non-numeric `8.snbt` and is left whole, while `./oak.snbt@8`
 * splits cleanly. Declared item names cannot contain `@` at all (the
 * import.json parser rejects it) and no vanilla id or damage-variant name
 * does, so a numeric suffix never collides with a real name.
 */
export function parseItemReferenceParts(reference: string): ItemReferenceParts {
    const at = reference.lastIndexOf("@");
    if (at <= 0) return { base: reference };
    const suffix = reference.slice(at + 1);
    if (!ITEM_COUNT_SUFFIX_RE.test(suffix)) return { base: reference };
    return { base: reference.slice(0, at), count: Number(suffix) };
}

export function isValidItemCount(count: number): boolean {
    return (
        Number.isInteger(count) &&
        count >= ITEM_COUNT_MIN &&
        count <= ITEM_COUNT_MAX
    );
}

/**
 * A copy of `nbt` with its stack size set to `count`. Never mutates the source
 * tag — an item importable's `nbt` is shared by every reference that resolves
 * to it, so a count suffix must not leak back into the declaration.
 */
export function withItemCount(nbt: Tag, count: number): Tag {
    if (nbt.type !== "compound") return nbt;
    return {
        type: "compound",
        value: { ...nbt.value, Count: { type: "byte", value: count } },
    };
}

/**
 * Re-key a resolved reference under the text that was actually written and
 * apply its count suffix. An out-of-range count is deliberately left
 * unapplied: `checkItems` reports it as an error, and building a stack
 * Housing cannot hold would only turn a clear diagnostic into a confusing
 * import.
 */
function withResolvedCount(
    resolved: ResolvedItemReference | undefined,
    key: string,
    count: number | undefined
): ResolvedItemReference | undefined {
    if (resolved === undefined) return undefined;
    if (count === undefined || !isValidItemCount(count)) {
        return { ...resolved, key };
    }
    return { ...resolved, key, count, nbt: withItemCount(resolved.nbt, count) };
}

const VANILLA_ITEM_NAMES = new Set(MINECRAFT_ITEMS.map((item) => item.name));

export function vanillaVariationReferenceName(displayName: string): string {
    return displayName.toLowerCase().replace(/ /g, "_");
}

type VanillaVariationReference = {
    id: string;
    damage: number;
};

export const VANILLA_VARIATION_REFERENCE_OVERRIDES: Readonly<
    Partial<Record<string, VanillaVariationReference>>
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
        const override = VANILLA_VARIATION_REFERENCE_OVERRIDES[name];
        if (override !== undefined) {
            VANILLA_VARIATION_REFERENCES.set(name, override);
        }
    }
    return [...collisions].sort();
})();

export function isDirectSnbtItemReference(value: string): boolean {
    return parseItemReferenceParts(value).base.toLowerCase().endsWith(".snbt");
}

export function resolveItemReference(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    ownerNode: object,
    itemName: string
): ResolvedItemReference | undefined {
    const { base, count } = parseItemReferenceParts(itemName);

    const named = itemNames.get(base);
    if (named !== undefined) {
        return withResolvedCount(
            {
                kind: "named",
                key: base,
                name: named.name,
                importable: named,
                nbt: named.nbt,
            },
            itemName,
            count
        );
    }

    const vanilla = resolveVanillaItemReference(base);
    if (vanilla !== undefined) {
        return withResolvedCount(vanilla, itemName, count);
    }

    if (!isDirectSnbtItemReference(base)) {
        return undefined;
    }

    const resolvedPath = resolveItemPathFromOwner(gcx, ownerNode, base);
    return withResolvedCount(
        resolveDirectSnbtItemReference(gcx, base, resolvedPath, ownerNode),
        itemName,
        count
    );
}

export function resolveItemReferenceFromSourcePath(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    sourcePath: string,
    itemName: string
): ResolvedItemReference | undefined {
    const { base, count } = parseItemReferenceParts(itemName);

    const named = itemNames.get(base);
    if (named !== undefined) {
        return withResolvedCount(
            {
                kind: "named",
                key: base,
                name: named.name,
                importable: named,
                nbt: named.nbt,
            },
            itemName,
            count
        );
    }

    const vanilla = resolveVanillaItemReference(base);
    if (vanilla !== undefined) {
        return withResolvedCount(vanilla, itemName, count);
    }

    if (!isDirectSnbtItemReference(base)) {
        return undefined;
    }

    const resolvedPath = resolveItemPathFromSourcePath(gcx, sourcePath, base);
    return withResolvedCount(
        resolveDirectSnbtItemReference(gcx, base, resolvedPath),
        itemName,
        count
    );
}

export function resolveVanillaItemReference(
    itemName: string
): ResolvedItemReference | undefined {
    const { base, count } = parseItemReferenceParts(itemName);
    return withResolvedCount(resolveVanillaBaseReference(base), itemName, count);
}

function resolveVanillaBaseReference(
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
    return gcx.sourceMap.fileLoader.resolvePath(
        parentPath,
        parseItemReferenceParts(itemName).base
    );
}
