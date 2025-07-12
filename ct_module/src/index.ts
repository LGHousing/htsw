/// <reference types="../CTAutocomplete" />

import type { ActionHolder } from 'housing-common/src/types';
import * as htsl from 'htsl/src/index';
import { Button } from './gui/button';
import { generateSteps } from './steps/generateSteps';
import { Importer } from './importer/importer';

import { getSlots, ButtonType } from './slots';
import { chatHistory, chatHistoryContains } from './utils';

function onClick() {
    // const src = `
    //     goto event "Player Kill"
    //     title "frick" "frock" 1 2 3
    // `;
    // const importer = Importer.fromSource(src);
    const holders: ActionHolder[] = [
        {
            type: 'EVENT',
            event: 'Player Kill',
            actions: [
                {
                    type: 'TITLE',
                    title: 'frick',
                    subtitle: 'frock',
                    fadein: 1,
                    stay: 2,
                    fadeout: 3,
                },
            ],
        },
    ];
    const importer = Importer.fromActionHolders(holders);
    importer.initialize();
}

const button = new Button(
    100,
    100,
    100,
    20,
    'Click me',
    () => {
        return true;
    },
    onClick
);
button.register();

ChatLib.chat('&3hello fucking world!');
