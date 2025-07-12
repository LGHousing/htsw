export type StepRunCommand = {
    type: 'RUN_COMMAND';
    command: string;
};

export type StepSendMessage = {
    type: 'SEND_MESSAGE';
    message: string;
};

export type StepSelectValue = {
    type: 'SELECT_VALUE';
    key: string; // snake_case
    keyIsNormalized: boolean;
    value: string; // Enabled %var.player/foo% "hello world" NBT-whatever for items
    valueIsNormalized: boolean;
};

export type StepClickButton = {
    type: 'CLICK_BUTTON';
    key: string;
    keyIsNormalized: boolean;
};

export type StepConditional = {
    type: 'CONDITIONAL';
    condition: () => boolean;
    then: () => Step[];
    else: () => Step[];
};

export type Step =
    | StepRunCommand
    | StepSendMessage
    | StepSelectValue
    | StepClickButton
    | StepConditional;
