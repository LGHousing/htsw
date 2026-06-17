/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Container, Icon, Row, Text } from "../lib/components";
import { Icons, IconName } from "../lib/icons.generated";
import { ImportablesView } from "./importables";
import { HousesView } from "./houses";
import { SettingsView } from "./settings";
import {
    COLOR_TAB,
    COLOR_TAB_ACCENT,
    COLOR_TAB_ACTIVE,
    COLOR_TAB_ACTIVE_HOVER,
    COLOR_TAB_HOVER,
    COLOR_TEXT,
    SIZE_TAB_H,
} from "../lib/theme";

type TabId = "importables" | "houses" | "settings";

type Tab = { id: TabId; label: string; icon: IconName; content: () => Element };

const TABS: Tab[] = [
    { id: "importables", label: "Importables", icon: Icons.compass, content: ImportablesView },
    { id: "houses", label: "Houses", icon: Icons.house, content: HousesView },
    { id: "settings", label: "Settings", icon: Icons.settings, content: SettingsView },
];

let activeTab: TabId = "importables";

export function getActiveTab(): Tab {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === activeTab) return TABS[i];
    return TABS[0];
}

export function setActiveLeftTab(id: TabId): void {
    activeTab = id;
}

// Tab geometry, needed to decide whether the text labels fit or the bar must
// fall back to icon-only. Mirrors the Button defaults (padding x:4, icon 16,
// icon→text gap 4) and the bar's own gap so the fit test matches what is
// actually laid out.
const TAB_GAP = 2;
const TAB_BUTTON_PAD_X = 4;
const TAB_ICON_W = 16;
const TAB_ICON_LABEL_GAP = 4;
const LABEL_FIT_MARGIN = 4;

function tabButton(t: Tab, showLabel: boolean): Element {
    const isActive = activeTab === t.id;
    const content: Element[] = [
        Icon({
            name: t.icon,
            tooltip: showLabel ? undefined : t.label,
            tooltipColor: COLOR_TEXT,
        }),
    ];
    if (showLabel) content.push(Text({ text: t.label }));
    return Container({
        style: {
            direction: "col",
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: [
            Button({
                children: content,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: isActive ? COLOR_TAB_ACTIVE : COLOR_TAB,
                    hoverBackground: isActive ? COLOR_TAB_ACTIVE_HOVER : COLOR_TAB_HOVER,
                },
                onClick: () => {
                    activeTab = t.id;
                },
            }),
            Container({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 2 },
                    background: isActive ? COLOR_TAB_ACCENT : undefined,
                },
                children: [],
            }),
        ],
    });
}

// `availW` is the tab bar's own width (the left panel minus its padding). The
// labels show only when the WIDEST one fits its tab; otherwise every tab drops
// to icon-only (with a hover tooltip) so a narrow panel never paints a
// half-clipped "Importables" into the next tab.
export function TabBar(availW: number): Element {
    const n = TABS.length;
    const perTab = (availW - TAB_GAP * (n - 1)) / n;
    const labelSpace =
        perTab - TAB_BUTTON_PAD_X * 2 - TAB_ICON_W - TAB_ICON_LABEL_GAP;
    let widestLabel = 0;
    for (let i = 0; i < n; i++) {
        const w = Renderer.getStringWidth(TABS[i].label);
        if (w > widestLabel) widestLabel = w;
    }
    const showLabels = labelSpace - LABEL_FIT_MARGIN >= widestLabel;
    return Row({
        anchorKey: "tour:left-tabs",
        style: {
            gap: TAB_GAP,
            height: { kind: "px", value: SIZE_TAB_H + 2 },
            width: { kind: "grow" },
        },
        children: TABS.map((t) => tabButton(t, showLabels)),
    });
}
