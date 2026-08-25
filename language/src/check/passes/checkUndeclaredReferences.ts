import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Span } from "../../span";
import type { Action, Condition, Importable } from "../../types";
import { visitActionTrees } from "../actionTree";

/**
 * Under `dangerouslyDeleteEverythingNotInThisFile`, every house importable an
 * action points at has to be declared by the manifest. Otherwise a prune deletes
 * the target and leaves the action pointing at nothing — and for functions,
 * menus and regions the import would create an empty shell for the missing name
 * and prune it right back on every run, tripping the watch-mode loop guard.
 *
 * Checked at parse time so the editor underlines it before the import gets there.
 */
export function checkUndeclaredReferences(
    gcx: GlobalCtxt,
    checkableImportables: Importable[] = gcx.importables
): void {
    const declared = collectDeclaredNames(gcx.importables);

    visitActionTrees(checkableImportables, {
        action: (action) => checkAction(gcx, declared, action),
        conditions: (conditions) => checkConditions(gcx, declared, conditions),
    });
}

/** The importable kinds an action can name, and that a prune can delete. */
type ReferenceKind = "function" | "menu" | "region" | "team" | "group";

type DeclaredNames = Record<ReferenceKind, ReadonlySet<string>>;

const DECLARING_FIELD: Record<ReferenceKind, string> = {
    function: "functions[].name",
    menu: "menus[].name",
    region: "regions[].name",
    team: "teams[].name",
    group: "groups[].name",
};

function collectDeclaredNames(importables: readonly Importable[]): DeclaredNames {
    const functions = new Set<string>();
    const menus = new Set<string>();
    const regions = new Set<string>();
    const teams = new Set<string>();
    const groups = new Set<string>();

    for (const importable of importables) {
        switch (importable.type) {
            case "FUNCTION":
                functions.add(normalizeName(importable.name));
                break;
            case "MENU":
                menus.add(normalizeName(importable.name));
                break;
            case "REGION":
                regions.add(normalizeName(importable.name));
                break;
            case "TEAM":
                teams.add(normalizeName(importable.name));
                break;
            case "GROUP":
                groups.add(normalizeName(importable.name));
                break;
            default:
                break;
        }
    }

    return { function: functions, menu: menus, region: regions, team: teams, group: groups };
}

// Housing matches these names case-insensitively, so a raw comparison would
// report references the import resolves fine.
function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

function checkAction(
    gcx: GlobalCtxt,
    declared: DeclaredNames,
    action: Action
): void {
    if (action.type === "FUNCTION") {
        checkReference(gcx, declared, "function", action, "function", action.function);
    } else if (action.type === "SET_MENU") {
        checkReference(gcx, declared, "menu", action, "menu", action.menu);
    } else if (action.type === "SET_TEAM") {
        checkReference(gcx, declared, "team", action, "team", action.team);
    } else if (action.type === "SET_GROUP") {
        checkReference(gcx, declared, "group", action, "group", action.group);
    }
}

function checkConditions(
    gcx: GlobalCtxt,
    declared: DeclaredNames,
    conditions: readonly Condition[]
): void {
    for (const condition of conditions) {
        if (condition.type === "IS_IN_REGION" && condition.region !== undefined) {
            checkReference(
                gcx,
                declared,
                "region",
                condition,
                "region",
                condition.region
            );
        }
    }
}

/**
 * Names that resolve to something other than a declarable importable. "Set
 * Player Team" documents `None` as a way to clear the player's team.
 */
const BUILT_IN_NAMES: Partial<Record<ReferenceKind, ReadonlySet<string>>> = {
    team: new Set(["none"]),
};

function checkReference(
    gcx: GlobalCtxt,
    declared: DeclaredNames,
    kind: ReferenceKind,
    node: Action | Condition,
    field: string,
    name: string
): void {
    // An empty name is its own error elsewhere.
    if (name.trim() === "") return;
    if (BUILT_IN_NAMES[kind]?.has(normalizeName(name)) === true) return;
    if (declared[kind].has(normalizeName(name))) return;

    gcx.addDiagnostic(
        Diagnostic.error(`Undeclared ${kind} '${name}'`)
            .addPrimarySpan(
                referenceSpan(gcx, node, field),
                `No ${kind} named '${name}' is declared`
            )
            .addSubDiagnostic(
                Diagnostic.note(
                    "`dangerouslyDeleteEverythingNotInThisFile` is set on this project"
                )
            )
            .addSubDiagnostic(
                Diagnostic.help(
                    `Declare it in \`${DECLARING_FIELD[kind]}\`, or drop the key`
                )
            )
    );
}

// Prefer the span of the field naming the target. Actions from a path that did
// not record one fall back to the action itself rather than throwing.
function referenceSpan(
    gcx: GlobalCtxt,
    node: Action | Condition,
    field: string
): Span {
    const typed = node as unknown as Record<string, unknown>;
    return (
        gcx.spans.tryGetField(typed, field) ??
        gcx.spans.getField(node as { type: string }, "type")
    );
}
