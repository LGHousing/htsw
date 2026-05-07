/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Row } from "../lib/components";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    GLYPH_CHEVRON_DOWN,
} from "../lib/theme";
import {
    getLastOpenTarget,
    openOpenTargetMenu,
    runOpenTarget,
} from "../popovers/open-menu";

/**
 * Slim strip under the inventory cutout. Only the Housing Menu shortcut
 * and the /functions … /eventactions … split-button live here now —
 * everything else (Trust toggle, Capture, Import) moved into the right
 * panel's Import tab. No background fill: the strip floats over the
 * world.
 */
export function BottomToolbar(): Element {
    return Row({
        style: {
            padding: 4,
            gap: 4,
            width: { kind: "grow" },
            height: { kind: "px", value: 26 },
            align: "center",
        },
        children: [
            // Housing Menu sizes to its label so the split button on the
            // right always has enough room for "Event Actions" without
            // overflowing the button background.
            Button({
                text: "Housing Menu",
                style: {
                    width: { kind: "auto" },
                    height: { kind: "px", value: 18 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    try {
                        ChatLib.command("hmenu");
                    } catch (err) {
                        ChatLib.chat(`&c[htsw] /hmenu failed: ${err}`);
                    }
                },
            }),
            // Split button: main label + caret share a Row with gap=0 so
            // the two halves visually fuse into one control.
            Row({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                    gap: 0,
                },
                children: [
                    Button({
                        text: () => getLastOpenTarget().label,
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => runOpenTarget(getLastOpenTarget()),
                    }),
                    Button({
                        text: GLYPH_CHEVRON_DOWN,
                        style: {
                            width: { kind: "px", value: 14 },
                            height: { kind: "px", value: 18 },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: (rect) => openOpenTargetMenu(rect),
                    }),
                ],
            }),
        ],
    });
}
