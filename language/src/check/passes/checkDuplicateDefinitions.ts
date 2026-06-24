import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Span } from "../../span";

export function checkDuplicateDefinitions(gcx: GlobalCtxt) {
    const functions = gcx.importables.filter(it => it.type === "FUNCTION");
    deduplicateBy(gcx, functions, "name", {
        specifier: "name",
    });

    const regions = gcx.importables.filter(it => it.type === "REGION");
    deduplicateBy(gcx, regions, "name", {
        specifier: "name",
    });

    // TODO: Menus do not have any identifiable qualities
    // This might be a problem, actually. Maybe we can enforce
    // our own version of something, not sure

    const items = gcx.importables.filter(it => it.type === "ITEM");
    deduplicateBy(gcx, items, "name", {
        specifier: "name"
    });

    const events = gcx.importables.filter(it => it.type === "EVENT");
    deduplicateBy(gcx, events, "event", {
        specifier: "event"
    });

    const teams = gcx.importables.filter(it => it.type === "TEAM");
    deduplicateBy(gcx, teams, "name", {
        specifier: "name"
    });

    const groups = gcx.importables.filter(it => it.type === "GROUP");
    deduplicateBy(gcx, groups, "name", {
        specifier: "name"
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
                Diagnostic.error(`The ${terms.specifier} \`${id}\` is defined multiple times`)
                    .addPrimarySpan(span, `\`${id}\` redefined here`)
                    .addSecondarySpan(otherSpan, `Previous definition of \`${id}\` here`)
            );
        } else {
            seen.set(id, gcx.spans.getField(el, by));
        }
    }
}