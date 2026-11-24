import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTs } from './support/loader.mjs';

const strategy = await loadTs('src/services/conflict-strategy.ts');

/** 创建临时包目录并写入文件 */
const createPackage = (files) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'nlm-strategy-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

const baseConfig = {
  strategy: 'install',
  skipPeerDependencies: true,
  skipBuildOnlyDependencies: true,
  skip: [],
  host: [],
  install: [],
};

test('matchesPackagePattern：精确与通配', () => {
  const { matchesPackagePattern: match } = strategy;
  assert.equal(match('umi', 'umi'), true);
  assert.equal(match('umi', 'umix'), false);
  assert.equal(match('@umijs/plugin-a', '@umijs/*'), true);
  assert.equal(match('@umijs/plugin-a', '@umijs/plugin-*'), true);
  assert.equal(match('lodash', '@umijs/*'), false);
  assert.equal(match('lodash', ''), false);
});

test('collectRuntimeSpecifiers：exports 子路径键入口可被收集', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'exports-only',
      version: '1.0.0',
      exports: {
        '.': { import: './dist/index.mjs', require: './dist/index.cjs' },
        './util': './dist/util.cjs',
      },
    }),
    'dist/index.mjs':
      "import { a } from './a.mjs';\nimport umi from 'umi';\nexport * from './b.mjs';\nexport default a;\n",
    'dist/a.mjs': "export const a = require('lodash');\n",
    'dist/b.mjs': "export * from 'ahooks';\n",
    'dist/util.cjs': "module.exports = require('qs');\n",
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const specs = strategy.collectRuntimeSpecifiers(root, manifest);
  assert.deepEqual([...specs].sort(), ['ahooks', 'lodash', 'qs', 'umi']);
});

test('collectRuntimeSpecifiers：import type 不计入运行时依赖', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'type-only',
      version: '1.0.0',
      main: './index.js',
    }),
    'index.js':
      "import type { IApi } from 'umi';\nexport const a = require('lodash');\n",
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const specs = strategy.collectRuntimeSpecifiers(root, manifest);
  assert.deepEqual([...specs], ['lodash']);
});

test('collectRuntimeSpecifiers：动态引用判为无法判定（null）', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'dynamic',
      version: '1.0.0',
      main: './index.js',
    }),
    'index.js': 'const name = "umi";module.exports = require(name);\n',
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  assert.equal(strategy.collectRuntimeSpecifiers(root, manifest), null);
});

test('collectRuntimeSpecifiers：入口缺失判为无法判定（null）', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'no-entry',
      version: '1.0.0',
      main: './missing.js',
    }),
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  assert.equal(strategy.collectRuntimeSpecifiers(root, manifest), null);
});

test('decideConflictActions：默认 peer 跳过 / 构建期跳过 / 其余隔离安装', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      main: './index.js',
    }),
    'index.js': "module.exports = require('lodash');\n",
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const decisions = strategy.decideConflictActions({
    conflicts: [
      {
        name: 'react',
        requiredVersion: '^17.0.0',
        installedVersion: '18.2.0',
        source: 'peerDependencies',
      },
      {
        name: 'umi',
        requiredVersion: '^3.0.0',
        installedVersion: '4.0.0',
        source: 'dependencies',
      },
      {
        name: 'lodash',
        requiredVersion: '^4.0.0',
        installedVersion: '3.10.0',
        source: 'dependencies',
      },
    ],
    packageDir: root,
    manifest,
    config: baseConfig,
  });
  assert.deepEqual(decisions.get('react'), {
    action: 'skip',
    reason: 'peer-host',
  });
  assert.deepEqual(decisions.get('umi'), {
    action: 'skip',
    reason: 'build-only',
  });
  assert.deepEqual(decisions.get('lodash'), {
    action: 'install',
    reason: 'default',
  });
});

test('decideConflictActions：配置规则优先级 install > host > skip', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      main: './index.js',
    }),
    'index.js': "module.exports = require('lodash');\n",
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const decisions = strategy.decideConflictActions({
    conflicts: [
      {
        name: 'umi',
        requiredVersion: '^3.0.0',
        installedVersion: '4.0.0',
        source: 'dependencies',
      },
      {
        name: 'react',
        requiredVersion: '^17.0.0',
        installedVersion: '18.2.0',
        source: 'peerDependencies',
      },
      {
        name: 'lodash',
        requiredVersion: '^2.0.0',
        installedVersion: '4.17.21',
        source: 'dependencies',
      },
    ],
    packageDir: root,
    manifest,
    config: {
      ...baseConfig,
      install: ['umi', 'react'],
      host: ['react', 'lodash'],
      skip: ['lodash'],
    },
  });
  assert.deepEqual(decisions.get('umi'), {
    action: 'install',
    reason: 'config-install',
  });
  assert.deepEqual(decisions.get('react'), {
    action: 'install',
    reason: 'config-install',
  });
  assert.deepEqual(decisions.get('lodash'), {
    action: 'host',
    reason: 'config-host',
  });
});

test('decideConflictActions：strategy=skip/host 作为兜底', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      main: './index.js',
    }),
    'index.js': "module.exports = require('lodash');\n",
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const conflicts = [
    {
      name: 'lodash',
      requiredVersion: '^2.0.0',
      installedVersion: '4.17.21',
      source: 'dependencies',
    },
  ];
  const skipConfig = { ...baseConfig, strategy: 'skip' };
  assert.deepEqual(
    strategy
      .decideConflictActions({
        conflicts,
        packageDir: root,
        manifest,
        config: skipConfig,
      })
      .get('lodash'),
    { action: 'skip', reason: 'config-strategy' },
  );
  const hostConfig = { ...baseConfig, strategy: 'host' };
  assert.deepEqual(
    strategy
      .decideConflictActions({
        conflicts,
        packageDir: root,
        manifest,
        config: hostConfig,
      })
      .get('lodash'),
    { action: 'host', reason: 'config-strategy' },
  );
});

test('findMisplacedBuildDependencies：构建期工具误放 dependencies 才提示', () => {
  const manifest = {
    name: 'lib',
    version: '1.0.0',
    dependencies: {
      umi: '^3.5.0',
      '@umijs/plugin-a': '^1.0.0',
      lodash: '^4.0.0',
    },
    devDependencies: { webpack: '^5.0.0' },
  };

  // 运行时引用中只有 lodash → umi / @umijs/* 判定为误放
  const found = strategy.findMisplacedBuildDependencies(
    manifest,
    new Set(['lodash']),
  );
  assert.deepEqual(found.sort(), ['@umijs/plugin-a', 'umi']);

  // umi 在产物中被真实引用 → 不提示
  const referenced = strategy.findMisplacedBuildDependencies(
    manifest,
    new Set(['lodash', 'umi']),
  );
  assert.deepEqual(referenced, ['@umijs/plugin-a']);

  // 扫描结论不可信（null）→ 不提示
  assert.deepEqual(strategy.findMisplacedBuildDependencies(manifest, null), []);
});

test('decideConflictActions：关闭构建期跳过则回落默认安装', () => {
  const root = createPackage({
    'package.json': JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      main: './index.js',
    }),
    'index.js': "module.exports = require('lodash');\n",
  });
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const decisions = strategy.decideConflictActions({
    conflicts: [
      {
        name: 'umi',
        requiredVersion: '^3.0.0',
        installedVersion: '4.0.0',
        source: 'dependencies',
      },
    ],
    packageDir: root,
    manifest,
    config: { ...baseConfig, skipBuildOnlyDependencies: false },
  });
  assert.deepEqual(decisions.get('umi'), {
    action: 'install',
    reason: 'default',
  });
});
