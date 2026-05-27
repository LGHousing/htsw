import { Element, Style } from "../layout";

export type McItemProps = {
    item: string;
    count?: number;
    style?: Style;
};

const DEFAULT_SIZE: Style = {
    width: { kind: "px", value: 16 },
    height: { kind: "px", value: 16 },
};

export function McItem(props: McItemProps): Element {
    return {
        kind: "mcItem",
        style: props.style ?? DEFAULT_SIZE,
        item: props.item,
        count: props.count ?? 1,
    };
}
