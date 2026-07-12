/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Container, Icon, Row, Text } from "../lib/components";
import { Icons, IconName } from "../lib/icons.generated";
import { ProjectsView } from "./projects";
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
import { markGuiDirty } from "../lib/dirty";

type TabId = "projects" | "houses" | "settings";

type Tab = { id: TabId; label: string; icon: IconName; content: (bodyW: number) => Element };

const TABS: Tab[] = [
    { id: "projects", label: "Projects", icon: Icons.compass, content: ProjectsView },
    { id: "houses", label: "Houses", icon: Icons.house, content: HousesView },
    { id: "settings", label: "Settings", icon: Icons.settings, content: SettingsView },
];

let activeTab: TabId = "projects";

export function getActiveTab(): Tab {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === activeTab) return TABS[i];
    return TABS[0];
}

export function setActiveLeftTab(id: TabId): void {
    if (activeTab === id) return;
    activeTab = id;
    markGuiDirty();
}

// Tab geometry, needed to decide whether the text labels fit or the bar must
// fall back to icon-only. Mirrors the Button defaults (padding x:4, icon 16,
// icon→text gap 4) and the bar's own gap so the fit test matches what is
// actually laid out.
export const TAB_GAP = 2;
const TAB_BUTTON_PAD_X = 4;
const TAB_ICON_W = 16;
const TAB_ICON_LABEL_GAP = 4;
const LABEL_FIT_MARGIN = 4;

export function tabLabelsFit(perTabW: number, labels: string[]): boolean {
    const labelSpace =
        perTabW - TAB_BUTTON_PAD_X * 2 - TAB_ICON_W - TAB_ICON_LABEL_GAP;
    let widestLabel = 0;
    for (let i = 0; i < labels.length; i++) {
        const w = Renderer.getStringWidth(labels[i]);
        if (w > widestLabel) widestLabel = w;
    }
    return labelSpace - LABEL_FIT_MARGIN >= widestLabel;
}

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
                    setActiveLeftTab(t.id);
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
// half-clipped label into the next tab.
export function TabBar(availW: number): Element {
    const n = TABS.length;
    const perTab = (availW - TAB_GAP * (n - 1)) / n;
    const showLabels = tabLabelsFit(perTab, TABS.map((t) => t.label));
    const buttons = TABS.map((t) => tabButton(t, showLabels));
    // Projects + Houses are the two "sides of your project" the tour's step 3
    // points at; Settings isn't one of them. Grouping just those two under the
    // anchor keeps the spotlight off Settings. The pair group takes grow 2 to
    // the lone Settings tab's grow 1, so all three tabs keep their even thirds.
    const projectTabs = Row({
        anchorKey: "tour:project-tabs",
        style: {
            gap: TAB_GAP,
            width: { kind: "grow", factor: 2 },
            height: { kind: "grow" },
        },
        children: [buttons[0], buttons[1]],
    });
    return Row({
        style: {
            gap: TAB_GAP,
            height: { kind: "px", value: SIZE_TAB_H + 2 },
            width: { kind: "grow" },
        },
        children: [projectTabs, ...buttons.slice(2)],
    });
}
