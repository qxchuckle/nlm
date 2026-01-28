import select from '@inquirer/select';
import input from '@inquirer/input';
import { select as selectPro } from 'inquirer-select-pro';
import chalk from 'chalk';
import { getRuntime, updateRuntime } from '../core/runtime';
import {
  getAllPackagesInStore,
  getPackageVersionsInStore,
} from '../core/store';
import { getLockfilePackageNames, lockfileExists } from '../core/lockfile';
import { readPackageManifest } from '../utils/package';
import { isValidVersion, isValidVersionRange } from '../utils/version';
import { push } from './push';
import { install } from './install';
import { update } from './update';
import { uninstall } from './uninstall';
import { list } from './list';
import { config } from './config';
import { search } from './search';
import { t, type Messages } from '../utils/i18n';
import { promptMultiSelectPro, promptSingleSelectPro } from '../utils/prompt';
import type { UninstallOptions } from './uninstall';

const PUSH_VERSION_CUSTOM_VALUE = '__custom__';

/** 引导项类型 */
type WizardItemType =
  | 'boolean'
  | 'string'
  | 'packages-store'
  | 'packages-lockfile'
  | 'package-scripts'
  | 'push-version'
  | 'input';

/** 单个可配置项 */
interface WizardItem {
  id: string;
  labelKey: keyof Messages;
  type: WizardItemType;
  /** input 类型时可选，允许留空 */
  optional?: boolean;
}

/** 命令元数据 */
interface WizardCommandMeta {
  id: string;
  descriptionKey: keyof Messages;
  items: WizardItem[];
}

const WIZARD_COMMANDS: WizardCommandMeta[] = [
  {
    id: 'push',
    descriptionKey: 'cmdPushDesc',
    items: [
      { id: 'build', labelKey: 'optionPushBuild', type: 'package-scripts' },
      { id: 'version', labelKey: 'optionPushVersion', type: 'push-version' },
      { id: 'force', labelKey: 'optionForce', type: 'boolean' },
      { id: 'packlist', labelKey: 'optionPacklist', type: 'boolean' },
      {
        id: 'packageManager',
        labelKey: 'optionPackageManager',
        type: 'input',
        optional: true,
      },
    ],
  },
  {
    id: 'install',
    descriptionKey: 'cmdInstallDesc',
    items: [
      {
        id: 'packages',
        labelKey: 'installSelectPackages',
        type: 'packages-store',
      },
      { id: 'force', labelKey: 'optionForce', type: 'boolean' },
      {
        id: 'packageManager',
        labelKey: 'optionPackageManager',
        type: 'input',
        optional: true,
      },
    ],
  },
  {
    id: 'update',
    descriptionKey: 'cmdUpdateDesc',
    items: [
      {
        id: 'packages',
        labelKey: 'guideUpdatePackages',
        type: 'packages-lockfile',
      },
      { id: 'force', labelKey: 'optionForce', type: 'boolean' },
      {
        id: 'packageManager',
        labelKey: 'optionPackageManager',
        type: 'input',
        optional: true,
      },
    ],
  },
  {
    id: 'uninstall',
    descriptionKey: 'cmdUninstallDesc',
    items: [
      {
        id: 'packages',
        labelKey: 'uninstallSelectPackages',
        type: 'packages-lockfile',
      },
      { id: 'install', labelKey: 'optionUninstallInstall', type: 'boolean' },
    ],
  },
  {
    id: 'list',
    descriptionKey: 'cmdListDesc',
    items: [{ id: 'global', labelKey: 'optionListGlobal', type: 'boolean' }],
  },
  {
    id: 'config',
    descriptionKey: 'cmdConfigDesc',
    items: [{ id: 'global', labelKey: 'optionGlobal', type: 'boolean' }],
  },
  {
    id: 'search',
    descriptionKey: 'cmdSearchDesc',
    items: [{ id: 'keyword', labelKey: 'guideSearchKeyword', type: 'input' }],
  },
];

/** 提示布尔项 */
const promptBoolean = async (labelKey: keyof Messages): Promise<boolean> => {
  const choice = await select({
    message: t('guideSetValue', { label: t(labelKey) }),
    choices: [
      { name: t('guideYes'), value: 'yes' },
      { name: t('guideNo'), value: 'no' },
    ],
  });
  return choice === 'yes';
};

/** 提示字符串项 */
const promptString = async (
  labelKey: keyof Messages,
  placeholder?: string,
): Promise<string> => {
  return input({
    message: t('guideSetValue', { label: t(labelKey) }),
    default: placeholder,
    validate: (v) =>
      v != null && String(v).trim() !== '' ? true : t('guideInputRequired'),
  });
};

/** 根据项类型逐个提示并收集值 */
const promptItemValue = async (
  item: WizardItem,
  workingDir: string,
): Promise<string | string[] | boolean> => {
  switch (item.type) {
    case 'boolean':
      // return promptBoolean(item.labelKey);
      // boolean类型的参数已在「选择要设置的项」里选中，视为开启，无需二次 Yes/No 确认
      return true;
    case 'string':
      return await promptString(item.labelKey, 'build');
    case 'package-scripts': {
      const pkg = readPackageManifest(workingDir);
      const scripts = pkg?.scripts && Object.keys(pkg.scripts);
      if (!scripts?.length) return '';
      const choices = [
        { name: t('pushScriptSkip'), value: '' },
        ...scripts.map((name) => ({
          name: `${name}  ${chalk.gray(pkg!.scripts![name])}`,
          value: name,
        })),
      ];
      const defaultScript = scripts.includes('build') ? 'build' : '';
      return promptSingleSelectPro(
        t('pushSelectScript'),
        choices,
        defaultScript,
      );
    }
    case 'push-version': {
      const pkg = readPackageManifest(workingDir);
      const currentVer = pkg?.version ?? '0.0.0';
      const storeVersions = pkg?.name
        ? getPackageVersionsInStore(pkg.name)
        : [];
      const latestInStore =
        storeVersions.length > 0
          ? storeVersions[storeVersions.length - 1]
          : null;
      const choices: { name: string; value: string }[] = [
        {
          name: t('pushVersionCurrent', { version: currentVer }),
          value: currentVer,
        },
        { name: t('pushVersionCustom'), value: PUSH_VERSION_CUSTOM_VALUE },
      ];
      if (latestInStore != null) {
        const latestDesc = t('pushVersionLatestDesc', {
          version: latestInStore,
        });
        choices.unshift({
          name: `${t('pushVersionLatest')}  ${chalk.gray(latestDesc)}`,
          value: 'latest',
        });
      }
      const chosen = await promptSingleSelectPro(
        t('pushVersionPrompt'),
        choices,
        currentVer,
      );
      if (chosen === PUSH_VERSION_CUSTOM_VALUE) {
        return await input({
          message: t('pushVersionInput'),
          validate: (v) => {
            const s = v != null ? String(v).trim() : '';
            if (!s) return t('guideInputRequired');
            if (s === 'latest' || isValidVersion(s) || isValidVersionRange(s))
              return true;
            return t('pushVersionInvalid', { version: s });
          },
        });
      }
      return chosen;
    }
    case 'input':
      return await input({
        message: t('guideSetValue', { label: t(item.labelKey) }),
        validate: (v) =>
          item.optional || (v != null && String(v).trim() !== '')
            ? true
            : t('guideInputRequired'),
      });
    case 'packages-store': {
      const choices = getAllPackagesInStore();
      if (choices.length === 0) return [];
      return promptMultiSelectPro(t(item.labelKey), choices);
    }
    case 'packages-lockfile': {
      if (!lockfileExists(workingDir)) return [];
      const choices = getLockfilePackageNames(workingDir);
      if (choices.length === 0) return [];
      return promptMultiSelectPro(t(item.labelKey), choices);
    }
    default:
      return '';
  }
};

/** 执行选中的命令 */
const runCommand = async (
  commandId: string,
  values: Record<string, string | string[] | boolean>,
): Promise<void> => {
  const v = values;

  switch (commandId) {
    case 'push':
      updateRuntime({
        force: v.force === true,
        buildScript:
          typeof v.build === 'string' && v.build.length > 0
            ? v.build
            : undefined,
        pushVersion:
          typeof v.version === 'string' && v.version.length > 0
            ? v.version
            : undefined,
        usePacklist: v.packlist === true,
        forcedPackageManager:
          typeof v.packageManager === 'string' && v.packageManager.trim()
            ? v.packageManager.trim()
            : undefined,
      });
      await push();
      break;
    case 'install':
      updateRuntime({
        force: v.force === true,
        forcedPackageManager:
          typeof v.packageManager === 'string' && v.packageManager.trim()
            ? v.packageManager.trim()
            : undefined,
      });
      await install(Array.isArray(v.packages) ? v.packages : []);
      break;
    case 'update':
      updateRuntime({
        force: v.force === true,
        forcedPackageManager:
          typeof v.packageManager === 'string' && v.packageManager.trim()
            ? v.packageManager.trim()
            : undefined,
      });
      await update(Array.isArray(v.packages) ? v.packages : []);
      break;
    case 'uninstall':
      await uninstall(Array.isArray(v.packages) ? v.packages : [], {
        install: v.install === true,
      } as UninstallOptions);
      break;
    case 'list':
      await list(v.global === true);
      break;
    case 'config':
      await config(v.global === true);
      break;
    case 'search':
      await search(typeof v.keyword === 'string' ? v.keyword : '');
      break;
    default:
      throw new Error(`Unknown command: ${commandId}`);
  }
};

/** program 类型：仅需输出帮助 */
type HelpProgram = { outputHelp?: () => void };

/**
 * 执行 wizard 命令：交互式选择命令与参数，再执行
 * @param program 传入时，选择 help 会调用 program.outputHelp()
 */
export const wizard = async (program?: HelpProgram): Promise<void> => {
  const { workingDir } = getRuntime();

  // 1. 选择要执行的命令（支持按命令名、描述搜索），含 help 项
  const commandChoices = [
    ...WIZARD_COMMANDS.map((cmd) => ({
      name: `${cmd.id}  ${chalk.gray(t(cmd.descriptionKey))}`,
      value: cmd.id,
      searchText: `${cmd.id} ${t(cmd.descriptionKey)}`,
    })),
    {
      name: `help  ${chalk.gray(t('guideHelpDesc'))}`,
      value: 'help',
      searchText: `help ${t('guideHelpDesc')}`,
    },
  ];
  const commandId = await selectPro({
    message: t('guideSelectCommand'),
    multiple: false,
    options: async (input?: string) => {
      const term = (input || '').toLowerCase().trim();
      if (!term)
        return commandChoices.map((c) => ({ name: c.name, value: c.value }));
      return commandChoices
        .filter((c) => c.searchText.toLowerCase().includes(term))
        .map((c) => ({ name: c.name, value: c.value }));
    },
  });

  if (commandId == null) return;

  const id = commandId as string;
  if (id === 'help') {
    program?.outputHelp?.();
    return;
  }
  const meta = WIZARD_COMMANDS.find((c) => c.id === id)!;

  // 无参数命令直接执行
  if (meta.items.length === 0) {
    await runCommand(id, {});
    return;
  }

  // 2. 多选要设置的项
  const itemIds = await promptMultiSelectPro(
    t('guideSelectOptionsToSet'),
    meta.items.map((i) => ({ value: i.id, suffix: t(i.labelKey) })),
    [],
  );

  const values: Record<string, string | string[] | boolean> = {};

  // 3. 对每个选中的项逐个提示
  for (const itemId of itemIds) {
    const item = meta.items.find((i) => i.id === itemId)!;
    values[itemId] = (await promptItemValue(item, workingDir)) as
      | string
      | string[]
      | boolean;
  }

  await runCommand(id, values);
};

export default wizard;
