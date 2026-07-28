import { SOUNDS } from "htsw/types";

import { normalizeSoundKey } from "../../src/housingSync/fields/sounds";

export function unresolvedHousingSoundLabels(labels: readonly string[]): string[] {
    return labels.filter((label) => {
        const normalized = normalizeSoundKey(label);
        if (normalized === null) return true;
        return !SOUNDS.some(
            (sound) => sound.path.toLowerCase() === normalized.toLowerCase()
        );
    });
}
