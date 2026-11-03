import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { outDir: 'dist/umpire-2b', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  // 乱数を大量に回すテストは 1 件で数十秒かかる（vitest 5 からは 5 秒を超えると失敗になる）
  test: { testTimeout: 60_000 },
});
