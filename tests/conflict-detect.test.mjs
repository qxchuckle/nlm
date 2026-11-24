import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './support/loader.mjs';

const dependency = await loadTs('src/services/dependency.ts');

test('detectDependencyConflicts：保留声明来源，dependencies 优先于 peerDependencies', () => {
  const nlmPkg = {
    name: 'lib',
    version: '1.0.0',
    dependencies: { umi: '^3.5.0', lodash: '^4.0.0' },
    peerDependencies: { react: '^17.0.0', umi: '^3.0.0', lodash: '^3.0.0' },
  };
  const projectPkg = {
    name: 'app',
    version: '1.0.0',
    dependencies: {
      umi: '^4.0.0',
      lodash: '^4.17.21',
      react: '^18.0.0',
    },
  };

  const conflicts = dependency.detectDependencyConflicts(nlmPkg, projectPkg);
  const byName = Object.fromEntries(conflicts.map((c) => [c.name, c]));

  assert.deepEqual(Object.keys(byName).sort(), ['react', 'umi']);
  assert.equal(byName.umi.source, 'dependencies');
  assert.equal(byName.umi.requiredVersion, '^3.5.0');
  assert.equal(byName.react.source, 'peerDependencies');
  // lodash 范围有交集 → 不算冲突
  assert.equal(byName.lodash, undefined);
});

test('detectDependencyConflicts：项目未声明该依赖则不计冲突', () => {
  const conflicts = dependency.detectDependencyConflicts(
    {
      name: 'lib',
      version: '1.0.0',
      dependencies: { umi: '^3.5.0' },
    },
    { name: 'app', version: '1.0.0', dependencies: {} },
  );
  assert.deepEqual(conflicts, []);
});
