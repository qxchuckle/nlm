import { join } from 'path';
import { InstallOptions } from '../types';
import { LATEST_VERSION, getPackageStoreDir } from '../constants';
import {
  parsePackageName,
  readPackageManifest,
  isValidProject,
} from '../utils/package';
import { getLatestVersion } from '../utils/version';
import { pathExistsSync } from '../utils/file';
import {
  packageExistsInStore,
  packageVersionExistsInStore,
  addPackageUsage,
  getPackageVersionsInStore,
} from '../core/store';
import {
  addPackageToLockfile,
  getLockfilePackage,
  isPackageInLockfile,
} from '../core/lockfile';
import {
  copyPackageToProject,
  getStorePackageSignature,
} from '../services/copy';
import {
  detectDependencyConflicts,
  handleDependencyConflicts,
} from '../services/dependency';
import { replaceNestedPackages } from '../services/nested';
import { update } from './update';
import logger from '../utils/logger';

/**
 * 执行 install 命令
 */
export const install = async (options: InstallOptions): Promise<void> => {
  const { workingDir, packageName, force = false } = options;

  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    logger.error('当前目录不是有效的项目（缺少 package.json 或 node_modules）');
    logger.info('请先运行 npm install / yarn / pnpm install');
    process.exit(1);
  }

  // 如果没有指定包名，走 update 流程
  if (!packageName) {
    logger.info('未指定包名，更新所有已安装的 nlm 包...');
    await update({ workingDir, force });
    return;
  }

  // 解析包名和版本
  const { name, version: requestedVersion } = parsePackageName(packageName);

  if (!name) {
    logger.error(`无效的包名: ${packageName}`);
    process.exit(1);
  }

  // 检查包是否存在于 store
  if (!packageExistsInStore(name)) {
    logger.error(`包 ${logger.pkg(name)} 不存在于 store`);
    logger.info(`请先在 ${name} 项目中运行 ${logger.cmd('nlm push')}`);
    process.exit(1);
  }

  // 确定要安装的版本
  let versionToInstall = requestedVersion || LATEST_VERSION;

  if (versionToInstall === LATEST_VERSION) {
    // 获取最新版本
    const packageDir = getPackageStoreDir(name);
    const latestVersion = getLatestVersion(packageDir);

    if (!latestVersion) {
      logger.error(`包 ${logger.pkg(name)} 没有可用版本`);
      process.exit(1);
    }

    versionToInstall = latestVersion;
    logger.info(`使用最新版本: ${logger.version(versionToInstall)}`);
  } else {
    // 检查指定版本是否存在
    if (!packageVersionExistsInStore(name, versionToInstall)) {
      logger.error(`版本 ${logger.version(versionToInstall)} 不存在`);

      const availableVersions = getPackageVersionsInStore(name);
      if (availableVersions.length > 0) {
        logger.info(`可用版本: ${availableVersions.join(', ')}`);
      }

      process.exit(1);
    }
  }

  // 检查是否已安装且 signature 相同
  if (!force && isPackageInLockfile(workingDir, name)) {
    const lockEntry = getLockfilePackage(workingDir, name);
    const storeSignature = getStorePackageSignature(name, versionToInstall);

    if (lockEntry?.signature === storeSignature) {
      logger.info(
        `${logger.pkg(name)}@${logger.version(versionToInstall)} 已是最新`,
      );
      return;
    }
  }

  logger.info(`安装 ${logger.pkg(name)}@${logger.version(versionToInstall)}`);

  // 复制包到 node_modules
  const copyResult = await copyPackageToProject(
    name,
    versionToInstall,
    workingDir,
    force,
  );

  // 处理依赖冲突
  const projectPkg = readPackageManifest(workingDir);
  const nlmPkgPath = join(workingDir, 'node_modules', name);
  const nlmPkg = readPackageManifest(nlmPkgPath);

  if (projectPkg && nlmPkg) {
    const conflicts = detectDependencyConflicts(nlmPkg, projectPkg);
    if (conflicts.length > 0) {
      await handleDependencyConflicts(name, conflicts, workingDir);
    }
  }

  // 替换嵌套的同名包
  const nlmPackageDir = join(workingDir, 'node_modules', name);
  await replaceNestedPackages(workingDir, name, nlmPackageDir);

  // 更新 lockfile
  addPackageToLockfile(workingDir, name, {
    version: requestedVersion || LATEST_VERSION,
    signature: copyResult.signature,
  });

  // 更新 store 使用记录
  addPackageUsage(name, workingDir);

  logger.success(`安装完成`);
};

export default install;
