module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: false,
        tsconfig: "tsconfig.json",
      },
    ],
  },
  extensionsToTreatAsEsm: [],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^node-fetch$": "node-fetch/dist/index.js",
  },
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  globals: {
    "ts-jest": {
      useESM: false,
    },
  },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
};
