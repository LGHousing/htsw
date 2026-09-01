/// <reference types="../../../CTAutocomplete" />

import { canonicalPath } from "../parsing/parses";
import {
    asStringSetValue,
    defineRootDoc,
    serializeStringSet,
} from "../../persistence/store";

const autoTrackSources = defineRootDoc<Set<string>>({
    file: "auto-track.json",
    fallback: new Set<string>(),
    // Canonicalize on read so a path stored under a different spelling still
    // matches the canonical paths every caller tests against.
    parse: (raw, fallback) => {
        const parsed = asStringSetValue(raw, fallback);
        if (parsed === fallback) return fallback;
        const out = new Set<string>();
        parsed.forEach((source) => out.add(canonicalPath(source)));
        return out;
    },
    serialize: serializeStringSet,
});

export function isAutoTrackSource(sourcePath: string): boolean {
    return autoTrackSources.get().has(canonicalPath(sourcePath));
}

export function getAutoTrackRevision(): number {
    return autoTrackSources.revision();
}

export function toggleAutoTrackSource(sourcePath: string): boolean | null {
    if (!autoTrackSources.healthy()) return null;
    const canon = canonicalPath(sourcePath);
    const current = autoTrackSources.get();
    const next = new Set<string>(current);
    const enabling = !current.has(canon);
    if (enabling) next.add(canon);
    else next.delete(canon);
    if (!autoTrackSources.set(next)) return null;
    return enabling;
}

export function isAnyAutoTrackEnabled(): boolean {
    return autoTrackSources.get().size > 0;
}

export function getAutoTrackSources(): ReadonlySet<string> {
    return autoTrackSources.get();
}
