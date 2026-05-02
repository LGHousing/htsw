import { Element } from "../../layout";
import { Col, Text } from "../../components";

export function KnowledgeView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: [Text({ text: "No children", color: 0xff888888 | 0 })],
    });
}
