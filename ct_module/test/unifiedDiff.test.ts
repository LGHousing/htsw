import { describe, expect, it } from "vitest";

import { unifiedDiff } from "../src/slashCommands/unifiedDiff";

describe("unifiedDiff", () => {
    it("formats insertions", () => {
        expect(
            unifiedDiff(
                "one\nthree\n",
                "one\ntwo\nthree\n",
                "source/actions",
                "live/actions"
            )
        ).toBe(
            "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -1,2 +1,3 @@\n" +
                " one\n" +
                "+two\n" +
                " three\n"
        );
    });

    it("formats deletions", () => {
        expect(
            unifiedDiff(
                "one\ntwo\nthree\n",
                "one\nthree\n",
                "source/actions",
                "live/actions"
            )
        ).toBe(
            "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -1,3 +1,2 @@\n" +
                " one\n" +
                "-two\n" +
                " three\n"
        );
    });

    it("formats replacements", () => {
        expect(unifiedDiff("old\n", "new\n", "source/actions", "live/actions")).toBe(
            "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -1 +1 @@\n" +
                "-old\n" +
                "+new\n"
        );
    });

    it("uses three lines of context in each hunk", () => {
        expect(
            unifiedDiff(
                "1\n2\n3\n4\n5\n6\n7\n8\n9\n",
                "1\n2\n3\n4\nfive\n6\n7\n8\n9\n",
                "source/actions",
                "live/actions"
            )
        ).toBe(
            "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -2,7 +2,7 @@\n" +
                " 2\n" +
                " 3\n" +
                " 4\n" +
                "-5\n" +
                "+five\n" +
                " 6\n" +
                " 7\n" +
                " 8\n"
        );
    });

    it("separates distant changes into multiple hunks", () => {
        const source = Array.from({ length: 16 }, (_, i) => String(i + 1));
        const live = source.slice();
        live[1] = "two";
        live[13] = "fourteen";

        const diff = unifiedDiff(
            `${source.join("\n")}\n`,
            `${live.join("\n")}\n`,
            "source/actions",
            "live/actions"
        );

        expect(diff.match(/^@@/gm)).toHaveLength(2);
        expect(diff).toContain("-2\n+two");
        expect(diff).toContain("-14\n+fourteen");
    });

    it("keeps nearby changes in one hunk", () => {
        const source = Array.from({ length: 12 }, (_, i) => String(i + 1));
        const live = source.slice();
        live[1] = "two";
        live[7] = "eight";

        const diff = unifiedDiff(
            `${source.join("\n")}\n`,
            `${live.join("\n")}\n`,
            "source/actions",
            "live/actions"
        );

        expect(diff.match(/^@@/gm)).toHaveLength(1);
    });

    it("omits oversized bodies before allocating the LCS table", () => {
        const source = Array.from({ length: 150 }, (_, i) => `source ${i}`).join(
            "\n"
        );
        const live = Array.from({ length: 150 }, (_, i) => `live ${i}`).join("\n");

        expect(
            unifiedDiff(source, live, "source/actions", "live/actions")
        ).toContain(
            "# HTSW diff body omitted: 150 source lines × 150 live lines exceeds the 20000-cell comparison limit."
        );
    });
});
