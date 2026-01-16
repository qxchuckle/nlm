#!/usr/bin/env node
import { Command } from 'commander';
import { push } from './commands/push';
import { install } from './commands/install';
import { update } from './commands/update';
import { uninstall } from './commands/uninstall';
import { list } from './commands/list';

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

  // push 命令
  program
    .command('push')
    .alias('p')
    .description('推送当前包到全局 store，并更新所有使用此包的项目')
    .option('-f, --force', '强制推送，跳过 hash 检查')
    .action(async (options) => {
      await push({
        workingDir: process.cwd(),
        force: options.force,
      });
    });

  // install 命令
  program
    .command('install [package]')
    .alias('i')
    .description('安装 nlm 包到当前项目')
    .option('-f, --force', '强制安装，跳过 hash 检查')
    .action(async (packageName, options) => {
      await install({
        workingDir: process.cwd(),
        packageName,
        force: options.force,
      });
    });

  // update 命令
  program
    .command('update [package]')
    .alias('up')
    .description('更新已安装的 nlm 包')
    .option('-f, --force', '强制更新，跳过 hash 检查')
    .action(async (packageName, options) => {
      await update({
        workingDir: process.cwd(),
        packageName,
        force: options.force,
      });
    });

  // uninstall 命令
  program
    .command('uninstall <package>')
    .alias('un')
    .description('卸载 nlm 包')
    .action(async (packageName) => {
      await uninstall({
        workingDir: process.cwd(),
        packageName,
      });
    });

  // ls 命令
  program
    .command('ls')
    .alias('l')
    .description('列出已安装的 nlm 包')
    .option('-s, --store', '列出全局 store 中的所有包')
    .action(async (options) => {
      await list({
        workingDir: process.cwd(),
        store: options.store,
      });
    });

  // 解析命令行参数
  program.parse();
};

main();
