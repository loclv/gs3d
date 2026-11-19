import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    three: 'src/three/index.ts',
  },
  outDir: '.',
  format: 'esm',
  fixedExtension: false,
  dts: false,
  clean: false,
  minify: false,
  sourcemap: false,
  deps: {
    neverBundle: ['./gs3d/app.js'],
  },
});
