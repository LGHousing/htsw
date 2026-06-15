import * as htsw from "../../language/dist/index.js";

/**
 * Parse and run HTSL code, returning captured chat output.
 * @param {string} source - HTSL source code
 * @returns {{ output: string[], diagnostics: string[] }}
 */
export function runHtsl(source) {
  const output = [];
  const diagnostics = [];

  try {
    // In-memory file loader
    const fileLoader = {
      fileExists: (path) => path === "/playground.htsl",
      readFile: () => source,
      getParentPath: () => "",
      resolvePath: () => "/playground.htsl",
    };

    const sm = new htsw.SourceMap(fileLoader);
    const result = htsw.parseActionsResult(sm, "/playground.htsl");

    if (!result.value || result.value.length === 0) {
      return { output: ["(no output)"], diagnostics: [] };
    }

    const vars = new htsw.runtime.simple.SimpleVars();

    const actionBehaviors = new htsw.runtime.simple.SimpleActionBehaviors(vars)
      .with("MESSAGE", (rt, action) => {
        output.push(replacePlaceholders(rt, action.message ?? ""));
      });

    const rt = new htsw.runtime.Runtime({
      spans: result.spans,
      actionBehaviors,
      conditionBehaviors: new htsw.runtime.simple.SimpleConditionBehaviors(
        vars
      ),
      placeholderBehaviors: new htsw.runtime.simple.SimplePlaceholderBehaviors(
        vars
      ),
    });

    rt.runActions(result.value);

    if (output.length === 0) {
      output.push("(no output)");
    }
  } catch (e) {
    diagnostics.push(e.message || String(e));
  }

  return { output, diagnostics };
}

function replacePlaceholders(rt, value) {
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
