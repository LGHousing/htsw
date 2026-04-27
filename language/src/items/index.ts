import type { GlobalCtxt } from "../context";
import { Diagnostic } from "../diagnostic";
import { parseSnbt, type Tag } from "../nbt";
import type { ImportableItem } from "../types";

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
      };

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

    if (!isDirectSnbtItemReference(itemName)) {
        return undefined;
    }

    const resolvedPath = resolveItemPathFromOwner(gcx, ownerNode, itemName);
    if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
        gcx.addDiagnostic(
            Diagnostic.error(`SNBT item file does not exist '${itemName}'`)
                .addPrimarySpan(
                    gcx.spans.getField(ownerNode as { itemName: string }, "itemName"),
                    "not found"
                )
                .addSubDiagnostic(
                    Diagnostic.help(
                        "Direct item paths are resolved relative to the HTSL file that contains the item field."
                    )
                )
        );
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
    const parentPath = gcx.sourceMap.fileLoader.getParentPath(sourceFile.path);
    return gcx.sourceMap.fileLoader.resolvePath(parentPath, itemName);
}
