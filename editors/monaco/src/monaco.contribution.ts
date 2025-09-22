import * as monaco from "monaco-editor";
import { setupHtsl } from "./htslMode";
import { HTSL_MONARCH_DEFINITION } from "./htslMonarch.ts";

monaco.languages.register({
    id: "htsl",
    extensions: [".htsl"],
    aliases: ["HTSL", "htsl"],
});

monaco.languages.onLanguage("htsl", () => {
    setupHtsl();
});

monaco.languages.setLanguageConfiguration("htsl", {
    autoClosingPairs: [
        { open: "(", notIn: ["string"], close: ")" },
        { open: "[", notIn: ["string"], close: "]" },
        { open: "{", notIn: ["string"], close: "}" },
        { open: '"', notIn: ["string"], close: '"' },
        { open: "/*", notIn: ["string"], close: "*/" },
    ],
    surroundingPairs: [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
    ],
    comments: {
        blockComment: ["/*", "*/"],
        lineComment: "//",
    },
    brackets: [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
    ],
});

monaco.languages.setMonarchTokensProvider("htsl", HTSL_MONARCH_DEFINITION);
