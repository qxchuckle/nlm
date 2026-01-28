import { StoreConfig, StorePackageEntry } from '../types';
import {
  getStoreConfigPath,
  getStoreDir,
  getPackagesDir,
  getPackageStoreDir,
} from '../constants';
import {
  readJsonSync,
  writeJsonSync,
  ensureDirSync,
  pathExistsSync,
  readdirSync,
} from '../utils/file';
import { compareVersions, isValidVersion } from '../utils/version';

/**
 * 读取全局 store 配置
 */
export const readStoreConfig = (): StoreConfig => {
  const configPath = getStoreConfigPath();
  const config = readJsonSync<StoreConfig>(configPath);
  return config || {};
};

/**
 * 写入全局 store 配置
 */
export const writeStoreConfig = (config: StoreConfig): void => {
  ensureDirSync(getStoreDir());
  const configPath = getStoreConfigPath();
  writeJsonSync(configPath, config);
};

/**
 * 获取包在 store 中的条目
 */
export const getStorePackageEntry = (
  packageName: string,
): StorePackageEntry | null => {
  const config = readStoreConfig();
  return config[packageName] || null;
};

/**
 * 更新包在 store 中的条目
 */
export const updateStorePackageEntry = (
  packageName: string,
  entry: Partial<StorePackageEntry>,
): void => {
  const config = readStoreConfig();
  const existing = config[packageName] || { target: '', usedBy: [] };
  config[packageName] = {
    ...existing,
    ...entry,
  };
  writeStoreConfig(config);
};

/**
 * 设置包的源路径
 */
export const setPackageTarget = (
  packageName: string,
  targetPath: string,
): void => {
  const config = readStoreConfig();
  const existing = config[packageName] || { target: '', usedBy: [] };
  config[packageName] = {
    ...existing,
    target: targetPath,
  };
  writeStoreConfig(config);
};

/**
 * 添加使用此包的项目
 */
export const addPackageUsage = (
  packageName: string,
  projectPath: string,
): void => {
  const config = readStoreConfig();
  const existing = config[packageName] || { target: '', usedBy: [] };

  if (!existing.usedBy.includes(projectPath)) {
    existing.usedBy.push(projectPath);
  }

  config[packageName] = existing;
  writeStoreConfig(config);
};

/**
 * 移除使用此包的项目
 */
export const removePackageUsage = (
  packageName: string,
  projectPath: string,
): void => {
  const config = readStoreConfig();
  const existing = config[packageName];

  if (!existing) {
    return;
  }

  existing.usedBy = existing.usedBy.filter((p) => p !== projectPath);

  // 如果没有项目使用此包，且没有 target，则删除整个条目
  if (existing.usedBy.length === 0 && !existing.target) {
    delete config[packageName];
  } else {
    config[packageName] = existing;
  }

  writeStoreConfig(config);
};

/**
 * 获取使用此包的所有项目
 */
export const getPackageUsages = (packageName: string): string[] => {
  const entry = getStorePackageEntry(packageName);
  return entry?.usedBy || [];
};

/**
 * 检查包是否存在于 store
 */
export const packageExistsInStore = (packageName: string): boolean => {
  const packageDir = getPackageStoreDir(packageName);
  return pathExistsSync(packageDir);
};

/**
 * 检查包的特定版本是否存在于 store
 */
export const packageVersionExistsInStore = (
  packageName: string,
  version: string,
): boolean => {
  const versionDir = getPackageStoreDir(packageName, version);
  return pathExistsSync(versionDir);
};

/**
 * 获取包在 store 中的所有版本
 */
export const getPackageVersionsInStore = (packageName: string): string[] => {
  const packageDir = getPackageStoreDir(packageName);
  if (!pathExistsSync(packageDir)) {
    return [];
  }
  return readdirSync(packageDir)
    .filter((v) => isValidVersion(v))
    .sort((a, b) => compareVersions(a, b));
};

/**
 * 获取 store 中的所有包
 */
export const getAllPackagesInStore = (): string[] => {
  const packagesDir = getPackagesDir();
  if (!pathExistsSync(packagesDir)) {
    return [];
  }

  const items = readdirSync(packagesDir);
  const packages: string[] = [];

  for (const item of items) {
    if (item.startsWith('@')) {
      // scoped 包，需要读取子目录
      const scopeDir = `${packagesDir}/${item}`;
      const scopedPackages = readdirSync(scopeDir);
      for (const pkg of scopedPackages) {
        packages.push(`${item}/${pkg}`);
      }
    } else {
      packages.push(item);
    }
  }

  return packages;
};

/**
 * 删除包的特定版本
 */
export const removePackageVersionFromStore = async (
  packageName: string,
  version: string,
): Promise<void> => {
  const { remove } = await import('../utils/file');
  const versionDir = getPackageStoreDir(packageName, version);
  await remove(versionDir);
};

/**
 * 删除整个包
 */
export const removePackageFromStore = async (
  packageName: string,
): Promise<void> => {
  const { remove } = await import('../utils/file');
  const packageDir = getPackageStoreDir(packageName);
  await remove(packageDir);

  // 从配置中移除
  const config = readStoreConfig();
  delete config[packageName];
  writeStoreConfig(config);
};
