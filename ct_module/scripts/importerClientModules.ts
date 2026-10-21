// The importer's client modules (importer/src/platform.ts) and the ct_module
// files that implement them. The plugin resolves an import of a client module,
// from the importer or from here, to the ct_module file, so the bundle and the
// tests load the same modules in the same order as before the importer moved
// out. vite.config.ts and vitest.config.ts both use it.
import path from "node:path";
import { fileURLToPath } from "node:url";

const importerSrcDir = fileURLToPath(new URL("../../importer/src/", import.meta.url));
const ctSrcDir = fileURLToPath(new URL("../src/", import.meta.url));

/** importer/src path (no extension) -> ct_module/src path (no extension). */
export const IMPORTER_CLIENT_MODULES: { readonly [importerPath: string]: string } = {
    platform: "importerPlatform",
    "housingSync/items/capture": "housingSync/items/capture",
    "housingSync/items/heldItem": "housingSync/items/heldItem",
    "housingSync/items/itemPicker": "housingSync/items/itemPicker",
    "housingSync/items/playerInventory": "housingSync/items/playerInventory",
    "housingSync/menus/menuInput": "housingSync/menus/menuInput",
    "housingSync/sideEffects": "housingSync/sideEffects",
    "importables/functions/icon": "importables/functions/icon",
    "project/htswPath": "project/htswPath",
    "project/projectFs": "project/projectFs",
    "runtime/parsing/realPath": "runtime/parsing/realPath",
    "runtimeDebug/importFailureLog": "runtimeDebug/importFailureLog",
    "runtimeDebug/importFailureUpload": "runtimeDebug/importFailureUpload",
    "tasks/specifics/slots": "tasks/specifics/slots",
    "tasks/specifics/waitFor": "tasks/specifics/waitFor",
    "trace/jsonl": "trace/jsonl",
    "utils/fileLoaders": "utils/fileLoaders",
    "utils/filesystem": "utils/filesystem",
    "utils/itemLore": "utils/itemLore",
    "utils/mainThread": "utils/mainThread",
    "utils/nbt": "utils/nbt",
    "utils/packets": "utils/packets",
};

const byImporterFile = new Map<string, string>();
for (const [importerPath, ctPath] of Object.entries(IMPORTER_CLIENT_MODULES)) {
    byImporterFile.set(
        path.join(importerSrcDir, `${importerPath}.ts`),
        path.join(ctSrcDir, `${ctPath}.ts`)
    );
}

type ResolveContext = {
    resolve(
        source: string,
        importer: string | undefined,
        options: { skipSelf: boolean }
    ): Promise<{ id: string } | null>;
};

export function importerClientModules() {
    return {
        name: "htsw-importer-client-modules",
        enforce: "pre" as const,
        async resolveId(this: ResolveContext, source: string, importer: string | undefined) {
            const fromImporter = importer !== undefined && importer.startsWith(importerSrcDir);
            if (!fromImporter && !source.startsWith("@htsw/importer")) return null;
            const resolved = await this.resolve(source, importer, { skipSelf: true });
            if (resolved === null) return null;
            return byImporterFile.get(resolved.id.split("?")[0]) ?? resolved;
        },
    };
}
