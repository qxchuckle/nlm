import { join } from 'path';
import fs from 'fs-extra';
import {
  pathExistsSync,
  readdirSync,
  statSync,
  removeSync,
} from '../utils/file';
import logger from '../utils/logger';

/**
 * 查找 node_modules 中所有同名包的路径
 * 递归搜索嵌套的 node_modules
 */
export const findAllNestedPackages = (
  nodeModulesDir: string,
  packageName: string,
  results: string[] = [],
): string[] => {
  if (!pathExistsSync(nodeModulesDir)) {
    return results;
  }

  // 检查当前层级是否有目标包
  const targetPath = join(nodeModulesDir, packageName);
  if (pathExistsSync(targetPath)) {
    results.push(targetPath);
  }

  // 遍历当前 node_modules 下的所有目录
  const items = readdirSync(nodeModulesDir);

  for (const item of items) {
    const itemPath = join(nodeModulesDir, item);
    const stats = statSync(itemPath);

    if (!stats?.isDirectory()) {
      continue;
    }

    if (item.startsWith('@')) {
      // scoped 包目录，遍历其子目录
      const scopedItems = readdirSync(itemPath);
      for (const scopedItem of scopedItems) {
        const scopedItemPath = join(itemPath, scopedItem);
        const nestedNodeModules = join(scopedItemPath, 'node_modules');
        findAllNestedPackages(nestedNodeModules, packageName, results);
      }
    } else if (item !== packageName) {
      // 普通包目录，检查其 node_modules
      const nestedNodeModules = join(itemPath, 'node_modules');
      findAllNestedPackages(nestedNodeModules, packageName, results);
    }
  }

  return results;
};

/**
 * 替换所有嵌套的同名包
 * 将嵌套包指向 nlm 安装的版本
 */
export const replaceNestedPackages = async (
  workingDir: string,
  packageName: string,
  sourceDir: string,
): Promise<number> => {
  const nodeModulesDir = join(workingDir, 'node_modules');

  // 查找所有嵌套的同名包（排除顶层）
  const allPaths = findAllNestedPackages(nodeModulesDir, packageName);
  const topLevelPath = join(nodeModulesDir, packageName);
  const nestedPaths = allPaths.filter((p) => p !== topLevelPath);

  if (nestedPaths.length === 0) {
    return 0;
  }

  logger.info(`发现 ${nestedPaths.length} 个嵌套的 ${logger.pkg(packageName)}`);

  // 替换所有嵌套包
  let replaced = 0;
  for (const nestedPath of nestedPaths) {
    try {
      // 删除嵌套包
      removeSync(nestedPath);

      // 复制 nlm 版本到嵌套位置
      await fs.copy(sourceDir, nestedPath);

      logger.debug(`已替换: ${logger.path(nestedPath)}`);
      replaced++;
    } catch (error) {
      logger.warn(`替换失败: ${nestedPath}`);
      logger.debug(String(error));
    }
  }

  if (replaced > 0) {
    logger.success(`已替换 ${replaced} 个嵌套包`);
  }

  return replaced;
};

/**
 * 检查是否存在嵌套的同名包
 */
export const hasNestedPackages = (
  workingDir: string,
  packageName: string,
): boolean => {
  const nodeModulesDir = join(workingDir, 'node_modules');
  const allPaths = findAllNestedPackages(nodeModulesDir, packageName);
  const topLevelPath = join(nodeModulesDir, packageName);
  return allPaths.some((p) => p !== topLevelPath);
};

/**
 * 获取嵌套包的数量
 */
export const getNestedPackageCount = (
  workingDir: string,
  packageName: string,
): number => {
  const nodeModulesDir = join(workingDir, 'node_modules');
  const allPaths = findAllNestedPackages(nodeModulesDir, packageName);
  const topLevelPath = join(nodeModulesDir, packageName);
  return allPaths.filter((p) => p !== topLevelPath).length;
};
