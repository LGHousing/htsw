import { describe } from "vitest";
import { Lexer, Parser } from "../src/htsl/parse";

describe("Main", () => {
    const lexer = new Lexer(`
var x = 5
lobby Main_Lobby
tp Custom_Coordinates "1 1 1"
        `);

    const parser = new Parser(lexer);

    const result = parser.parseCompletely();

    console.log(JSON.stringify(result));
});
