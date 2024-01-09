export default {
  "**/*.{js,ts}": "eslint",
  "**/*.{js,ts,css,md}": "prettier --write",
  "src/**/*.ts": "tsc-files --noEmit",
  "examples/cdk-project/**/*.ts":
    "tsc-files --noEmit -project examples/cdk-project",
};
