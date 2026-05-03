import { ClickInfo, Element, Rect, Style } from "../layout";
import { Extractable } from "../extractable";

export type ButtonProps = {
    text: Extractable<string>;
    onClick: (rect: Rect, info: ClickInfo) => void;
    onDoubleClick?: (rect: Rect) => void;
    style?: Style;
};

export function Button(props: ButtonProps): Element {
    return {
        kind: "button",
        style: props.style ?? {},
        text: props.text,
        onClick: props.onClick,
        onDoubleClick: props.onDoubleClick,
    };
}
