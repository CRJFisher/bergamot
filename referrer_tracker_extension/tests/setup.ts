import { jest } from "@jest/globals";
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
  },
  storage: {
    local: {
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
