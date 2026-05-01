import type { Tag } from "../types";
import { Printer, type PrintSnbtOptions } from "./printer";

export type { PrintSnbtOptions } from "./printer";

/**
 * Serialize a Tag back into SNBT text.
 *
 * Defaults to compact (single-line) output for round-tripping with
 * Minecraft's `JsonToNBT`. Pass `{ pretty: true }` for human-readable
 * output with newlines and indentation. Pretty output is still valid
 * SNBT and parses back to an equal Tag.
 */
export function printSnbt(tag: Tag, options?: PrintSnbtOptions): string {
    return new Printer(options).print(tag);
}
