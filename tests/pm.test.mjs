import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './support/loader.mjs';

const pm = await loadTs('src/services/pm.ts');

test('detectPackageManagerKind：npm 系与 fnpm/cnpm 归一类', () => {
  assert.equal(pm.detectPackageManagerKind('pnpm'), 'wrap-pnpm');
  assert.equal(pm.detectPackageManagerKind('yarn'), 'wrap-yarn');
  assert.equal(
    pm.detectPackageManagerKind('/usr/local/bin/yarnpkg'),
    'wrap-yarn',
  );
  assert.equal(pm.detectPackageManagerKind('npm'), 'wrap-npm');
  assert.equal(pm.detectPackageManagerKind('fnpm'), 'wrap-npm');
  assert.equal(pm.detectPackageManagerKind('cnpm'), 'wrap-npm');
  assert.equal(pm.detectPackageManagerKind('bun'), 'wrap-plain');
});

test('buildWrapInstallCommand：pnpm 必须关闭 auto-install-peers', () => {
  const cmd = pm.buildWrapInstallCommand('pnpm', 'wrap-pnpm');
  // 关闭 peer 严格检查但**不装** peer：否则 wrap 里会被 pnpm 自动补装 umi 等 peer 整树
  assert.match(cmd, /--config\.strict-peer-dependencies=false/);
  assert.match(cmd, /--config\.auto-install-peers=false/);
  assert.match(cmd, /--lockfile=false/);
  assert.match(cmd, /--ignore-workspace/);
  assert.match(cmd, /--prefer-offline/);

  // 全局虚拟店时跟随启用
  const globalCmd = pm.buildWrapInstallCommand('pnpm', 'wrap-pnpm', {
    globalVirtualStore: true,
  });
  assert.match(globalCmd, /--config\.enable-global-virtual-store=true/);
});

test('buildWrapInstallCommand：npm 系与 yarn 的禁 lock 参数', () => {
  const npmCmd = pm.buildWrapInstallCommand('npm', 'wrap-npm');
  assert.match(npmCmd, /--no-package-lock/);
  assert.match(npmCmd, /--legacy-peer-deps/);
  assert.doesNotMatch(npmCmd, /auto-install-peers/);

  const yarnCmd = pm.buildWrapInstallCommand('yarn', 'wrap-yarn');
  assert.match(yarnCmd, /--no-lockfile/);
  assert.doesNotMatch(yarnCmd, /auto-install-peers/);

  assert.equal(
    pm.buildWrapInstallCommand('whatever', 'wrap-plain'),
    'whatever install',
  );
});
