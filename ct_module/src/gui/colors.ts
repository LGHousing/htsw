export const Colors = {
    bg: 0xee101216,
    panel: 0xee181b20,
    panelSoft: 0xcc20242b,
    row: 0x99272c34,
    rowSelected: 0xcc26364a,
    border: 0xff3a404a,
    text: 0xffe6e9ef,
    muted: 0xff9aa3ad,
    green: 0xff62d26f,
    yellow: 0xffe5bc4b,
    red: 0xffef6a64,
    blue: 0xff67a7e8,
    accent: 0xffd7f264,
};

export function stateColor(state: "current" | "stale" | "missing" | "unsupported"): number {
    if (state === "current") return Colors.green;
    if (state === "stale") return Colors.yellow;
    if (state === "missing") return Colors.red;
    return Colors.muted;
}
