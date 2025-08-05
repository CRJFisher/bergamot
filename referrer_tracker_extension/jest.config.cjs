module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  testMatch: [
    '**/tests/**/*.test.ts'
  ],
  setupFiles: [
    './tests/setup.ts'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  testEnvironmentOptions: {
    url: 'http://localhost'
  }
};