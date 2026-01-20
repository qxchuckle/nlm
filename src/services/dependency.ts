import { spawn, execSync } from 'child_process';
import { join } from 'path';
import {
  DependencyConflict,
  Dependencies,
  PackageManifest,
  NlmError,
} from '../types';
import { readPackageManifest } from '../utils/package';
import { areVersionRangesCompatible, satisfiesVersion } from '../utils/version';
import { getConfiguredPackageManager } from '../core/config';
import { ensureDirSync, pathExistsSync } from '../utils/file';
import { getProjectNlmDir } from '../constants';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

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

    // 检查版本范围是否兼容（有交集）
    if (!areVersionRangesCompatible(requiredVersion, installedVersion)) {
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
 * 在 .nlm/包名/node_modules 中安装冲突版本的依赖
 * 会先检查已安装的版本是否满足要求，避免重复安装
 */
export const handleDependencyConflicts = async (
  packageName: string,
  conflicts: DependencyConflict[],
  workingDir: string,
): Promise<void> => {
  if (conflicts.length === 0) {
    return;
  }

  // nlm 包目录
  const nlmPkgDir = join(getProjectNlmDir(workingDir), packageName);
  // node_modules 目录（用于检查已安装的依赖）
  const nodeModulesDir = join(nlmPkgDir, 'node_modules');

  // 过滤出真正需要安装的依赖（已安装的版本不满足要求）
  const needInstall = filterConflictsNeedInstall(conflicts, nodeModulesDir);

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

  ensureDirSync(nlmPkgDir);

  // 获取配置的包管理器
  const pm = getConfiguredPackageManager(workingDir);

  // 收集所有需要安装的依赖
  const depSpecs = needInstall.map(
    (conflict) => `${conflict.name}@${conflict.requiredVersion}`,
  );

  try {
    await runInstallCommand(pm, depSpecs, nlmPkgDir);
  } catch (error) {
    logger.error(t('depInstallFailed'));
    throw error;
  }
};

/**
 * 过滤出真正需要安装的冲突依赖
 * 检查 nlmPackageDir/node_modules 中已安装的版本是否满足要求
 */
const filterConflictsNeedInstall = (
  conflicts: DependencyConflict[],
  conflictDir: string,
): DependencyConflict[] => {
  return conflicts.filter((conflict) => {
    const installedPkgPath = join(conflictDir, conflict.name);

    // 如果目录不存在，需要安装
    if (!pathExistsSync(installedPkgPath)) {
      return true;
    }

    // 读取已安装的 package.json
    const installedPkg = readPackageManifest(installedPkgPath);
    if (!installedPkg || !installedPkg.version) {
      return true;
    }

    // 检查已安装的版本是否满足 nlm 包要求的版本范围
    const isCompatible = satisfiesVersion(
      installedPkg.version,
      conflict.requiredVersion,
    );

    return !isCompatible;
  });
};

/**
 * 执行安装命令并等待完成
 */
const runInstallCommand = (
  pm: string,
  packageSpecs: string[],
  cwd: string,
): Promise<void> => {
  if (packageSpecs.length === 0) {
    return Promise.resolve();
  }
  const { cmd, args } = getInstallCommand(pm, packageSpecs);
  const command = `${cmd} ${args.join(' ')}`;
  logger.info(t('depDebugRunCommand', { cmd: logger.cmd(command) }));
  execSync(command, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
  return Promise.resolve();
};

/**
 * 执行包管理器安装命令，安装指定的包
 */
export const runInstall = async (
  workingDir: string,
  packageNames: string[],
): Promise<void> => {
  const pm = getConfiguredPackageManager(workingDir);
  await runInstallCommand(pm, packageNames, workingDir);
};

/**
 * 获取包管理器的安装命令
 * 添加 --legacy-peer-deps 等标志跳过 peer dependency 检查
 */
const getInstallCommand = (
  pm: string,
  packageSpecs: string[],
): { cmd: string; args: string[] } => {
  return {
    cmd: pm,
    args: ['install', ...packageSpecs, '--legacy-peer-deps'],
  };
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
