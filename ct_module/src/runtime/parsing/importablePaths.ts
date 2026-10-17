// The importable→path helpers moved into the language package (they're pure
// parse-output utilities also needed by the VS Code extension); this module
// stays as the GUI's import point so call sites don't churn.
export {
    IMPORTABLE_CHILD_LIST_NAMES,
    type ImportableChildListName,
    allReferencedPaths,
    hasChildList,
    importableDeclaringPath,
    importableFilePaths,
    importableSourcePath,
    importableChildListPath,
} from "htsw";
