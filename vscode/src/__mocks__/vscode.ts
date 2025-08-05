export const workspace = {
    textDocuments: [],
    applyEdit: jest.fn(),
    onDidChangeTextDocument: jest.fn(),
    onDidOpenTextDocument: jest.fn(),
    onDidCloseTextDocument: jest.fn(),
};

export const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
};

export class Position {
    constructor(public readonly line: number, public readonly character: number) { }
}

export class Range {
    constructor(public readonly start: Position, public readonly end: Position) { }
}

export class WorkspaceEdit {
    replace = jest.fn();
}

export class Uri {
    static file(path: string): Uri {
        return new Uri(path);
    }

    constructor(public readonly fsPath: string) { }
}

export const EventEmitter = jest.fn().mockImplementation(() => ({
    event: jest.fn(),
    fire: jest.fn(),
    dispose: jest.fn(),
})); 