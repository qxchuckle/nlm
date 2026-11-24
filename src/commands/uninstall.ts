import fs from 'fs-extra';
import { dirname, join, resolve } from 'path';
import { NlmError } from '../types';
import {
  PROJECT_NLM_DIR,
  getProjectPackageDir,
  getConflictDepsPackageDir,
  getConflictDepsNodeModulesPath,
} from '../constants';
import {
  isValidProject,
  isScopedPackage,
  getPackageScope,
  validatePackageNameIsInstalled,
} from '../utils/package';
import {
  removeSync,
  pathExistsSync,
  readdirSync,
  isSymlink,
} from '../utils/file';
import { removePackageUsage } from '../core/store';
import {
  removePackageFromLockfile,
  getLockfilePackageNames,
  getLockfilePackage,
} from '../core/lockfile';
import { getRuntime } from '../core/runtime';
import { withProjectLock } from '../utils/lock';
import logger from '../utils/logger';
import { t } from '../utils/i18n';
import { promptMultiSelectPro } from '../utils/prompt';
import { runInstall } from '../services/dependency';

export interface UninstallOptions {
  install?: boolean;
}

/**
 * 回收安装时替换的嵌套软链
 * 原始嵌套副本已被删除，只能移除指向 .nlm 的软链，交由包管理器重装恢复
 */
const removeNestedLinks = (
  workingDir: string,
  packageName: string,
  nestedPaths?: string[],
): void => {
  if (!nestedPaths || nestedPaths.length === 0) return;
  const nlmPkgDir = resolve(getProjectPackageDir(workingDir, packageName));
  let removed = 0;
  for (const relativePath of nestedPaths) {
    const linkPath = join(workingDir, relativePath);
    if (!isSymlink(linkPath)) continue;
    try {
      const linkTarget = fs.readlinkSync(linkPath);
      const resolvedTarget = resolve(dirname(linkPath), linkTarget);
      if (resolvedTarget !== nlmPkgDir) continue;
      removeSync(linkPath);
      removed += 1;
    } catch {
      // 无法读取的链接跳过
    }
  }
  if (removed > 0) {
    logger.warn(t('uninstallNestedRestored', { count: removed }));
  }
};

/**
 * 卸载单个包
 */
const uninstallPackage = (workingDir: string, name: string): void => {
  // 先取 lockfile 记录（含嵌套替换路径），后续步骤会移除该条目
  const lockEntry = getLockfilePackage(workingDir, name);

  // 从 node_modules 中移除软链接
  const nodeModulesPath = join(workingDir, 'node_modules', name);
  if (pathExistsSync(nodeModulesPath)) {
    removeSync(nodeModulesPath);

    // 如果是 scoped 包，检查 scope 目录是否为空
    if (isScopedPackage(name)) {
      const scope = getPackageScope(name);
      if (scope) {
        const scopeDir = join(workingDir, 'node_modules', scope);
        const scopeContents = readdirSync(scopeDir);
        if (scopeContents.length === 0) {
          removeSync(scopeDir);
        }
      }
    }
  }

  // 从 .nlm 目录中移除包
  const nlmPackageDir = getProjectPackageDir(workingDir, name);
  if (pathExistsSync(nlmPackageDir)) {
    removeSync(nlmPackageDir);

    // 如果是 scoped 包，检查 scope 目录是否为空
    if (isScopedPackage(name)) {
      const scope = getPackageScope(name);
      if (scope) {
        const scopeDir = join(workingDir, PROJECT_NLM_DIR, scope);
        if (pathExistsSync(scopeDir)) {
          const scopeContents = readdirSync(scopeDir);
          if (scopeContents.length === 0) {
            removeSync(scopeDir);
          }
        }
      }
    }
  }

  // 从 lockfile 中移除
  removePackageFromLockfile(workingDir, name, true);

  // 从 store 的使用记录中移除
  removePackageUsage(name, workingDir);

  // 清理冲突依赖包装包
  const conflictDepsDir = getConflictDepsPackageDir(workingDir, name);
  if (pathExistsSync(conflictDepsDir)) {
    removeSync(conflictDepsDir);
  }

  // 清理 app node_modules 中的包装包 symlink
  const conflictNmPath = getConflictDepsNodeModulesPath(workingDir, name);
  if (pathExistsSync(conflictNmPath)) {
    removeSync(conflictNmPath);
  }

  // 回收安装时替换的嵌套软链（否则卸载后会在 app 树里留下悬空链接）
  removeNestedLinks(workingDir, name, lockEntry?.nestedPaths);
};

/**
 * 执行 uninstall 命令
 */
export const uninstall = async (
  packageNames: string[],
  options: UninstallOptions = {},
): Promise<void> => {
  const { workingDir } = getRuntime();

  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProjectSimple'));
  }

  // 如果没有指定包名，交互式选择
  let targetPackages = packageNames;
  if (targetPackages.length === 0) {
    const installedPackages = getLockfilePackageNames(workingDir);
    if (installedPackages.length === 0) {
      logger.info(t('uninstallNoPackages'));
      return;
    }
    const selected = await promptMultiSelectPro(
      t('uninstallSelectPackages'),
      installedPackages,
    );
    if (selected.length === 0) {
      logger.info(t('uninstallCancelled'));
      return;
    }
    targetPackages = selected;
  }

  // 验证并解析所有包名
  const validNames: string[] = [];
  for (const packageName of targetPackages) {
    try {
      const name = validatePackageNameIsInstalled(workingDir, packageName);
      validNames.push(name);
    } catch (error) {
      logger.error(error instanceof NlmError ? error.message : String(error));
    }
  }

  if (validNames.length === 0) {
    logger.warn(t('uninstallNoPackages'));
    return;
  }

  const startTime = Date.now();
  const pkgListStr = validNames.map((n) => logger.pkg(n)).join(' ');
  logger.spin(t('uninstallPackage', { pkg: pkgListStr }));

  // 卸载所有包（.nlm 域写操作纳入项目锁，防与其它 nlm 进程互踩）
  await withProjectLock(workingDir, async () => {
    for (const name of validNames) {
      uninstallPackage(workingDir, name);
    }
  });

  // 检查 .nlm 目录是否为空
  // const nlmDir = join(workingDir, PROJECT_NLM_DIR);
  // if (pathExistsSync(nlmDir)) {
  //   const remaining = getLockfilePackageNames(workingDir);
  //   if (remaining.length === 0) {
  //     // 目录可能只剩下配置文件，保留它
  //     const contents = readdirSync(nlmDir);
  //     if (contents.length === 0) {
  //       removeSync(nlmDir);
  //     }
  //   }
  // }

  logger.spinSuccess(
    t('uninstallComplete', {
      pkg: `${pkgListStr} ${logger.duration(startTime)}`,
    }),
  );

  // 如果指定了 -i 参数，自动从 npm 安装被卸载的包
  if (options.install) {
    logger.spin(t('uninstallInstalling', { pkg: pkgListStr }));
    await runInstall(workingDir, validNames);
    logger.spinSuccess(t('uninstallInstallComplete', { pkg: pkgListStr }));
  } else {
    logger.warn(t('uninstallNote'));
  }
};

export default uninstall;
