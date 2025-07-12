import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import { TransformerPlugin } from './transformerPlugin';

esbuild
    .build({
        entryPoints: ['./src/index.ts'],
        bundle: true,
        outfile: './dist/esbuild-bundle.js',
        platform: 'node',
        target: 'es2015',
        format: 'cjs',
        plugins: [TransformerPlugin],
        minify: true,
    })
    .then(() => {
        execSync(
            'npx babel ./dist/esbuild-bundle.js --out-file ./dist/index.js --presets=@babel/preset-env',
            {
                stdio: 'inherit',
            }
        );
        fs.unlinkSync('./dist/esbuild-bundle.js');

        console.log('Build completed successfully');
    })
    .catch((error) => {
        console.error(`Build failed: ${error}`);
        process.exit(1);
    });
