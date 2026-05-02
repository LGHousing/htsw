import { defaultImportJsonPath } from "./files";

export type HtswGuiConfig = {
    schemaVersion: 1;
    recentImportJsonPaths: string[];
    houseAliases: Record<string, string>;
};

const CONFIG_PATH = "./htsw/gui-config.json";
const MAX_RECENT_PATHS = 10;

export function defaultGuiConfig(): HtswGuiConfig {
    return {
        schemaVersion: 1,
        recentImportJsonPaths: [defaultImportJsonPath()],
        houseAliases: {},
    };
}

export function readGuiConfig(): HtswGuiConfig {
    if (!FileLib.exists(CONFIG_PATH)) return defaultGuiConfig();

    try {
        const parsed = JSON.parse(String(FileLib.read(CONFIG_PATH) ?? ""));
        if (
            !parsed ||
            typeof parsed !== "object" ||
            parsed.schemaVersion !== 1 ||
            !Array.isArray(parsed.recentImportJsonPaths) ||
            !parsed.houseAliases ||
            typeof parsed.houseAliases !== "object"
        ) {
            return defaultGuiConfig();
        }

        return {
            schemaVersion: 1,
            recentImportJsonPaths: normalizeRecentPaths(
                parsed.recentImportJsonPaths.filter(
                    (path: unknown) => typeof path === "string"
                )
            ),
            houseAliases: parsed.houseAliases as Record<string, string>,
        };
    } catch {
        return defaultGuiConfig();
    }
}

export function writeGuiConfig(config: HtswGuiConfig): void {
    try {
        FileLib.write(CONFIG_PATH, JSON.stringify(config, null, 4), true);
    } catch {
        // best-effort
    }
}

export function rememberImportPath(
    config: HtswGuiConfig,
    importPath: string
): HtswGuiConfig {
    return {
        ...config,
        recentImportJsonPaths: normalizeRecentPaths([
            importPath,
            ...config.recentImportJsonPaths,
        ]),
    };
}

export function removeRecentImportPath(
    config: HtswGuiConfig,
    importPath: string
): HtswGuiConfig {
    return {
        ...config,
        recentImportJsonPaths: config.recentImportJsonPaths.filter(
            (path) => path !== importPath
        ),
    };
}

export function setHouseAlias(
    config: HtswGuiConfig,
    housingUuid: string,
    alias: string
): HtswGuiConfig {
    const nextAliases = { ...config.houseAliases };
    const trimmed = alias.trim();
    if (trimmed.length === 0) {
        delete nextAliases[housingUuid];
    } else {
        nextAliases[housingUuid] = trimmed;
    }
    return {
        ...config,
        houseAliases: nextAliases,
    };
}

function normalizeRecentPaths(paths: readonly string[]): string[] {
    const out: string[] = [];
    for (const path of paths) {
        if (path.length === 0 || out.indexOf(path) !== -1) continue;
        out.push(path);
        if (out.length >= MAX_RECENT_PATHS) break;
    }
    return out.length === 0 ? [defaultImportJsonPath()] : out;
}
