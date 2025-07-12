import * as esbuild from 'esbuild';
import fs from 'fs';
import * as ts from 'typescript';

const BIG_INT_POLYFILL = `import BigInt from 'big-integer';`;
const STRUCTURED_CLONE_POLYFILL = `function structuredClone(value) { return JSON.parse(JSON.stringify(value)); }`;

export const TransformerPlugin = {
    name: 'transformer-plugin',
    setup(build: esbuild.PluginBuild) {
        build.onLoad({ filter: /\.(ts|js)$/ }, async (args) => {
            const contents = await fs.promises.readFile(args.path, 'utf8');
            const sourceFile = ts.createSourceFile(
                args.path,
                contents,
                ts.ScriptTarget.Latest,
                true,
                args.path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
            );

            let foundBigInt = false;
            let foundStructuredClone = false;

            const result = ts.transform(sourceFile, [
                (ctx: ts.TransformationContext) => {
                    return (sourceFile: ts.SourceFile) => {
                        function visitor(node: ts.Node): ts.Node {
                            if (ts.isBigIntLiteral(node)) {
                                // 123n -> BigInt("123")
                                const value = node.text.slice(0, -1);
                                const newCall = ts.factory.createCallExpression(
                                    ts.factory.createIdentifier('BigInt'),
                                    undefined,
                                    [ts.factory.createStringLiteral(value)]
                                );
                                foundBigInt = true;
                                return newCall;
                            }
                            if (
                                ts.isCallExpression(node) &&
                                ts.isIdentifier(node.expression) &&
                                node.expression.text === 'BigInt'
                            ) {
                                foundBigInt = true;
                            }
                            if (
                                ts.isCallExpression(node) &&
                                ts.isIdentifier(node.expression) &&
                                node.expression.text === 'structuredClone'
                            ) {
                                foundStructuredClone = true;
                            }
                            return ts.visitEachChild(node, visitor, ctx);
                        }
                        return ts.visitEachChild(sourceFile, visitor, ctx);
                    };
                },
            ]);

            let transformedCode = ts.createPrinter().printFile(result.transformed[0]);
            if (foundBigInt) {
                transformedCode = `${BIG_INT_POLYFILL}\n${transformedCode}`;
            }
            if (foundStructuredClone) {
                transformedCode = `${STRUCTURED_CLONE_POLYFILL}\n${transformedCode}`;
            }

            return {
                contents: transformedCode,
                loader: 'ts',
            };
        });
    },
};
