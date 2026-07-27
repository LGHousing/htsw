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
});
