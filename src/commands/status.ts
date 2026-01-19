import chalk from 'chalk';
import { join } from 'path';
import { readLockfile, lockfileExists } from '../core/lockfile';
import {
  getPackageVersionsInStore,
  readStoreConfig,
  packageExistsInStore,
} from '../core/store';
import { readInstalledPackageManifest, isValidProject } from '../utils/package';
import { pathExistsSync, lstatSync } from '../utils/file';
import { resolveVersion } from '../utils/version';
import { getRuntime } from '../core/runtime';
import { LATEST_VERSION, getProjectPackageDir } from '../constants';
import { NlmError } from '../types';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

interface PackageStatus {
  name: string;
  /** lockfile 中记录的版本规则 */
  lockedVersion: string;
  /** 实际安装的版本 */
  installedVersion: string | null;
  /** store 中最新可用版本 */
  latestVersion: string | null;
  /** 软链接是否正常 */
  linkOk: boolean;
  /** 是否有更新 */
  hasUpdate: boolean;
  /** 包在 store 中是否存在 */
  inStore: boolean;
}

/**
 * 检查软链接状态
 */
const checkSymlink = (workingDir: string, packageName: string): boolean => {
  const nodeModulesPath = join(workingDir, 'node_modules', packageName);
  const nlmPackagePath = getProjectPackageDir(workingDir, packageName);

  // 检查 node_modules 中的路径是否存在
  if (!pathExistsSync(nodeModulesPath)) {
    return false;
  }

  try {
    const stat = lstatSync(nodeModulesPath);
    // 检查是否是软链接
    if (!stat?.isSymbolicLink()) {
      return false;
    }

    // 检查 .nlm 中的包是否存在
    if (!pathExistsSync(nlmPackagePath)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * 获取单个包的状态
 */
const getPackageStatus = (
  workingDir: string,
  name: string,
  lockedVersion: string,
): PackageStatus => {
  // 检查包是否在 store 中
  const inStore = packageExistsInStore(name);

  // 获取实际安装的版本
  const installedPkg = readInstalledPackageManifest(workingDir, name);
  const installedVersion = installedPkg?.version || null;

  // 获取 store 中的版本列表
  const storeVersions = getPackageVersionsInStore(name);
  const latestVersion =
    storeVersions.length > 0 ? storeVersions[storeVersions.length - 1] : null;

  // 检查软链接状态
  const linkOk = checkSymlink(workingDir, name);

  // 检查是否有更新
  let hasUpdate = false;
  if (installedVersion && latestVersion && inStore) {
    // 解析 lockfile 中的版本规则，看最新版本是否满足
    const resolved = resolveVersion(lockedVersion, storeVersions);
    if (resolved && resolved.version !== installedVersion) {
      hasUpdate = true;
    }
    // 如果是 latest，直接比较
    if (
      lockedVersion === LATEST_VERSION &&
      installedVersion !== latestVersion
    ) {
      hasUpdate = true;
    }
  }

  return {
    name,
    lockedVersion,
    installedVersion,
    latestVersion,
    linkOk,
    hasUpdate,
    inStore,
  };
};

/**
 * 执行 status 命令
 */
export const status = async (): Promise<void> => {
  const { workingDir } = getRuntime();

  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProjectSimple'));
  }

  // 检查是否有 lockfile
  if (!lockfileExists(workingDir)) {
    logger.info(t('statusNoPackages'));
    return;
  }

  const lockfile = readLockfile(workingDir);
  const packages = Object.entries(lockfile.packages);

  if (packages.length === 0) {
    logger.info(t('statusNoPackages'));
    return;
  }

  const storeConfig = readStoreConfig();

  // 收集所有包的状态
  const statuses: PackageStatus[] = [];
  for (const [name, entry] of packages) {
    const pkgStatus = getPackageStatus(workingDir, name, entry.version);
    statuses.push(pkgStatus);
  }

  // 统计信息
  const totalCount = statuses.length;
  const okCount = statuses.filter((s) => s.linkOk && s.inStore).length;
  const brokenCount = statuses.filter((s) => !s.linkOk).length;
  const missingCount = statuses.filter((s) => !s.inStore).length;
  const outdatedCount = statuses.filter((s) => s.hasUpdate).length;

  // 打印标题
  logger.log(t('statusTitle'));
  console.log();

  // 打印每个包的状态
  for (const pkg of statuses) {
    // 状态图标
    let statusIcon: string;
    let statusText: string;

    if (!pkg.inStore) {
      statusIcon = chalk.red('✗');
      statusText = chalk.red(t('statusMissing'));
    } else if (!pkg.linkOk) {
      statusIcon = chalk.yellow('⚠');
      statusText = chalk.yellow(t('statusBroken'));
    } else if (pkg.hasUpdate) {
      statusIcon = chalk.blue('↑');
      statusText = chalk.blue(t('statusOutdated'));
    } else {
      statusIcon = chalk.green('✓');
      statusText = chalk.green(t('statusOk'));
    }

    // 包名和状态
    console.log(`${statusIcon} ${logger.pkg(pkg.name)} ${statusText}`);

    // 版本信息
    const lockedDisplay =
      pkg.lockedVersion === LATEST_VERSION
        ? chalk.yellow('latest')
        : chalk.cyan(pkg.lockedVersion);

    const installedDisplay = pkg.installedVersion
      ? chalk.green(pkg.installedVersion)
      : chalk.red('-');

    const latestDisplay = pkg.latestVersion
      ? chalk.green(pkg.latestVersion)
      : chalk.gray('-');

    console.log(
      `  ${chalk.gray(t('statusLocked'))} ${lockedDisplay}  ${chalk.gray(t('statusInstalled'))} ${installedDisplay}  ${chalk.gray(t('statusLatest'))} ${latestDisplay}`,
    );

    // 源路径
    const entry = storeConfig[pkg.name];
    if (entry?.target) {
      console.log(
        `  ${chalk.gray(t('statusSource'))} ${logger.path(entry.target)}`,
      );
    }
  }

  console.log();

  // 打印摘要
  logger.log(t('statusSummary'));

  const summaryParts: string[] = [];
  summaryParts.push(chalk.white(t('statusTotal', { count: totalCount })));

  if (okCount > 0) {
    summaryParts.push(chalk.green(t('statusOkCount', { count: okCount })));
  }
  if (brokenCount > 0) {
    summaryParts.push(
      chalk.yellow(t('statusBrokenCount', { count: brokenCount })),
    );
  }
  if (missingCount > 0) {
    summaryParts.push(
      chalk.red(t('statusMissingCount', { count: missingCount })),
    );
  }
  if (outdatedCount > 0) {
    summaryParts.push(
      chalk.blue(t('statusOutdatedCount', { count: outdatedCount })),
    );
  }

  console.log(`  ${summaryParts.join('  ')}`);

  // 提示修复建议
  if (brokenCount > 0) {
    console.log();
    logger.warn(t('statusFixBroken', { cmd: logger.cmd('nlm update') }));
  }

  if (missingCount > 0) {
    console.log();
    logger.warn(t('statusFixMissing', { cmd: logger.cmd('nlm push') }));
  }
};

export default status;
