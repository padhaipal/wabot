/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'jest',
  ignoreStatic: true,
  mutate: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  thresholds: {
    high: 80,
    low: 80,
    break: 80,
  },
};

export default config;
