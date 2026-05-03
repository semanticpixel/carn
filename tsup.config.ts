import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/mcp/server.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  sourcemap: true,
});
