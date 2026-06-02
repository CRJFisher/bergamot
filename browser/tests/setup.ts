import { jest } from "@jest/globals";
import { TextEncoder, TextDecoder } from "util";

// Add TextEncoder/TextDecoder to global scope for jsdom
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

// Mock chrome API
global.chrome = {
  tabs: {
    onCreated: {
      addListener: jest.fn(),
    },
    onUpdated: {
      addListener: jest.fn(),
    },
    onRemoved: {
      addListener: jest.fn(),
    },
    onActivated: {
      addListener: jest.fn(),
    },
    get: jest.fn(),
    query: jest.fn(),
    sendMessage: jest.fn(),
  },
  webNavigation: {
    onCommitted: { addListener: jest.fn() },
    onHistoryStateUpdated: { addListener: jest.fn() },
    onCreatedNavigationTarget: { addListener: jest.fn() },
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
    session: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
  runtime: {
    onMessage: {
      addListener: jest.fn(),
    },
    onInstalled: {
      addListener: jest.fn(),
    },
  },
} as any;
