import { defineConfig } from 'vitest/config';

// Integration suites talk to the databases from docker-compose.yml. Each suite
// skips itself when its KASTOR_*_URL variable is missing. Files run one after
// another because several of them share table names inside one database.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 180000,
  },
});
