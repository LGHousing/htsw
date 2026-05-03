/// <reference types="../../../../CTAutocomplete" />

import { Element } from "../../layout";
import { Button, Col, Container, Scroll, Text } from "../../components";
import { getHousingUuid, getKnowledgeRows, setHousingUuid } from "../../state";
import { STATUS_COLOR, STATUS_LABEL } from "../../knowledge-status";
import { getCurrentHousingUuid } from "../../../knowledge/housingId";
import { TaskManager } from "../../../tasks/manager";

const ROW_BG = 0xff2d333d | 0;
const ROW_HOVER_BG = 0xff3a4350 | 0;

function detectHousing(): void {
    TaskManager.run(async (ctx) => {
        try {
            const uuid = await getCurrentHousingUuid(ctx);
            setHousingUuid(uuid);
            ChatLib.chat(`&a[htsw] Housing UUID: ${uuid}`);
        } catch (err) {
            ChatLib.chat(`&c[htsw] Detect failed: ${err}`);
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Detect task failed: ${err}`);
    });
}

function shortUuid(uuid: string): string {
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}

export function KnowledgeView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: () => {
            const uuid = getHousingUuid();
            const rows = getKnowledgeRows();
            if (uuid === null) {
                return [
                    Text({
                        text: "No housing UUID yet.",
                        color: 0xff888888 | 0,
                    }),
                    Text({
                        text: "Click Detect or run an import.",
                        color: 0xff666666 | 0,
                    }),
                    Button({
                        text: "Detect (/wtfmap)",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => detectHousing(),
                    }),
                ];
            }
            const header: Element[] = [
                Text({
                    text: `Housing: ${shortUuid(uuid)}`,
                    color: 0xff888888 | 0,
                }),
            ];
            if (rows.length === 0) {
                header.push(
                    Text({
                        text: "No knowledge rows.",
                        color: 0xff666666 | 0,
                    })
                );
                return header;
            }
            const list = rows.map((row) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 4 },
                        gap: 6,
                        height: { kind: "px", value: 16 },
                        background: ROW_BG,
                        hoverBackground: ROW_HOVER_BG,
                    },
                    children: [
                        Container({
                            style: {
                                width: { kind: "px", value: 6 },
                                height: { kind: "px", value: 10 },
                                background: STATUS_COLOR[row.state],
                            },
                            children: [],
                        }),
                        Text({
                            text: row.identity,
                            style: { width: { kind: "grow" } },
                        }),
                        Text({
                            text: STATUS_LABEL[row.state],
                            color: 0xff888888 | 0,
                        }),
                    ],
                })
            );
            return [
                ...header,
                Scroll({
                    id: "knowledge-rows-scroll",
                    style: { height: { kind: "grow" }, gap: 2 },
                    children: list,
                }),
            ];
        },
    });
}
