/// <reference types="../../../CTAutocomplete" />

/**
 * Registers every workspace slice.
 *
 * Kept as one file that imports the feature modules, rather than each feature
 * importing the workspace: the dependency edges stay one-way, and there is a
 * single place to read to know exactly what a reload restores.
 *
 * Adding a slice is a `defineWorkspaceSlice` call here plus a capture/restore
 * pair on the module that owns the state. Nothing else changes — capture is
 * polled, so no mutation site needs to announce itself.
 */

import type { Importable } from "htsw/types";

import { defineWorkspaceSlice } from "../../persistence/workspace";
import {
    asEntryArray,
    asString,
    asStringArray,
    type ValueParser,
} from "../../persistence/store";
import { canonicalPath } from "../parsing/parses";
import { pathExists } from "../lib/java";
import { getImportJsonPath, setImportJsonPath } from "../state/paths";
import { restoreSourcePaths, sourcePaths } from "../left-panel/projects/source";
import {
    getExpansionState,
    setExpansionState,
    type ExpansionState,
} from "../left-panel/projects/rows";
import {
    getActiveSort,
    isSortDir,
    isSortFieldId,
    setActiveSort,
    type SortState,
} from "../left-panel/projects/sort";
import {
    getFilterState,
    setFilterState,
    type FilterState,
} from "../left-panel/projects/filter";
import {
    getActiveLeftTabId,
    isLeftTabId,
    setActiveLeftTab,
} from "../left-panel/tabs";
import {
    getTabsState,
    setTabsState,
    type TabsState,
} from "../right-panel/selection";
import {
    captureQueueItems,
    restoreQueueItems,
    type QueueItem,
} from "../right-panel/import-tab/queue";

const IMPORTABLE_TYPES = [
    "FUNCTION", "EVENT", "REGION", "ITEM", "MENU", "NPC", "TEAM", "GROUP", "COMMAND",
];

function asRecordOfBoolean(
    raw: unknown,
    fallback: Record<string, boolean>
): Record<string, boolean> {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const source = raw as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const value = source[key];
        if (typeof value === "boolean") out[key] = value;
    }
    return out;
}

// ── Open projects ──────────────────────────────────────────────────────

defineWorkspaceSlice<string[]>({
    key: "sources",
    fallback: [],
    parse: asStringArray,
    capture: sourcePaths,
    restore: restoreSourcePaths,
});

// ── Active project ─────────────────────────────────────────────────────

defineWorkspaceSlice<string>({
    key: "activeImportJson",
    fallback: "",
    parse: asString,
    capture: getImportJsonPath,
    restore: (path) => {
        // Checked here rather than trusted from the file: the project may have
        // been deleted or moved since it was written, and pointing the whole
        // GUI at a path that no longer resolves is worse than starting empty.
        if (path === "" || !pathExists(path)) return;
        setImportJsonPath(path);
    },
});

// ── Editor tabs ────────────────────────────────────────────────────────

const parseTabs: ValueParser<TabsState> = (raw, fallback) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const source = raw as Record<string, unknown>;
    const entries = asEntryArray<{ path: string; importJsonPath: string | null }>(
        (entry) => {
            if (typeof entry.path !== "string") return null;
            const owner = entry.importJsonPath;
            return {
                path: entry.path,
                importJsonPath: typeof owner === "string" ? owner : null,
            };
        }
    )(source.confirmed, []);
    const activeRaw = source.active;
    let active: { path: string; importJsonPath: string | null } | null = null;
    if (activeRaw !== null && typeof activeRaw === "object" && !Array.isArray(activeRaw)) {
        const entry = activeRaw as Record<string, unknown>;
        if (typeof entry.path === "string") {
            active = {
                path: entry.path,
                importJsonPath:
                    typeof entry.importJsonPath === "string"
                        ? entry.importJsonPath
                        : null,
            };
        }
    }
    return { confirmed: entries, active };
};

defineWorkspaceSlice<TabsState>({
    key: "tabs",
    fallback: { confirmed: [], active: null },
    parse: parseTabs,
    capture: getTabsState,
    restore: (state) => setTabsState(state, pathExists),
});

// ── Projects tree ──────────────────────────────────────────────────────

const parseExpansion: ValueParser<ExpansionState> = (raw, fallback) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const source = raw as Record<string, unknown>;
    return {
        imports: asRecordOfBoolean(source.imports, {}),
        includeGroups: asRecordOfBoolean(source.includeGroups, {}),
        importables: asStringArray(source.importables, []),
        collapsedRoots: asStringArray(source.collapsedRoots, []),
    };
};

defineWorkspaceSlice<ExpansionState>({
    key: "expansion",
    fallback: {
        imports: {},
        includeGroups: {},
        importables: [],
        collapsedRoots: [],
    },
    parse: parseExpansion,
    capture: getExpansionState,
    restore: setExpansionState,
});

// ── Sort ───────────────────────────────────────────────────────────────

const parseSort: ValueParser<SortState> = (raw, fallback) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const source = raw as Record<string, unknown>;
    if (!isSortFieldId(source.id) || !isSortDir(source.direction)) return fallback;
    return { id: source.id, direction: source.direction };
};

defineWorkspaceSlice<SortState>({
    key: "sort",
    fallback: { id: "type", direction: "ASC" },
    parse: parseSort,
    capture: getActiveSort,
    restore: setActiveSort,
});

// ── Filters ────────────────────────────────────────────────────────────

const parseFilters: ValueParser<FilterState> = (raw, fallback) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const source = raw as Record<string, unknown>;
    return {
        types: asStringArray(source.types, []).filter(
            (t) => IMPORTABLE_TYPES.indexOf(t) >= 0
        ),
        statuses: asStringArray(source.statuses, []),
    };
};

defineWorkspaceSlice<FilterState>({
    key: "filters",
    fallback: { types: [], statuses: [] },
    parse: parseFilters,
    capture: getFilterState,
    restore: setFilterState,
});

// ── Active left tab ────────────────────────────────────────────────────

defineWorkspaceSlice<string>({
    key: "leftTab",
    fallback: "projects",
    parse: (raw, fallback) => (isLeftTabId(raw) ? raw : fallback),
    capture: getActiveLeftTabId,
    restore: (id) => {
        if (isLeftTabId(id)) setActiveLeftTab(id);
    },
});

// ── Queue ──────────────────────────────────────────────────────────────

const parseQueue: ValueParser<QueueItem[]> = asEntryArray<QueueItem>((entry) => {
    const label = typeof entry.label === "string" ? entry.label : "";
    if (entry.operation === "import") {
        if (typeof entry.sourcePath !== "string") return null;
        const sourcePath = canonicalPath(entry.sourcePath);
        if (entry.kind === "importJson") {
            return { operation: "import", kind: "importJson", sourcePath, label };
        }
        if (
            entry.kind !== "importable" ||
            typeof entry.identity !== "string" ||
            typeof entry.type !== "string"
        ) {
            return null;
        }
        return {
            operation: "import",
            kind: "importable",
            sourcePath,
            identity: entry.identity,
            type: entry.type as Importable["type"],
            label,
        };
    }
    if (entry.operation !== "export" && entry.operation !== "read") return null;
    if (
        typeof entry.destinationPath !== "string" ||
        typeof entry.identity !== "string" ||
        typeof entry.type !== "string"
    ) {
        return null;
    }
    return {
        operation: entry.operation,
        kind: "importable",
        destinationPath: canonicalPath(entry.destinationPath),
        housingUuid:
            typeof entry.housingUuid === "string" ? entry.housingUuid : null,
        identity: entry.identity,
        type: entry.type as Importable["type"],
        label,
    };
});

defineWorkspaceSlice<QueueItem[]>({
    key: "queue",
    fallback: [],
    parse: parseQueue,
    capture: captureQueueItems,
    restore: (saved) => {
        // Rows whose file is gone are dropped: the import would fail at
        // resolve time anyway, and a permanently-failing row is worse than
        // an absent one.
        const live = saved.filter((item) =>
            pathExists(
                item.operation === "import" ? item.sourcePath : item.destinationPath
            )
        );
        restoreQueueItems(live);
    },
});
