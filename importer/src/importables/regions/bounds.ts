import type { Bounds } from "htsw/types";

import { stableStringify } from "../../utils/helpers";

function normalizeRegionBounds(bounds: Bounds): Bounds {
    return {
        from: {
            x: Math.min(bounds.from.x, bounds.to.x),
            y: Math.min(bounds.from.y, bounds.to.y),
            z: Math.min(bounds.from.z, bounds.to.z),
        },
        to: {
            x: Math.max(bounds.from.x, bounds.to.x),
            y: Math.max(bounds.from.y, bounds.to.y),
            z: Math.max(bounds.from.z, bounds.to.z),
        },
    };
}

export function regionBoundsCompareKey(bounds: Bounds): string {
    return stableStringify(normalizeRegionBounds(bounds));
}

export function regionBoundsEqual(left: Bounds | null, right: Bounds): boolean {
    return (
        left !== null && regionBoundsCompareKey(left) === regionBoundsCompareKey(right)
    );
}
