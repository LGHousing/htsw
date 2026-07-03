// The importable→path helpers moved into the language package (they're pure
// parse-output utilities also needed by the VS Code extension); this module
// stays as the GUI's import point so call sites don't churn.
export {
    SUB_LIST_KINDS,
    type SubListKind,
    allReferencedPaths,
    hasSubList,
    importableDeclaringPath,
    importableFilePaths,
    importableSourcePath,
    importableSubListPath,
    subListOf,
} from "htsw";
