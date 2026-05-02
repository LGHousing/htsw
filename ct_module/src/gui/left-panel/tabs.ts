import { Element } from "../layout";
import { Button, Row } from "../components";
import { ExploreView } from "./explore";
import { KnowledgeView } from "./knowledge";

export type TabId = "explore" | "knowledge";

type Tab = { id: TabId; label: string; content: () => Element };

export const TABS: Tab[] = [
    { id: "explore", label: "Explore", content: ExploreView },
    { id: "knowledge", label: "Knowledge", content: KnowledgeView },
];

const TAB_ACTIVE_BG = 0xff67a7e8 | 0;

let activeTab: TabId = "explore";

export function getActiveTab(): Tab {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === activeTab) return TABS[i];
    return TABS[0];
}

export function TabBar(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: TABS.map((t) =>
            Button({
                text: t.label,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: () => (activeTab === t.id ? TAB_ACTIVE_BG : undefined),
                    hoverBackground: () => (activeTab === t.id ? TAB_ACTIVE_BG : undefined),
                },
                onClick: () => {
                    activeTab = t.id;
                },
            })
        ),
    });
}
