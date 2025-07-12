import { describe, expect, it } from 'vitest';
import { readCases } from './helpers';

import * as htsl from '../src';

describe('Generate', () => {
    for (const test of readCases(__dirname + '/cases/actions/')) {
        it('generate ' + test.name, () => {
            const actions = htsl.actions(test.source);

            const generatedSource = htsl.codegen.generate(actions);
            const newActions = htsl.actions(generatedSource);

            // uncomment to see where it went wrong:
            console.log(test.source);
            console.log('---');
            console.log(generatedSource);

            expect(newActions).toEqual(actions);
        });
    }
});
