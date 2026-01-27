import chalk from 'chalk';
import input from '@inquirer/input';
import select from '@inquirer/select';
import { select as selectPro } from 'inquirer-select-pro';
import { t, type Messages } from './i18n';
import { NlmConfig, NlmError } from '../types';

const CUSTOM_OPTION = '__custom__';

/**
 * 基础配置项定义
 */
export interface BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'select' | 'selectPro' | 'input';
  /** 提示消息翻译 key */
  messageKey: keyof Messages;
  /** 默认值 */
  defaultValue: string;
}

/**
 * 选择类型配置项定义
 */
export interface SelectConfigItemDefinition extends BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'select';
  /** 预设选项 */
  presets: string[];
  /** 是否允许自定义输入 */
  allowCustom?: boolean;
  /** 是否多选 */
  multiple?: boolean;
}

/**
 * 输入类型配置项定义
 */
export interface InputConfigItemDefinition extends BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'input';
}

/**
 * 高级选择类型配置项定义（支持搜索过滤）
 */
export interface SelectProConfigItemDefinition extends BaseConfigItemDefinition {
  /** 配置类型 */
  type: 'selectPro';
  /** 预设选项 */
  presets: string[];
  /** 是否多选 */
  multiple?: boolean;
}

/**
 * 配置项定义
 */
export type ConfigItemDefinition =
  | SelectConfigItemDefinition
  | SelectProConfigItemDefinition
  | InputConfigItemDefinition;

/**
 * 处理选择类型配置项的交互（单选）
 */
const promptSingleSelectItem = async (
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
 * 处理选择类型配置项的交互（多选）
 */
const promptMultiSelectItem = async (
  item: SelectConfigItemDefinition,
  currentValue: string | string[] | undefined,
): Promise<string[]> => {
  const currentArray = Array.isArray(currentValue)
    ? currentValue
    : currentValue
      ? [currentValue]
      : [];

  // 构建选项
  const choices = item.presets.map((preset) => ({
    name: currentArray.includes(preset)
      ? `${preset} ${chalk.gray(t('configCurrent'))}`
      : preset,
    value: preset,
  }));

  // 交互式多选
  const selected = await selectPro({
    message: t(item.messageKey),
    multiple: true,
    options: choices,
    defaultValue: currentArray,
  });

  return selected as string[];
};

/**
 * 处理选择类型配置项的交互
 */
const promptSelectItem = async (
  item: SelectConfigItemDefinition,
  currentValue: string | string[] | undefined,
): Promise<string | string[]> => {
  if (item.multiple) {
    return promptMultiSelectItem(item, currentValue);
  }
  return promptSingleSelectItem(
    item,
    Array.isArray(currentValue) ? currentValue[0] : currentValue,
  );
};

/**
 * 处理高级选择类型配置项的交互（单选，支持搜索过滤）
 */
const promptSingleSelectProItem = async (
  item: SelectProConfigItemDefinition,
  currentValue: string | undefined,
): Promise<string> => {
  const current = currentValue || item.defaultValue;

  // 构建选项
  const choices = item.presets.map((preset) => ({
    name:
      preset === current
        ? `${preset} ${chalk.gray(t('configCurrent'))}`
        : preset,
    value: preset,
  }));

  // 交互式选择（支持搜索）
  const selected = await selectPro({
    message: t(item.messageKey),
    multiple: false,
    defaultValue: current,
    options: async (input?: string) => {
      const term = (input || '').toLowerCase();
      return choices.filter((choice) => {
        if (!term) return true;
        return choice.value.toLowerCase().includes(term);
      });
    },
  });

  return selected as string;
};

/**
 * 处理高级选择类型配置项的交互（多选，支持搜索过滤）
 */
const promptMultiSelectProItem = async (
  item: SelectProConfigItemDefinition,
  currentValue: string | string[] | undefined,
): Promise<string[]> => {
  const currentArray = Array.isArray(currentValue)
    ? currentValue
    : currentValue
      ? [currentValue]
      : [];

  // 构建选项
  const choices = item.presets.map((preset) => ({
    name: currentArray.includes(preset)
      ? `${preset} ${chalk.gray(t('configCurrent'))}`
      : preset,
    value: preset,
  }));

  // 交互式多选（支持搜索）
  const selected = await selectPro({
    message: t(item.messageKey),
    multiple: true,
    defaultValue: currentArray,
    options: async (input?: string) => {
      const term = (input || '').toLowerCase();
      return choices.filter((choice) => {
        if (!term) return true;
        return choice.value.toLowerCase().includes(term);
      });
    },
  });

  return selected as string[];
};

/**
 * 处理高级选择类型配置项的交互
 */
const promptSelectProItem = async (
  item: SelectProConfigItemDefinition,
  currentValue: string | string[] | undefined,
): Promise<string | string[]> => {
  if (item.multiple) {
    return promptMultiSelectProItem(item, currentValue);
  }
  return promptSingleSelectProItem(
    item,
    Array.isArray(currentValue) ? currentValue[0] : currentValue,
  );
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
export const promptConfigItem = async (
  item: ConfigItemDefinition,
  currentValue: string | string[] | undefined,
): Promise<string | string[]> => {
  const { type } = item;
  if (type === 'select') {
    return promptSelectItem(item, currentValue);
  } else if (type === 'selectPro') {
    return promptSelectProItem(item, currentValue);
  } else if (type === 'input') {
    return promptInputItem(
      item,
      Array.isArray(currentValue) ? currentValue[0] : currentValue,
    );
  } else {
    throw new NlmError(`Unknown config item type: ${type}`);
  }
};
export interface MultiSelectChoice<T extends string> {
  value: T;
  suffix?: string;
}

export interface SingleSelectChoice {
  name: string;
  value: string;
}

/**
 * 单选 Pro（支持搜索）
 */
export const promptSingleSelectPro = async (
  message: string,
  choices: SingleSelectChoice[],
  defaultValue?: string,
): Promise<string> => {
  const selected = await selectPro({
    message,
    multiple: false,
    defaultValue,
    options: async (input?: string) => {
      const term = (input || '').toLowerCase().trim();
      if (!term) return choices;
      return choices.filter(
        (c) =>
          c.value.toLowerCase().includes(term) ||
          c.name.toLowerCase().includes(term),
      );
    },
  });
  return (selected ?? '') as string;
};

/**
 * 多选Pro
 */
export const promptMultiSelectPro = async <T extends string>(
  message: string,
  choices: T[] | MultiSelectChoice<T>[],
  defaultSelected?: T[],
): Promise<T[]> => {
  const normalizedChoices = choices.map((choice) => {
    if (typeof choice === 'string') {
      return { value: choice, suffix: undefined };
    }
    return choice;
  });

  const selected = await selectPro({
    message,
    multiple: true,
    defaultValue: defaultSelected,
    options: async (input?: string) => {
      const term = (input || '').toLowerCase();
      return normalizedChoices
        .filter((choice) => {
          if (!term) return true;
          const searchStr =
            `${choice.value} ${choice.suffix || ''}`.toLowerCase();
          return searchStr.includes(term);
        })
        .map((choice) => ({
          name: choice.suffix
            ? `${choice.value} ${chalk.gray(choice.suffix)}`
            : choice.value,
          value: choice.value,
        }));
    },
  });

  return selected;
};
