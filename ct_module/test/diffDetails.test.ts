import { describe, expect, it } from "vitest";
import * as htsw from "htsw";

import {
    formatDiffDetailsFile,
    renderActionsForDiff,
} from "../src/slashCommands/diffDetails";
import { message } from "./utils";

describe("diff details", () => {
    it("reuses the exporter HTSL serializer", () => {
        const actions = [message("source")];

        expect(renderActionsForDiff(actions)).toBe(
            htsw.htsl.printActionsWithDiagnostics(actions).source
        );
    });

    it("assembles a canonical action-list diff report", () => {
        const sourceText = renderActionsForDiff([message("source")]);
        const liveText = renderActionsForDiff([message("live")]);

        expect(
            formatDiffDetailsFile(
                {
                    clean: 2,
                    conflicts: [
                        {
                            type: "FUNCTION",
                            identity: "Debug",
                            basePath: "actions",
                            sourceText,
                            liveText,
                        },
                    ],
                    unknown: 1,
                },
                "/project/import.json",
                "2026-07-27T12:00:00.000Z"
            )
        ).toBe(
            "# HTSW diff details\n" +
                "# timestamp: 2026-07-27T12:00:00.000Z\n" +
                "# manifest: /project/import.json\n" +
                "# clean: 2\n" +
                "# conflicts: 1\n" +
                "# unknown: 1\n" +
                "\n" +
                '# FUNCTION "Debug" · actions\n' +
                "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -1 +1 @@\n" +
                '-chat "source"\n' +
                '+chat "live"\n'
        );
    });
});
