import { ContainerStyle, Element } from "../layout";
import { Extractable } from "../extractable";

export type ScrollProps = {
    id: string;
    children: Extractable<Element[]>;
    style?: ContainerStyle;
};

export function Scroll(props: ScrollProps): Element {
    return {
        kind: "scroll",
        id: props.id,
        style: props.style ?? {},
        children: props.children,
    };
}
