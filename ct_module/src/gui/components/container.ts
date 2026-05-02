import { ContainerStyle, Element } from "../layout";
import { Extractable } from "../extractable";

export type ContainerProps = {
    children: Extractable<Element[]>;
    style?: ContainerStyle;
};

export function Container(props: ContainerProps): Element {
    return {
        kind: "container",
        style: props.style ?? {},
        children: props.children,
    };
}

export function Row(props: ContainerProps): Element {
    return Container({
        children: props.children,
        style: { ...(props.style ?? {}), direction: "row" },
    });
}

export function Col(props: ContainerProps): Element {
    return Container({
        children: props.children,
        style: { ...(props.style ?? {}), direction: "col" },
    });
}
