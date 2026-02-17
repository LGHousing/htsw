export type StepRunCommand = {
    type: "RUN_COMMAND";
    command: string;
};

export type StepSendMessage = {
    type: "SEND_MESSAGE";
    message: string;
};

export type StepSelectValue = {
    type: "SELECT_VALUE";
    key: string;
    value: string;
};

export type StepClickButton = {
    type: "CLICK_BUTTON";
    key: string;
};

export type StepClickSlot = {
    type: "CLICK_SLOT";
    slot: number;
};

export type StepSelectItem = {
    type: "SELECT_ITEM";
    item: string;
};

export type StepConditional = {
    type: "CONDITIONAL";
    condition: () => boolean;
    then: () => Step[];
    else: () => Step[];
};

export type Step =
    | StepRunCommand
    | StepSendMessage
    | StepSelectValue
    | StepClickButton
    | StepClickSlot
    | StepSelectItem
    | StepConditional;
