import type { Color } from "htsw/types";

const COLOR_BY_CODE: Partial<Record<string, Color>> = {
    "1": "Dark Blue",
    "2": "Dark Green",
    "3": "Dark Aqua",
    "4": "Dark Red",
    "5": "Dark Purple",
    "6": "Gold",
    "7": "Gray",
    "8": "Dark Gray",
    "9": "Blue",
    a: "Green",
    b: "Aqua",
    c: "Red",
    d: "Light Purple",
    e: "Yellow",
};

export function teamGroupColorFromDisplayName(displayName: string): Color | undefined {
    for (let i = 0; i < displayName.length - 1; i++) {
        if (displayName.charAt(i) !== "§") continue;
        const color = COLOR_BY_CODE[displayName.charAt(i + 1).toLowerCase()];
        if (color !== undefined) return color;
    }
    return undefined;
}
