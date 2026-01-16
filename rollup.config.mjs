import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import clear from 'rollup-plugin-clear';
import typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';
// import replace from '@rollup/plugin-replace';
import nodeExternals from 'rollup-plugin-node-externals';
import dts from 'rollup-plugin-dts';

const outputDir = 'lib';

export default defineConfig([
  {
    input: {
      index: './src/index.ts',
      cli: './src/cli.ts',
    },
    output: [
      {
        dir: outputDir,
        format: 'es',
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
      {
        dir: outputDir,
        format: 'cjs',
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].cjs',
        exports: 'named',
      },
    ],
    external: ['../package.json'],
    plugins: [
      nodeExternals(),
      json(),
      nodeResolve({
        extensions: ['.js', '.ts'],
        preferBuiltins: true,
      }),
      clear({
        targets: [outputDir],
      }),
      typescript({
        tsconfig: './tsconfig.src.json',
        declaration: true,
        declarationDir: outputDir,
        outputToFilesystem: true,
        include: ['package.json', 'src/**/*'],
      }),
      commonjs({
        extensions: ['.js'],
      }),
      // replace({
      //   preventAssignment: true,
      //   __env__: JSON.stringify(process.env.ENV),
      // }),
    ],
  },
  {
    input: {
      index: './src/index.ts',
      // cli: "./src/cli.ts",
    },
    output: {
      dir: outputDir,
      format: 'es',
      preserveModules: true,
      preserveModulesRoot: 'src',
      entryFileNames: '[name].d.ts',
    },
    plugins: [dts()],
  },
]);
