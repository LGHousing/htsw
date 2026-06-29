import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Span } from "../../span";

export function checkDuplicateDefinitions(gcx: GlobalCtxt) {
    const functions = gcx.importables.filter(it => it.type === "FUNCTION");
    deduplicateBy(gcx, functions, "name", {
        specifier: "function name",
    });

    const regions = gcx.importables.filter(it => it.type === "REGION");
    deduplicateBy(gcx, regions, "name", {
        specifier: "region name",
    });

    // TODO: Menus do not have any identifiable qualities
    // This might be a problem, actually. Maybe we can enforce
    // our own version of something, not sure

    const items = gcx.importables.filter(it => it.type === "ITEM");
    deduplicateBy(gcx, items, "name", {
        specifier: "item name"
    });

    const events = gcx.importables.filter(it => it.type === "EVENT");
    deduplicateBy(gcx, events, "event", {
        specifier: "event"
    });

    const teams = gcx.importables.filter(it => it.type === "TEAM");
    deduplicateBy(gcx, teams, "name", {
        specifier: "team name"
    });

    const groups = gcx.importables.filter(it => it.type === "GROUP");
    deduplicateBy(gcx, groups, "name", {
        specifier: "group name"
    });

    const commands = gcx.importables.filter(it => it.type === "COMMAND");
    deduplicateBy(gcx, commands, "name", {
        specifier: "command name"
    });

    const npcs = gcx.importables.filter(it => it.type === "NPC");
    deduplicateByKey(gcx, npcs, (npc) => `${npc.pos.x},${npc.pos.y},${npc.pos.z}`, "pos", {
        specifier: "NPC position"
    });
}

type Terms = {
    specifier: string;
};

function deduplicateBy<T extends object, K extends keyof T>(
    gcx: GlobalCtxt, list: T[], by: K, terms: Terms
) {
    const seen: Map<T[K], Span> = new Map();
    
    for (const el of list) {
        const id = el[by];
        
        if (seen.has(id)) {
            // We are on a duplicate entry.
            const span = gcx.spans.getField(el, by);
            const otherSpan = seen.get(id)!;
            
            gcx.addDiagnostic(
                Diagnostic.error(`Duplicate ${terms.specifier} '${id}'`)
                    .addPrimarySpan(span, `\`${id}\` redefined here`)
                    .addSecondarySpan(otherSpan, `Previous definition of \`${id}\` here`)
            );
        } else {
            seen.set(id, gcx.spans.getField(el, by));
        }
    }
}

function deduplicateByKey<T extends object, K extends keyof T>(
    gcx: GlobalCtxt, list: T[], key: (value: T) => string, spanField: K, terms: Terms
) {
    const seen: Map<string, Span> = new Map();

    for (const el of list) {
        const id = key(el);

        if (seen.has(id)) {
            const span = gcx.spans.getField(el, spanField);
            const otherSpan = seen.get(id)!;

            gcx.addDiagnostic(
                Diagnostic.error(`Duplicate ${terms.specifier} '${id}'`)
                    .addPrimarySpan(span, `\`${id}\` redefined here`)
                    .addSecondarySpan(otherSpan, `Previous definition of \`${id}\` here`)
            );
        } else {
            seen.set(id, gcx.spans.getField(el, spanField));
        }
    }
}
