import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTs } from './support/loader.mjs';

const reuse = await loadTs('src/services/dependency-reuse.ts');

/** 创建临时根目录 */
const createRoot = () => fs.mkdtempSync(join(tmpdir(), 'nlm-reuse-'));

/** 写入一个包（manifest 不含 name/version 时自动补） */
const writePackage = (dir, manifest) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
};

/** 读取某个槽位的状态（symlink / 实体 / 缺失） */
const inspect = (target) => {
  if (
    !fs.existsSync(target) &&
    !fs.lstatSync(target, { throwIfNoEntry: false })
  ) {
    return { kind: 'missing' };
  }
  const stats = fs.lstatSync(target);
  if (!stats.isSymbolicLink()) {
    const manifest = JSON.parse(
      fs.readFileSync(join(target, 'package.json'), 'utf8'),
    );
    return { kind: 'entity', version: manifest.version };
  }
  const resolved = fs.realpathSync(target);
  const manifest = JSON.parse(
    fs.readFileSync(join(resolved, 'package.json'), 'utf8'),
  );
  return { kind: 'link', version: manifest.version, target: resolved };
};

test('parsePkgNameFromPnpmKey：普通包与 scoped 包', () => {
  assert.equal(reuse.parsePkgNameFromPnpmKey('is-number@7.0.0'), 'is-number');
  assert.equal(reuse.parsePkgNameFromPnpmKey('@hbos+foo@1.0.0'), '@hbos/foo');
  assert.equal(
    reuse.parsePkgNameFromPnpmKey('react-dom@17.0.2_react@17.0.2'),
    'react-dom',
  );
  assert.equal(reuse.parsePkgNameFromPnpmKey('invalid'), null);
});

test('buildAppEntityIndex：任意深度索引 + 软链只登记不递归 + 浅层优先', (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appModules = join(root, 'app', 'node_modules');
  writePackage(join(appModules, 'a'), {
    name: 'a',
    version: '1.0.0',
    dependencies: { lodash: '^4.0.0' },
  });
  writePackage(join(appModules, 'a', 'node_modules', 'lodash'), {
    name: 'lodash',
    version: '4.17.20',
  });
  writePackage(join(root, 'app', 'linked-real'), {
    name: 'linked',
    version: '2.0.0',
  });
  fs.symlinkSync('../linked-real', join(appModules, 'linked'), 'junction');
  // 软链目标里再放一个包，索引不应递归进入
  writePackage(join(root, 'app', 'linked-real', 'node_modules', 'deep-only'), {
    name: 'deep-only',
    version: '1.0.0',
  });

  const index = reuse.buildAppEntityIndex(appModules);
  assert.equal(index.get('lodash').length, 1);
  assert.equal(index.get('lodash')[0].depth, 1);
  assert.equal(index.get('linked')[0].depth, 0);
  assert.equal(index.get('deep-only'), undefined);
});

test('collectWrapDeclaredRanges：包含 wrap 包装包自身声明并跳过已优化软链', (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const wrapRoot = join(root, 'wrap');
  const wrapModules = join(wrapRoot, 'node_modules');
  writePackage(wrapRoot, {
    name: 'nlm-cd-demo',
    version: '1.0.0',
    dependencies: { umi: '^3.5.0' },
  });
  writePackage(join(wrapModules, 'b'), {
    name: 'b',
    version: '1.0.0',
    dependencies: { lodash: '^4.17.0' },
    peerDependencies: { react: '^17.0.0' },
    optionalDependencies: { fsevents: '^2.0.0' },
  });
  // 已优化为软链的包不再参与范围收集
  fs.symlinkSync(
    join(wrapModules, 'b'),
    join(wrapModules, 'c-linked'),
    'junction',
  );
  writePackage(join(root, 'outside'), { name: 'outside', version: '1.0.0' });

  const ranges = reuse.collectWrapDeclaredRanges(wrapModules);
  assert.deepEqual([...ranges.get('umi')], ['^3.5.0']);
  assert.deepEqual([...ranges.get('lodash')], ['^4.17.0']);
  assert.deepEqual([...ranges.get('react')], ['^17.0.0']);
  assert.deepEqual([...ranges.get('fsevents')], ['^2.0.0']);
});

test('pickReusableAppEntity：顶层优先 → 深层同版本 → semver 兼容 → 非 semver 拒绝', (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appModules = join(root, 'app', 'node_modules');
  writePackage(join(appModules, 'pkg'), { name: 'pkg', version: '2.0.0' });
  writePackage(join(appModules, 'holder', 'node_modules', 'pkg'), {
    name: 'pkg',
    version: '1.0.0',
  });
  writePackage(join(appModules, 'pinned'), {
    name: 'pinned',
    version: '0.0.2',
  });

  const index = reuse.buildAppEntityIndex(appModules);
  const cache = new Map();

  // 1) 顶层 semver 兼容优先于深层精确副本
  const topLevel = reuse.pickReusableAppEntity(
    index,
    'pkg',
    new Set(['^2.0.0']),
    '2.0.0',
    cache,
  );
  assert.equal(topLevel.depth, 0);

  // 2) 顶层不满足范围时回落深层精确副本
  const deep = reuse.pickReusableAppEntity(
    index,
    'pkg',
    new Set(['^1.0.0']),
    '1.0.0',
    cache,
  );
  assert.equal(deep.depth, 1);

  // 3) semver 不满足 → 不复用
  assert.equal(
    reuse.pickReusableAppEntity(
      index,
      'pkg',
      new Set(['^3.0.0']),
      '3.0.0',
      cache,
    ),
    null,
  );

  // 4) 非 semver 范围只认版本完全相等
  assert.equal(
    reuse.pickReusableAppEntity(
      index,
      'pinned',
      new Set(['git+https://example.com/pinned.git']),
      '0.0.1',
      cache,
    ),
    null,
  );
  assert.equal(
    reuse.pickReusableAppEntity(
      index,
      'pinned',
      new Set(['git+https://example.com/pinned.git']),
      '0.0.2',
      cache,
    ).depth,
    0,
  );
});

test('optimizeFlatReuse：复用矩阵 + 统计 + 幂等', (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appModules = join(root, 'app', 'node_modules');
  const wrapRoot = join(root, 'wrap');
  const wrapModules = join(wrapRoot, 'node_modules');

  writePackage(join(appModules, 'lodash'), {
    name: 'lodash',
    version: '4.17.21',
  });
  writePackage(join(appModules, 'react'), { name: 'react', version: '18.2.0' });
  writePackage(join(appModules, 'pinned'), {
    name: 'pinned',
    version: '0.0.2',
  });

  writePackage(wrapRoot, {
    name: 'nlm-cd-demo',
    version: '1.0.0',
    dependencies: { lodash: '^4.17.20', react: '^17.0.1' },
  });
  writePackage(join(wrapModules, 'lodash'), {
    name: 'lodash',
    version: '4.17.20',
  });
  writePackage(join(wrapModules, 'react'), {
    name: 'react',
    version: '17.0.1',
  });
  writePackage(join(wrapModules, 'b'), {
    name: 'b',
    version: '2.0.0',
    dependencies: { lodash: '^4.17.0' },
  });
  writePackage(join(wrapModules, 'b', 'node_modules', 'lodash'), {
    name: 'lodash',
    version: '4.17.19',
  });
  writePackage(join(wrapModules, 'only-here'), {
    name: 'only-here',
    version: '1.0.0',
  });
  writePackage(join(wrapModules, 'c'), {
    name: 'c',
    version: '1.0.0',
    dependencies: { pinned: 'git+https://example.com/pinned.git' },
  });
  writePackage(join(wrapModules, 'c', 'node_modules', 'pinned'), {
    name: 'pinned',
    version: '0.0.1',
  });

  const stats = reuse.optimizeFlatReuse(wrapModules, appModules);

  // 顶层 semver 兼容复用
  const flat = inspect(join(wrapModules, 'lodash'));
  assert.equal(flat.kind, 'link');
  assert.equal(flat.version, '4.17.21');
  // 嵌套传递依赖复用
  const nested = inspect(join(wrapModules, 'b', 'node_modules', 'lodash'));
  assert.equal(nested.kind, 'link');
  assert.equal(nested.version, '4.17.21');
  // 版本不满足 → 保留独立副本
  assert.equal(inspect(join(wrapModules, 'react')).kind, 'entity');
  // app 无同名包 → 保留
  assert.equal(inspect(join(wrapModules, 'only-here')).kind, 'entity');
  // 非 semver 声明 → 保留
  assert.equal(
    inspect(join(wrapModules, 'c', 'node_modules', 'pinned')).kind,
    'entity',
  );
  assert.deepEqual(stats, { replaced: 2, compatible: 2 });

  // 幂等：再次执行不产生新替换
  const again = reuse.optimizeFlatReuse(wrapModules, appModules);
  assert.deepEqual(again, { replaced: 0, compatible: 0 });
});
