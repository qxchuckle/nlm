import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

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
export const getPackageStoreDir = (
  packageName: string,
  version?: string,
): string => {
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
 * 全局配置文件名
 */
export const GLOBAL_CONFIG_FILE_NAME = 'nlm.config.json';

/**
 * 获取全局 store 配置文件路径
 */
export const getStoreConfigPath = (): string => {
  return join(getStoreDir(), STORE_CONFIG_FILE);
};

/**
 * 获取全局 nlm 配置文件路径
 */
export const getGlobalConfigPath = (): string => {
  return join(getStoreDir(), GLOBAL_CONFIG_FILE_NAME);
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

/**
 * 获取项目 .nlm 中指定包的路径
 */
export const getProjectPackageDir = (
  workingDir: string,
  packageName: string,
): string => {
  return join(getProjectNlmDir(workingDir), packageName);
};

/**
 * 冲突依赖包装包目录名（位于 .nlm/ 下）
 */
export const CONFLICT_DEPS_DIR = '.conflict-deps';

/**
 * 冲突依赖包装包在 app node_modules 中的名称前缀
 */
export const CONFLICT_DEPS_PKG_PREFIX = 'nlm-cd-';

/**
 * 获取项目 .nlm/.conflict-deps 目录路径
 */
export const getConflictDepsDir = (workingDir: string): string => {
  return join(getProjectNlmDir(workingDir), CONFLICT_DEPS_DIR);
};

/**
 * 获取指定 nlm 包的冲突依赖包装包目录
 */
export const getConflictDepsPackageDir = (
  workingDir: string,
  packageName: string,
): string => {
  return join(getConflictDepsDir(workingDir), packageName);
};

/**
 * 将包名转换为合法的冲突依赖包装包名称
 * scoped 包 @scope/name → nlm-cd-scope-name-<短哈希>
 * 追加短哈希保证映射单射（避免 @a/b-c 与 @a-b/c 扁平化后碰撞，
 * 防跨包误清理——该名称会用于 app node_modules 的删除等破坏性操作）
 */
export const getConflictDepsPackageName = (packageName: string): string => {
  const flatName = packageName.replace('@', '').replace('/', '-');
  const hash = createHash('sha1').update(packageName).digest('hex').slice(0, 8);
  return `${CONFLICT_DEPS_PKG_PREFIX}${flatName}-${hash}`;
};

/**
 * 获取冲突依赖包装包在 app node_modules 中的路径
 */
export const getConflictDepsNodeModulesPath = (
  workingDir: string,
  packageName: string,
): string => {
  return join(
    workingDir,
    'node_modules',
    getConflictDepsPackageName(packageName),
  );
};
