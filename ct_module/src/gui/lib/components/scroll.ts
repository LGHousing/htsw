import { Child, ContainerStyle, Element } from "../layout";
import { Extractable } from "../extractable";

export type ScrollProps = {
    id: string;
    children: Extractable<Child[]>;
    style?: ContainerStyle;
    /** Scroll axis. Defaults to "y" (vertical). */
    axis?: "x" | "y";
    /**
     * When true, mouse-wheel and scrollbar-drag input is consumed
     * instead of moving the viewport. Used by the live-preview during
     * an import — autoFollow re-centres each frame anyway, so user
     * scrolls would just snap back glitchily.
     */
    locked?: Extractable<boolean>;
};

export function Scroll(props: ScrollProps): Element {
    return {
        kind: "scroll",
        id: props.id,
        style: props.style ?? {},
        children: props.children,
        axis: props.axis,
        locked: props.locked,
    };
}
