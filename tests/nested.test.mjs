import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTs } from './support/loader.mjs';

const nested = await loadTs('src/services/nested.ts');

const createRoot = () => fs.mkdtempSync(join(tmpdir(), 'nlm-nested-'));

const writePackage = (dir, manifest) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
};

test('replaceNestedPackages：返回被替换路径并建立指向 .nlm 的软链', async (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appModules = join(root, 'node_modules');
  const nlmPkgDir = join(root, '.nlm', 'demo-pkg');
  writePackage(nlmPkgDir, { name: 'demo-pkg', version: '1.2.0' });
  writePackage(join(appModules, 'holder'), {
    name: 'holder',
    version: '1.0.0',
    dependencies: { 'demo-pkg': '^1.0.0' },
  });
  writePackage(join(appModules, 'holder', 'node_modules', 'demo-pkg'), {
    name: 'demo-pkg',
    version: '1.0.0',
  });

  const result = await nested.replaceNestedPackages(
    root,
    'demo-pkg',
    nlmPkgDir,
  );

  assert.equal(result.replaced, 1);
  assert.equal(result.paths.length, 1);
  assert.equal(
    result.paths[0],
    join('node_modules', 'holder', 'node_modules', 'demo-pkg'),
  );

  const linkPath = join(root, result.paths[0]);
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(linkPath), fs.realpathSync(nlmPkgDir));
});

test('replaceNestedPackages：无嵌套同名包时返回空结果', async (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appModules = join(root, 'node_modules');
  writePackage(join(appModules, 'holder'), {
    name: 'holder',
    version: '1.0.0',
  });
  writePackage(join(root, '.nlm', 'demo-pkg'), {
    name: 'demo-pkg',
    version: '1.2.0',
  });

  const result = await nested.replaceNestedPackages(
    root,
    'demo-pkg',
    join(root, '.nlm', 'demo-pkg'),
  );
  assert.deepEqual(result, { replaced: 0, paths: [] });
});
