import { join } from 'path';
import { UpdateOptions } from '../types';
import { LATEST_VERSION, getPackageStoreDir } from '../constants';
import { parsePackageName, readPackageManifest, isValidProject } from '../utils/package';
import { getLatestVersion } from '../utils/version';
import {
  packageExistsInStore,
  packageVersionExistsInStore,
} from '../core/store';
import {
  readLockfile,
  getLockfilePackageNames,
  getLockfilePackage,
  addPackageToLockfile,
  isPackageInLockfile,
} from '../core/lockfile';
import { copyPackageToProject, getStorePackageSignature } from '../services/copy';
import { detectDependencyConflicts, handleDependencyConflicts } from '../services/dependency';
import { replaceNestedPackages } from '../services/nested';
import logger from '../utils/logger';

/**
 * 执行 update 命令
 * 根据 nlm-lock.json 更新依赖
 */
export const update = async (options: UpdateOptions): Promise<void> => {
  const { workingDir, packageName, force = false } = options;
  
  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    logger.error('当前目录不是有效的项目（缺少 package.json 或 node_modules）');
    process.exit(1);
  }
  
  // 获取要更新的包列表
  let packagesToUpdate: string[] = [];
  
  if (packageName) {
    // 更新指定包
    const { name } = parsePackageName(packageName);
    
    if (!isPackageInLockfile(workingDir, name)) {
      logger.error(`包 ${logger.pkg(name)} 未安装，请先使用 ${logger.cmd('nlm install')} 安装`);
      process.exit(1);
    }
    
    packagesToUpdate = [name];
  } else {
    // 更新所有包
    packagesToUpdate = getLockfilePackageNames(workingDir);
  }
  
  if (packagesToUpdate.length === 0) {
    logger.info('没有已安装的 nlm 包');
    return;
  }
  
  logger.info(`更新 ${packagesToUpdate.length} 个包...`);
  
  const projectPkg = readPackageManifest(workingDir);
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const name of packagesToUpdate) {
    try {
      const result = await updateSinglePackage(name, workingDir, force, projectPkg);
      if (result) {
        updatedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      logger.error(`更新 ${logger.pkg(name)} 失败: ${error}`);
    }
  }
  
  logger.success(`更新完成: ${updatedCount} 个更新, ${skippedCount} 个跳过`);
};

/**
 * 更新单个包
 */
const updateSinglePackage = async (
  name: string,
  workingDir: string,
  force: boolean,
  projectPkg: ReturnType<typeof readPackageManifest>
): Promise<boolean> => {
  // 检查包是否存在于 store
  if (!packageExistsInStore(name)) {
    logger.warn(`包 ${logger.pkg(name)} 不存在于 store，跳过`);
    return false;
  }
  
  // 获取 lockfile 中的版本信息
  const lockEntry = getLockfilePackage(workingDir, name);
  if (!lockEntry) {
    logger.warn(`包 ${logger.pkg(name)} 不在 lockfile 中，跳过`);
    return false;
  }
  
  // 确定要安装的版本
  let versionToInstall = lockEntry.version;
  
  if (versionToInstall === LATEST_VERSION) {
    const packageDir = getPackageStoreDir(name);
    const latestVersion = getLatestVersion(packageDir);
    
    if (!latestVersion) {
      logger.warn(`包 ${logger.pkg(name)} 没有可用版本，跳过`);
      return false;
    }
    
    versionToInstall = latestVersion;
  }
  
  // 检查版本是否存在
  if (!packageVersionExistsInStore(name, versionToInstall)) {
    logger.warn(`版本 ${logger.version(versionToInstall)} 不存在，跳过`);
    return false;
  }
  
  // 检查 signature 是否相同
  const storeSignature = getStorePackageSignature(name, versionToInstall);
  
  if (!force && lockEntry.signature === storeSignature) {
    logger.debug(`${logger.pkg(name)} 已是最新，跳过`);
    return false;
  }
  
  logger.info(`更新 ${logger.pkg(name)}@${logger.version(versionToInstall)}`);
  
  // 复制包到 node_modules
  const copyResult = await copyPackageToProject(name, versionToInstall, workingDir, force);
  
  // 处理依赖冲突
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
  
  // 更新 lockfile 中的 signature
  addPackageToLockfile(workingDir, name, {
    version: lockEntry.version,
    signature: copyResult.signature,
  });
  
  return true;
};

export default update;
