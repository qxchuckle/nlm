import { execSync } from 'child_process';
import { join, relative, dirname, resolve, sep } from 'path';
import fs from 'fs-extra';
import {
  DependencyConflict,
  DependencyConflictSource,
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
import {
  getConfiguredPackageManager,
  getConflictDepsConfig,
} from '../core/config';
import { ConflictDecision, decideConflictActions } from './conflict-strategy';
import { applyReuseOptimizations } from './dependency-reuse';
import { PackageManagerKind, detectPackageManagerKind } from './pm';
import { getRuntime } from '../core/runtime';
import {
  ensureDirSync,
  pathExistsSync,
  writeJsonSync,
  removeSync,
  readdirSync,
  readdirWithFileTypesSync,
  isSymlink,
} from '../utils/file';
import {
  getProjectNlmDir,
  getConflictDepsPackageDir,
  getConflictDepsPackageName,
  getConflictDepsNodeModulesPath,
} from '../constants';
import logger from '../utils/logger';
import { t } from '../utils/i18n';
import { withProjectLock } from '../utils/lock';

/** 生成 0-99 的随机整数 */
const randInt = (): number => Math.floor(Math.random() * 100);

/** 本次进程内已给出「强制安装」引导的依赖名（避免多包重复刷屏） */
const hintedConflictPackages = new Set<string>();

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
 * 冲突项保留声明来源（dependencies / peerDependencies），供后续裁决分流
 */
export const detectDependencyConflicts = (
  nlmPkg: PackageManifest,
  projectPkg: PackageManifest,
  workingDir?: string,
): DependencyConflict[] => {
  const conflicts: DependencyConflict[] = [];

  const sources: Array<{
    source: DependencyConflictSource;
    deps?: Dependencies;
  }> = [
    { source: 'dependencies', deps: nlmPkg.dependencies },
    { source: 'peerDependencies', deps: nlmPkg.peerDependencies },
  ];

  const projectDeps: Dependencies = {
    ...projectPkg.dependencies,
    ...projectPkg.devDependencies,
  };

  const seen = new Set<string>();

  for (const { source, deps } of sources) {
    for (const [name, requiredVersion] of Object.entries(deps || {})) {
      // 同名依赖以 dependencies 声明为准（前面的来源优先）
      if (seen.has(name)) continue;
      seen.add(name);

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
            source,
          });
        }
      } catch {
        conflicts.push({
          name,
          requiredVersion,
          installedVersion,
          source,
        });
      }
    }
  }

  return conflicts;
};

/**
 * 处理依赖冲突（三层模型）
 * 1. 裁决：install（隔离安装）/ skip（不安装，解析回退项目自有副本）/ host（不安装 + 显式链到项目实体）
 * 2. 仅 install 项写入 wrap 包装包并安装（按包管理器类别适配参数、禁 lock）
 * 3. 后置复用优化：wrap 树中可复用的实体指向 app 现有副本（Node realpath 单实例）
 * 4. 同步 symlink：install → wrap 实体，host → app 实体，skip → 移除历史链接
 */
export const handleDependencyConflicts = async (
  packageName: string,
  conflicts: DependencyConflict[],
  workingDir: string,
): Promise<void> => {
  if (conflicts.length === 0) {
    return;
  }

  // 冲突依赖包装包目录 / 实际 node_modules 路径
  const conflictPkgDir = getConflictDepsPackageDir(workingDir, packageName);
  const conflictNodeModules = getConflictNodeModulesPath(
    workingDir,
    packageName,
  );
  const nlmPkgDir = join(getProjectNlmDir(workingDir), packageName);

  // 逐条裁决安装策略（peer 语义 / 构建期判定 / 配置规则）
  const decisions = decideConflictActions({
    conflicts,
    packageDir: nlmPkgDir,
    manifest: readPackageManifest(nlmPkgDir),
    config: getConflictDepsConfig(workingDir),
  });

  // 回退校验：skip / host 依赖项目侧必须**实际可解析**，否则降级为隔离安装。
  // 典型场景：package.json 声明了该依赖但未安装（全新克隆未 install）、
  // 或 node_modules 被提升到 workspace 根之外——否则会在启动时才暴露 module not found
  conflicts.forEach((conflict) => {
    const action = decisions.get(conflict.name)?.action;
    if (action !== 'skip' && action !== 'host') return;
    if (resolveAppPackageDir(workingDir, conflict.name)) return;
    decisions.set(conflict.name, {
      action: 'install',
      reason: 'fallback-unresolvable',
    });
  });

  const actionOf = (name: string) => decisions.get(name)?.action ?? 'install';
  const reasonOf = (name: string) => decisions.get(name)?.reason ?? 'default';

  // 仅「隔离安装」项参与 wrap 安装与版本满足判定
  const installConflicts = conflicts.filter(
    (conflict) => actionOf(conflict.name) === 'install',
  );
  const needInstall = filterConflictsNeedInstall(
    installConflicts,
    conflictNodeModules,
  );

  const skippedCount = conflicts.filter(
    (conflict) => actionOf(conflict.name) === 'skip',
  ).length;
  const sharedCount = conflicts.filter(
    (conflict) => actionOf(conflict.name) === 'host',
  ).length;

  logger.warn(
    t('depConflictDetected', {
      total: conflicts.length,
      need: needInstall.length,
      skipped: skippedCount,
      shared: sharedCount,
    }),
  );
  conflicts.forEach((conflict) => {
    const needsInstall = needInstall.some(
      (item) => item.name === conflict.name,
    );
    logger.log(
      `  - ${logger.pkg(conflict.name)} ${formatDecisionTag(actionOf(conflict.name), needsInstall)} ` +
        `${t('depRequires', { version: logger.version(conflict.requiredVersion) })}, ` +
        t('depProjectHas', {
          version: logger.version(conflict.installedVersion),
        }) +
        formatDecisionReason(reasonOf(conflict.name)),
    );
  });

  // 兜底跳过（构建期 / peer）首次出现时给一次性配置引导，让用户知道可回退
  const hintTargets = conflicts
    .filter((conflict) => {
      const reason = reasonOf(conflict.name);
      return (
        (reason === 'build-only' || reason === 'peer-host') &&
        !hintedConflictPackages.has(conflict.name)
      );
    })
    .map((conflict) => conflict.name);
  if (hintTargets.length > 0) {
    hintTargets.forEach((name) => hintedConflictPackages.add(name));
    logger.info(
      t('depConflictHintInstall', {
        pkgs: JSON.stringify(hintTargets),
      }),
    );
  }

  const pm = getActualPackageManager(workingDir);
  const kind = detectPackageManagerKind(pm);

  // 历史 wrap 声明是否已与本次「隔离安装」集合不一致（策略切换后须回收旧副本）
  const prevWrapNames = Object.keys(
    readPackageManifest(conflictPkgDir)?.dependencies || {},
  );
  const installNames = installConflicts.map((conflict) => conflict.name);
  const wrapOutdated = prevWrapNames.some(
    (name) => !installNames.includes(name),
  );

  if (installConflicts.length === 0) {
    // 全部无需隔离安装：回收旧 wrap 树与 app 包装包，避免旧副本继续被抢先解析
    removeConflictDepsArtifacts(packageName, workingDir);
  } else if (needInstall.length > 0 || wrapOutdated) {
    await installIsolatedConflicts(packageName, installConflicts, workingDir);
  } else {
    // wrap 树即安装事实源，needInstall==0 说明依赖已满足
    // 补跑复用优化：确保历史安装/配置变化（如 hoisted 适配）后的优化状态收敛
    applyReuseOptimizations(kind, packageName, workingDir);
  }

  // 创建/校正依赖链接：install → wrap 实体，host → app 实体，skip → 移除
  await syncConflictDepSymlinks(packageName, conflicts, decisions, workingDir);
};

/**
 * 隔离安装指定冲突依赖（写入 wrap 包装包 → 安装 → 复用优化 → 安装后复核）
 */
const installIsolatedConflicts = async (
  packageName: string,
  conflicts: DependencyConflict[],
  workingDir: string,
): Promise<void> => {
  const conflictPkgDir = getConflictDepsPackageDir(workingDir, packageName);
  const pm = getActualPackageManager(workingDir);
  const kind = detectPackageManagerKind(pm);

  ensureDirSync(conflictPkgDir);
  // 读取上一次的版本号，确保新生成的不同
  const prevManifest = readPackageManifest(conflictPkgDir);
  const conflictPkgManifest = {
    name: getConflictDepsPackageName(packageName),
    version: genRandomVersion(prevManifest?.version),
    private: true,
    dependencies: Object.fromEntries(
      conflicts.map((conflict) => [conflict.name, conflict.requiredVersion]),
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

  // 后置复用优化：将 wrap 树中可复用的依赖指向 app 现有副本（best-effort）
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
};

/**
 * 回收冲突安装产物（wrap 目录 + app 包装包）
 * best-effort：任何异常不影响主流程
 */
const removeConflictDepsArtifacts = (
  packageName: string,
  workingDir: string,
): void => {
  try {
    const conflictDepsDir = getConflictDepsPackageDir(workingDir, packageName);
    if (pathExistsSync(conflictDepsDir)) {
      removeSync(conflictDepsDir);
      logger.debug(`已回收 ${packageName} 的冲突依赖 wrap 树`);
    }
    const appPackagePath = getConflictDepsNodeModulesPath(
      workingDir,
      packageName,
    );
    if (pathExistsSync(appPackagePath)) {
      removeSync(appPackagePath);
    }
  } catch (error) {
    logger.debug(`回收冲突安装产物失败（已跳过）: ${String(error)}`);
  }
};

/** 冲突裁决标签（安装/已安装/跳过/共享项目版本） */
const formatDecisionTag = (
  action: 'install' | 'skip' | 'host',
  needsInstall: boolean,
): string => {
  if (action === 'skip') return t('depConflictSkipped');
  if (action === 'host') return t('depConflictHost');
  return needsInstall ? t('depNeedInstall') : t('depAlreadyInstalled');
};

/** 冲突裁决原因（附加在版本信息后的括号说明） */
const formatDecisionReason = (reason: string): string => {
  switch (reason) {
    case 'build-only':
      return t('depReasonBuildOnly');
    case 'peer-host':
      return t('depReasonPeerHost');
    case 'config-skip':
      return t('depReasonConfigSkip');
    case 'config-host':
      return t('depReasonConfigHost');
    case 'config-install':
      return t('depReasonConfigInstall');
    case 'config-strategy':
      return t('depReasonStrategy');
    case 'fallback-unresolvable':
      return t('depReasonFallback');
    default:
      return '';
  }
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
  // debug 模式保留实时输出；否则捕获输出，成功时不打断进度条，失败时整段回放
  if (getRuntime().debug) {
    execSync(command, { cwd, stdio: 'inherit', encoding: 'utf-8' });
    return;
  }
  try {
    execSync(command, { cwd, stdio: 'pipe', encoding: 'utf-8' });
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const output = [failure.stdout, failure.stderr]
      .filter((item): item is string => !!item && item.trim().length > 0)
      .join('\n');
    if (output) {
      logger.error(output.trim());
    }
    throw error;
  }
};

/**
 * 清理已失效的冲突依赖链接
 * 只处理「指向 .nlm/.conflict-deps/<pkg> 的软链」与悬空软链，
 * 避免误删包产物自带的 node_modules（bundledDependencies）
 */
const pruneStaleConflictLinks = (
  packageName: string,
  workingDir: string,
  keep: Set<string>,
): void => {
  const nlmPkgNodeModules = join(
    getProjectNlmDir(workingDir),
    packageName,
    'node_modules',
  );
  const conflictDepsDir = resolve(
    getConflictDepsPackageDir(workingDir, packageName),
  );

  const handleLink = (linkPath: string, depName: string): void => {
    if (keep.has(depName) || !isSymlink(linkPath)) return;
    let target: string | null = null;
    try {
      target = resolve(dirname(linkPath), fs.readlinkSync(linkPath));
    } catch {
      target = null;
    }
    // 悬空链接或仍指向本包 wrap 的链接：都需回收
    // 前缀需带分隔符，避免 @hbos/demo 误判 @hbos/demo-extra 的 wrap
    if (
      target === null ||
      target === conflictDepsDir ||
      target.startsWith(`${conflictDepsDir}${sep}`)
    ) {
      removeSync(linkPath);
    }
  };

  for (const entry of readdirWithFileTypesSync(nlmPkgNodeModules)) {
    const entryPath = join(nlmPkgNodeModules, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const sub of readdirWithFileTypesSync(entryPath)) {
        handleLink(join(entryPath, sub.name), `${entry.name}/${sub.name}`);
      }
      continue;
    }
    handleLink(entryPath, entry.name);
  }
};

/**
 * 同步冲突依赖的 symlink
 * - install：.nlm/<pkg>/node_modules/<dep> → wrap 中的实际位置
 * - host：.nlm/<pkg>/node_modules/<dep> → app 实体（显式共享项目版本）
 * - skip：移除历史链接，让解析沿目录树回退到 app 自身副本
 * 注意：不再冲突 / 已从 wrap 回收的依赖，其历史链接也要一并清理
 */
const syncConflictDepSymlinks = async (
  packageName: string,
  conflicts: DependencyConflict[],
  decisions: Map<string, ConflictDecision>,
  workingDir: string,
): Promise<void> => {
  const nlmPkgDir = join(getProjectNlmDir(workingDir), packageName);
  const nlmPkgNodeModules = join(nlmPkgDir, 'node_modules');
  const conflictNodeModules = getConflictNodeModulesPath(
    workingDir,
    packageName,
  );

  // 只保留「本次仍要隔离安装」的链接，其余历史链接（含已消解冲突）全部回收
  pruneStaleConflictLinks(
    packageName,
    workingDir,
    new Set(
      conflicts
        .filter(
          (conflict) =>
            (decisions.get(conflict.name)?.action ?? 'install') === 'install',
        )
        .map((conflict) => conflict.name),
    ),
  );

  for (const conflict of conflicts) {
    const action = decisions.get(conflict.name)?.action ?? 'install';
    const linkPath = join(nlmPkgNodeModules, conflict.name);

    if (action === 'skip') {
      // 不建链：历史链接必须移除，否则仍会抢先解析到旧副本
      if (isSymlink(linkPath)) {
        removeSync(linkPath);
      }
      continue;
    }

    const targetPath =
      action === 'host'
        ? getAppPackageEntity(workingDir, conflict.name)
        : join(conflictNodeModules, conflict.name);

    // 目标不存在则跳过（可能安装失败 / app 侧缺失）
    if (!targetPath || !pathExistsSync(targetPath)) {
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
 * 从项目目录向上逐级查找已安装的依赖路径
 * 覆盖 workspace 子包 / monorepo 提升（node_modules 不在当前工作目录）的场景，
 * 与 Node 自身的向上查找语义保持一致（限制层数防御异常目录结构）
 */
const resolveAppPackageDir = (
  workingDir: string,
  depName: string,
): string | null => {
  let currentDir = workingDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(currentDir, 'node_modules', depName);
    if (pathExistsSync(candidate)) {
      return candidate;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return null;
};

/**
 * 获取 app 中已安装包的实际实体路径
 * app 顶层为软链（pnpm / cnpm 等布局）时解析为真实实体，避免链接套链接
 */
const getAppPackageEntity = (
  workingDir: string,
  depName: string,
): string | null => {
  const appPackagePath = resolveAppPackageDir(workingDir, depName);
  if (!appPackagePath) {
    return null;
  }
  if (!isSymlink(appPackagePath)) {
    return appPackagePath;
  }
  try {
    return fs.realpathSync(appPackagePath);
  } catch {
    return appPackagePath;
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
    return withProjectLock(workingDir, async () => {
      if (canSafelyCleanupConflictLinks(packageName, nlmPkg, workingDir)) {
        cleanupConflictState(packageName, workingDir);
      }
      return false;
    });
  }

  // 冲突处理会写入 .nlm/.conflict-deps 与链接，全部纳入项目锁（防并行进程互踩）
  await withProjectLock(workingDir, () =>
    handleDependencyConflicts(packageName, conflicts, workingDir),
  );
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
