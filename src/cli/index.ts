#!/usr/bin/env node
import { Command, ParseOptions } from 'commander';
import mri from 'mri';
import { createRequire } from 'module';
import { push } from '@/commands/push';
import { install } from '@/commands/install';
import { update } from '@/commands/update';
import { uninstall } from '@/commands/uninstall';
import { list } from '@/commands/list';
import { config } from '@/commands/config';
import { search } from '@/commands/search';
import { status } from '@/commands/status';
import { guide } from '@/commands/guide';
import { NlmError } from '@/types';
import { initRuntime, updateRuntime, type Locale } from '@/core/runtime';
import logger from '@/utils/logger';
import { t, initI18n, detectSystemLocale } from '@/utils/i18n';
import { readConfig } from '@/core/config';

const require = createRequire(import.meta.url);
const program = new Command();

// 获取版本号
const getVersion = (): string => {
  try {
    const pkg = require('../../package.json');
    return pkg.version;
  } catch {
    return '-';
  }
};

/**
 * 检查是否开启调试模式
 * 优先级：--debug > DEBUG 环境变量
 */
const isDebugEnabled = (): boolean => {
  // 检查命令行参数是否包含 --debug
  if (process.argv.includes('--debug')) {
    return true;
  }
  // 检查环境变量
  const debugEnv = process.env.DEBUG;
  return debugEnv === '1' || debugEnv === 'true' || debugEnv === 'nlm';
};

/**
 * 解析语言选项并验证
 */
const parseLocale = (lang?: string): Locale => {
  const normalized = lang?.toLowerCase();
  if (normalized === 'zh' || normalized === 'en') {
    return normalized;
  }
  return detectSystemLocale();
};

/**
 * 预解析全局选项
 * 使用 mri 轻量级解析 process.argv
 */
const preParse = () => {
  const workingDir = process.cwd();
  const argv = mri(process.argv.slice(2), {
    boolean: ['debug'],
    string: ['lang', 'packageManager'],
  });
  const debug = argv.debug || isDebugEnabled();
  // 读取配置
  // 注意，像是push后workingDir可能发生变化所以往往还是需要重新读取配置
  const nlmConfig = {
    ...readConfig({
      workingDir,
      extendsGlobalConfig: true,
      initConfig: false,
    }),
  };
  const forcedPackageManager = argv.packageManager;
  const locale = parseLocale(argv.lang || nlmConfig.lang);
  return {
    workingDir,
    debug,
    locale,
    nlmConfig,
    forcedPackageManager,
  };
};

/**
 * 包装命令 action，统一处理错误
 */
const wrapAction = <T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): ((...args: T) => Promise<void>) => {
  return async (...args: T) => {
    try {
      logger.debug(JSON.stringify(args[0], null, 2));
      await fn(...args);
    } catch (error) {
      if (error instanceof NlmError) {
        logger.error(error.message);
      } else if (error instanceof Error) {
        logger.error(t('errUnknown', { error: error.message }));
      } else {
        logger.error(t('errUnknown', { error: String(error) }));
      }
      process.exit(1);
    }
  };
};

/**
 * Cli 入口主函数
 */
export const nlmCliMain = async (
  argv?: string[],
  parseOptions?: ParseOptions,
) => {
  // 预解析全局选项（允许未知选项，避免过早退出）
  const { workingDir, debug, locale, nlmConfig, forcedPackageManager } =
    preParse();

  // 初始化 i18n（用于命令描述翻译）
  initI18n(locale);

  // 配置主程序
  program
    .name('nlm')
    .description(t('cliDescription'))
    .version(getVersion())
    .option('--debug', t('optionDebug'))
    .option('--lang <locale>', t('optionLang'))
    .option('--packageManager <name>', t('optionPackageManager'))
    .hook('preSubcommand', () => {
      // 在执行子命令前初始化运行时配置
      initRuntime({
        workingDir,
        debug,
        locale,
        nlmConfig,
        forcedPackageManager,
      });
    });

  // guide 命令（交互式引导）
  program
    .command('guide')
    .alias('gui')
    .description(t('cmdGuideDesc'))
    .action(wrapAction(async () => guide(program)));

  // push 命令
  program
    .command('push')
    .alias('p')
    .description(t('cmdPushDesc'))
    .option('-f, --force', t('optionForce'))
    .option('-b, --build [scriptName]', t('optionPushBuild'))
    .option('--packlist', t('optionPacklist'))
    .action(
      wrapAction(async (options) => {
        if (options.force) updateRuntime({ force: true });
        // -b 无值：列出可执行脚本选择，默认 build；-b <name>：执行指定脚本；未传 -b：默认执行 build
        if (options.build === true) {
          updateRuntime({ pushShowScriptList: true, buildScript: undefined });
        } else if (options.build === undefined) {
          updateRuntime({ buildScript: 'build' });
        } else {
          updateRuntime({ buildScript: options.build });
        }
        if (options.packlist) updateRuntime({ usePacklist: true });
        await push();
      }),
    );

  // install 命令
  program
    .command('install [packages...]')
    .alias('i')
    .description(t('cmdInstallDesc'))
    .option('-f, --force', t('optionForce'))
    .action(
      wrapAction(async (packageNames: string[], options) => {
        if (options.force) updateRuntime({ force: true });
        await install(packageNames);
      }),
    );

  // update 命令
  program
    .command('update [packages...]')
    .alias('up')
    .description(t('cmdUpdateDesc'))
    .option('-f, --force', t('optionForce'))
    .action(
      wrapAction(async (packageNames: string[], options) => {
        if (options.force) updateRuntime({ force: true });
        await update(packageNames);
      }),
    );

  // uninstall 命令
  program
    .command('uninstall [packages...]')
    .alias('un')
    .description(t('cmdUninstallDesc'))
    .option('-i, --install', t('optionUninstallInstall'))
    .action(
      wrapAction(async (packageNames: string[], options) =>
        uninstall(packageNames, { install: options.install ?? false }),
      ),
    );

  // ls 命令
  program
    .command('list')
    .alias('ls')
    .description(t('cmdListDesc'))
    .option('-s, --store', t('optionStore'))
    .action(wrapAction(async (options) => list(options.store ?? false)));

  // config 命令
  program
    .command('config')
    .alias('c')
    .description(t('cmdConfigDesc'))
    .option('-g, --global', t('optionGlobal'))
    .action(wrapAction(async (options) => config(options.global ?? false)));

  // search 命令
  program
    .command('search <keyword>')
    .alias('s')
    .description(t('cmdSearchDesc'))
    .action(wrapAction(async (keyword: string) => search(keyword)));

  // status 命令
  program
    .command('status')
    .alias('st')
    .description(t('cmdStatusDesc'))
    .action(wrapAction(async () => status()));

  // 处理未知命令
  program.on('command:*', (operands) => {
    logger.error(t('errUnknownCommand', { cmd: operands[0] }));
    logger.info(t('helpRunCommand', { cmd: logger.cmd('nlm --help') }));
    process.exit(1);
  });

  // 解析命令行参数
  program.parse(argv, parseOptions);
};
