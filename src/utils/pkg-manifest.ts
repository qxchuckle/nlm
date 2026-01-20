import { join } from 'path';
import { NormalizedPackage, PackageManifest } from '../types';
import { readJsonSync } from './file';
import normalizePackageData from 'normalize-package-data';

/**
 * 规范化 package.json 数据
 * 使用 normalize-package-data 处理，统一字段格式
 */
export const normalizePackage = (pkg: PackageManifest): NormalizedPackage => {
  const normalized = { ...pkg };
  // 静默模式，不输出警告
  normalizePackageData(normalized, () => {});
  return normalized as NormalizedPackage;
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
