import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const docsDirectory = path.resolve("docs");
const rawDirectory = path.resolve("book", "raw");

function findMarkdownFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entryPath !== path.join(docsDirectory, "theme")) {
        files.push(...findMarkdownFiles(entryPath));
      }
    } else if (entry.isFile() && path.extname(entry.name) === ".md") {
      files.push(entryPath);
    }
  }

  return files;
}

rmSync(rawDirectory, { recursive: true, force: true });
mkdirSync(rawDirectory, { recursive: true });

const files = findMarkdownFiles(docsDirectory)
  .map((sourcePath) => {
    const relativePath = path.relative(docsDirectory, sourcePath);
    const manifestPath = relativePath.split(path.sep).join("/");
    const destinationPath = path.join(rawDirectory, relativePath);
    const contents = readFileSync(sourcePath);

    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);

    return {
      path: manifestPath,
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: statSync(sourcePath).size,
    };
  })
  .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

writeFileSync(
  path.join(rawDirectory, "manifest.json"),
  `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
);

console.log(`Emitted ${files.length} raw Markdown files.`);
