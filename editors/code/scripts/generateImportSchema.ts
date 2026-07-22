import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    IMPORT_JSON_SCHEMA,
    IMPORT_JSON_SCHEMA_DEFINITIONS,
    type SchemaSpec,
} from "../../../language/src/importjson/schemaSpec.ts";

type JsonSchema = Record<string, unknown>;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, "../schemas/import.schema.json");
const checkOnly = process.argv.includes("--check");
const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "HTSL import.json",
    ...toJsonSchema(IMPORT_JSON_SCHEMA),
    definitions: Object.fromEntries(
        Object.entries(IMPORT_JSON_SCHEMA_DEFINITIONS).map(([name, spec]) => [
            name,
            toJsonSchema(spec),
        ])
    ),
};
const output = `${JSON.stringify(schema, null, 2)}\n`;

if (checkOnly) {
    if (readFileSync(outputPath, "utf8") !== output) {
        throw new Error(
            "import.schema.json is stale; run npm run generate:schema from editors/code"
        );
    }
} else {
    writeFileSync(outputPath, output);
}

function toJsonSchema(spec: SchemaSpec): JsonSchema {
    switch (spec.kind) {
        case "string": {
            const schema: JsonSchema = { type: "string" };
            copyDescription(schema, spec);
            if (spec.pattern !== undefined) schema.pattern = spec.pattern;
            if (spec.enum !== undefined) schema.enum = spec.enum;
            return schema;
        }
        case "number": {
            const schema: JsonSchema = {
                type: spec.integer === true ? "integer" : "number",
            };
            copyDescription(schema, spec);
            if (spec.minimum !== undefined) schema.minimum = spec.minimum;
            if (spec.maximum !== undefined) schema.maximum = spec.maximum;
            return schema;
        }
        case "boolean": {
            const schema: JsonSchema = { type: "boolean" };
            copyDescription(schema, spec);
            return schema;
        }
        case "array": {
            const schema: JsonSchema = {
                type: "array",
                items: toJsonSchema(spec.items),
            };
            copyDescription(schema, spec);
            return schema;
        }
        case "object": {
            const properties: Record<string, JsonSchema> = {};
            const required: string[] = [];
            for (const [key, property] of Object.entries(spec.properties)) {
                properties[key] = toJsonSchema(property);
                if (property.required) required.push(key);
            }
            const schema: JsonSchema = {
                type: "object",
                additionalProperties: false,
                properties,
            };
            if (required.length > 0) schema.required = required;
            copyDescription(schema, spec);
            return schema;
        }
        case "ref": {
            const schema: JsonSchema = { $ref: `#/definitions/${spec.ref}` };
            copyDescription(schema, spec);
            return schema;
        }
    }
}

function copyDescription(
    schema: JsonSchema,
    spec: { description?: string }
): void {
    if (spec.description !== undefined) schema.description = spec.description;
}
