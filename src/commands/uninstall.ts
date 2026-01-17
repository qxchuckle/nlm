import { join } from 'path';
import { NlmError } from '../types';
import { PROJECT_NLM_DIR, getProjectPackageDir } from '../constants';
import {
  parsePackageName,
  isValidProject,
  isScopedPackage,
  getPackageScope,
} from '../utils/package';
import { removeSync, pathExistsSync, readdirSync } from '../utils/file';
import { removePackageUsage } from '../core/store';
import {
  removePackageFromLockfile,
  isPackageInLockfile,
  getLockfilePackageNames,
} from '../core/lockfile';
import { getRuntime } from '../core/runtime';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

/**
 * 执行 uninstall 命令
 */
export const uninstall = async (packageName: string): Promise<void> => {
  const { workingDir } = getRuntime();

  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProjectSimple'));
  }

  // 解析包名
  const { name } = parsePackageName(packageName);

  if (!name) {
    throw new NlmError(t('errInvalidPackageName', { name: packageName }));
  }

  // 检查包是否已安装
  if (!isPackageInLockfile(workingDir, name)) {
    throw new NlmError(t('uninstallNotInstalled', { pkg: logger.pkg(name) }));
  }

  const startTime = Date.now();
  logger.spin(t('uninstallPackage', { pkg: logger.pkg(name) }));

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

  // 从 .nlm 目录中移除包（包括所有版本）
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
  removePackageFromLockfile(workingDir, name);

  // 从 store 的使用记录中移除
  removePackageUsage(name, workingDir);

  // 检查 .nlm 目录是否为空
  const nlmDir = join(workingDir, PROJECT_NLM_DIR);
  if (pathExistsSync(nlmDir)) {
    const remaining = getLockfilePackageNames(workingDir);
    if (remaining.length === 0) {
      // 目录可能只剩下配置文件，保留它
      const contents = readdirSync(nlmDir);
      if (contents.length === 0) {
        removeSync(nlmDir);
      }
    }
  }

  logger.spinSuccess(
    t('uninstallComplete', {
      pkg: `${logger.pkg(name)} ${logger.duration(startTime)}`,
    }),
  );
  logger.warn(t('uninstallNote'));
};

export default uninstall;
