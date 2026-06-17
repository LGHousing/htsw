/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { Button, Col, Container } from "../lib/components";
import { isScrollUserOverridden } from "../lib/layout";
import { Icons } from "../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
} from "../lib/theme";
import {
    confirmSelect,
    getActivePath,
    isLiveTabActive,
    pinTab,
} from "./selection";
import { getActiveImportPath, getImportProgress, getSessionVerb } from "./import-tab/importProgress";
import { CodeView, jumpToFocusedLine } from "../code-view/codeView";
import { diffDecorator, progressDecorator } from "./decorators";
import { previewLinesForFile } from "./import-tab/livePreview";
import type { RenderableLine } from "../code-view/lineTypes";

const LIVE_PREVIEW_SCROLL_ID = "right-live-preview-scroll";

export function viewBody(): Element {
    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" }, gap: 0 },
        children: () =>
            isLiveTabActive()
                ? [
                      jumpBackPipRow(),
                      CodeView({
                          scrollId: LIVE_PREVIEW_SCROLL_ID,
                          lines: () => extractLiveLines(),
                          lineDecorator: () => progressDecorator(getActivePath()),
                          autoFollow: true,
                          scrollLocked: () => getActiveImportPath() !== null,
                          emptyMessage: () => {
                              if (getImportProgress() !== null) {
                                  const verb = getSessionVerb();
                                  if (verb === "export") return "Exporting — progress above.";
                                  if (verb === "read") return "Reading house contents — progress above.";
                                  return "Importing — progress above.";
                              }
                              return "No live diff to show.";
                          },
                      }),
                  ]
                : [
                      CodeView({
                          scrollId: "right-source-scroll",
                          source: () => getActivePath(),
                          lineDecorator: () => diffDecorator(getActivePath()),
                          autoFollow: false,
                          onOpenPath: (path, options) => {
                              if (options.activate) confirmSelect(path);
                              else pinTab(path);
                          },
                          emptyMessage:
                              "Click an entry on the left to preview, double-click to pin a tab.",
                      }),
                  ],
    });
}

function jumpBackPipRow(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "auto" },
        },
        children: () => {
            if (getActiveImportPath() === null) return [];
            if (!isScrollUserOverridden(LIVE_PREVIEW_SCROLL_ID)) return [];
            return [
                Button({
                    icon: Icons.arrowDown,
                    text: "Jump to current",
                    style: {
                        width: { kind: "grow" },
                        height: { kind: "px", value: 14 },
                        background: COLOR_BUTTON,
                        hoverBackground: COLOR_BUTTON_HOVER,
                    },
                    textColor: COLOR_TEXT,
                    onClick: () => jumpToFocusedLine(LIVE_PREVIEW_SCROLL_ID),
                }),
            ];
        },
    });
}

function extractLiveLines(): readonly RenderableLine[] | null {
    const path = getActivePath();
    if (path === null) return null;
    return previewLinesForFile(path);
}
