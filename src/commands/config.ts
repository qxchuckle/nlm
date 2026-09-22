import chalk from 'chalk';
import {
  readConfig,
  writeConfig,
  readGlobalConfig,
  writeGlobalConfig,
} from '../core/config';
import { getRuntime } from '../core/runtime';
import logger from '../utils/logger';
import { Messages, t } from '../utils/i18n';
import { promptConfigItem, type ConfigItemDefinition } from '../utils/prompt';
import { DEFAULT_CONFIG, NlmConfig, NlmError } from '../types';
import { getConfigPath, getGlobalConfigPath } from '@/constants';
import { isValidProject } from '@/utils/package';

/**
 * 配置项定义列表
 * 添加新配置项只需在此数组中添加即可
 */
const configItems: (ConfigItemDefinition & {
  key: keyof NlmConfig; /** 标签翻译 key */
  labelKey: keyof Messages;
  /** 布尔配置项，交互值为 'true'/'false' 字符串，存储时转换为 boolean */
  boolean?: boolean;
})[] = [
  {
    type: 'select',
    key: 'packageManager',
    labelKey: 'configPackageManager',
    messageKey: 'configSelectPackageManager',
    presets: ['npm', 'pnpm', 'yarn'],
    allowCustom: true,
    defaultValue: DEFAULT_CONFIG.packageManager,
  },
  {
    type: 'select',
    key: 'lang',
    labelKey: 'configLang',
    messageKey: 'configSelectLang',
    presets: ['auto', 'zh', 'en'],
    allowCustom: false,
    defaultValue: DEFAULT_CONFIG.lang,
  },
  {
    type: 'select',
    key: 'installForceLatest',
    labelKey: 'configInstallForceLatest',
    messageKey: 'configSelectInstallForceLatest',
    presets: ['false', 'true'],
    allowCustom: false,
    defaultValue: String(DEFAULT_CONFIG.installForceLatest),
    /** 布尔配置项，交互值需转换为 boolean 存储 */
    boolean: true,
  },
  {
    type: 'select',
    key: 'pushForceLatest',
    labelKey: 'configPushForceLatest',
    messageKey: 'configSelectPushForceLatest',
    presets: ['false', 'true'],
    allowCustom: false,
    defaultValue: String(DEFAULT_CONFIG.pushForceLatest),
    /** 布尔配置项，交互值需转换为 boolean 存储 */
    boolean: true,
  },
];

/**
 * 执行 config 命令
 */
export const config = async (global: boolean): Promise<void> => {
  const { workingDir, nlmConfig } = getRuntime();

  // 非全局配置时检查当前目录是否是有效项目
  if (!global && !isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProject'));
  }

  logger.info(
    t(global ? 'configGlobalMode' : 'configProjectMode'),
    logger.path(global ? getGlobalConfigPath() : getConfigPath(workingDir)),
  );

  // 读取当前配置
  const currentConfig = global ? readGlobalConfig() : nlmConfig;

  // 遍历所有配置项进行交互
  const newConfig: Partial<NlmConfig> = {};

  for (const item of configItems) {
    const rawCurrent = currentConfig[item.key];
    // 布尔配置项：boolean → 'true'/'false' 字符串供交互展示
    const currentValue =
      typeof rawCurrent === 'boolean' ? String(rawCurrent) : rawCurrent;
    const value = await promptConfigItem(
      item,
      currentValue as string | undefined,
    );
    if (item.boolean) {
      (newConfig as Record<string, string | string[] | boolean>)[item.key] =
        value === 'true';
    } else {
      (newConfig as Record<string, string | string[]>)[item.key] = value;
    }
  }

  // 保存配置
  if (global) {
    writeGlobalConfig({ ...currentConfig, ...newConfig });
  } else {
    writeConfig(workingDir, { ...currentConfig, ...newConfig });
  }

  logger.success(
    t('configSaved', {
      type: global ? t('configGlobal') : t('configProject'),
    }),
  );

  // 显示配置结果
  logger.log(t('configResult'));
  for (const item of configItems) {
    const value = (newConfig as Record<string, unknown>)[item.key];
    console.log(
      `  ${chalk.gray(t(item.labelKey))} ${chalk.green(String(value))}`,
    );
  }
};

export default config;
