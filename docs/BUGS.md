# Known bugs and gotchas

Project-wide gotchas live here. Language-level HTSL gotchas live in `docs/05-gotchas/` and `gotchas.md`. CT-specific GUI quirks live in `.claude/skills/gui-development/SKILL.md` ("CT/Rhino quirks").

## CT 2.2.1 Rhino fork: `decorator` is a contextual reserved word

**Symptom.** `/ct reload` hangs at 94%, then chat shows `Error loading module HTSW` followed by a bare `java.lang.NullPointerException`. Full stack only appears on the first occurrence in a JVM run — subsequent reloads show only the bare NPE because of the JVM "fast throw" stack-omission optimization. To get a fresh stack, restart Minecraft.

**Cause.** The ChatTriggers fork of Rhino (`org.mozilla:rhino:1.8.6` from [ChatTriggers/rhino](https://github.com/ChatTriggers/rhino), bundled inside `ctjs-2.2.1-1.8.9.jar`) treats the identifier `decorator` as a contextual keyword in its grammar extension for the decorators proposal. Using it as a bare identifier in Identifier-position (parameter declaration, `const decorator = ...`, `var decorator`, etc.) confuses the parser — `primaryExpr()` returns null on a nearby identifier, and the fork then NPEs at `Parser.memberExpr:3292` because of an unconditional `pn.setLineno(lineno)` call on the null `pn`. Upstream Mozilla Rhino removed that call years ago; the fork has not pulled it in.

**Safe positions** (parser doesn't treat as Identifier):

- Property names in object literals: `{ decorator: x }`
- Member access: `obj.decorator`, `props.decorator`
- String contents and comments

**Unsafe positions** (parser sees it as Identifier and may NPE):

- Function parameter names: `function f(decorator) {}`
- Local variable bindings: `const decorator = ...`, `var decorator`, `let decorator`
- Top-level variable bindings
- Probably destructuring patterns (untested)

**Workaround.** Don't name any binding the bare word `decorator`. Use `lineDecorator`, `dec`, `viewDec`, etc. instead.

**⚠️ Babel name-inference trap.** Don't even name an *object literal property* `decorator` if its value is an inline arrow function. Babel-preset-env infers function names from the surrounding property key, so `decorator: () => ...` transpiles to `function decorator() {...}` in the bundle — same trap. Either name the prop something else (we use `lineDecorator` on `CodeViewProps`), or pass the function as a named identifier reference like `decorator: someHoistedFn` so name-inference doesn't apply.

**Related fix in this repo.** `ct_module/src/gui/code-view/CodeView.ts` originally had `const decorator = extract(props.decorator);` and `function applyAutoFollow(scrollId, decorator, lineIdToIndex)` — both renamed to `lineDecorator`. The public prop on `CodeViewProps` was also renamed from `decorator` to `lineDecorator` because babel name-inference reintroduced the bug when an inline arrow was passed as the prop value.
