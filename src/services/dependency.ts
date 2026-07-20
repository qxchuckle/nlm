import { execSync } from 'child_process';
import { join, relative, dirname } from 'path';
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
 * 优先 .conflict-deps/<pkg>/node_modules（npm symlink 场景）
 * 回退 app/node_modules/nlm-cd-<pkg>/node_modules（fnpm 复制场景）
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
 * 通过包装包在 app 目录安装冲突依赖，利用 npm 原生嵌套+去重机制复用 app 已有依赖
 *
 * 流程：
 * 1. 创建 .nlm/.conflict-deps/<pkg>/package.json（声明冲突依赖）
 * 2. 在 app 目录执行 npm install file:.nlm/.conflict-deps/<pkg> --no-save
 * 3. npm 将冲突版本嵌套到 .nlm/.conflict-deps/<pkg>/node_modules/
 * 4. 创建 symlink：.nlm/<pkg>/node_modules/<dep> → ../../.conflict-deps/<pkg>/node_modules/<dep>
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

  if (needInstall.length === 0) {
    // 所有冲突依赖已安装，检查 app node_modules 中的包装包 symlink 是否存在
    // 如果不存在（被 app 的 npm install 清掉），需要重新安装以恢复 hoisted 传递依赖
    const appSymlinkPath = getConflictDepsNodeModulesPath(
      workingDir,
      packageName,
    );
    if (pathExistsSync(appSymlinkPath)) {
      // symlink 存在，只需确保 nlm 包的 symlink 存在
      await createConflictDepSymlinks(packageName, conflicts, workingDir);
      return;
    }
    // symlink 不存在，需要重新安装（下方逻辑）
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

  const pm = getActualPackageManager(workingDir);

  // 在 app 目录执行安装（利用 npm 原生去重）
  const relativePath = relative(workingDir, conflictPkgDir);
  try {
    await runConflictDepsInstall(pm, relativePath, workingDir);
  } catch (error) {
    logger.error(t('depInstallFailed'));
    throw error;
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
 * 执行冲突依赖安装命令
 * 使用 file: 协议在 app 目录安装包装包，利用 npm 原生嵌套去重
 */
const runConflictDepsInstall = (
  pm: string,
  relativePkgPath: string,
  cwd: string,
): Promise<void> => {
  const command = `${pm} install file:${relativePkgPath} --no-save --legacy-peer-deps`;
  logger.info(t('depDebugRunCommand', { cmd: logger.cmd(command) }));
  execSync(command, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
  return Promise.resolve();
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
 */
export const runInstall = async (
  workingDir: string,
  packageNames: string[],
): Promise<void> => {
  const pm = getActualPackageManager(workingDir);
  if (packageNames.length === 0) {
    return;
  }
  const command = `${pm} install ${packageNames.join(' ')} --legacy-peer-deps`;
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
