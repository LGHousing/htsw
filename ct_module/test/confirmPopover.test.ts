import { afterEach, expect, it, vi } from "vitest";

import type { Element } from "../src/gui/lib/layout";

const mocks = vi.hoisted(() => ({
    opened: null as null | {
        content: Element;
        height: number;
    },
}));

vi.mock("../src/gui/lib/popovers", () => ({
    openPopover: (options: { content: Element; height: number }) => {
        mocks.opened = options;
        return { id: 1 };
    },
    closePopover: () => undefined,
}));

import {
    closeConfirmPopover,
    openConfirmPopover,
} from "../src/gui/popovers/confirm";

afterEach(() => {
    closeConfirmPopover();
    mocks.opened = null;
    vi.unstubAllGlobals();
});

it("keeps every line in one scrollable confirm body when the list is long", () => {
    vi.stubGlobal("Renderer", {
        getStringWidth: (text: string) => text.length,
    });
    const lines = Array.from({ length: 24 }, (_, index) => `List ${index + 1}`);

    openConfirmPopover({
        title: "Adopt live Housing state?",
        lines,
        onConfirm: () => undefined,
    });

    const content = mocks.opened?.content;
    expect(content?.kind).toBe("container");
    if (content?.kind !== "container") throw new Error("missing confirm content");
    const children = content.children as Element[];
    const scroll = children.find((child) => child.kind === "scroll");
    expect(scroll).toMatchObject({
        kind: "scroll",
        id: "confirm-lines",
    });
    if (scroll?.kind !== "scroll") throw new Error("missing confirm scroll");
    expect(scroll.children).toHaveLength(lines.length);
    expect(mocks.opened?.height).toBeLessThan(200);
});
