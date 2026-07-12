import { Icon } from "../lib/components";
import type { Element } from "../lib/layout";
import type { IconName } from "../lib/icons.generated";
import { Icons } from "../lib/icons.generated";
import { ACCENT_SUCCESS, ACCENT_WARN, COLOR_TEXT_DIM, COLOR_TEXT_FAINT } from "../lib/theme";

// One status-icon vocabulary shared by the Houses and Projects rows. Both
// pages show the same file<->house relationship from opposite sides (Houses
// iterates a house's contents, Projects iterates your files), so a "differs"
// row must read identically on both. Each page maps its own states into these
// keys and supplies its own tooltip wording — the icon and color are the shared
// part, the phrasing is per-page.
//
// The metaphor: unlink = present on only one side; link = present on both;
// compare-arrows = present on both but the content has diverged.
export type LinkStatusKey =
    | "matches" // in both, content verified identical
    | "differs" // in both, content differs
    | "present" // in both, content not compared (untrusted, or not read yet)
    | "oneSided" // present on only one of files/house
    | "unknown"; // can't tell — house not scanned, or nothing read yet

const LINK_STATUS_VISUAL: { [k in LinkStatusKey]: { icon: IconName; color: number } } = {
    matches: { icon: Icons.link, color: ACCENT_SUCCESS },
    differs: { icon: Icons.gitCompareArrows, color: ACCENT_WARN },
    present: { icon: Icons.link, color: COLOR_TEXT_DIM },
    oneSided: { icon: Icons.unlink, color: COLOR_TEXT_DIM },
    unknown: { icon: Icons.circleHelp, color: COLOR_TEXT_FAINT },
};

export function linkStatusIcon(key: LinkStatusKey, tooltip: string, size: number = 10): Element {
    const v = LINK_STATUS_VISUAL[key];
    return Icon({
        name: v.icon,
        color: v.color,
        tooltip,
        tooltipColor: v.color,
        style: { width: { kind: "px", value: size }, height: { kind: "px", value: size } },
    });
}
