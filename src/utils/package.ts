import { join, resolve } from 'path';
import { NlmError, PackageManifest, PackageName } from '../types';
import { readJsonSync, writeJsonSync, pathExistsSync } from './file';
import { getProjectPackageDir } from '../constants';
import packlist from 'npm-packlist';
import logger from './logger';
import { isPackageInLockfile } from '@/core/lockfile';
import { t } from './i18n';
import { getPackFilesInternal } from './pack-list';
import { readPackageManifest } from './pkg-manifest';
import { getRuntime } from '@/core/runtime';

// 重新导出供其他模块使用
export { readPackageManifest, normalizePackage } from './pkg-manifest';

/**
 * 创建 minimal arborist tree 对象
 * 这样可以避免使用 arborist.loadActual() 扫描整个 node_modules
 * 仅适用于没有 bundledDependencies 的包
 */
const createMinimalTree = (workingDir: string, pkg: PackageManifest) => {
  const resolvedPath = resolve(workingDir);
  return {
    path: resolvedPath,
    realpath: resolvedPath,
    package: pkg,
    isProjectRoot: true,
    edgesOut: new Map(),
    workspaces: null,
  };
};

/**
 * 解析包名和版本
 * 支持格式: @scope/name@version, name@version, @scope/name, name
 */
export const parsePackageName = (
  packageName: string,
): { name: PackageName; version: string } => {
  // 匹配 @scope/name@version 或 name@version
  const match = packageName.match(/(^@[^/]+\/)?([^@]+)@?(.*)/);
  if (!match) {
    return { name: '' as PackageName, version: '' };
  }
  return {
    name: ((match[1] || '') + match[2]) as PackageName,
    version: match[3] || '',
  };
};

/**
 * 写入 package.json
 */
export const writePackageManifest = (
  workingDir: string,
  pkg: PackageManifest,
): void => {
  const packagePath = join(workingDir, 'package.json');
  const indent = pkg.__indent || '  ';
  const pkgToWrite = { ...pkg };
  delete pkgToWrite.__indent;
  writeJsonSync(packagePath, pkgToWrite);
};

/**
 * 检查项目是否有效（存在 package.json 和 node_modules）
 */
export const isValidProject = (workingDir: string): boolean => {
  const hasPackageJson = pathExistsSync(join(workingDir, 'package.json'));
  // const hasNodeModules = pathExistsSync(join(workingDir, 'node_modules'));
  return hasPackageJson; // && hasNodeModules;
};

/**
 * 检查是否存在 package.json
 */
export const hasPackageJson = (workingDir: string): boolean => {
  return pathExistsSync(join(workingDir, 'package.json'));
};

/**
 * 获取包的完整名称（带版本）
 */
export const getPackageFullName = (name: string, version: string): string => {
  return version ? `${name}@${version}` : name;
};

/**
 * 判断是否是 scoped 包
 */
export const isScopedPackage = (name: string): boolean => {
  return name.startsWith('@');
};

/**
 * 获取 scoped 包的 scope 部分
 */
export const getPackageScope = (name: string): string | null => {
  if (!isScopedPackage(name)) {
    return null;
  }
  return name.split('/')[0];
};

/** packlist tree 类型 */
type PackTree = Parameters<typeof packlist>[0];

/**
 * 检查包是否有 bundledDependencies
 */
const hasBundledDependencies = (pkg: PackageManifest): boolean => {
  const bundled = pkg.bundleDependencies || pkg.bundledDependencies;
  return !!(bundled && Array.isArray(bundled) && bundled.length > 0);
};

/**
 * 检查包是否有 workspaces（monorepo）
 */
const hasWorkspaces = (pkg: PackageManifest): boolean => {
  if (!pkg.workspaces) return false;
  if (Array.isArray(pkg.workspaces)) {
    return pkg.workspaces.length > 0;
  }
  // workspaces 对象格式: { packages: [...], nohoist: [...] }
  return !!(pkg.workspaces.packages && pkg.workspaces.packages.length > 0);
};

/**
 * 检查是否需要使用完整的 arborist（用于构建依赖树）
 * 仅 bundledDependencies 需要完整 arborist 来遍历依赖树
 */
const needsFullArborist = (pkg: PackageManifest): string | false => {
  if (hasBundledDependencies(pkg)) {
    return 'bundledDependencies';
  }
  return false;
};

/**
 * 检查 files 字段中是否包含需要递归处理子目录 .npmignore 的目录模式
 * npm 规则：当 files 包含目录时，该目录及子目录中的 .npmignore 会被应用
 */
const hasDirectoryInFiles = (pkg: PackageManifest): boolean => {
  if (!pkg.files || !Array.isArray(pkg.files)) return false;
  return pkg.files.some((pattern) => {
    // 排除模式不算
    if (pattern.startsWith('!')) return false;
    // 包含 glob 字符的不是纯目录
    if (
      pattern.includes('*') ||
      pattern.includes('?') ||
      pattern.includes('{')
    ) {
      return false;
    }
    // 简单判断：不包含扩展名的可能是目录
    const lastSegment = pattern.split('/').pop() || '';
    return !lastSegment.includes('.');
  });
};

/**
 * 检查是否需要降级使用 npm-packlist
 * 以下情况 tinyglobby 实现可能不完整，需要降级：
 * 1. bundledDependencies - 需要递归打包依赖及其 node_modules
 * 2. workspaces (monorepo) - 需要正确处理工作区边界和 ignore 规则
 * 3. files 包含目录且目录中存在 .npmignore - 需要递归读取子目录忽略规则
 */
const needsFallbackToPacklist = (
  workingDir: string,
  pkg: PackageManifest,
): string | false => {
  // bundledDependencies 必须使用 packlist
  if (hasBundledDependencies(pkg)) {
    return 'bundledDependencies';
  }

  // workspaces 需要特殊处理工作区边界
  if (hasWorkspaces(pkg)) {
    return 'workspaces';
  }

  // 如果 files 包含目录，检查这些目录中是否有 .npmignore
  // npm 规则：子目录中的 .npmignore 会被递归应用
  if (hasDirectoryInFiles(pkg) && pkg.files) {
    for (const pattern of pkg.files) {
      if (pattern.startsWith('!')) continue;
      // 检查目录中是否存在 .npmignore
      const dirPath = join(workingDir, pattern);
      const npmignorePath = join(dirPath, '.npmignore');
      if (pathExistsSync(npmignorePath)) {
        return 'nested .npmignore';
      }
    }
  }

  return false;
};

/**
 * 获取 pack tree
 */
export const getPackTree = async (workingDir: string): Promise<PackTree> => {
  const startTime = Date.now();

  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    throw new Error(t('copyReadPackageJsonFailed'));
  }

  const reason = needsFullArborist(pkg);
  if (reason) {
    // 需要完整 arborist 时使用 loadActual
    const Arborist = (await import('@npmcli/arborist')).default;
    const arborist = new Arborist({ path: workingDir });
    const tree = await arborist.loadActual();
    logger.debug(`arborist tree (${reason}) ${logger.duration(startTime)}`);
    return tree;
  }

  // 简单包使用 minimal tree
  const tree = createMinimalTree(workingDir, pkg) as PackTree;
  logger.debug(`minimal tree ${logger.duration(startTime)}`);
  return tree;
};

/**
 * 使用 npm-packlist 获取文件列表（降级方案）
 */
const getPackFilesWithPacklist = async (
  workingDir: string,
): Promise<string[]> => {
  const tree = await getPackTree(workingDir);

  const startTime = Date.now();
  const files = await packlist(tree, {
    path: workingDir,
  });
  logger.debug(`packlist ${logger.duration(startTime)}`);

  return files;
};

/**
 * 获取包的发布文件列表
 * 优先使用 tinyglobby 快速方案，特殊情况降级使用 npm-packlist
 */
export const getPackFiles = async (workingDir: string): Promise<string[]> => {
  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    throw new Error(t('copyReadPackageJsonFailed'));
  }

  const { usePacklist } = getRuntime();

  // 如果指定了 --packlist 参数，强制使用 npm-packlist
  if (usePacklist) {
    logger.debug('force using packlist (--packlist)');
    const files = await getPackFilesWithPacklist(workingDir);
    logger.debug(`files num ${files.length}`);
    return files;
  }

  // 检查是否需要降级使用 npm-packlist
  const reason = needsFallbackToPacklist(workingDir, pkg);
  if (reason) {
    logger.debug(`fallback to packlist (${reason})`);
    const files = await getPackFilesWithPacklist(workingDir);
    logger.debug(`files num ${files.length}`);
    return files;
  }

  // 优先使用 tinyglobby 快速方案
  const files = await getPackFilesInternal(workingDir);
  logger.debug(`files num ${files.length}`);
  return files;
};

/**
 * 读取项目中已安装的 nlm 包的 package.json
 * @param workingDir 项目目录
 * @param packageName 包名
 * @returns package.json 内容，如果不存在则返回 null
 */
export const readInstalledPackageManifest = (
  workingDir: string,
  packageName: string,
): PackageManifest | null => {
  const pkgJsonPath = join(
    getProjectPackageDir(workingDir, packageName),
    'package.json',
  );
  try {
    const pkg = readJsonSync<PackageManifest>(pkgJsonPath);
    if (!pkg || !pkg.name || !pkg.version) {
      return null;
    }
    return pkg;
  } catch {
    return null;
  }
};

/**
 * 校验包名是否有效并检查是否已安装
 */
export const validatePackageNameIsInstalled = (
  workingDir: string,
  packageName: string,
): string => {
  const { name } = parsePackageName(packageName);
  if (!name) {
    throw new NlmError(t('errInvalidPackageName', { name: packageName }));
  }
  if (!isPackageInLockfile(workingDir, name)) {
    throw new NlmError(
      t('updateNotInstalled', {
        pkg: logger.pkg(name),
        cmd: logger.cmd('nlm install'),
      }),
    );
  }
  return name;
};
