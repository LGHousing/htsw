import * as htsw from "htsw";
import { Importable, ImportableFunction } from "htsw/types";
import { printDiagnostic } from "./diagnostics";

export function run(sm: htsw.SourceMap, result: htsw.ParseResult<Importable[]>) {
    const vars = new htsw.runtime.simple.SimpleVars();

    const actionBehaviors = new htsw.runtime.simple.SimpleActionBehaviors(vars)
        .with("MESSAGE",
            (rt, action) => {
                console.log(replacePlaceholders(rt, action.message));
            }
        )
        .with("FUNCTION",
            (rt, action) => {
                const fn = result.value.find(
                    it => it.type === "FUNCTION" && it.name === action.function
                ) as ImportableFunction | undefined;

                if (!fn) {
                    rt.emitDiagnostic(
                        htsw.Diagnostic.warning(`Unknown function '${action.function}'`)
                            .addPrimarySpan(result.spans.getField(action, "function"))
                    );
                    return;
                }

                rt.runActions(fn.actions);
            }
        );

    const rt = new htsw.runtime.Runtime({
        spans: result.spans,
        actionBehaviors,
        conditionBehaviors: new htsw.runtime.simple.SimpleConditionBehaviors(vars),
        placeholderBehaviors: new htsw.runtime.simple.SimplePlaceholderBehaviors(vars),
        onDiagnostic: (diag) => {
            printDiagnostic(sm, diag)
        }
    });

    const main = result.value.find(
        it => it.type === "FUNCTION" && it.name === "htsw:main"
    ) as ImportableFunction | undefined;

    if (!main) {
        rt.emitDiagnostic(
            htsw.Diagnostic.warning("No function `htsw:main`, nothing to run")
        );
        return;
    }

    rt.runActions(main.actions);
}

function replacePlaceholders(rt: htsw.runtime.Runtime, value: string): string {
    const placeholders = value.match(/%([^%]+?)%/g);
    if (!placeholders) return value;

    for (const placeholder of placeholders) {
        const content = placeholder.substring(1, placeholder.length - 1);
        const resolved = rt.runPlaceholder(content);
        if (!resolved) continue;
        value = value.replace(placeholder, resolved.toString());
    }

    return value;
}
