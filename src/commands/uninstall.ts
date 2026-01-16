import { join } from 'path';
import { UninstallOptions } from '../types';
import { PROJECT_NLM_DIR } from '../constants';
import { parsePackageName, isValidProject, isScopedPackage, getPackageScope } from '../utils/package';
import { removeSync, pathExistsSync, readdirSync } from '../utils/file';
import { removePackageUsage } from '../core/store';
import { removePackageFromLockfile, isPackageInLockfile, getLockfilePackageNames } from '../core/lockfile';
import logger from '../utils/logger';

/**
 * 执行 uninstall 命令
 */
export const uninstall = async (options: UninstallOptions): Promise<void> => {
  const { workingDir, packageName } = options;
  
  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    logger.error('当前目录不是有效的项目');
    process.exit(1);
  }
  
  // 解析包名
  const { name } = parsePackageName(packageName);
  
  if (!name) {
    logger.error(`无效的包名: ${packageName}`);
    process.exit(1);
  }
  
  // 检查包是否已安装
  if (!isPackageInLockfile(workingDir, name)) {
    logger.error(`包 ${logger.pkg(name)} 未通过 nlm 安装`);
    process.exit(1);
  }
  
  logger.info(`卸载 ${logger.pkg(name)}`);
  
  // 从 node_modules 中移除包
  const nodeModulesPath = join(workingDir, 'node_modules', name);
  if (pathExistsSync(nodeModulesPath)) {
    removeSync(nodeModulesPath);
    logger.info(`已从 node_modules 移除 ${logger.pkg(name)}`);
    
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
  
  // 从 .nlm 目录中移除包相关文件（如冲突依赖目录）
  const nlmPackageDir = join(workingDir, PROJECT_NLM_DIR, name);
  if (pathExistsSync(nlmPackageDir)) {
    removeSync(nlmPackageDir);
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
  
  logger.success(`卸载完成`);
  logger.warn(`注意：请手动重新安装实际依赖（运行 npm install / yarn / pnpm install）`);
};

export default uninstall;
