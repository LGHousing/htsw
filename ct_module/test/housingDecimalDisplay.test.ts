import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
    scalarFieldCompareKey,
    setHousingDecimalQuantizer,
} from "../src/housingSync/actions/comparison";

const MEASURED: Array<[number, string]> = [
    [0, "0"], [7, "7"], [-3, "-3"], [1000000, "1,000,000"],
    [0.0625, "0.062"], [0.1875, "0.188"], [0.3125, "0.312"],
    [0.4375, "0.438"], [0.5625, "0.562"], [0.6875, "0.688"],
    [0.8125, "0.812"], [0.9375, "0.938"], [1.0625, "1.062"],
    [2.1875, "2.188"], [5.4375, "5.438"], [-0.0625, "-0.062"],
    [-0.1875, "-0.188"], [123456.0625, "123,456.062"],
    [0.0005, "0.0"], [0.0015, "0.002"], [0.0025, "0.003"],
    [0.0035, "0.004"], [0.0045, "0.004"], [0.0055, "0.005"],
    [0.0065, "0.006"], [0.0075, "0.007"], [0.0085, "0.009"],
    [0.0095, "0.009"], [0.1235, "0.123"], [0.5115, "0.511"],
    [1.2345, "1.234"], [2.3455, "2.345"], [12.3455, "12.345"],
    [-0.0025, "-0.003"], [-0.0035, "-0.004"], [-1.2345, "-1.234"],
    [0.0001, "0.0"], [0.0004, "0.0"], [0.0009, "0.001"],
    [-0.0001, "-0.0"], [0.00049999, "0.0"], [0.9995, "1.0"],
    [1.9995, "2.0"], [2.9995, "2.999"], [0.99949, "0.999"],
    [0.99951, "1.0"], [999.9995, "1,000.0"], [1234.56789, "1,234.568"],
    [99999.99949, "99,999.999"], [12345.6785, "12,345.678"],
    [1000000.0625, "1,000,000.062"], [0.123456, "0.123"],
    [3.14159265, "3.142"], [2.71828182, "2.718"], [0.3333333, "0.333"],
    [0.6666666, "0.667"], [9.87654321, "9.877"], [0.1, "0.1"],
    [0.30000000000000004, "0.3"], [0.049999999999999996, "0.05"],
    [12345678.9995, "12,345,679.0"], [1.0005, "1.0"],
    [2.0005, "2.001"], [3.0005, "3.001"], [4.0005, "4.0"],
    [8.0005, "8.001"], [16.0005, "16.0"], [0.5005, "0.5"],
    [0.2505, "0.251"], [0.1255, "0.126"], [0.0635, "0.064"],
    [0.0645, "0.065"],
];

let classesDir = "";
let restoreQuantizer: ((value: number) => number) | undefined;

beforeAll(() => {
    classesDir = mkdtempSync(resolve(tmpdir(), "htsw-decimal-"));
    execFileSync("javac", [
        "--release", "8", "-d", classesDir,
        resolve("java/HousingDecimalFormatter.java"),
    ]);

    const values = Array.from(new Set(MEASURED.flatMap(([input, display]) => [
        String(input), display.replace(/,/g, ""),
    ])));
    const output = execFileSync(
        "java",
        ["-cp", classesDir, "HousingDecimalFormatter", ...values],
        { encoding: "utf8" }
    ).trim().split(/\r?\n/);
    const quantized = new Map<string, number>();
    for (let i = 0; i < values.length; i++) {
        quantized.set(String(Number(values[i])), Number(output[i].replace(/,/g, "")));
    }
    restoreQuantizer = setHousingDecimalQuantizer(
        (value) => quantized.get(String(value)) ?? value
    );
});

afterAll(() => {
    if (restoreQuantizer) setHousingDecimalQuantizer(restoreQuantizer);
    if (classesDir) rmSync(classesDir, { recursive: true, force: true });
});

describe("Housing decimal display parity", () => {
    test("Java DecimalFormat matches every measured GUI value", () => {
        const inputs = MEASURED.map(([input]) => String(input));
        const actual = execFileSync(
            "java",
            ["-cp", classesDir, "HousingDecimalFormatter", ...inputs],
            { encoding: "utf8" }
        ).trim().split(/\r?\n/);
        expect(actual).toEqual(MEASURED.map(([, display]) => display));
    });

    test("comparison treats each authored value as its displayed form", () => {
        for (const [input, display] of MEASURED) {
            expect(scalarFieldCompareKey("COMPARE_VAR", "amount", String(input)))
                .toEqual(scalarFieldCompareKey("COMPARE_VAR", "amount", display));
        }
    });
});
