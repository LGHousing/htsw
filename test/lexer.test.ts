import { describe, it, expect } from "vitest";
import { Lexer } from "../src/htsl/parse/lexer";
import { SourceFile } from "../src/sourceMap";
import { readCases } from "./helpers";

describe("Lexer", () => {
    for (const test of readCases("test/cases/tokens/")) {
        it(test.name, () => {
            const lexer = new Lexer(new SourceFile("/test.htsl", test.source));
            const result = [];
            while (lexer.hasNext()) result.push(lexer.advanceToken());

            expect(result).toMatchSnapshot();
        });
    }
});
