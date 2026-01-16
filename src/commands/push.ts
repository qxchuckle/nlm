import { PushOptions } from '../types';
import { readPackageManifest } from '../utils/package';
import { copyPackageToStore, copyPackageToProject } from '../services/copy';
import {
  setPackageTarget,
  getPackageUsages,
  packageVersionExistsInStore,
} from '../core/store';
import { getLockfilePackage } from '../core/lockfile';
import logger from '../utils/logger';

/**
 * 执行 push 命令
 * 将当前包推送到全局 store，并更新所有使用此包的项目
 */
export const push = async (options: PushOptions): Promise<void> => {
  const { workingDir, force = false } = options;
  
  // 读取当前包的 package.json
  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    logger.error('当前目录不是有效的 npm 包（缺少 package.json 或格式错误）');
    process.exit(1);
  }
  
  const { name, version } = pkg;
  logger.info(`推送 ${logger.pkg(name)}@${logger.version(version)}`);
  
  // 复制包到 store
  let copyResult;
  try {
    copyResult = await copyPackageToStore(workingDir, force);
  } catch (error) {
    logger.error(`推送失败: ${error}`);
    process.exit(1);
  }
  
  // 更新 store 配置中的 target 路径
  setPackageTarget(name, workingDir);
  
  // 如果内容没有变化且不是强制模式，跳过更新项目
  if (!copyResult.changed && !force) {
    logger.info('包内容未变化，跳过更新项目');
    return;
  }
  
  // 获取所有使用此包的项目并更新
  const usages = getPackageUsages(name);
  
  if (usages.length === 0) {
    logger.info('没有项目使用此包');
    return;
  }
  
  logger.info(`正在更新 ${usages.length} 个项目...`);
  
  for (const projectPath of usages) {
    try {
      // 检查项目中安装的版本
      const lockEntry = getLockfilePackage(projectPath, name);
      
      if (!lockEntry) {
        logger.warn(`${logger.path(projectPath)} 未安装此包，跳过`);
        continue;
      }
      
      const installedVersion = lockEntry.version === 'latest' ? version : lockEntry.version;
      
      // 检查版本是否存在
      if (!packageVersionExistsInStore(name, installedVersion)) {
        logger.warn(
          `${logger.path(projectPath)} 依赖的版本 ${installedVersion} 不存在，跳过`
        );
        continue;
      }
      
      // 更新项目中的包
      await copyPackageToProject(name, installedVersion, projectPath, force);
      
      logger.success(`已更新 ${logger.path(projectPath)}`);
    } catch (error) {
      logger.error(`更新 ${projectPath} 失败: ${error}`);
    }
  }
  
  logger.success(`推送完成`);
};

export default push;
