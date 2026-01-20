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
): string[] => {
  if (!pathExistsSync(nodeModulesDir)) {
    return results;
  }

  // 检查当前层级是否有目标包
  const targetPath = join(nodeModulesDir, packageName);
  if (pathExistsSync(targetPath)) {
    results.push(targetPath);
  }

  // 遍历当前 node_modules 下的所有目录（使用 withFileTypes 减少系统调用）
  const entries = readdirWithFileTypesSync(nodeModulesDir);

  for (const entry of entries) {
    // 跳过非目录、软链接和需要忽略的目录
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      shouldSkipDir(entry.name)
    ) {
      continue;
    }

    const itemPath = join(nodeModulesDir, entry.name);

    if (entry.name.startsWith('@')) {
      // scoped 包目录，遍历其子目录
      const scopedEntries = readdirWithFileTypesSync(itemPath);
      for (const scopedEntry of scopedEntries) {
        // 跳过软链接
        if (scopedEntry.isSymbolicLink()) {
          continue;
        }

        const scopedItemPath = join(itemPath, scopedEntry.name);
        const nestedNodeModules = join(scopedItemPath, 'node_modules');
        findAllNestedPackages(nestedNodeModules, packageName, results);
      }
    } else if (entry.name !== packageName) {
      // 普通包目录，检查其 node_modules
      const nestedNodeModules = join(itemPath, 'node_modules');
      findAllNestedPackages(nestedNodeModules, packageName, results);
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

  logger.debug(t('nestedDebugPaths', { paths: nestedPaths.join('\n') }));

  if (nestedPaths.length === 0) {
    // logger.debug(t('nestedNoIndirectDeps', { pkg: logger.pkg(packageName) }));
    return 0;
  }

  logger.debug(
    t('nestedFoundIndirectDeps', {
      count: nestedPaths.length,
      pkg: logger.pkg(packageName),
    }),
  );

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
