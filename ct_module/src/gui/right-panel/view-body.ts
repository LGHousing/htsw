/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { Col } from "../lib/components";
import {
    confirmSelect,
    getActiveFileSelection,
    isLiveTabActive,
    pinTab,
} from "./selection";
import { SourceCodeView } from "../code-view/sourceCodeView";
import { ImportCodeView } from "./importCodeView";

export function viewBody(): Element {
    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" }, gap: 0 },
        children: () =>
            isLiveTabActive()
                ? [ImportCodeView()]
                : [
                      SourceCodeView({
                          source: () => getActiveFileSelection()?.path ?? null,
                          sourceImportJsonPath: () =>
                              getActiveFileSelection()?.importJsonPath ?? null,
                          onOpenPath: (path, options) => {
                              const owner =
                                  getActiveFileSelection()?.importJsonPath ?? null;
                              if (options.activate) confirmSelect(path, owner);
                              else pinTab(path, owner);
                          },
                          emptyMessage:
                              "Click an entry on the left to preview, double-click to pin a tab.",
                      }),
                  ],
    });
}
