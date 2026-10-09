import { execSync } from 'child_process';
import { join, relative, dirname, basename } from 'path';
import fs from 'fs-extra';
import {
  DependencyConflict,
  Dependencies,
  PackageManifest,
  NlmError,
} from '../types';
import { readPackageManifest } from '../utils/package';
import {
  areVersionRangesCompatible,
  satisfiesVersion,
  isSemverVersionOrRange,
} from '../utils/version';
import { getConfiguredPackageManager } from '../core/config';
import { getRuntime } from '../core/runtime';
import {
  ensureDirSync,
  pathExistsSync,
  writeJsonSync,
  removeSync,
  readdirSync,
  readdirWithFileTypesSync,
  isSymlink,
  createSymlinkSync,
} from '../utils/file';
import {
  getProjectNlmDir,
  getConflictDepsPackageDir,
  getConflictDepsPackageName,
  getConflictDepsNodeModulesPath,
} from '../constants';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

/** 生成 0-99 的随机整数 */
const randInt = (): number => Math.floor(Math.random() * 100);

/** 生成随机版本号，确保与上一次不同 */
const genRandomVersion = (prevVersion?: string): string => {
  let ver: string;
  do {
    ver = `${randInt()}.${randInt()}.${randInt()}`;
  } while (ver === prevVersion);
  return ver;
};

/**
 * 获取冲突依赖的实际 node_modules 路径
 * 优先 .conflict-deps/<pkg>/node_modules（wrap 目录安装场景：pnpm/yarn）
 * 回退 app/node_modules/nlm-cd-<pkg>/node_modules（app 目录安装场景：fnpm 复制 / npm tarball 嵌套）
 */
const getConflictNodeModulesPath = (
  workingDir: string,
  packageName: string,
): string => {
  const localPath = join(
    getConflictDepsPackageDir(workingDir, packageName),
    'node_modules',
  );
  if (pathExistsSync(localPath)) {
    return localPath;
  }
  return join(
    workingDir,
    'node_modules',
    getConflictDepsPackageName(packageName),
    'node_modules',
  );
};

/**
 * 检测依赖冲突
 * 比较 nlm 包的依赖和项目的依赖，找出版本不兼容的依赖
 * 使用 npm semver 规则判断版本范围是否兼容
 */
export const detectDependencyConflicts = (
  nlmPkg: PackageManifest,
  projectPkg: PackageManifest,
): DependencyConflict[] => {
  const conflicts: DependencyConflict[] = [];

  const nlmDeps: Dependencies = {
    ...nlmPkg.dependencies,
    ...nlmPkg.peerDependencies,
  };

  const projectDeps: Dependencies = {
    ...projectPkg.dependencies,
    ...projectPkg.devDependencies,
  };

  for (const [name, requiredVersion] of Object.entries(nlmDeps)) {
    const installedVersion = projectDeps[name];

    if (!installedVersion) {
      // 项目中没有安装此依赖，可能需要警告
      continue;
    }

    // 不符合 semver 的版本打 warn，并区分来源
    if (!isSemverVersionOrRange(requiredVersion)) {
      logger.warn(
        t('depInvalidVersionNlm', { name, version: requiredVersion }),
      );
    }
    if (!isSemverVersionOrRange(installedVersion)) {
      logger.warn(
        t('depInvalidVersionProject', {
          name,
          version: installedVersion,
        }),
      );
    }

    try {
      // 检查版本范围是否兼容（有交集），无效范围（如 latest）会跳过
      if (!areVersionRangesCompatible(requiredVersion, installedVersion)) {
        conflicts.push({
          name,
          requiredVersion,
          installedVersion,
        });
      }
    } catch {
      conflicts.push({
        name,
        requiredVersion,
        installedVersion,
      });
    }
  }

  return conflicts;
};

/**
 * 处理依赖冲突
 * 通过包装包安装冲突依赖，按包管理器类别分流安装位置（命令组合均已实测验证）：
 * - app 目录玩法（fnpm/cnpm 用 file: 目录、npm 用 file: tarball）：借助 app 依赖树 hoist 复用
 * - wrap 目录玩法（pnpm/yarn）：在 .conflict-deps/<pkg>/ 内独立安装（禁 lock），安装后执行复用优化
 *
 * 流程：
 * 1. 创建 .nlm/.conflict-deps/<pkg>/package.json（声明冲突依赖）
 * 2. 按包管理器类别执行安装（app 目录 / wrap 目录）
 * 3. 后置复用优化（wrap 玩法）：将 wrap 树中与 app 重复的依赖指向 app 现有副本
 * 4. 创建 symlink：.nlm/<pkg>/node_modules/<dep> → conflict-deps 中的实际位置
 */
export const handleDependencyConflicts = async (
  packageName: string,
  conflicts: DependencyConflict[],
  workingDir: string,
): Promise<void> => {
  if (conflicts.length === 0) {
    return;
  }

  // 冲突依赖包装包目录
  const conflictPkgDir = getConflictDepsPackageDir(workingDir, packageName);
  // 冲突依赖实际 node_modules 路径
  const conflictNodeModules = getConflictNodeModulesPath(
    workingDir,
    packageName,
  );

  // 过滤出真正需要安装的依赖（已安装的版本不满足要求）
  const needInstall = filterConflictsNeedInstall(
    conflicts,
    conflictNodeModules,
  );

  logger.warn(
    t('depConflictDetected', {
      total: conflicts.length,
      need: needInstall.length,
    }),
  );
  conflicts.forEach((conflict) => {
    const isNeedInstall = needInstall.find((i) => i.name === conflict.name);
    logger.log(
      `  - ${logger.pkg(conflict.name)} ${isNeedInstall ? t('depNeedInstall') : t('depAlreadyInstalled')} ` +
        `${t('depRequires', { version: logger.version(conflict.requiredVersion) })}, ` +
        t('depProjectHas', {
          version: logger.version(conflict.installedVersion),
        }),
    );
  });

  const pm = getActualPackageManager(workingDir);
  const kind = detectPackageManagerKind(pm);

  if (needInstall.length === 0) {
    if (isAppDirKind(kind)) {
      // app 玩法（fnpm/cnpm/npm）：检查 app node_modules 中的包装包是否存在
      // 如果不存在（被 app 的 install 清掉），需要重新安装以恢复
      const appSymlinkPath = getConflictDepsNodeModulesPath(
        workingDir,
        packageName,
      );
      if (pathExistsSync(appSymlinkPath)) {
        // 包装包存在，只需确保 nlm 包的 symlink 存在
        await createConflictDepSymlinks(packageName, conflicts, workingDir);
        return;
      }
      // 包装包不存在，需要重新安装（下方逻辑）
    } else {
      // wrap 玩法（pnpm/yarn）：wrap 树即安装事实源，needInstall==0 说明依赖已满足，无需重装
      await createConflictDepSymlinks(packageName, conflicts, workingDir);
      return;
    }
  }

  // 创建包装包 package.json（声明所有冲突依赖，而非仅 needInstall，避免 npm prune 已安装的）
  ensureDirSync(conflictPkgDir);
  // 读取上一次的版本号，确保新生成的不同
  const prevManifest = readPackageManifest(conflictPkgDir);
  const conflictPkgManifest = {
    name: getConflictDepsPackageName(packageName),
    version: genRandomVersion(prevManifest?.version),
    private: true,
    dependencies: Object.fromEntries(
      conflicts.map((c) => [c.name, c.requiredVersion]),
    ),
  };
  writeJsonSync(join(conflictPkgDir, 'package.json'), conflictPkgManifest);

  // 执行安装（按包管理器类别分流：app 目录玩法 / wrap 目录独立安装）
  try {
    await runConflictDepsInstall(
      pm,
      kind,
      packageName,
      workingDir,
      conflictPkgDir,
    );
  } catch (error) {
    logger.error(t('depInstallFailed'));
    throw error;
  }

  // 后置复用优化：将 wrap 树中与 app 重复的依赖指向 app 现有副本（best-effort）
  applyReuseOptimizations(kind, packageName, workingDir);

  // 创建 symlink：.nlm/<pkg>/node_modules/<dep> → conflict-deps 中的实际位置
  await createConflictDepSymlinks(packageName, conflicts, workingDir);
};

/**
 * 过滤出真正需要安装的冲突依赖
 * 检查 .nlm/.conflict-deps/<pkg>/node_modules 中已安装的版本是否满足要求
 */
const filterConflictsNeedInstall = (
  conflicts: DependencyConflict[],
  conflictNodeModules: string,
): DependencyConflict[] => {
  return conflicts.filter((conflict) => {
    const installedPkgPath = join(conflictNodeModules, conflict.name);

    // 如果目录不存在，需要安装
    if (!pathExistsSync(installedPkgPath)) {
      return true;
    }

    // 读取已安装的 package.json
    const installedPkg = readPackageManifest(installedPkgPath);
    if (!installedPkg || !installedPkg.version) {
      return true;
    }

    try {
      // 检查已安装的版本是否满足 nlm 包要求的版本范围
      const isCompatible = satisfiesVersion(
        installedPkg.version,
        conflict.requiredVersion,
      );
      return !isCompatible;
    } catch {
      // 无法比较时（如 requiredVersion 为 latest），跳过，视为已满足不重复安装
      return false;
    }
  });
};

/**
 * 包管理器类别：决定冲突依赖的安装位置与参数策略（各命令组合均已实测验证）
 */
type PackageManagerKind =
  | 'app-file' // fnpm / cnpm：app 目录 file: 目录玩法（依赖 hoist 复用）
  | 'app-tarball' // npm：app 目录 file: tarball 玩法（依赖 hoist 复用）
  | 'wrap-pnpm' // pnpm：wrap 目录独立安装 + 后置复用优化
  | 'wrap-yarn' // yarn 1：wrap 目录独立安装 + 后置复用优化
  | 'wrap-plain'; // 未知：wrap 目录保守安装

/**
 * 按命令名识别包管理器类别（精确匹配，容忍路径前缀与参数后缀）
 * 注意 fnpm 与 cnpm 同属 app-file（fnpm 为 cnpm 封装，行为一致）
 */
const detectPackageManagerKind = (pm: string): PackageManagerKind => {
  const cmd = basename(pm.trim().split(/\s+/)[0] || '');
  if (cmd === 'pnpm') return 'wrap-pnpm';
  if (cmd === 'yarn' || cmd === 'yarnpkg') return 'wrap-yarn';
  if (cmd === 'fnpm' || cmd === 'cnpm') return 'app-file';
  if (cmd === 'npm') return 'app-tarball';
  return 'wrap-plain';
};

/** 是否为 app 目录玩法（安装发生在 app、依赖由 app 树承载） */
const isAppDirKind = (kind: PackageManagerKind): boolean =>
  kind === 'app-file' || kind === 'app-tarball';

/**
 * 判断 app 是否使用 pnpm 全局虚拟店
 * 特征：无本地 node_modules/.pnpm 且顶层包 symlink 指向 store 的 links 目录
 * （全局虚拟店下 wrap 跟随启用同配置，依赖实体跨项目共享同一路径）
 */
const isPnpmGlobalVirtualStoreApp = (workingDir: string): boolean => {
  const appModules = join(workingDir, 'node_modules');
  if (!pathExistsSync(appModules)) return false;
  if (pathExistsSync(join(appModules, '.pnpm'))) return false; // 本地虚拟店
  const isGlobalLink = (linkPath: string): boolean => {
    try {
      // 归一化分隔符后判断（pnpm 全局虚拟店实体位于 <store>/links/ 下）
      return String(fs.readlinkSync(linkPath))
        .replace(/\\/g, '/')
        .includes('/links/');
    } catch {
      return false;
    }
  };
  const entries = readdirWithFileTypesSync(appModules);
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('@')) continue;
    if (entry.isSymbolicLink() && isGlobalLink(join(appModules, entry.name))) {
      return true;
    }
  }
  for (const entry of entries) {
    if (!entry.name.startsWith('@') || !entry.isDirectory()) continue;
    const scopeDir = join(appModules, entry.name);
    for (const sub of readdirWithFileTypesSync(scopeDir)) {
      if (sub.isSymbolicLink() && isGlobalLink(join(scopeDir, sub.name))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * 从 pnpm 虚拟店条目键解析包名
 * is-number@7.0.0 → is-number；@hbos+foo@1.0.0 → @hbos/foo（忽略 peer 后缀）
 */
const parsePkgNameFromPnpmKey = (key: string): string | null => {
  const at = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  if (at <= 0) return null;
  const name = key.slice(0, at);
  return name.startsWith('@') ? name.replace('+', '/') : name;
};

/**
 * npm pack 包装包生成 tgz（tarball 为标准依赖语义，npm 会正常处理依赖树并 hoist 复用）
 * 返回 tgz 绝对路径；会先清理历史 tgz 产物避免堆积
 */
const packConflictDeps = (pm: string, conflictPkgDir: string): string => {
  for (const file of readdirSync(conflictPkgDir)) {
    if (file.endsWith('.tgz')) {
      removeSync(join(conflictPkgDir, file));
    }
  }
  const command = `${pm} pack --json`;
  logger.info(t('depDebugRunCommand', { cmd: logger.cmd(command) }));
  const output = execSync(command, {
    cwd: conflictPkgDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let filename: string | undefined;
  try {
    const parsed = JSON.parse(output) as Array<{ filename?: string }>;
    filename = parsed?.[0]?.filename;
  } catch {
    filename = output.match(/"filename"\s*:\s*"([^"]+)"/)?.[1];
  }
  if (!filename) {
    throw new NlmError(`npm pack 未返回 tgz 文件名: ${output}`);
  }
  return join(conflictPkgDir, filename);
};

/**
 * 执行冲突依赖安装（按包管理器类别分流）
 * - app-file（fnpm/cnpm）：app 目录 file: 目录安装，--no-save 防写 app 文件
 * - app-tarball（npm）：先 pack 为 tgz 再在 app 安装（file: 目录为 link 语义不装依赖）
 * - wrap-pnpm：wrap 目录独立安装（--ignore-workspace 防被 app workspace 捕获、--lockfile=false 禁 lock）
 * - wrap-yarn：wrap 目录独立安装（--no-lockfile 禁 lock）
 * - wrap-plain：wrap 目录保守安装
 */
const runConflictDepsInstall = async (
  pm: string,
  kind: PackageManagerKind,
  packageName: string,
  workingDir: string,
  conflictPkgDir: string,
): Promise<void> => {
  const relativeWrapPath = relative(workingDir, conflictPkgDir);
  let command: string;
  let cwd = workingDir;
  switch (kind) {
    case 'app-file':
      command = `${pm} install file:${relativeWrapPath} --no-save --legacy-peer-deps`;
      break;
    case 'app-tarball': {
      const tgzPath = packConflictDeps(pm, conflictPkgDir);
      command = `${pm} install file:${relative(workingDir, tgzPath)} --no-save --legacy-peer-deps --no-package-lock`;
      break;
    }
    case 'wrap-pnpm': {
      // app 为全局虚拟店时跟随启用（依赖实体与 app 同路径，零后置处理共享）
      const globalStoreOpt = isPnpmGlobalVirtualStoreApp(workingDir)
        ? ' --config.enable-global-virtual-store=true'
        : '';
      command = `${pm} install --ignore-workspace --lockfile=false${globalStoreOpt}`;
      cwd = conflictPkgDir;
      break;
    }
    case 'wrap-yarn':
      command = `${pm} install --no-lockfile`;
      cwd = conflictPkgDir;
      break;
    default:
      command = `${pm} install`;
      cwd = conflictPkgDir;
      break;
  }
  logger.info(t('depDebugRunCommand', { cmd: logger.cmd(command) }));
  execSync(command, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
};

/**
 * 将 wrap 中的包实体替换为指向 app 实体的 symlink
 * 采用「备份挪走 → 建链 → 清理备份 / 失败回滚」保证实体不丢失
 */
const replaceEntityWithSymlink = (
  wrapEntity: string,
  appEntity: string,
): void => {
  const backupPath = `${wrapEntity}.nlm-opt-bak`;
  removeSync(backupPath); // 清理历史残留备份
  fs.renameSync(wrapEntity, backupPath); // 原子挪走，实体未丢失
  try {
    const relativeTarget = relative(dirname(wrapEntity), appEntity);
    createSymlinkSync(relativeTarget, wrapEntity);
    removeSync(backupPath);
  } catch (error) {
    // 回滚：恢复原实体，保留独立副本
    removeSync(wrapEntity);
    fs.renameSync(backupPath, wrapEntity);
    throw error;
  }
};

/**
 * P1：pnpm 本地虚拟店——键对齐替换
 * 对 wrap 虚拟店中与 app 同键（含 peer hash 的完整条目名）的条目，
 * 将包实体替换为指向 app 实体的 symlink（Node realpath 单实例）
 */
const optimizePnpmReuse = (workingDir: string, packageName: string): void => {
  const wrapPnpmDir = join(
    getConflictDepsPackageDir(workingDir, packageName),
    'node_modules',
    '.pnpm',
  );
  const appPnpmDir = join(workingDir, 'node_modules', '.pnpm');
  if (!pathExistsSync(wrapPnpmDir) || !pathExistsSync(appPnpmDir)) {
    return; // wrap 非 pnpm 布局，或 app 非本地虚拟店（如全局虚拟店无需后置处理）
  }

  let replaced = 0;
  for (const entry of readdirWithFileTypesSync(wrapPnpmDir)) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const appEntryDir = join(appPnpmDir, entry.name);
    if (!pathExistsSync(appEntryDir)) continue; // app 无同键条目 → 保守跳过
    const depName = parsePkgNameFromPnpmKey(entry.name);
    if (!depName) continue;
    const wrapEntity = join(wrapPnpmDir, entry.name, 'node_modules', depName);
    const appEntity = join(appEntryDir, 'node_modules', depName);
    if (!pathExistsSync(wrapEntity) || !pathExistsSync(appEntity)) continue;
    if (isSymlink(wrapEntity)) continue; // 幂等：已优化过
    replaceEntityWithSymlink(wrapEntity, appEntity);
    replaced += 1;
  }
  if (replaced > 0) {
    logger.debug(
      `冲突依赖复用优化（pnpm）：${replaced} 个依赖指向 app 现有副本`,
    );
  }
};

/**
 * P2：yarn 1 平铺树——同版本替换（递归含嵌套层）
 * wrap 树中与 app 顶层同名的包若版本一致，则替换为指向 app 实体的 symlink
 */
const optimizeYarnReuse = (workingDir: string, packageName: string): void => {
  const wrapModules = join(
    getConflictDepsPackageDir(workingDir, packageName),
    'node_modules',
  );
  const appModules = join(workingDir, 'node_modules');
  if (!pathExistsSync(wrapModules) || !pathExistsSync(appModules)) return;

  let replaced = 0;

  // 单个包实体：与 app 顶层同版本则替换；返回是否已替换
  const handlePackage = (pkgDir: string, pkgName: string): boolean => {
    if (isSymlink(pkgDir)) return false; // 已是 symlink（幂等）
    const appPkgDir = join(appModules, pkgName);
    const wrapManifest = readPackageManifest(pkgDir);
    const appManifest = readPackageManifest(appPkgDir);
    if (
      !wrapManifest?.version ||
      !appManifest?.version ||
      wrapManifest.version !== appManifest.version
    ) {
      return false; // 不同版本（或读取失败）→ 保守跳过
    }
    replaceEntityWithSymlink(pkgDir, appPkgDir);
    replaced += 1;
    return true;
  };

  // 递归遍历 node_modules 层（已替换为 symlink 的包不再深入）
  const walk = (modulesDir: string, depth: number): void => {
    if (depth > 16) return; // 防御性深度上限
    for (const entry of readdirWithFileTypesSync(modulesDir)) {
      if (entry.name.startsWith('.')) continue; // .bin 等
      if (entry.name.startsWith('@')) {
        if (!entry.isDirectory()) continue;
        const scopeDir = join(modulesDir, entry.name);
        for (const sub of readdirWithFileTypesSync(scopeDir)) {
          const subDir = join(scopeDir, sub.name);
          if (
            !isSymlink(subDir) &&
            !handlePackage(subDir, `${entry.name}/${sub.name}`)
          ) {
            walk(join(subDir, 'node_modules'), depth + 1);
          }
        }
        continue;
      }
      const pkgDir = join(modulesDir, entry.name);
      if (isSymlink(pkgDir) || !entry.isDirectory()) continue;
      if (!handlePackage(pkgDir, entry.name)) {
        walk(join(pkgDir, 'node_modules'), depth + 1);
      }
    }
  };

  walk(wrapModules, 0);
  if (replaced > 0) {
    logger.debug(
      `冲突依赖复用优化（yarn）：${replaced} 个依赖指向 app 现有副本`,
    );
  }
};

/**
 * 后置复用优化总入口：将 wrap 树中与 app 重复的依赖指向 app 现有副本
 * （Node 以 realpath 作模块缓存键，指向同一实体即模块单实例，防大型 app 内存崩溃）
 * best-effort：任何异常一律跳过，保留独立副本，不影响正确性
 */
const applyReuseOptimizations = (
  kind: PackageManagerKind,
  packageName: string,
  workingDir: string,
): void => {
  try {
    if (kind === 'wrap-pnpm') {
      optimizePnpmReuse(workingDir, packageName);
    } else if (kind === 'wrap-yarn') {
      optimizeYarnReuse(workingDir, packageName);
    }
  } catch (error) {
    logger.debug(
      `冲突依赖复用优化失败（已跳过，不影响安装）: ${String(error)}`,
    );
  }
};

/**
 * 创建冲突依赖的 symlink
 * 将 .nlm/<pkg>/node_modules/<dep> 链接到 app/node_modules/nlm-cd-<pkg>/node_modules/<dep>
 */
const createConflictDepSymlinks = async (
  packageName: string,
  conflicts: DependencyConflict[],
  workingDir: string,
): Promise<void> => {
  const nlmPkgDir = join(getProjectNlmDir(workingDir), packageName);
  const nlmPkgNodeModules = join(nlmPkgDir, 'node_modules');
  const conflictNodeModules = getConflictNodeModulesPath(
    workingDir,
    packageName,
  );

  for (const conflict of conflicts) {
    const linkPath = join(nlmPkgNodeModules, conflict.name);
    const targetPath = join(conflictNodeModules, conflict.name);

    // 目标不存在则跳过（可能安装失败）
    if (!pathExistsSync(targetPath)) {
      continue;
    }

    // 计算相对路径
    const relativeTarget = relative(dirname(linkPath), targetPath);

    try {
      // 检查是否已存在正确的 symlink
      const stats = await fs.lstat(linkPath).catch(() => null);
      if (stats?.isSymbolicLink()) {
        const currentTarget = await fs.readlink(linkPath);
        if (currentTarget === relativeTarget || currentTarget === targetPath) {
          continue; // 已正确
        }
      }
      // 删除现有的目录或错误的链接
      if (stats) {
        removeSync(linkPath);
      }

      // 确保父目录存在（处理 scoped packages 如 @scope/pkg）
      await fs.ensureDir(dirname(linkPath));
      // 创建相对路径的软链接
      await fs.symlink(relativeTarget, linkPath, 'junction');

      logger.debug(
        t('nestedDebugReplaced', {
          from: logger.path(linkPath),
          to: relativeTarget,
        }),
      );
    } catch (error) {
      logger.debug(`创建冲突依赖 symlink 失败: ${conflict.name}`);
      logger.debug(String(error));
    }
  }
};

/**
 * 获取实际需要使用的包管理器
 */
const getActualPackageManager = (workingDir: string): string => {
  return (
    getRuntime().forcedPackageManager || getConfiguredPackageManager(workingDir)
  );
};

/**
 * 执行 package.json scripts 中的脚本
 * 使用 getActualPackageManager 决定的包管理器执行 run <scriptName>
 * 命令失败时抛出 NlmError
 */
export const runPackageManagerScript = async (
  workingDir: string,
  scriptName: string,
): Promise<void> => {
  const pm = getActualPackageManager(workingDir);
  try {
    execSync(`${pm} run ${scriptName}`, {
      cwd: workingDir,
      stdio: 'inherit',
      encoding: 'utf-8',
    });
  } catch (error) {
    throw new NlmError(t('pushBuildFailed', { error: String(error) }));
  }
};

/**
 * 执行包管理器安装命令，安装指定的包
 * （uninstall -i 场景：将 nlm 链接包正式装回 app，写入 package.json 属该场景语义）
 * 按包管理器类别适配：pnpm/yarn 不支持 --legacy-peer-deps，改用 add
 */
export const runInstall = async (
  workingDir: string,
  packageNames: string[],
): Promise<void> => {
  const pm = getActualPackageManager(workingDir);
  if (packageNames.length === 0) {
    return;
  }
  const kind = detectPackageManagerKind(pm);
  const pkgList = packageNames.join(' ');
  let command: string;
  switch (kind) {
    case 'wrap-pnpm': {
      // pnpm workspace root 下 add 需显式 -w
      const isWorkspaceRoot = pathExistsSync(
        join(workingDir, 'pnpm-workspace.yaml'),
      );
      command = `${pm} add ${pkgList}${isWorkspaceRoot ? ' -w' : ''}`;
      break;
    }
    case 'wrap-yarn': {
      // yarn workspace root 下 add 需显式 -W（--ignore-workspace-root-check）
      const isWorkspaceRoot = !!readPackageManifest(workingDir)?.workspaces;
      command = `${pm} add ${pkgList}${isWorkspaceRoot ? ' -W' : ''}`;
      break;
    }
    case 'wrap-plain':
      command = `${pm} install ${pkgList}`;
      break;
    default:
      // npm / fnpm / cnpm 支持 --legacy-peer-deps
      command = `${pm} install ${pkgList} --legacy-peer-deps`;
      break;
  }
  logger.info(t('depDebugRunCommand', { cmd: logger.cmd(command) }));
  execSync(command, {
    cwd: workingDir,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
};

/**
 * 检查并处理依赖冲突
 * 通用函数，用于 install 和 update 命令
 *
 * @param packageName nlm 包名
 * @param nlmPackageDir nlm 包在 .nlm 中的路径
 * @param workingDir 项目工作目录
 * @param projectPkg 项目的 package.json（可选，如果不传则自动读取）
 * @returns 是否存在冲突
 */
export const checkAndHandleDependencyConflicts = async (
  packageName: string,
  nlmPackageDir: string,
  workingDir: string,
  projectPkg?: PackageManifest | null,
): Promise<boolean> => {
  const project = projectPkg ?? readPackageManifest(workingDir);
  const nlmPkg = readPackageManifest(nlmPackageDir);

  if (!project || !nlmPkg) {
    return false;
  }

  const conflicts = detectDependencyConflicts(nlmPkg, project);
  if (conflicts.length === 0) {
    return false;
  }

  await handleDependencyConflicts(packageName, conflicts, workingDir);
  return true;
};

/**
 * 检查项目中是否存在 nlm 包需要的依赖
 */
export const checkMissingDependencies = (
  nlmPkg: PackageManifest,
  projectPkg: PackageManifest,
): string[] => {
  const missing: string[] = [];

  const nlmDeps: Dependencies = {
    ...nlmPkg.dependencies,
    ...nlmPkg.peerDependencies,
  };

  const projectDeps: Dependencies = {
    ...projectPkg.dependencies,
    ...projectPkg.devDependencies,
  };

  for (const name of Object.keys(nlmDeps)) {
    if (!projectDeps[name]) {
      missing.push(name);
    }
  }

  return missing;
};

/**
 * 获取包在 node_modules 中的 package.json
 */
export const getInstalledPackageManifest = (
  workingDir: string,
  packageName: string,
): PackageManifest | null => {
  const pkgPath = join(workingDir, 'node_modules', packageName);
  if (!pathExistsSync(pkgPath)) {
    return null;
  }
  return readPackageManifest(pkgPath);
};
