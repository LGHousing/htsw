import { languages } from "monaco-editor";
import IMonarchLanguage = languages.IMonarchLanguage;
import * as htsl from "htsl/src";

export const HTSL_MONARCH_DEFINITION: IMonarchLanguage = {
    keywords: [
        "goto",
        "loop",
        "if",
        "else",
        "and",
        "or",
        "function",
        "random",
        "exit",
        "define",
        "macro",
        "true",
        "false",
    ],

    typeKeywords: [
        "stat",
        "globalstat",
        "teamstat",
        "var",
        "globalvar",
        "teamvar",
        "placeholder",
    ],

    operators: [
        "=",
        ">",
        "<",
        "!",
        "==",
        "<=",
        ">=",
        "=<",
        "=>",
        "!=",
        "+",
        "-",
        "*",
        "/",
        "//",
        "**",
        "+=",
        "-=",
        "*=",
        "/=",
        "//=",
    ],

    actions: htsl.helpers.ACTION_KWS,
    conditions: htsl.helpers.CONDITION_KWS,
    shorthands: htsl.helpers.SHORTHANDS,

    symbols: /[=><!~?:&|+\-*\/^]+/,

    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
        root: [
            // identifiers and keywords
            [
                /[a-zA-Z_$][\w$]*/,
                {
                    cases: {
                        "@typeKeywords": "type.keyword",
                        "@keywords": "keyword",
                        "@actions": "entity.name.function",
                        "@conditions": "entity.name.function",
                        "@shorthands": "entity.name.function",
                        "@default": "identifier",
                    },
                },
            ],

            // whitespace
            { include: "@whitespace" },

            // delimiters and operators
            [/[{}()\[\]]/, "@brackets"],
            [
                /@symbols/,
                {
                    cases: { "@operators": "operator" },
                },
            ],

            // numbers
            [/\d+(\.\d*)?/, "number"],

            // delimiter: after number because of .\d floats
            [/[;,.]/, "delimiter"],

            // strings
            [/"([^"\\]|\\.)*$/, "string.invalid"],
            [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

            [/%([^%\\]|\\.)*$/, "keyword.invalid"],
            [
                /%/,
                { token: "string.placeholder", bracket: "@open", next: "@placeholder" },
            ],
        ],

        comment: [
            [/[^\/*]+/, "comment"],
            [/\/\*/, "comment", "@push"], // nested comment
            ["\\*/", "comment", "@pop"],
            [/[\/*]/, "comment"],
        ],

        string: [
            [/[^\\"%]+/, "string"],
            [
                /%/,
                { token: "string.placeholder", bracket: "@open", next: "@placeholder" },
            ],
            [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
        ],

        placeholder: [
            [/[^\\%]+/, "string.placeholder"],
            [/%/, { token: "string.placeholder", bracket: "@close", next: "@pop" }],
        ],

        whitespace: [
            [/[ \t\r\n]+/, "white"],
            [/\/\*/, "comment", "@comment"],
            [/\/\/.*$/, "comment"],
        ],
    },
};
