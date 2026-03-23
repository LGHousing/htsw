import items from "../../assets/items.json";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Tag, TagCompound } from "../../nbt";
import { getTags } from "../helpers";

export function checkNbt(gcx: GlobalCtxt) {
    const tags = getTags(gcx);

    for (const tag of tags) {
        checkTag(gcx, tag);
    }
}

function checkTag(gcx: GlobalCtxt, tag: Tag) {
    if (tag.type !== "compound") {
        gcx.addDiagnostic(
            Diagnostic.error("Expected NBT tag compound")
                .addPrimarySpan(gcx.spans.get(tag))
        );
        return;
    }

    checkTagId(gcx, tag);
    checkTagCount(gcx, tag);
}

function checkTagId(gcx: GlobalCtxt, tag: TagCompound) {
    const tagId = tag.value["id"];
    if (tagId === undefined) {
        gcx.addDiagnostic(
            Diagnostic.error("Missing required tag 'id'")
                .addPrimarySpan(gcx.spans.get(tag).endSpan())
        );
        return;
    }

    if (tagId.type !== "string") {
        gcx.addDiagnostic(
            Diagnostic.error("Expected string")
                .addPrimarySpan(gcx.spans.get(tagId))
        );
        return;
    }

    const id = tagId.value;

    let idFound = false;
    for (const item of items) {
        if (id === `minecraft:${item.name}`) {
            idFound = true;
        }
    }

    if (!idFound) {
        gcx.addDiagnostic(
            Diagnostic.error("Invalid item id")
                .addPrimarySpan(gcx.spans.get(tagId))
        );
        return;
    }
}

function checkTagCount(gcx: GlobalCtxt, tag: TagCompound) {
    const tagCount = tag.value["Count"];
    if (tagCount === undefined) {
        gcx.addDiagnostic(
            Diagnostic.error("Missing required tag 'Count'")
                .addPrimarySpan(gcx.spans.get(tag).endSpan())
        );
        return;
    }

    if (tagCount.type !== "byte") {
        gcx.addDiagnostic(
            Diagnostic.error("Expected byte")
                .addPrimarySpan(gcx.spans.get(tagCount))
        );
        return;
    }

    const count = tagCount.value;

    if (count < 0) {
        gcx.addDiagnostic(
            Diagnostic.error("Count must be greater than or equal to 0")
                .addPrimarySpan(gcx.spans.get(tagCount))
        );
        return;
    }

    // We are probably fine allowing 64 of anything
    if (count > 64) {
        gcx.addDiagnostic(
            Diagnostic.error("Count must be less than or equal to 64")
                .addPrimarySpan(gcx.spans.get(tagCount))
        );
        return;
    }
}