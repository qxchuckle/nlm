import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTs } from './support/loader.mjs';

const configModule = await loadTs('src/core/config.ts');

const writeJson = (filePath, data) => {
  fs.mkdirSync(join(filePath, '..'), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

test('readConfig：conflictDeps 名单取并集，标量字段项目级覆盖全局', (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'nlm-config-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeJson(join(home, '.nlm', 'nlm.config.json'), {
    lang: 'zh',
    conflictDeps: {
      strategy: 'host',
      skipPeerDependencies: false,
      host: ['react'],
    },
  });
  writeJson(join(project, '.nlm', 'nlm.config.json'), {
    conflictDeps: {
      host: ['@cffe/h2o-theme'],
      install: ['umi'],
    },
  });

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const config = configModule.readConfig({
      workingDir: project,
      extendsGlobalConfig: true,
      initConfig: false,
    });
    // 名单并集：全局默认 + 项目追加
    assert.deepEqual([...config.conflictDeps.host].sort(), [
      '@cffe/h2o-theme',
      'react',
    ]);
    assert.deepEqual(config.conflictDeps.install, ['umi']);
    // 标量字段：项目未写 → 继承全局
    assert.equal(config.conflictDeps.strategy, 'host');
    assert.equal(config.conflictDeps.skipPeerDependencies, false);

    // 归一化配置同样保留并集结果
    const resolved = configModule.getConflictDepsConfig(project);
    assert.deepEqual([...resolved.host].sort(), ['@cffe/h2o-theme', 'react']);
    assert.equal(resolved.strategy, 'host');
  } finally {
    process.env.HOME = previousHome;
  }
});

test('readConfig：双方都未配置 conflictDeps 时保持默认值', (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'nlm-config-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeJson(join(home, '.nlm', 'nlm.config.json'), {});
  writeJson(join(project, '.nlm', 'nlm.config.json'), {});

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const resolved = configModule.getConflictDepsConfig(project);
    assert.deepEqual(resolved.host, []);
    assert.deepEqual(resolved.skip, []);
    assert.deepEqual(resolved.install, []);
    assert.equal(resolved.strategy, 'install');
    assert.equal(resolved.skipPeerDependencies, true);
    assert.equal(resolved.skipBuildOnlyDependencies, true);
  } finally {
    process.env.HOME = previousHome;
  }
});
