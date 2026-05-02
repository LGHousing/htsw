export const Colors = {
    bg: 0xd0101216,
    panel: 0xf0242931,
    panelSoft: 0xe02d333d,
    hover: 0xf03a4350,
    row: 0xd0323944,
    rowSelected: 0xe0384f68,
    borderRect: 0xff596270,
    text: 0xe6e9ef,
    muted: 0xaab3bd,
    green: 0x62d26f,
    yellow: 0xe5bc4b,
    red: 0xef6a64,
    blue: 0x67a7e8,
    accent: 0xd7f264,
};

export function stateColor(
    state: "current" | "modified" | "unknown" | "unsupported"
): number {
    if (state === "current") return Colors.green;
    if (state === "modified") return Colors.yellow;
    if (state === "unknown") return Colors.red;
    return Colors.muted;
}
