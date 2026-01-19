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
import { DEFAULT_CONFIG, NlmConfig } from '../types';

/**
 * 配置项定义列表
 * 添加新配置项只需在此数组中添加即可
 */
const configItems: (ConfigItemDefinition & {
  key: keyof NlmConfig; /** 标签翻译 key */
  labelKey: keyof Messages;
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
];

/**
 * 执行 config 命令
 */
export const config = async (global: boolean): Promise<void> => {
  const { workingDir } = getRuntime();

  logger.info(global ? t('configGlobalMode') : t('configProjectMode'));

  // 读取当前配置
  const currentConfig = global
    ? readGlobalConfig()
    : readConfig(workingDir, true);

  // 遍历所有配置项进行交互
  const newConfig: Partial<NlmConfig> = {};

  for (const item of configItems) {
    const currentValue = currentConfig[item.key] as string | undefined;
    const value = await promptConfigItem(item, currentValue);
    (newConfig as Record<string, string | string[]>)[item.key] = value;
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
    const value = (newConfig as Record<string, string>)[item.key];
    console.log(`  ${chalk.gray(t(item.labelKey))} ${chalk.green(value)}`);
  }
};

export default config;
