import type { ActionHolder } from 'housing-common/src/types';
import * as htsl from 'htsl/src/index';

const src = `goto function "Foo"\ntitle "Title" "Subtitle" 1 5 1`;

// const diagnostics: htsl.Diagnostic[] = htsl.diagnostics(src);
const holders: ActionHolder[] = htsl.actions(src);

for (const holder of holders) {
    console.log(`type: ${holder.type}`);
    for (const action of holder.actions) {
        console.log(`  action type: ${action.type}`);
        for (const [key, value] of Object.entries(action)) {
            if (key !== 'type') {
                console.log(`    ${key}: ${value}`);
            }
        }
    }
}

console.log('Complete result:', JSON.stringify(holders, null, 2));
