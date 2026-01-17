import { NlmConfig } from '../types';
import {
  getConfigPath,
  getProjectNlmDir,
  getGlobalConfigPath,
  getStoreDir,
} from '../constants';
import {
  readJsonSync,
  writeJsonSync,
  ensureDirSync,
  pathExistsSync,
} from '../utils/file';
import logger from '@/utils/logger';

/**
 * 默认配置
 */
const defaultConfig: NlmConfig = {
  packageManager: 'npm',
};

/**
 * 初始化配置文件（如果不存在）
 */
export const initConfigIfNotExists = (workingDir: string): void => {
  const configPath = getConfigPath(workingDir);
  if (!pathExistsSync(configPath)) {
    ensureDirSync(getProjectNlmDir(workingDir));
    writeJsonSync(configPath, {});
  }
};

/**
 * 读取项目配置
 */
export const readConfig = (
  workingDir: string,
  extendsGlobalConfig: boolean,
): NlmConfig => {
  initConfigIfNotExists(workingDir);
  const configPath = getConfigPath(workingDir);
  let config = readJsonSync<NlmConfig>(configPath);
  logger.debug(`项目配置: ${logger.path(configPath)}`);
  logger.debug(`项目配置内容: ${JSON.stringify(config)}`);
  if (extendsGlobalConfig) {
    const globalConfig = readGlobalConfig();
    logger.debug(`全局配置: ${logger.path(getGlobalConfigPath())}`);
    logger.debug(`全局配置内容: ${JSON.stringify(globalConfig)}`);
    config = { ...globalConfig, ...config };
  }
  const result = { ...defaultConfig, ...config };
  logger.debug(`配置合并结果: ${JSON.stringify(result)}`);
  return result;
};

/**
 * 写入项目配置
 */
export const writeConfig = (workingDir: string, config: NlmConfig): void => {
  ensureDirSync(getProjectNlmDir(workingDir));
  const configPath = getConfigPath(workingDir);
  writeJsonSync(configPath, config);
};

/**
 * 检查配置文件是否存在
 */
export const configExists = (workingDir: string): boolean => {
  const configPath = getConfigPath(workingDir);
  return pathExistsSync(configPath);
};

/**
 * 获取配置的包管理器
 */
export const getConfiguredPackageManager = (
  workingDir: string,
): 'npm' | 'yarn' | 'pnpm' => {
  const config = readConfig(workingDir, true);
  return config.packageManager || 'npm';
};

/**
 * 更新项目配置
 */
export const updateConfig = (
  workingDir: string,
  updates: Partial<NlmConfig>,
): void => {
  const config = readConfig(workingDir, false);
  const newConfig = { ...config, ...updates };
  writeConfig(workingDir, newConfig);
};

// ==================== 全局配置相关 ====================

/**
 * 初始化全局配置文件（如果不存在）
 */
export const initGlobalConfigIfNotExists = (): void => {
  const globalConfigPath = getGlobalConfigPath();
  if (!pathExistsSync(globalConfigPath)) {
    ensureDirSync(getStoreDir());
    writeJsonSync(globalConfigPath, {});
    logger.debug(`初始化全局配置文件: ${logger.path(globalConfigPath)}`);
  }
};

/**
 * 读取全局配置
 */
export const readGlobalConfig = (): NlmConfig => {
  initGlobalConfigIfNotExists();
  const globalConfigPath = getGlobalConfigPath();
  const config = readJsonSync<NlmConfig>(globalConfigPath);
  logger.debug(`读取全局配置: ${logger.path(globalConfigPath)}`);
  logger.debug(`读取全局配置内容: ${JSON.stringify(config)}`);
  return { ...defaultConfig, ...config };
};

/**
 * 写入全局配置
 */
export const writeGlobalConfig = (config: NlmConfig): void => {
  ensureDirSync(getStoreDir());
  const globalConfigPath = getGlobalConfigPath();
  writeJsonSync(globalConfigPath, config);
};

/**
 * 检查全局配置文件是否存在
 */
export const globalConfigExists = (): boolean => {
  const globalConfigPath = getGlobalConfigPath();
  return pathExistsSync(globalConfigPath);
};

/**
 * 更新全局配置
 */
export const updateGlobalConfig = (updates: Partial<NlmConfig>): void => {
  const config = readGlobalConfig();
  const newConfig = { ...config, ...updates };
  writeGlobalConfig(newConfig);
};
