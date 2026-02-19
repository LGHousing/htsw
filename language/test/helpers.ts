import { readdirSync } from "node:fs";
import { readFileSync } from "fs";

export function readCases(path: string): { name: string; source: string }[] {
    const files = readdirSync(path);

    const entries: {
        name: string;
        source: string;
    }[] = [];

    for (const file of files) {
        if (!file.endsWith(".htsl")) continue;
        const name = file.substring(0, file.length - 5).replaceAll("_", " ");
        const source = readFileSync(path + `/${file}`)
            .toString()
            .replaceAll("\r", "");
        entries.push({ name, source });
    }

    return entries;
}
