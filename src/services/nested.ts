import { join, relative } from 'path';
import fs from 'fs-extra';
import {
  pathExistsSync,
  readdirWithFileTypesSync,
  removeSync,
} from '../utils/file';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

const IGNORED_DIRS = new Set(['.bin', '.cache', '@types']);

/**
 * 判断目录名是否应该跳过
 */
const shouldSkipDir = (name: string): boolean => {
  // 跳过指定的目录
  return IGNORED_DIRS.has(name);
};

/**
 * 查找 node_modules 中所有同名包的路径
 */
export const findAllNestedPackages = (
  nodeModulesDir: string,
  packageName: string,
  results: string[] = [],
  visitedDirs: Set<string> = new Set(), // 防止重复遍历
): string[] => {
  if (!pathExistsSync(nodeModulesDir) || visitedDirs.has(nodeModulesDir)) {
    return results;
  }

  visitedDirs.add(nodeModulesDir);

  // 使用栈进行深度优先遍历，避免递归过深
  const dirStack: Array<{ path: string; depth: number }> = [];
  dirStack.push({ path: nodeModulesDir, depth: 0 });

  // 可配置的最大深度，防止无限递归
  const MAX_DEPTH = 20;

  while (dirStack.length > 0) {
    const { path: currentDir, depth } = dirStack.pop()!;

    if (depth > MAX_DEPTH) {
      continue; // 跳过过深嵌套
    }

    // 检查当前目录下是否存在目标包
    const targetPath = join(currentDir, packageName);
    if (pathExistsSync(targetPath)) {
      results.push(targetPath);
    }

    // 读取当前目录
    let entries;
    try {
      entries = readdirWithFileTypesSync(currentDir);
    } catch (error) {
      // 忽略无法访问的目录
      continue;
    }

    // 记录当前目录下需要进一步探索的目录
    const subDirsToExplore: string[] = [];

    for (const entry of entries) {
      // 跳过非目录、软链接和需要忽略的目录
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        shouldSkipDir(entry.name)
      ) {
        continue;
      }

      const itemPath = join(currentDir, entry.name);

      // 检查是否已访问过
      if (visitedDirs.has(itemPath)) {
        continue;
      }
      visitedDirs.add(itemPath);

      // 检查当前条目是否有node_modules目录
      const nestedNodeModules = join(itemPath, 'node_modules');

      if (pathExistsSync(nestedNodeModules)) {
        // 如果存在node_modules，将其加入栈中
        if (!visitedDirs.has(nestedNodeModules)) {
          visitedDirs.add(nestedNodeModules);
          dirStack.push({
            path: nestedNodeModules,
            depth: depth + 1,
          });
        }
      } else {
        // 如果没有node_modules，将此目录加入待探索列表
        subDirsToExplore.push(itemPath);
      }
    }

    // 处理没有node_modules的目录
    for (const subDir of subDirsToExplore) {
      // 只探索没有node_modules的目录
      dirStack.push({
        path: subDir,
        depth: depth + 1,
      });
    }
  }

  return results;
};

/**
 * 替换所有嵌套的同名包
 * 将嵌套包指向 nlm 安装的版本（使用软链接）
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

  // logger.debug(t('nestedDebugPaths', { paths: nestedPaths.join('\n') }));

  logger.info(
    t('nestedFoundIndirectDeps', {
      count: nestedPaths.length,
      pkg: logger.pkg(packageName),
    }),
  );

  if (nestedPaths.length === 0) {
    return 0;
  }

  // 替换所有嵌套包（使用软链接）
  let replaced = 0;
  for (const nestedPath of nestedPaths) {
    try {
      // 删除嵌套包
      removeSync(nestedPath);

      // 创建软链接到 nlm 版本
      const relativeTarget = relative(join(nestedPath, '..'), sourceDir);
      await fs.symlink(relativeTarget, nestedPath, 'junction');

      logger.debug(
        t('nestedDebugReplaced', {
          from: logger.path(nestedPath),
          to: relativeTarget,
        }),
      );
      replaced++;
    } catch (error) {
      logger.debug(t('nestedReplaceFailed', { path: nestedPath }));
      logger.debug(String(error));
    }
  }

  if (replaced > 0) {
    logger.debug(t('nestedReplaceSuccess', { count: replaced }));
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
