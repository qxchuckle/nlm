#!/usr/bin/env node
import { Command } from 'commander';
import mri from 'mri';
import { createRequire } from 'module';
import { push } from './commands/push';
import { install } from './commands/install';
import { update } from './commands/update';
import { uninstall } from './commands/uninstall';
import { list } from './commands/list';
import { config } from './commands/config';
import { search } from './commands/search';
import { status } from './commands/status';
import { NlmError } from './types';
import { initRuntime, updateRuntime, type Locale } from './core/runtime';
import logger from './utils/logger';
import { t, initI18n, detectSystemLocale } from './utils/i18n';

const require = createRequire(import.meta.url);
const program = new Command();

// 获取版本号
const getVersion = (): string => {
  try {
    const pkg = require('../package.json');
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
  const argv = mri(process.argv.slice(2), {
    boolean: ['debug'],
    string: ['lang'],
  });
  const debug = argv.debug || isDebugEnabled();
  const locale = parseLocale(argv.lang);
  return {
    workingDir: process.cwd(),
    debug,
    locale,
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
      await fn(...args);
    } catch (error) {
      if (error instanceof NlmError) {
        logger.error(error.message);
      } else {
        logger.error(t('errUnknown', { error: String(error) }));
      }
      process.exit(1);
    }
  };
};

const main = async () => {
  // 预解析全局选项（允许未知选项，避免过早退出）
  const { workingDir, debug, locale } = preParse();

  // 初始化 i18n（用于命令描述翻译）
  initI18n(locale);

  // 配置主程序
  program
    .name('nlm')
    .description(t('cliDescription'))
    .version(getVersion())
    .option('--debug', t('optionDebug'))
    .option('--lang <locale>', t('optionLang'))
    .hook('preSubcommand', () => {
      // 在执行子命令前初始化运行时配置
      initRuntime({
        workingDir,
        debug,
        locale,
      });
    });

  // push 命令
  program
    .command('push')
    .alias('p')
    .description(t('cmdPushDesc'))
    .option('-f, --force', t('optionForce'))
    .option('--packlist', t('optionPacklist'))
    .action(
      wrapAction(async (options) => {
        if (options.force) updateRuntime({ force: true });
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
  program.parse();
};

main();
