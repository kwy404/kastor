import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 is a native module: load it from node_modules at run time.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
