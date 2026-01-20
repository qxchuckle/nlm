import { join, resolve } from 'path';
import { NlmError, PackageManifest, PackageName } from '../types';
import { readJsonSync, writeJsonSync, pathExistsSync } from './file';
import { getProjectPackageDir } from '../constants';
import packlist from 'npm-packlist';
import logger from './logger';
import { isPackageInLockfile } from '@/core/lockfile';
import { t } from './i18n';
import { readGitignore } from './gitignore';

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
 * 读取 package.json
 */
export const readPackageManifest = (
  workingDir: string,
): PackageManifest | null => {
  const packagePath = join(workingDir, 'package.json');
  try {
    const pkg = readJsonSync<PackageManifest>(packagePath);
    if (!pkg || !pkg.name || !pkg.version) {
      return null;
    }
    return pkg;
  } catch {
    return null;
  }
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
  const hasNodeModules = pathExistsSync(join(workingDir, 'node_modules'));
  return hasPackageJson && hasNodeModules;
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
 * 检查是否需要使用完整的 arborist
 * 以下情况需要完整 arborist：
 * 1. bundledDependencies - 需要遍历依赖树打包 bundled 依赖
 * 2. workspaces (monorepo) - 需要正确处理工作区的 ignore 规则
 */
const needsFullArborist = (pkg: PackageManifest): string | false => {
  if (hasBundledDependencies(pkg)) {
    return 'bundledDependencies';
  }
  if (hasWorkspaces(pkg)) {
    return 'workspaces';
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
 * 获取包的发布文件列表
 */
export const getPackFiles = async (workingDir: string): Promise<string[]> => {
  const tree = await getPackTree(workingDir);

  const startTime = Date.now();
  const files = await packlist(tree, {
    path: workingDir,
  });
  logger.debug(`packlist ${logger.duration(startTime)}`);

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
