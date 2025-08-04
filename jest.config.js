module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
      '^.+\.tsx?$': 'ts-jest',
    },
    moduleNameMapper: {
      '\.(css|less|scss|sass)$': 'identity-obj-proxy',
    },
    testPathIgnorePatterns: [
      '/node_modules/',
      '/out/',
      '/referrer_tracker_extension/',
      'e2e/',
      '\\.spec\\.(ts|js)$'
    ],
    testMatch: [
      '<rootDir>/src/**/*.test.ts',
      '<rootDir>/src/**/*.test.js'
    ]
  };