import chalk from 'chalk';
import { readLockfile, lockfileExists } from '../core/lockfile';
import {
  getAllPackagesInStore,
  getPackageVersionsInStore,
  readStoreConfig,
} from '../core/store';
import { readInstalledPackageManifest } from '../utils/package';
import { getRuntime } from '../core/runtime';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

/**
 * 执行 ls 命令
 */
export const list = async (showStore: boolean): Promise<void> => {
  const { workingDir } = getRuntime();

  if (showStore) {
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
    logger.info(t('listNoPackages'));
    return;
  }

  const lockfile = readLockfile(workingDir);
  const packages = Object.entries(lockfile.packages);

  if (packages.length === 0) {
    logger.info(t('listNoPackages'));
    return;
  }

  const storeConfig = readStoreConfig();

  logger.log(t('listInstalled'));
  console.log();

  for (const [name, entry] of packages) {
    const versionDisplay =
      entry.version === 'latest'
        ? chalk.yellow('latest')
        : chalk.green(entry.version);

    // 从项目 .nlm/<packageName>/package.json 读取实际安装的版本
    const installedPkg = readInstalledPackageManifest(workingDir, name);
    const actualVersion = installedPkg?.version;

    console.log(logger.pkg(name));
    console.log(
      `  ${versionDisplay}${actualVersion && actualVersion !== entry.version ? ` ${chalk.gray('→')} ${chalk.green(actualVersion)}` : ''}  ${chalk.gray(entry.signature)}`,
    );
    console.log(
      `  ${chalk.gray(t('listSourcePath'))} ${logger.path(storeConfig[name]?.target ?? '-')}`,
    );
  }

  console.log();
  logger.log(t('listTotal', { count: packages.length }));
};

/**
 * 列出全局 store 中的所有包
 */
const listStore = async (): Promise<void> => {
  const packages = getAllPackagesInStore();

  if (packages.length === 0) {
    logger.info(t('listStoreEmpty'));
    return;
  }

  const storeConfig = readStoreConfig();

  logger.log(t('listStoreTitle'));
  console.log();

  for (const name of packages) {
    const versions = getPackageVersionsInStore(name);
    const entry = storeConfig[name];

    console.log(logger.pkg(name));
    console.log(`  ${logger.version(versions.join(' '))}`);

    // 源路径信息
    console.log(
      `  ${chalk.gray(t('listSourcePath'))} ${logger.path(entry?.target ?? '-')}`,
    );

    // 使用项目列表
    if (entry?.usedBy && entry.usedBy.length > 0) {
      console.log(
        `  ${chalk.gray(t('listUsedBy'))} ${chalk.yellow(t('listUsedByCount', { count: entry.usedBy.length }))}`,
      );
      for (const project of entry.usedBy) {
        console.log(`    ${logger.path(project)}`);
      }
    } else {
      console.log(`  ${chalk.gray(t('listUsedBy'))} ${chalk.gray('-')}`);
    }
  }

  console.log();
  logger.log(t('listTotal', { count: packages.length }));
};

export default list;
