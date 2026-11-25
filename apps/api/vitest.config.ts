import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Os testes de DI montam módulos Nest completos; o cold start passa de 5 s (padrão) quando os workers
    // rodam em paralelo (visto: 7,3 s). Folga explícita em vez de teste instável.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
