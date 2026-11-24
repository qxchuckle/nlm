import {
  DEFAULT_CONFIG,
  NlmConfig,
  ResolvedConflictDepsConfig,
} from '../types';
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
export const readConfig = (params: {
  workingDir: string;
  extendsGlobalConfig: boolean;
  initConfig: boolean;
}): NlmConfig => {
  const { workingDir, extendsGlobalConfig, initConfig } = params;
  if (initConfig) {
    initConfigIfNotExists(workingDir);
  }
  const configPath = getConfigPath(workingDir);
  let config = readJsonSync<NlmConfig>(configPath);
  // logger.debug(`项目配置: ${logger.path(configPath)}`);
  logger.debug(`项目配置内容: ${JSON.stringify(config)}`);
  if (extendsGlobalConfig) {
    const globalConfig = readGlobalConfig();
    // logger.debug(`全局配置: ${logger.path(getGlobalConfigPath())}`);
    logger.debug(`全局配置内容: ${JSON.stringify(globalConfig)}`);
    config = { ...globalConfig, ...config };
    // conflictDeps 为嵌套对象，逐字段合并：
    // - 标量字段：项目级覆盖全局级
    // - skip / host / install 名单：取并集（全局提供组织级默认，项目只做追加，避免丢失默认值）
    if (globalConfig.conflictDeps || config.conflictDeps) {
      const mergeList = (
        base?: string[],
        extra?: string[],
      ): string[] | undefined => {
        if (!base && !extra) return undefined;
        return Array.from(new Set([...(base || []), ...(extra || [])]));
      };
      config.conflictDeps = {
        ...globalConfig.conflictDeps,
        ...config.conflictDeps,
        skip: mergeList(
          globalConfig.conflictDeps?.skip,
          config.conflictDeps?.skip,
        ),
        host: mergeList(
          globalConfig.conflictDeps?.host,
          config.conflictDeps?.host,
        ),
        install: mergeList(
          globalConfig.conflictDeps?.install,
          config.conflictDeps?.install,
        ),
      };
    }
  }
  const result = { ...DEFAULT_CONFIG, ...config };
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
export const getConfiguredPackageManager = (workingDir: string): string => {
  const config = readConfig({
    workingDir,
    extendsGlobalConfig: true,
    initConfig: true,
  });
  return config.packageManager || DEFAULT_CONFIG.packageManager;
};

/**
 * 获取冲突依赖配置（缺省值已补齐）
 * 默认：peer 依赖由项目提供、构建期依赖不重复安装、其余冲突隔离安装
 */
export const getConflictDepsConfig = (
  workingDir: string,
): ResolvedConflictDepsConfig => {
  const config = readConfig({
    workingDir,
    extendsGlobalConfig: true,
    initConfig: true,
  });
  const raw = config.conflictDeps || {};
  const strategy =
    raw.strategy === 'skip' || raw.strategy === 'host'
      ? raw.strategy
      : 'install';
  return {
    strategy,
    skipPeerDependencies: raw.skipPeerDependencies !== false,
    skipBuildOnlyDependencies: raw.skipBuildOnlyDependencies !== false,
    skip: Array.isArray(raw.skip) ? raw.skip : [],
    host: Array.isArray(raw.host) ? raw.host : [],
    install: Array.isArray(raw.install) ? raw.install : [],
  };
};

/**
 * 更新项目配置
 */
export const updateConfig = (
  workingDir: string,
  updates: Partial<NlmConfig>,
): void => {
  const config = readConfig({
    workingDir,
    extendsGlobalConfig: false,
    initConfig: true,
  });
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
  return { ...config };
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
