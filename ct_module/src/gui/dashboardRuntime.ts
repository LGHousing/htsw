import type { HtswGuiConfig } from "./config";
import type { BrowserEntry } from "./files";
import type { DashboardState, LoadedProject } from "./model";
import type { Rect, TextField } from "./widgets";

export type ContextMenuItem = {
    id: string;
    label: string;
    enabled: boolean;
    payload?: string;
};

export type ContextMenuState = {
    x: number;
    y: number;
    items: ContextMenuItem[];
};

export type PromptState = {
    kind: "newFile" | "newFolder";
    title: string;
    value: string;
    parentDir: string;
};

export type ClickTarget =
    | { kind: "button"; id: string; rect: Rect; enabled: boolean }
    | { kind: "row"; id: string; rect: Rect }
    | { kind: "recent"; path: string; rect: Rect }
    | { kind: "browser"; entry: BrowserEntry; rect: Rect }
    | { kind: "browserBackground"; rect: Rect }
    | { kind: "field"; id: string; rect: Rect }
    | { kind: "contextItem"; id: string; payload: string | undefined; rect: Rect; enabled: boolean }
    | { kind: "tooltipSource"; text: string; rect: Rect }
    | { kind: "previewCmd"; cmd: string; rect: Rect }
    | { kind: "previewCopyNbt"; rowId: string; rect: Rect }
    | { kind: "previewGiveItem"; rowId: string; rect: Rect }
    | { kind: "tab"; tabId: string; rect: Rect }
    | { kind: "tabClose"; tabId: string; rect: Rect }
    | { kind: "openHtslTab"; rowId: string; rect: Rect };

export type ProgressTracker = {
    label: string;
    completed: number;
    total: number;
    failed: number;
    currentLabel: string;
    startedAtMs: number;
    finishedAtMs: number | null;
};

export type DashboardRuntime = {
    gui: Gui;
    state: DashboardState;
    config: HtswGuiConfig;
    project: LoadedProject | null;
    clickTargets: ClickTarget[];
    fields: TextField[];
    focusedField: string | null;
    rowScroll: number;
    browserOpen: boolean;
    browserDir: string;
    browserEntries: BrowserEntry[];
    pendingForget: boolean;
    renderErrorReported: boolean;
    mouseX: number;
    mouseY: number;
    tooltips: { x: number; y: number; text: string }[];
    contextMenu: ContextMenuState | null;
    pendingPrompt: PromptState | null;
    progress: ProgressTracker | null;
    overlayTrigger: any | null;
    lastClick: { key: string; t: number } | null;
};
