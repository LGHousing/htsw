import { Child, ContainerStyle, Element, Rect } from "../layout";
import { Extractable } from "../extractable";

export type ContainerProps = {
    children: Extractable<Child[]>;
    style?: ContainerStyle;
    onClick?: (rect: Rect) => void;
};

export function Container(props: ContainerProps): Element {
    return {
        kind: "container",
        style: props.style ?? {},
        children: props.children,
        onClick: props.onClick,
    };
}

export function Row(props: ContainerProps): Element {
    return Container({
        children: props.children,
        style: { ...(props.style ?? {}), direction: "row" },
        onClick: props.onClick,
    });
}

export function Col(props: ContainerProps): Element {
    return Container({
        children: props.children,
        style: { ...(props.style ?? {}), direction: "col" },
        onClick: props.onClick,
    });
}
