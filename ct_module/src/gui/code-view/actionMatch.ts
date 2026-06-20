/**
 * Order-preserving matching of one action list against a cache baseline by
 * per-slot hash. Pure (hash arrays in, index mapping out) so it can be unit
 * tested without the parse/cache/Java machinery `sourceDiff` pulls in.
 *
 * Returns, per source index, the cache slot index it corresponds to — or null
 * when the action has no counterpart (a genuine addition).
 *
 * An exact-hash LCS anchors the unchanged actions; leftover source and cache
 * items inside each gap between anchors are paired in order (an edit in place).
 * So inserting or removing an action no longer misaligns everything below it:
 * only the genuinely new action maps to null ("add"), and an edited action
 * still pairs with its old slot (its hash differs, so the caller reports
 * "edit"). Without this a positional compare reads the whole shifted tail as
 * changed.
 */
export function matchByHash(
    sourceHashes: readonly string[],
    cacheHashes: readonly string[] | undefined
): (number | null)[] {
    const n = sourceHashes.length;
    const result: (number | null)[] = new Array(n);
    for (let i = 0; i < n; i++) result[i] = null;
    if (cacheHashes === undefined || cacheHashes.length === 0) return result;
    const m = cacheHashes.length;

    // LCS length over exact hash equality.
    const dp: number[][] = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dp[i][j] =
                sourceHashes[i - 1] === cacheHashes[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    // Backtrack the anchor pairs (ascending in both indices).
    const anchors: { i: number; j: number }[] = [];
    let bi = n;
    let bj = m;
    while (bi > 0 && bj > 0) {
        if (sourceHashes[bi - 1] === cacheHashes[bj - 1]) {
            anchors.push({ i: bi - 1, j: bj - 1 });
            bi--;
            bj--;
        } else if (dp[bi - 1][bj] >= dp[bi][bj - 1]) {
            bi--;
        } else {
            bj--;
        }
    }
    anchors.reverse();

    // Pair leftover source/cache items within each gap (between anchors, with
    // virtual -1 / length sentinels at the ends) in order — these are edits.
    let prevI = -1;
    let prevJ = -1;
    for (let a = 0; a <= anchors.length; a++) {
        const nextI = a < anchors.length ? anchors[a].i : n;
        const nextJ = a < anchors.length ? anchors[a].j : m;
        const pairs = Math.min(nextI - prevI - 1, nextJ - prevJ - 1);
        for (let t = 0; t < pairs; t++) result[prevI + 1 + t] = prevJ + 1 + t;
        if (a < anchors.length) result[nextI] = nextJ;
        prevI = nextI;
        prevJ = nextJ;
    }
    return result;
}
