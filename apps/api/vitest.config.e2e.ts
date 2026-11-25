import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Sobe o AppModule inteiro (Prisma, Keycloak, Redis...): o padrão de 10 s não basta num boot a frio.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
