import { describe, it, expect } from "vitest";
import { Lexer } from "../src/htsl/parse/lexer";
import { readCases } from "./helpers";

describe("Lexer", () => {
    for (const test of readCases(__dirname + "/cases/tokens/")) {
        it(test.name, () => {
            const lexer = new Lexer(test.source, 0);
            const result = [];
            while (lexer.hasNext()) result.push(lexer.advanceToken());

            expect(result).toMatchSnapshot();
        });
    }
});
