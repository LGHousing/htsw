import { canonicalPath } from "../parsing/parses";

const autoTrackSources: Set<string> = new Set();

export function isAutoTrackSource(sourcePath: string): boolean {
    return autoTrackSources.has(canonicalPath(sourcePath));
}
export function toggleAutoTrackSource(sourcePath: string): boolean {
    const canon = canonicalPath(sourcePath);
    if (autoTrackSources.has(canon)) {
        autoTrackSources.delete(canon);
        return false;
    }
    autoTrackSources.add(canon);
    return true;
}
export function isAnyAutoTrackEnabled(): boolean { return autoTrackSources.size > 0; }
export function getAutoTrackSources(): ReadonlySet<string> { return autoTrackSources; }
