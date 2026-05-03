import { Element } from "../layout";
import { Button, Container, Row } from "../components";
import { ExploreView } from "./explore";
import { ImportablesView } from "./importables";
import { KnowledgeView } from "./knowledge";
import { SettingsView } from "./settings";
import {
    COLOR_TAB,
    COLOR_TAB_ACCENT,
    COLOR_TAB_ACTIVE,
    COLOR_TAB_ACTIVE_HOVER,
    COLOR_TAB_HOVER,
    SIZE_TAB_H,
} from "../theme";

export type TabId = "importables" | "explore" | "knowledge" | "settings";

type Tab = { id: TabId; label: string; content: () => Element };

export const TABS: Tab[] = [
    { id: "importables", label: "Importables", content: ImportablesView },
    { id: "explore", label: "Explore", content: ExploreView },
    { id: "knowledge", label: "Knowledge", content: KnowledgeView },
    { id: "settings", label: "Settings", content: SettingsView },
];

let activeTab: TabId = "importables";

export function getActiveTab(): Tab {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === activeTab) return TABS[i];
    return TABS[0];
}

function tabButton(t: Tab): Element {
    const isActive = activeTab === t.id;
    // 2px accent strip under the active tab. Stack as Col: button + strip.
    return Container({
        style: {
            direction: "col",
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: [
            Button({
                text: t.label,
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

export function TabBar(): Element {
    return Row({
        style: {
            gap: 2,
            height: { kind: "px", value: SIZE_TAB_H + 2 },
            width: { kind: "grow" },
        },
        children: TABS.map(tabButton),
    });
}
