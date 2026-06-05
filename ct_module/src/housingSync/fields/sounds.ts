import { SOUNDS } from "htsw/types";

export function normalizeSoundKey(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    for (let i = 0; i < SOUNDS.length; i++) {
        const sound = SOUNDS[i];
        if (
            lower === sound.path.toLowerCase() ||
            lower === sound.name.toLowerCase() ||
            lower === sound.name.split(" ").join("_").toLowerCase()
        ) {
            return sound.path;
        }
    }
    return trimmed;
}
