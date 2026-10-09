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
 * 其次 npminstall 布局（cnpm 9）：app/node_modules/.store/nlm-cd-<pkg>@<ver>/node_modules
 * （优先于穿越路径，因包装包实体内部的穿越路径可能为空目录）
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
  // cnpm 9（npminstall）：app 的包装包 symlink 指向 .store 实体——
  // 优先用其真实路径定位当前实体的依赖目录（避免多历史实体首个匹配的歧义）
  const appPackageLink = join(
    workingDir,
    'node_modules',
    getConflictDepsPackageName(packageName),
  );
  if (isSymlink(appPackageLink)) {
    try {
      const storeModules = dirname(fs.realpathSync(appPackageLink));
      if (pathExistsSync(storeModules)) {
        return storeModules;
      }
    } catch {
      // 悬空链接等 → 落到下方探测
    }
  }
  // cnpm 9（npminstall）的 .store 布局：包装包实体目录为 nlm-cd-<pkg>@<随机版本>，
  // 其实体 node_modules 内含该包装包视角解析好的依赖链接（非链接布局的兜底探测）
  const storeDir = join(workingDir, 'node_modules', '.store');
  const storePrefix = `${getConflictDepsPackageName(packageName)}@`;
  for (const entry of readdirWithFileTypesSync(storeDir)) {
    if (!entry.isDirectory() || !entry.name.startsWith(storePrefix)) {
      continue;
    }
    const storeModules = join(storeDir, entry.name, 'node_modules');
    if (pathExistsSync(storeModules)) {
      return storeModules;
    }
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
  workingDir?: string,
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
    let installedVersion: string | undefined = projectDeps[name];

    if (!installedVersion && workingDir) {
      // 项目声明中没有此依赖——但可能被 app 的传递依赖实际装入节点树：
      // nlm 包解析时会拿到该实际版本，需纳入冲突判断
      const installedManifest = getInstalledPackageManifest(workingDir, name);
      installedVersion = installedManifest?.version;
    }

    if (!installedVersion) {
      // 项目中确实没有安装此依赖，可能需要警告
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
    // wrap 树即安装事实源，needInstall==0 说明依赖已满足
    // 补跑复用优化：确保历史安装/配置变化（如 hoisted 适配）后的优化状态收敛
    applyReuseOptimizations(kind, packageName, workingDir);
    await createConflictDepSymlinks(packageName, conflicts, workingDir);
    return;
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

  // 执行安装（wrap 目录独立安装，按包管理器类别适配参数）
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

  // 安装后复核：落地版本仍未满足时告警（异常路径兜底，如未知的依赖覆盖机制）
  const unsatisfied = filterConflictsNeedInstall(
    conflicts,
    getConflictNodeModulesPath(workingDir, packageName),
  );
  if (unsatisfied.length > 0) {
    logger.warn(
      `冲突依赖安装后仍未满足版本要求: ${unsatisfied
        .map((conflict) => conflict.name)
        .join(', ')}`,
    );
  }

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
 * 统一 wrap 独立安装：此前 app 域安装（file:/tarball）在多 nlm 包场景下，
 * 后装包会在 app 树重算时清理先装包的安装产物（互踩致悬空），故全部改为 wrap 独立
 */
type PackageManagerKind =
  | 'wrap-pnpm' // pnpm：wrap 目录独立安装 + 后置复用优化
  | 'wrap-yarn' // yarn 1：wrap 目录独立安装 + 后置复用优化
  | 'wrap-npm' // npm / fnpm / cnpm：wrap 目录独立安装（npm 系参数）
  | 'wrap-plain'; // 未知：wrap 目录保守安装

/**
 * 按命令名识别包管理器类别（精确匹配，容忍路径前缀与参数后缀）
 * 注意 fnpm 与 cnpm 同属 wrap-npm（fnpm 为 cnpm 封装，npm 系参数一致）
 */
const detectPackageManagerKind = (pm: string): PackageManagerKind => {
  const cmd = basename(pm.trim().split(/\s+/)[0] || '');
  if (cmd === 'pnpm') return 'wrap-pnpm';
  if (cmd === 'yarn' || cmd === 'yarnpkg') return 'wrap-yarn';
  if (cmd === 'npm' || cmd === 'fnpm' || cmd === 'cnpm') return 'wrap-npm';
  return 'wrap-plain';
};

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
 * 生成带执行目录上下文的命令展示文案
 * wrap 场景（cwd 非项目根）附加 cd 前缀，便于用户识别命令在哪个目录执行
 */
const formatCommandWithCwd = (
  command: string,
  cwd: string,
  workingDir: string,
): string => {
  if (cwd === workingDir) {
    return command;
  }
  return `cd ${relative(workingDir, cwd)} && ${command}`;
};

/**
 * 执行冲突依赖安装（统一 wrap 目录独立安装，按包管理器类别适配参数）
 * - wrap-pnpm：--ignore-workspace 防被 app workspace 捕获、--lockfile=false 禁 lock、
 *   --prefer-offline 跳过 metadata 网络校验（大依赖树实测解析 116s → 7.6s）、
 *   --config.strict-peer-dependencies=false 显式忽略 peer 严格检查（与 --legacy-peer-deps 语义对齐）
 * - wrap-yarn：--no-lockfile 禁 lock、--prefer-offline 同理
 * - wrap-npm（npm/fnpm/cnpm）：--no-package-lock 禁 lock、--prefer-offline、--legacy-peer-deps 忽略 peer 冲突
 * - wrap-plain：wrap 目录保守安装
 */
const runConflictDepsInstall = async (
  pm: string,
  kind: PackageManagerKind,
  packageName: string,
  workingDir: string,
  conflictPkgDir: string,
): Promise<void> => {
  let command: string;
  switch (kind) {
    case 'wrap-pnpm': {
      // app 为全局虚拟店时跟随启用（依赖实体与 app 同路径，零后置处理共享）
      const globalStoreOpt = isPnpmGlobalVirtualStoreApp(workingDir)
        ? ' --config.enable-global-virtual-store=true'
        : '';
      command = `${pm} install --ignore-workspace --lockfile=false --prefer-offline --config.strict-peer-dependencies=false${globalStoreOpt}`;
      break;
    }
    case 'wrap-yarn':
      command = `${pm} install --no-lockfile --prefer-offline`;
      break;
    case 'wrap-npm':
      command = `${pm} install --no-package-lock --prefer-offline --legacy-peer-deps`;
      break;
    default:
      command = `${pm} install`;
      break;
  }
  const cwd = conflictPkgDir;
  logger.info(
    t('depDebugRunCommand', {
      cmd: logger.cmd(formatCommandWithCwd(command, cwd, workingDir)),
    }),
  );
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
 * 判断 .pnpm 目录是否为有效的本地虚拟店（含包实体目录条目）
 * 注意：node-linker=hoisted 等平铺模式仍会创建仅含 lock.yaml 的空壳 .pnpm 目录
 */
const hasPnpmStoreEntries = (pnpmDir: string): boolean =>
  readdirWithFileTypesSync(pnpmDir).some(
    (entry) => entry.isDirectory() && entry.name !== 'node_modules',
  );

/**
 * P1：pnpm 本地虚拟店——键对齐替换
 * 对 wrap 虚拟店中与 app 同键（含 peer hash 的完整条目名）的条目，
 * 将包实体替换为指向 app 实体的 symlink（Node realpath 单实例）
 */
const optimizePnpmReuse = (workingDir: string, packageName: string): void => {
  const wrapModulesDir = join(
    getConflictDepsPackageDir(workingDir, packageName),
    'node_modules',
  );
  const appModulesDir = join(workingDir, 'node_modules');
  const wrapPnpmDir = join(wrapModulesDir, '.pnpm');
  const appPnpmDir = join(appModulesDir, '.pnpm');
  if (!hasPnpmStoreEntries(wrapPnpmDir) || !hasPnpmStoreEntries(appPnpmDir)) {
    // app 或 wrap 非本地虚拟店（如 node-linker=hoisted 平铺 / 全局虚拟店）：
    // 退回平铺树替换（全局店下 wrap 目标为 symlink 自动跳过；平铺实体则正常替换）
    optimizeFlatReuse(wrapModulesDir, appModulesDir);
    return;
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
 * 平铺树替换（yarn 1 / pnpm node-linker=hoisted 等）——同版本替换（递归含嵌套层）
 * wrap 树中与 app 顶层同名的包若版本一致，则替换为指向 app 实体的 symlink
 */
const optimizeFlatReuse = (wrapModules: string, appModules: string): void => {
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
      `冲突依赖复用优化（平铺树）：${replaced} 个依赖指向 app 现有副本`,
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
    } else {
      // 平铺树（yarn 1 / npm 系 / pnpm hoisted / 未知）：同名同版本替换为指向 app 实体的 symlink
      optimizeFlatReuse(
        join(
          getConflictDepsPackageDir(workingDir, packageName),
          'node_modules',
        ),
        join(workingDir, 'node_modules'),
      );
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
 * 安全清理复核：仅当清理不会使「既有冲突链接」的解析结果变差时放行
 * 对每个现存冲突链接：若其目标有效（正在提供正确版本），
 * 则要求 app 顶层实际版本存在且满足要求（清理后解析回退到它）；
 * 悬空链接（已失效）与无链接情况放行
 */
const canSafelyCleanupConflictLinks = (
  packageName: string,
  nlmPkg: PackageManifest,
  workingDir: string,
): boolean => {
  const nlmPkgNodeModules = join(
    getProjectNlmDir(workingDir),
    packageName,
    'node_modules',
  );
  const allDeps: Dependencies = {
    ...nlmPkg.dependencies,
    ...nlmPkg.peerDependencies,
  };

  const checkLink = (linkPath: string, depName: string): boolean => {
    const requiredVersion = allDeps[depName];
    if (!requiredVersion) {
      return true; // 非本包依赖的链接（异常）→ 不拦截
    }
    // 链接目标无效（悬空）→ 本就无解析价值，清理无损失
    try {
      if (!fs.existsSync(fs.realpathSync(linkPath))) {
        return true;
      }
    } catch {
      return true;
    }
    // 链接有效：要求 app 顶层实际版本存在且满足（清理后的解析回退目标）
    const appInstalled = getInstalledPackageManifest(workingDir, depName);
    if (!appInstalled?.version) {
      return false;
    }
    try {
      return satisfiesVersion(appInstalled.version, requiredVersion);
    } catch {
      return false;
    }
  };

  for (const entry of readdirWithFileTypesSync(nlmPkgNodeModules)) {
    const entryPath = join(nlmPkgNodeModules, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const sub of readdirWithFileTypesSync(entryPath)) {
        const subPath = join(entryPath, sub.name);
        if (
          isSymlink(subPath) &&
          !checkLink(subPath, `${entry.name}/${sub.name}`)
        ) {
          return false;
        }
      }
    } else if (isSymlink(entryPath) && !checkLink(entryPath, entry.name)) {
      return false;
    }
  }
  return true;
};

/**
 * 清理指定 nlm 包的历史冲突残留（无冲突时调用，回归项目依赖解析）
 * 清点：.nlm/<pkg>/node_modules 下的冲突 symlink、.conflict-deps/<pkg>、app 包装包
 * best-effort：任何异常不影响主流程
 */
const cleanupConflictState = (
  packageName: string,
  workingDir: string,
): void => {
  try {
    let cleaned = 0;
    // 1. .nlm/<pkg>/node_modules 下的冲突 symlink（含 scoped 两级，先删链接再删目标）
    const nlmPkgNodeModules = join(
      getProjectNlmDir(workingDir),
      packageName,
      'node_modules',
    );
    const removeSymlink = (linkPath: string): void => {
      if (isSymlink(linkPath)) {
        removeSync(linkPath);
        cleaned += 1;
      }
    };
    for (const entry of readdirWithFileTypesSync(nlmPkgNodeModules)) {
      const entryPath = join(nlmPkgNodeModules, entry.name);
      if (entry.name.startsWith('@') && entry.isDirectory()) {
        for (const sub of readdirWithFileTypesSync(entryPath)) {
          removeSymlink(join(entryPath, sub.name));
        }
        if (readdirSync(entryPath).length === 0) {
          removeSync(entryPath);
        }
      } else {
        removeSymlink(entryPath);
      }
    }
    // 2. wrap 目录与 app 包装包
    const conflictDepsDir = getConflictDepsPackageDir(workingDir, packageName);
    if (pathExistsSync(conflictDepsDir)) {
      removeSync(conflictDepsDir);
      cleaned += 1;
    }
    const appPackagePath = getConflictDepsNodeModulesPath(
      workingDir,
      packageName,
    );
    if (pathExistsSync(appPackagePath)) {
      removeSync(appPackagePath);
      cleaned += 1;
    }
    if (cleaned > 0) {
      logger.debug(
        `已清理 ${packageName} 的历史冲突残留（${cleaned} 项，回归项目依赖解析）`,
      );
    }
  } catch (error) {
    logger.debug(`清理历史冲突残留失败（已跳过）: ${String(error)}`);
  }
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

  const conflicts = detectDependencyConflicts(nlmPkg, project, workingDir);
  if (conflicts.length === 0) {
    // 无冲突：先复核清理安全性（声明与磁盘可能不一致，防误删仍被需要的链接），
    // 再清理该包的历史冲突残留（wrap / symlink / app 包装包），回归项目依赖解析
    if (canSafelyCleanupConflictLinks(packageName, nlmPkg, workingDir)) {
      cleanupConflictState(packageName, workingDir);
    }
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
