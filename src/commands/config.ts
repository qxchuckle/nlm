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
import {
  promptConfigItem,
  promptSingleSelectPro,
  type ConfigItemDefinition,
} from '../utils/prompt';
import { DEFAULT_CONFIG, NlmConfig, NlmError } from '../types';
import { getConfigPath, getGlobalConfigPath } from '@/constants';
import { isValidProject } from '@/utils/package';

/**
 * nlm 配置项（支持嵌套路径与类型转换）
 */
type NlmConfigItem = ConfigItemDefinition & {
  /** 配置路径（支持嵌套，如 ['conflictDeps','strategy']） */
  path: string[];
  /** 展示用标签翻译 key */
  labelKey: keyof Messages;
  /** 存储类型：boolean 转布尔，stringList 转逗号分隔数组 */
  valueType?: 'boolean' | 'stringList';
};

/** 基础配置项 */
const basicConfigItems: NlmConfigItem[] = [
  {
    type: 'select',
    path: ['packageManager'],
    labelKey: 'configPackageManager',
    messageKey: 'configSelectPackageManager',
    presets: ['npm', 'pnpm', 'yarn'],
    allowCustom: true,
    defaultValue: DEFAULT_CONFIG.packageManager,
  },
  {
    type: 'select',
    path: ['lang'],
    labelKey: 'configLang',
    messageKey: 'configSelectLang',
    presets: ['auto', 'zh', 'en'],
    allowCustom: false,
    defaultValue: DEFAULT_CONFIG.lang,
  },
  {
    type: 'select',
    path: ['installForceLatest'],
    labelKey: 'configInstallForceLatest',
    messageKey: 'configSelectInstallForceLatest',
    presets: ['false', 'true'],
    allowCustom: false,
    defaultValue: String(DEFAULT_CONFIG.installForceLatest),
    valueType: 'boolean',
  },
  {
    type: 'select',
    path: ['pushForceLatest'],
    labelKey: 'configPushForceLatest',
    messageKey: 'configSelectPushForceLatest',
    presets: ['false', 'true'],
    allowCustom: false,
    defaultValue: String(DEFAULT_CONFIG.pushForceLatest),
    valueType: 'boolean',
  },
];

/** 冲突依赖策略配置项（按需进入，避免每次都要回答一长串问题） */
const conflictDepsItems: NlmConfigItem[] = [
  {
    type: 'select',
    path: ['conflictDeps', 'strategy'],
    labelKey: 'configConflictStrategy',
    messageKey: 'configSelectConflictStrategy',
    presets: ['install', 'skip', 'host'],
    allowCustom: false,
    defaultValue: 'install',
  },
  {
    type: 'select',
    path: ['conflictDeps', 'skipPeerDependencies'],
    labelKey: 'configConflictSkipPeer',
    messageKey: 'configSelectConflictSkipPeer',
    presets: ['true', 'false'],
    allowCustom: false,
    defaultValue: 'true',
    valueType: 'boolean',
  },
  {
    type: 'select',
    path: ['conflictDeps', 'skipBuildOnlyDependencies'],
    labelKey: 'configConflictSkipBuildOnly',
    messageKey: 'configSelectConflictSkipBuildOnly',
    presets: ['true', 'false'],
    allowCustom: false,
    defaultValue: 'true',
    valueType: 'boolean',
  },
  {
    type: 'input',
    path: ['conflictDeps', 'skip'],
    labelKey: 'configConflictSkipList',
    messageKey: 'configSelectConflictSkipList',
    defaultValue: '',
    allowEmpty: true,
    valueType: 'stringList',
  },
  {
    type: 'input',
    path: ['conflictDeps', 'host'],
    labelKey: 'configConflictHostList',
    messageKey: 'configSelectConflictHostList',
    defaultValue: '',
    allowEmpty: true,
    valueType: 'stringList',
  },
  {
    type: 'input',
    path: ['conflictDeps', 'install'],
    labelKey: 'configConflictInstallList',
    messageKey: 'configSelectConflictInstallList',
    defaultValue: '',
    allowEmpty: true,
    valueType: 'stringList',
  },
];

/** 按路径读取嵌套配置值 */
const getValueByPath = (
  config: Record<string, unknown>,
  path: string[],
): unknown => {
  let current: unknown = config;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

/** 按路径写入嵌套配置值（缺失的中间层自动创建） */
const setValueByPath = (
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void => {
  let current = target;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
};

/** 当前值 → 交互展示值 */
const toPromptValue = (value: unknown): string | undefined => {
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  return undefined;
};

/** 交互值 → 存储值 */
const parseValue = (item: NlmConfigItem, raw: string | string[]): unknown => {
  if (Array.isArray(raw)) return raw;
  if (item.valueType === 'boolean') return raw === 'true';
  if (item.valueType === 'stringList') {
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return raw;
};

/** 存储值 → 结果展示文本 */
const formatValue = (value: unknown): string => {
  if (typeof value === 'boolean') {
    return value ? t('guideYes') : t('guideNo');
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '-';
  }
  if (value === undefined || value === '') return '-';
  return String(value);
};

/**
 * 执行 config 命令
 */
export const config = async (global: boolean): Promise<void> => {
  const { workingDir, nlmConfig } = getRuntime();

  // 非全局配置时检查当前目录是否是有效项目
  if (!global && !isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProject'));
  }

  const configPath = global ? getGlobalConfigPath() : getConfigPath(workingDir);

  // 交互式配置依赖 TTY：非 TTY（CI / 管道）下提问会静默空转，明确报错并引导手改 JSON
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new NlmError(t('configRequiresTty', { path: configPath }));
  }

  logger.info(
    t(global ? 'configGlobalMode' : 'configProjectMode'),
    logger.path(configPath),
  );

  // 读取当前配置
  const currentConfig = global ? readGlobalConfig() : nlmConfig;

  // 以当前配置为底稿逐项覆盖（嵌套对象需浅拷贝，避免污染全局配置对象）
  const merged: Record<string, unknown> = {
    ...(currentConfig as unknown as Record<string, unknown>),
  };
  if (currentConfig.conflictDeps) {
    merged.conflictDeps = { ...currentConfig.conflictDeps };
  }

  // 是否进入冲突依赖策略配置（默认否，避免日常改包管理器时被追问 6 项）
  const enterConflictDeps = await promptSingleSelectPro(
    t('configConfigureConflictDeps'),
    [
      { name: t('guideNo'), value: 'no' },
      { name: t('guideYes'), value: 'yes' },
    ],
    'no',
  );
  const items =
    enterConflictDeps === 'yes'
      ? [...basicConfigItems, ...conflictDepsItems]
      : basicConfigItems;

  for (const item of items) {
    const currentValue = toPromptValue(getValueByPath(merged, item.path));
    const value = await promptConfigItem(item, currentValue);
    setValueByPath(merged, item.path, parseValue(item, value));
  }

  // 保存配置
  if (global) {
    writeGlobalConfig(merged as NlmConfig);
  } else {
    writeConfig(workingDir, merged as NlmConfig);
  }

  logger.success(
    t('configSaved', {
      type: global ? t('configGlobal') : t('configProject'),
    }),
  );

  // 显示配置结果
  logger.log(t('configResult'));
  for (const item of items) {
    console.log(
      `  ${chalk.gray(t(item.labelKey))} ${chalk.green(
        formatValue(getValueByPath(merged, item.path)),
      )}`,
    );
  }
};

export default config;
