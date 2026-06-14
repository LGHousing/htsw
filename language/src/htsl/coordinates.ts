import { GlobalCtxt } from "../context";
import { parseCoordinates0 } from "./parse/arguments";
import { Lexer } from "./parse/lexer";
import { Parser } from "./parse/parser";
import { DummyFileLoader, SourceFile, SourceMap, type FileLoader } from "../sourceMap";
import type { Coordinates } from "../types";

export function parseCoordinates(value: string): Coordinates {
    const sm = new SourceMap(new DummyFileLoader());
    const gcx = new GlobalCtxt(sm, "dummyPath");
    const file = new SourceFile("dummyfile15000", value);
    
    const lexer = new Lexer(file);
    const sp = new Parser(gcx, lexer);

    const error = () => {
        throw Error("Invalid coordinates");
    }

    let coordinates;
    try {
        coordinates = parseCoordinates0(sp);
    } catch {
        error();
    }

    if (gcx.isFailed()) {
        error();
    }

    return coordinates!;
}