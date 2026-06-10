module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
      '^.+\.tsx?$': ['ts-jest', {
        tsconfig: 'tsconfig.test.json'
      }],
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
    // Keep haste-map mock resolution away from compiled/staged copies of
    // src/__mocks__ (out/ from tsc, builds/staging from the production
    // build) — a stale staged mock must never shadow the live one.
    modulePathIgnorePatterns: ['<rootDir>/out/', '<rootDir>/builds/'],
    testMatch: [
      '<rootDir>/src/**/*.test.ts',
      '<rootDir>/src/**/*.test.js'
    ]
  };