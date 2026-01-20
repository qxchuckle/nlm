/**
 * 运行时配置管理
 * 用于存储命令行参数等运行时配置，避免层层传递
 *
 * 注意：此模块不应导入 logger 或 i18n，以避免循环依赖
 */

export type Locale = 'zh' | 'en';

export interface RuntimeConfig {
  /** 强制执行，跳过 hash 检查 */
  force: boolean;
  /** 当前工作目录 */
  workingDir: string;
  /** 是否开启调试模式 */
  debug: boolean;
  /** 当前语言 */
  locale: Locale;
  /** 强制使用 npm-packlist 获取文件列表 */
  usePacklist: boolean;
}

const defaultConfig: RuntimeConfig = {
  force: false,
  workingDir: process.cwd(),
  debug: false,
  locale: 'en',
  usePacklist: false,
};

let currentConfig: RuntimeConfig = { ...defaultConfig };

/**
 * 初始化运行时配置
 * 在命令执行前调用，设置命令行参数
 */
export const initRuntime = (options: Partial<RuntimeConfig> = {}): void => {
  currentConfig = {
    ...defaultConfig,
    ...options,
  };
};

/**
 * 获取完整的运行时配置
 */
export const getRuntime = (): Readonly<RuntimeConfig> => {
  return currentConfig;
};

/**
 * 获取单个配置项
 */
export const getRuntimeValue = <K extends keyof RuntimeConfig>(
  key: K,
): RuntimeConfig[K] => {
  return currentConfig[key];
};

/**
 * 更新运行时配置（部分更新）
 */
export const updateRuntime = (options: Partial<RuntimeConfig>): void => {
  currentConfig = {
    ...currentConfig,
    ...options,
  };
};

/**
 * 重置运行时配置为默认值
 */
export const resetRuntime = (): void => {
  currentConfig = { ...defaultConfig };
};
