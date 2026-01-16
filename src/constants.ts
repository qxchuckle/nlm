import { homedir } from 'os';
import { join } from 'path';

/**
 * nlm 工具名称
 */
export const NLM_NAME = 'nlm';

/**
 * 全局 store 目录路径
 */
export const getStoreDir = (): string => {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'nlm');
  }
  return join(homedir(), '.nlm');
};

/**
 * 全局 packages 目录路径
 */
export const getPackagesDir = (): string => {
  return join(getStoreDir(), 'packages');
};

/**
 * 获取指定包的 store 路径
 */
export const getPackageStoreDir = (packageName: string, version?: string): string => {
  const base = join(getPackagesDir(), packageName);
  return version ? join(base, version) : base;
};

/**
 * 全局 store 配置文件名
 */
export const STORE_CONFIG_FILE = 'nlm-store.json';

/**
 * 项目 nlm 目录名
 */
export const PROJECT_NLM_DIR = '.nlm';

/**
 * 项目 lockfile 文件名
 */
export const LOCKFILE_NAME = 'nlm-lock.json';

/**
 * 项目配置文件名
 */
export const CONFIG_FILE_NAME = 'nlm.config.json';

/**
 * 签名文件名
 */
export const SIGNATURE_FILE_NAME = 'nlm.sig';

/**
 * 默认版本标识
 */
export const LATEST_VERSION = 'latest';

/**
 * 获取全局 store 配置文件路径
 */
export const getStoreConfigPath = (): string => {
  return join(getStoreDir(), STORE_CONFIG_FILE);
};

/**
 * 获取项目 nlm 目录路径
 */
export const getProjectNlmDir = (workingDir: string): string => {
  return join(workingDir, PROJECT_NLM_DIR);
};

/**
 * 获取项目 lockfile 路径
 */
export const getLockfilePath = (workingDir: string): string => {
  return join(getProjectNlmDir(workingDir), LOCKFILE_NAME);
};

/**
 * 获取项目配置文件路径
 */
export const getConfigPath = (workingDir: string): string => {
  return join(getProjectNlmDir(workingDir), CONFIG_FILE_NAME);
};
