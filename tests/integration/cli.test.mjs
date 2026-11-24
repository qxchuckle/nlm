import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI_RUNNER = fileURLToPath(
  new URL('../support/cli.mjs', import.meta.url),
);

/** 安装替身脚本：按 wrap 的 package.json 造出 node_modules 实体（离线、确定性） */
const FAKE_NPM = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();
if (process.argv[2] === '--version') {
  console.log('10.0.0');
  process.exit(0);
}
if (process.argv[2] === 'install' || process.argv[2] === 'i') {
  const manifestPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(manifestPath)) process.exit(0);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const registryPath = process.env.FAKE_REGISTRY_MAP;
  const registry =
    registryPath && fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : {};
  fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
  for (const name of Object.keys(manifest.dependencies || {})) {
    const dir = path.join(cwd, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version: registry[name] || '1.0.0' }),
    );
  }
  process.exit(0);
}
process.exit(0);
`;

const writeJson = (filePath, data) => {
  fs.mkdirSync(join(filePath, '..'), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const writeFile = (filePath, content) => {
  fs.mkdirSync(join(filePath, '..'), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const exists = (p) => fs.existsSync(p);
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * 搭建沙箱：独立 HOME（含 store）、独立 app、独立 lib、假 npm
 */
const createSandbox = () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'nlm-it-'));
  const home = join(root, 'home');
  const binDir = join(root, 'bin');
  const appDir = join(root, 'app');
  const libDir = join(root, 'lib');

  writeFile(join(binDir, 'npm'), FAKE_NPM);
  fs.chmodSync(join(binDir, 'npm'), 0o755);

  writeJson(join(root, 'registry.json'), {
    '@hbos/component-table': '1.9.0',
    'nanoid': '4.0.2',
    'ghost-dep': '2.1.0',
  });

  writeJson(join(appDir, 'package.json'), {
    name: 'demo-app',
    version: '1.0.0',
    dependencies: {
      umi: '^4.1.2',
      react: '^18.0.0',
      '@hbos/component-table': '2.0.0',
      nanoid: '3.0.0',
      'rc-pagination': '^4.0.0',
      'holder': '^1.0.0',
    },
  });
  // app 实装副本（host / fallback 判定需要）
  const appModules = join(appDir, 'node_modules');
  writeJson(join(appModules, 'umi', 'package.json'), {
    name: 'umi',
    version: '4.1.2',
  });
  writeJson(join(appModules, 'react', 'package.json'), {
    name: 'react',
    version: '18.2.0',
  });
  writeJson(join(appModules, '@hbos', 'component-table', 'package.json'), {
    name: '@hbos/component-table',
    version: '2.0.0',
  });
  writeJson(join(appModules, 'nanoid', 'package.json'), {
    name: 'nanoid',
    version: '3.0.0',
  });
  writeJson(join(appModules, 'rc-pagination', 'package.json'), {
    name: 'rc-pagination',
    version: '4.3.0',
  });

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    FAKE_REGISTRY_MAP: join(root, 'registry.json'),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  /** 写 lib 的 package.json + 产物（产物只运行时引用 table/nanoid，不引用 rc-pagination/umi） */
  const writeLib = (manifest, distCode) => {
    writeJson(join(libDir, 'package.json'), manifest);
    writeFile(
      join(libDir, 'dist', 'index.js'),
      distCode ??
        "require('@hbos/component-table');\nrequire('nanoid');\nmodule.exports = {};\n",
    );
  };

  const run = (args, cwd) => {
    const result = spawnSync(process.execPath, [CLI_RUNNER, ...args], {
      cwd,
      env,
      encoding: 'utf8',
    });
    return {
      code: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      output: `${result.stdout || ''}${result.stderr || ''}`,
    };
  };

  const paths = {
    root,
    home,
    appDir,
    libDir,
    nlmDir: join(appDir, '.nlm'),
    pkgDir: join(appDir, '.nlm', '@hbos', 'demo-lib'),
    wrapDir: join(appDir, '.nlm', '.conflict-deps', '@hbos', 'demo-lib'),
    linkPath: join(appDir, '.nlm', '@hbos', 'demo-lib', 'node_modules'),
    lockfile: join(appDir, '.nlm', 'nlm-lock.json'),
    configFile: join(appDir, '.nlm', 'nlm.config.json'),
  };

  const baseLib = {
    name: '@hbos/demo-lib',
    version: '1.0.0',
    main: 'dist/index.js',
    dependencies: {
      '@hbos/component-table': '^1.0.0',
      nanoid: '^4.0.0',
      'rc-pagination': '^5.0.0',
    },
    peerDependencies: { umi: '^3.3.7', react: '^17.0.0' },
  };

  const pushLib = () => {
    const result = run(['push'], libDir);
    assert.equal(result.code, 0, `push 失败:\n${result.output}`);
    return result;
  };

  const installLib = () => {
    const result = run(['install', '@hbos/demo-lib'], appDir);
    assert.equal(result.code, 0, `install 失败:\n${result.output}`);
    return result;
  };

  /** 写项目配置（固定 zh 语言，保证断言文案稳定） */
  const writeConfig = (conflictDeps, extra = {}) => {
    writeJson(paths.configFile, {
      lang: 'zh',
      ...extra,
      ...(conflictDeps ? { conflictDeps } : {}),
    });
  };
  writeConfig();

  return {
    ...paths,
    env,
    run,
    writeLib,
    pushLib,
    installLib,
    writeConfig,
    baseLib,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

test('集成：默认策略下 umi(peer) 与构建期依赖被跳过，只隔离安装运行时冲突', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  sb.writeLib(sb.baseLib);
  sb.pushLib();
  const result = sb.installLib();

  // 包本体与顶层链接
  assert.equal(exists(join(sb.pkgDir, 'package.json')), true);
  assert.equal(
    isLink(join(sb.appDir, 'node_modules', '@hbos', 'demo-lib')),
    true,
  );

  // wrap 只保留运行时冲突（component-table / nanoid），不含 umi / rc-pagination
  const wrapManifest = readJson(join(sb.wrapDir, 'package.json'));
  assert.deepEqual(Object.keys(wrapManifest.dependencies).sort(), [
    '@hbos/component-table',
    'nanoid',
  ]);
  assert.equal(exists(join(sb.wrapDir, 'node_modules', 'umi')), false);

  // 依赖链接：install 项有、skip 项无
  assert.equal(isLink(join(sb.linkPath, '@hbos', 'component-table')), true);
  assert.equal(isLink(join(sb.linkPath, 'nanoid')), true);
  assert.equal(isLink(join(sb.linkPath, 'umi')), false);
  assert.equal(isLink(join(sb.linkPath, 'rc-pagination')), false);

  // 日志能看到裁决
  assert.match(result.output, /跳过安装/);
  assert.match(result.output, /peer/i);

  // 项目锁已释放
  assert.equal(exists(join(sb.nlmDir, '.lock')), false);

  // list 能看到冲突摘要
  const listed = sb.run(['list'], sb.appDir);
  assert.equal(listed.code, 0, listed.output);
  assert.match(listed.output, /冲突依赖/);
  assert.match(listed.output, /隔离 2/);
});

test('集成：strategy=skip 时全部不安装，且不产生 wrap 与链接', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  sb.writeLib(sb.baseLib);
  sb.writeConfig({ strategy: 'skip' });
  sb.pushLib();
  const result = sb.installLib();

  assert.equal(
    exists(join(sb.appDir, 'node_modules', '@hbos', 'demo-lib')),
    true,
  );
  assert.equal(exists(sb.wrapDir), false);
  assert.equal(isLink(join(sb.linkPath, 'nanoid')), false);
  assert.match(result.output, /跳过安装/);
});

test('集成：host 规则把依赖链到项目实体而非隔离安装', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  sb.writeLib(sb.baseLib);
  sb.writeConfig({ host: ['react'] });
  sb.pushLib();
  sb.installLib();

  const reactLink = join(sb.linkPath, 'react');
  assert.equal(isLink(reactLink), true);
  assert.equal(
    fs.realpathSync(reactLink),
    fs.realpathSync(join(sb.appDir, 'node_modules', 'react')),
  );
  // react 不进 wrap 声明
  const wrapManifest = readJson(join(sb.wrapDir, 'package.json'));
  assert.equal('react' in wrapManifest.dependencies, false);
});

test('集成：策略由 install 切到 skip 后，旧 wrap 与旧链接被回收', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  sb.writeLib(sb.baseLib);
  sb.pushLib();
  sb.installLib();
  assert.equal(exists(sb.wrapDir), true);
  assert.equal(isLink(join(sb.linkPath, 'nanoid')), true);

  // 改配置后走 update 路径（lockfile 已存在）
  sb.writeConfig({ strategy: 'skip' });
  const result = sb.run(['install', '@hbos/demo-lib'], sb.appDir);
  assert.equal(result.code, 0, result.output);

  assert.equal(exists(sb.wrapDir), false, '旧 wrap 应被回收');
  assert.equal(isLink(join(sb.linkPath, 'nanoid')), false, '旧链接应被移除');
});

test('集成：配置 skip 但项目未实际安装该依赖时降级为隔离安装', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  // 声明了 ghost-dep 但 node_modules 里没有 → 必须降级安装，避免启动时 module not found
  const appPkg = readJson(join(sb.appDir, 'package.json'));
  appPkg.dependencies['ghost-dep'] = '^1.0.0';
  writeJson(join(sb.appDir, 'package.json'), appPkg);

  sb.writeLib({
    ...sb.baseLib,
    dependencies: { ...sb.baseLib.dependencies, 'ghost-dep': '^2.0.0' },
  });
  sb.writeConfig({ skip: ['ghost-dep'] });
  sb.pushLib();
  const result = sb.installLib();

  const wrapManifest = readJson(join(sb.wrapDir, 'package.json'));
  assert.equal('ghost-dep' in wrapManifest.dependencies, true);
  assert.match(result.output, /未实际安装/);
});

test('集成：嵌套同名包被替换并记录，卸载时回收', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  // app 中一个包嵌套依赖了同名 nlm 包
  const nested = join(
    sb.appDir,
    'node_modules',
    'holder',
    'node_modules',
    '@hbos',
    'demo-lib',
  );
  writeJson(join(nested, 'package.json'), {
    name: '@hbos/demo-lib',
    version: '0.9.0',
  });

  sb.writeLib(sb.baseLib);
  sb.pushLib();
  sb.installLib();

  assert.equal(isLink(nested), true, '嵌套副本应被替换为软链');
  const lock = readJson(sb.lockfile);
  assert.equal(
    Array.isArray(lock.packages['@hbos/demo-lib'].nestedPaths),
    true,
  );
  assert.equal(lock.packages['@hbos/demo-lib'].nestedPaths.length, 1);

  const result = sb.run(['uninstall', '@hbos/demo-lib'], sb.appDir);
  assert.equal(result.code, 0, result.output);

  assert.equal(exists(sb.pkgDir), false);
  assert.equal(
    exists(join(sb.appDir, 'node_modules', '@hbos', 'demo-lib')),
    false,
  );
  assert.equal(exists(sb.wrapDir), false);
  assert.equal(exists(nested), false, '嵌套软链应被回收');
  assert.equal(readJson(sb.lockfile)?.packages?.['@hbos/demo-lib'], undefined);
});

test('集成：冲突消解后重新安装会清理历史冲突残留', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  sb.writeLib(sb.baseLib);
  sb.pushLib();
  sb.installLib();
  assert.equal(exists(sb.wrapDir), true);

  // 让项目版本满足 nlm 包要求（无冲突）
  const appPkg = readJson(join(sb.appDir, 'package.json'));
  appPkg.dependencies['@hbos/component-table'] = '^1.0.0';
  appPkg.dependencies['nanoid'] = '^4.0.0';
  delete appPkg.dependencies['rc-pagination'];
  delete appPkg.dependencies['umi'];
  delete appPkg.dependencies['react'];
  writeJson(join(sb.appDir, 'package.json'), appPkg);
  // 实体也换成满足要求的版本
  writeJson(
    join(sb.appDir, 'node_modules', '@hbos', 'component-table', 'package.json'),
    { name: '@hbos/component-table', version: '1.9.0' },
  );
  writeJson(join(sb.appDir, 'node_modules', 'nanoid', 'package.json'), {
    name: 'nanoid',
    version: '4.0.2',
  });

  const result = sb.run(['install', '@hbos/demo-lib'], sb.appDir);
  assert.equal(result.code, 0, result.output);
  assert.equal(exists(sb.wrapDir), false, '无冲突时应清理 wrap');
  assert.equal(isLink(join(sb.linkPath, 'nanoid')), false);
});

test('集成：重复安装幂等（第二次不再安装、状态不变）', async (t) => {
  const sb = createSandbox();
  t.after(sb.cleanup);

  sb.writeLib(sb.baseLib);
  sb.pushLib();
  sb.installLib();
  const wrapBefore = readJson(join(sb.wrapDir, 'package.json'));

  const again = sb.run(['install', '@hbos/demo-lib'], sb.appDir);
  assert.equal(again.code, 0, again.output);

  const wrapAfter = readJson(join(sb.wrapDir, 'package.json'));
  assert.deepEqual(wrapAfter.dependencies, wrapBefore.dependencies);
  assert.equal(isLink(join(sb.linkPath, 'nanoid')), true);
});
