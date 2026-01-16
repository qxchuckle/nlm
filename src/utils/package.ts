import { join } from 'path';
import { PackageManifest, PackageName } from '../types';
import { readJsonSync, writeJsonSync, pathExistsSync } from './file';

/**
 * 解析包名和版本
 * 支持格式: @scope/name@version, name@version, @scope/name, name
 */
export const parsePackageName = (
  packageName: string
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
export const readPackageManifest = (workingDir: string): PackageManifest | null => {
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
  pkg: PackageManifest
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
