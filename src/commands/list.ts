import Table from 'cli-table3';
import chalk from 'chalk';
import { ListOptions } from '../types';
import { readLockfile, lockfileExists } from '../core/lockfile';
import {
  getAllPackagesInStore,
  getPackageVersionsInStore,
  readStoreConfig,
} from '../core/store';
import logger from '../utils/logger';

// 表格样式配置
const tableStyle = {
  chars: {
    top: '─',
    'top-mid': '┬',
    'top-left': '┌',
    'top-right': '┐',
    bottom: '─',
    'bottom-mid': '┴',
    'bottom-left': '└',
    'bottom-right': '┘',
    left: '│',
    'left-mid': '├',
    mid: '─',
    'mid-mid': '┼',
    right: '│',
    'right-mid': '┤',
    middle: '│',
  },
  style: {
    head: ['cyan'],
    border: ['gray'],
  },
};

/**
 * 执行 ls 命令
 */
export const list = async (options: ListOptions): Promise<void> => {
  const { workingDir, store = false } = options;

  if (store) {
    await listStore();
  } else {
    await listProject(workingDir);
  }
};

/**
 * 列出项目中安装的 nlm 包
 */
const listProject = async (workingDir: string): Promise<void> => {
  if (!lockfileExists(workingDir)) {
    logger.info('当前项目没有安装任何 nlm 包');
    return;
  }

  const lockfile = readLockfile(workingDir);
  const packages = Object.entries(lockfile.packages);

  if (packages.length === 0) {
    logger.info('当前项目没有安装任何 nlm 包');
    return;
  }

  const table = new Table({
    head: ['包名', '版本', '签名'],
    ...tableStyle,
    colWidths: [40, 12, 20],
    wordWrap: true,
    wrapOnWordBoundary: false,
  });

  for (const [name, entry] of packages) {
    const versionDisplay =
      entry.version === 'latest'
        ? chalk.yellow('latest')
        : chalk.green(entry.version);

    table.push([
      chalk.cyan(name),
      versionDisplay,
      chalk.gray(entry.signature.substring(0, 12) + '...'),
    ]);
  }

  logger.log('已安装的 nlm 包:');
  console.log(table.toString());
  logger.log(`共 ${chalk.bold(packages.length)} 个包`);
};

/**
 * 列出全局 store 中的所有包
 */
const listStore = async (): Promise<void> => {
  const packages = getAllPackagesInStore();

  if (packages.length === 0) {
    logger.info('全局 store 中没有任何包');
    return;
  }

  const storeConfig = readStoreConfig();

  const table = new Table({
    head: ['包名', '版本', '源路径', '使用项目'],
    ...tableStyle,
    colWidths: [30, 12, 50, 15],
    wordWrap: true,
    wrapOnWordBoundary: false,
  });

  for (const name of packages) {
    const versions = getPackageVersionsInStore(name);
    const entry = storeConfig[name];

    const versionsStr = versions.map((v) => chalk.green(v)).join('\n');
    const targetPath = entry?.target ? chalk.blue(entry.target) : '-';
    const usedByCount =
      entry?.usedBy && entry.usedBy.length > 0
        ? chalk.yellow(`${entry.usedBy.length} 个项目`)
        : chalk.gray('-');

    table.push([chalk.cyan(name), versionsStr, targetPath, usedByCount]);
  }

  logger.log('全局 store 中的包:');
  console.log(table.toString());
  logger.log(`共 ${chalk.bold(packages.length)} 个包`);
};

export default list;
