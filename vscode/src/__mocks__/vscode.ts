interface MockTextDocument {
    uri: Uri;
    fileName: string;
    languageId: string;
    version: number;
    isDirty: boolean;
    isClosed: boolean;
    getText(): string;
}

export const workspace = {
    textDocuments: [] as MockTextDocument[],
    workspaceFolders: undefined as { uri: Uri }[] | undefined,
    applyEdit: jest.fn(),
    onDidChangeTextDocument: jest.fn(),
    onDidOpenTextDocument: jest.fn(),
    onDidCloseTextDocument: jest.fn(),
    // Returns configured defaults: `get(key, default)` yields `default`.
    getConfiguration: jest.fn(() => ({
        get: <T>(_key: string, default_value?: T): T | undefined => default_value,
    })),
};

export const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        clear: jest.fn(),
    })),
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

export class MarkdownString {
    value = "";
    supportHtml = false;
    isTrusted = false;

    appendMarkdown(text: string): MarkdownString {
        this.value += text;
        return this;
    }
}

export class Hover {
    constructor(public readonly contents: MarkdownString) { }
}

export const languages = {
    registerHoverProvider: jest.fn(() => ({ dispose: jest.fn() })),
};

export const EventEmitter = jest.fn().mockImplementation(() => ({
    event: jest.fn(),
    fire: jest.fn(),
    dispose: jest.fn(),
})); 