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

    if (!isDirectSnbtItemReference(itemName)) {
        return undefined;
    }

    const resolvedPath = resolveItemPathFromSourcePath(gcx, sourcePath, itemName);
    return resolveDirectSnbtItemReference(gcx, itemName, resolvedPath);
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
