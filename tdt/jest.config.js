module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json'
    }],
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/out/',
    '\\.spec\\.(ts|js)$'
  ],
  modulePathIgnorePatterns: ['<rootDir>/out/'],
  testMatch: [
    '<rootDir>/src/**/*.test.ts'
  ]
};
