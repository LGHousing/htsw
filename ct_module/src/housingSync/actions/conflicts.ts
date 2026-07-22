export function scanConflictVerdict(
    liveHash: string,
    lockHash: string | undefined,
    sourceHash: string
): "no-baseline" | "unchanged" | "already-applied" | "conflict" {
    if (lockHash === undefined) return "no-baseline";
    if (liveHash === lockHash) return "unchanged";
    if (liveHash === sourceHash) return "already-applied";
    return "conflict";
}
