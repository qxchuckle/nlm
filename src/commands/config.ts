import chalk from 'chalk';
import { select, input } from '@inquirer/prompts';
import {
  readConfig,
  writeConfig,
  readGlobalConfig,
  writeGlobalConfig,
} from '../core/config';
import { getRuntime } from '../core/runtime';
import logger from '../utils/logger';
import { t, type Messages } from '../utils/i18n';
import { DEFAULT_CONFIG, NlmConfig } from '../types';
import { NlmError } from '../types';

const CUSTOM_OPTION = '__custom__';

/**
 * 基础配置项定义
 */
interface BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'select' | 'input';
  /** 配置键名 */
  key: keyof NlmConfig;
  /** 标签翻译 key */
  labelKey: keyof Messages;
  /** 提示消息翻译 key */
  messageKey: keyof Messages;
  /** 默认值 */
  defaultValue: string;
}

/**
 * 选择类型配置项定义
 */
interface SelectConfigItemDefinition extends BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'select';
  /** 预设选项 */
  presets: string[];
  /** 是否允许自定义输入 */
  allowCustom: boolean;
}

/**
 * 输入类型配置项定义
 */
interface InputConfigItemDefinition extends BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'input';
}

/**
 * 配置项定义
 */
type ConfigItemDefinition =
  | SelectConfigItemDefinition
  | InputConfigItemDefinition;

/**
 * 配置项定义列表
 * 添加新配置项只需在此数组中添加即可
 */
const configItems: ConfigItemDefinition[] = [
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
 * 处理选择类型配置项的交互
 */
const promptSelectItem = async (
  item: SelectConfigItemDefinition,
  currentValue: string | undefined,
): Promise<string> => {
  const current = currentValue || item.defaultValue;
  const isCustomCurrent = !item.presets.includes(current);

  // 构建选项
  const choices = [
    ...item.presets.map((preset) => ({
      name:
        preset === current
          ? `${preset} ${chalk.gray(t('configCurrent'))}`
          : preset,
      value: preset,
    })),
  ];

  // 如果允许自定义，添加自定义选项
  if (item.allowCustom) {
    choices.push({
      name: isCustomCurrent
        ? `${t('configCustom')} ${chalk.gray(`(${current})`)} ${chalk.gray(t('configCurrent'))}`
        : t('configCustom'),
      value: CUSTOM_OPTION,
    });
  }

  // 交互式选择
  const selected = await select({
    message: t(item.messageKey),
    choices,
    default: isCustomCurrent ? CUSTOM_OPTION : current,
  });

  // 如果选择了自定义，则提示输入
  if (selected === CUSTOM_OPTION) {
    return await input({
      message: t('configInputCustom'),
      default: isCustomCurrent ? current : undefined,
      validate: (value) => {
        if (!value.trim()) {
          return t('configInputRequired');
        }
        return true;
      },
    });
  }

  return selected;
};

/**
 * 处理输入类型配置项的交互
 */
const promptInputItem = async (
  item: InputConfigItemDefinition,
  currentValue: string | undefined,
): Promise<string> => {
  const current = currentValue || item.defaultValue;

  return await input({
    message: t(item.messageKey),
    default: current || undefined,
    validate: (value) => {
      if (!value.trim()) {
        return t('configInputRequired');
      }
      return true;
    },
  });
};

/**
 * 处理单个配置项的交互
 */
const promptConfigItem = async (
  item: ConfigItemDefinition,
  currentValue: string | undefined,
): Promise<string> => {
  const { type } = item;
  if (type === 'select') {
    return promptSelectItem(item, currentValue);
  } else if (type === 'input') {
    return promptInputItem(item, currentValue);
  } else {
    throw new NlmError(`Unknown config item type: ${type}`);
  }
};

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
    (newConfig as Record<string, string>)[item.key] = value;
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
