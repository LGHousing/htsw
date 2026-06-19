/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Col, Container, Icon, Text } from "../../lib/components";
import { Icons, type IconName } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TOGGLE_ON,
    COLOR_TOGGLE_ON_HOVER,
    SIZE_ROW_H,
} from "../../lib/theme";
import {
    isImportSoundsMuted,
    setImportSoundsMuted,
} from "../../state/flags";
import { getStepAuto, setStepAuto } from "../../../housingSync/stepGate";

type ToggleRow = {
    icon: () => IconName;
    label: string;
    isOn: () => boolean;
    onToggle: () => void;
};

function toggleRow(opts: ToggleRow): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 6,
            padding: { side: "x", value: 8 },
            height: { kind: "px", value: SIZE_ROW_H + 4 },
            background: () => (opts.isOn() ? COLOR_TOGGLE_ON : COLOR_BUTTON),
            hoverBackground: () =>
                opts.isOn() ? COLOR_TOGGLE_ON_HOVER : COLOR_BUTTON_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            opts.onToggle();
        },
        children: [
            Icon({
                name: opts.icon,
                color: () => (opts.isOn() ? COLOR_TEXT : COLOR_TEXT_DIM),
                style: { width: { kind: "px", value: 12 }, height: { kind: "px", value: 12 } },
            }),
            Text({
                text: opts.label,
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            Icon({
                name: () => (opts.isOn() ? Icons.toggleRight : Icons.toggleLeft),
                color: () => (opts.isOn() ? COLOR_TEXT : COLOR_TEXT_DIM),
                style: { width: { kind: "px", value: 14 }, height: { kind: "px", value: 14 } },
            }),
        ],
    });
}

export function SettingsView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: [
            toggleRow({
                icon: () => (isImportSoundsMuted() ? Icons.volumeOff : Icons.volume2),
                label: "Mute import sounds",
                isOn: () => isImportSoundsMuted(),
                onToggle: () => setImportSoundsMuted(!isImportSoundsMuted()),
            }),
            toggleRow({
                icon: () => (getStepAuto() ? Icons.play : Icons.pause),
                label: "Auto-proceed imports",
                isOn: () => getStepAuto(),
                onToggle: () => setStepAuto(!getStepAuto()),
            }),
        ],
    });
}
