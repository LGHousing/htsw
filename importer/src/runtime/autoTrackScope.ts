import { getAutoTrackSources } from "./state/autoTrack";
import { getHousingUuid } from "./state/housing";
import { canonicalPath, getParseAt } from "./parsing/parses";

/** Why Auto-Track can't run for an import.json right now. */
export type AutoTrackBlock =
    /**
     * No known house to import into: the project declares no `houseUuid`, or
     * it hasn't been parsed yet so its binding is still unknown.
     */
    | "unbound"
    /** Bound to a house you aren't standing in. */
    | "elsewhere";

export function autoTrackBoundHouse(importJsonPath: string): string | null {
    const entry = getParseAt(importJsonPath);
    if (entry === null || entry.parsed === null) return null;
    return entry.parsed.importJson.houseUuid;
}

export function autoTrackBlock(importJsonPath: string): AutoTrackBlock | null {
    const bound = autoTrackBoundHouse(importJsonPath);
    if (bound === null) return "unbound";
    return bound === getHousingUuid() ? null : "elsewhere";
}

/** Tracked AND standing in the project's bound house. */
export function isAutoTrackActive(importJsonPath: string): boolean {
    const canon = canonicalPath(importJsonPath);
    return getAutoTrackSources().has(canon) && autoTrackBlock(canon) === null;
}

/**
 * The tracked sources Auto-Track and watch mode may act on. A tracked project
 * bound to another house stays in the persisted set — the toggle survives the
 * trip — but drops out here until you are back inside its house.
 */
export function getActiveAutoTrackSources(): ReadonlySet<string> {
    const active = new Set<string>();
    getAutoTrackSources().forEach((source) => {
        if (autoTrackBlock(source) === null) active.add(source);
    });
    return active;
}
