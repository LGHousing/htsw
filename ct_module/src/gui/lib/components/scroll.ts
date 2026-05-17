import { Child, ContainerStyle, Element } from "../layout";
import { Extractable } from "../extractable";

export type ScrollProps = {
    id: string;
    children: Extractable<Child[]>;
    style?: ContainerStyle;
    /**
     * When true, mouse-wheel and scrollbar-drag input is silently
     * consumed instead of moving the viewport. Use for auto-follow
     * scrolls where the user scrolling away just snaps back glitchily
     * on the next frame.
     */
    locked?: Extractable<boolean>;
};

export function Scroll(props: ScrollProps): Element {
    return {
        kind: "scroll",
        id: props.id,
        style: props.style ?? {},
        children: props.children,
        locked: props.locked,
    };
}
