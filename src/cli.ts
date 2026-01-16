#!/usr/bin/env node
import { Command } from 'commander';
import { push } from './commands/push';
import { install } from './commands/install';
import { update } from './commands/update';
import { uninstall } from './commands/uninstall';
import { list } from './commands/list';
import { NlmError } from './types';
import logger from './utils/logger';

const program = new Command();

// 获取版本号
const getVersion = async (): Promise<string> => {
  try {
    const pkg = await import('../package.json');
    return pkg.default?.version ?? pkg.version;
  } catch {
    return '1.0.0';
  }
};

const main = async () => {
  program
    .name('nlm')
    .description('npm local modules - 本地 npm 包联调工具')
    .version(await getVersion());

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
          logger.error(`未知错误: ${error}`);
        }
        process.exit(1);
      }
    };
  };

  // push 命令
  program
    .command('push')
    .alias('p')
    .description('推送当前包到全局 store，并更新所有使用此包的项目')
    .option('-f, --force', '强制推送，跳过 hash 检查')
    .action(
      wrapAction(async (options) => {
        await push({
          workingDir: process.cwd(),
          force: options.force,
        });
      }),
    );

  // install 命令
  program
    .command('install [package]')
    .alias('i')
    .description('安装 nlm 包到当前项目')
    .option('-f, --force', '强制安装，跳过 hash 检查')
    .action(
      wrapAction(async (packageName, options) => {
        await install({
          workingDir: process.cwd(),
          packageName,
          force: options.force,
        });
      }),
    );

  // update 命令
  program
    .command('update [package]')
    .alias('up')
    .description('更新已安装的 nlm 包')
    .option('-f, --force', '强制更新，跳过 hash 检查')
    .action(
      wrapAction(async (packageName, options) => {
        await update({
          workingDir: process.cwd(),
          packageName,
          force: options.force,
        });
      }),
    );

  // uninstall 命令
  program
    .command('uninstall <package>')
    .alias('un')
    .description('卸载 nlm 包')
    .action(
      wrapAction(async (packageName) => {
        await uninstall({
          workingDir: process.cwd(),
          packageName,
        });
      }),
    );

  // ls 命令
  program
    .command('ls')
    .alias('l')
    .description('列出已安装的 nlm 包')
    .option('-s, --store', '列出全局 store 中的所有包')
    .action(
      wrapAction(async (options) => {
        await list({
          workingDir: process.cwd(),
          store: options.store,
        });
      }),
    );

  // 处理未知命令
  program.on('command:*', (operands) => {
    logger.error(`未知命令: ${operands[0]}`);
    logger.info(`运行 ${logger.cmd('nlm --help')} 查看可用命令`);
    process.exit(1);
  });

  // 解析命令行参数
  program.parse();
};

main();
