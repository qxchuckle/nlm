import { NlmError } from '../types';
import { getProjectPackageDir } from '../constants';
import {
  parsePackageName,
  isValidProject,
  validatePackageNameIsInstalled,
} from '../utils/package';
import { resolveVersion } from '../utils/version';
import { packageExistsInStore, getPackageVersionsInStore } from '../core/store';
import {
  getLockfilePackageNames,
  getLockfilePackage,
  addPackageToLockfile,
  isPackageInLockfile,
} from '../core/lockfile';
import {
  copyPackageToProject,
  getStorePackageSignature,
} from '../services/copy';
import { checkAndHandleDependencyConflicts } from '../services/dependency';
import { replaceNestedPackages } from '../services/nested';
import { getRuntime } from '../core/runtime';
import logger from '../utils/logger';
import { t } from '../utils/i18n';
import chalk from 'chalk';

/**
 * 执行 update 命令
 * 根据 nlm-lock.json 更新依赖
 */
export const update = async (packageNames?: string[]): Promise<void> => {
  const { workingDir } = getRuntime();

  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProject'));
  }

  // 获取要更新的包列表
  let packagesToUpdate: string[] = [];

  if (packageNames && packageNames.length > 0) {
    // 更新指定的包
    for (const packageName of packageNames) {
      const name = validatePackageNameIsInstalled(workingDir, packageName);
      packagesToUpdate.push(name);
    }
  } else {
    // 更新所有包
    packagesToUpdate = getLockfilePackageNames(workingDir);
  }

  if (packagesToUpdate.length === 0) {
    logger.info(t('updateNoPackages'));
    return;
  }

  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < packagesToUpdate.length; i++) {
    const name = packagesToUpdate[i];
    const startTime = Date.now();
    logger.spin(
      t('updatePackage', {
        current: i + 1,
        total: packagesToUpdate.length,
        pkg: logger.pkg(name),
      }),
    );

    try {
      const result = await updateSinglePackage(name);
      if (result) {
        logger.spinSuccess(
          t('updateUpdated', {
            pkg: `${logger.pkg(name)} ${logger.duration(startTime)}`,
          }),
        );
        updatedCount++;
      } else {
        logger.spinInfo(
          t('updateUpToDate', {
            pkg: `${logger.pkg(name)} ${logger.duration(startTime)}`,
          }),
        );
        skippedCount++;
      }
    } catch (error) {
      logger.spinFail(
        t('updateFailed', { pkg: logger.pkg(name), error: String(error) }),
      );
    }
  }

  logger.success(
    t('updateComplete', { updated: updatedCount, skipped: skippedCount }),
  );
};

/**
 * 更新单个包
 */
export const updateSinglePackage = async (name: string): Promise<boolean> => {
  const { workingDir, force } = getRuntime();
  // 检查包是否存在于 store
  if (!packageExistsInStore(name)) {
    logger.warn(t('updateNotInStore', { pkg: logger.pkg(name) }));
    return false;
  }

  // 获取 lockfile 中的版本信息
  const lockEntry = getLockfilePackage(workingDir, name);
  if (!lockEntry) {
    logger.warn(t('updateNotInLockfile', { pkg: logger.pkg(name) }));
    return false;
  }

  // 确定要安装的版本
  const availableVersions = getPackageVersionsInStore(name);
  const resolved = resolveVersion(lockEntry.version, availableVersions);

  if (!resolved) {
    logger.warn(
      t('updateNoMatchVersion', {
        pkg: logger.pkg(name),
        version: logger.version(lockEntry.version),
      }),
    );
    return false;
  }

  const versionToInstall = resolved.version;

  // 检查 signature 是否相同
  // const storeSignature = getStorePackageSignature(name, versionToInstall);

  // if (!force && lockEntry.signature === storeSignature) {
  //   logger.debug(t('updateUpToDate', { pkg: logger.pkg(name) }));
  //   return false;
  // }

  logger.info(
    t('updateSingle', { pkg: logger.pkg(name, versionToInstall) }),
    chalk.gray('→'),
    logger.path(workingDir),
  );

  // 复制包到 .nlm 并在 node_modules 中创建软链接
  let startTime = Date.now();
  const copyResult = await copyPackageToProject(name, versionToInstall);
  logger.debug('copy', logger.duration(startTime));

  // 获取 .nlm 中的实际包路径
  const nlmPackageDir = getProjectPackageDir(workingDir, name);

  // 处理依赖冲突
  await checkAndHandleDependencyConflicts(name, nlmPackageDir, workingDir);

  startTime = Date.now();
  // 替换嵌套的同名包（使用软链接）
  await replaceNestedPackages(workingDir, name, nlmPackageDir);
  logger.debug('replaceNested', logger.duration(startTime));

  // 更新 lockfile 中的 signature
  addPackageToLockfile(workingDir, name, {
    version: lockEntry.version,
    signature: copyResult.signature,
  });
  return true;
};

export default update;
