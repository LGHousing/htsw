export function itemSnbtCachePath(housingUuid: string, hash: string): string {
    return `./htsw/.cache/${housingUuid}/items/${hash}.snbt`;
}

export function readCachedItemSnbt(
    housingUuid: string,
    hash: string
): string | undefined {
    const path = itemSnbtCachePath(housingUuid, hash);
    if (!FileLib.exists(path)) return undefined;

    const raw = FileLib.read(path);
    return raw === null ? undefined : String(raw);
}
