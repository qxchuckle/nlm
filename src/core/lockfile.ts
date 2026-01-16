import { LockfileConfig, LockfilePackageEntry } from '../types';
import { getLockfilePath, getProjectNlmDir } from '../constants';
import {
  readJsonSync,
  writeJsonSync,
  ensureDirSync,
  pathExistsSync,
  removeSync,
} from '../utils/file';

/**
 * 创建空的 lockfile 配置
 */
const createEmptyLockfile = (): LockfileConfig => ({
  packages: {},
});

/**
 * 读取项目的 lockfile
 */
export const readLockfile = (workingDir: string): LockfileConfig => {
  const lockfilePath = getLockfilePath(workingDir);
  const config = readJsonSync<LockfileConfig>(lockfilePath);
  return config || createEmptyLockfile();
};

/**
 * 写入项目的 lockfile
 */
export const writeLockfile = (workingDir: string, config: LockfileConfig): void => {
  ensureDirSync(getProjectNlmDir(workingDir));
  const lockfilePath = getLockfilePath(workingDir);
  writeJsonSync(lockfilePath, config);
};

/**
 * 检查 lockfile 是否存在
 */
export const lockfileExists = (workingDir: string): boolean => {
  const lockfilePath = getLockfilePath(workingDir);
  return pathExistsSync(lockfilePath);
};

/**
 * 删除 lockfile
 */
export const removeLockfile = (workingDir: string): void => {
  const lockfilePath = getLockfilePath(workingDir);
  removeSync(lockfilePath);
};

/**
 * 获取 lockfile 中的包条目
 */
export const getLockfilePackage = (
  workingDir: string,
  packageName: string
): LockfilePackageEntry | null => {
  const config = readLockfile(workingDir);
  return config.packages[packageName] || null;
};

/**
 * 添加或更新 lockfile 中的包
 */
export const addPackageToLockfile = (
  workingDir: string,
  packageName: string,
  entry: LockfilePackageEntry
): void => {
  const config = readLockfile(workingDir);
  config.packages[packageName] = entry;
  writeLockfile(workingDir, config);
};

/**
 * 从 lockfile 中移除包
 */
export const removePackageFromLockfile = (
  workingDir: string,
  packageName: string
): void => {
  const config = readLockfile(workingDir);
  delete config.packages[packageName];
  
  // 如果没有包了，删除整个 lockfile
  if (Object.keys(config.packages).length === 0) {
    removeLockfile(workingDir);
  } else {
    writeLockfile(workingDir, config);
  }
};

/**
 * 获取 lockfile 中的所有包名
 */
export const getLockfilePackageNames = (workingDir: string): string[] => {
  const config = readLockfile(workingDir);
  return Object.keys(config.packages);
};

/**
 * 检查包是否在 lockfile 中
 */
export const isPackageInLockfile = (
  workingDir: string,
  packageName: string
): boolean => {
  const config = readLockfile(workingDir);
  return packageName in config.packages;
};

/**
 * 获取包的签名
 */
export const getPackageSignature = (
  workingDir: string,
  packageName: string
): string | null => {
  const entry = getLockfilePackage(workingDir, packageName);
  return entry?.signature || null;
};

/**
 * 更新包的签名
 */
export const updatePackageSignature = (
  workingDir: string,
  packageName: string,
  signature: string
): void => {
  const config = readLockfile(workingDir);
  const existing = config.packages[packageName];
  
  if (existing) {
    existing.signature = signature;
    writeLockfile(workingDir, config);
  }
};
