import chalk from 'chalk';
import { join } from 'path';
import { readLockfile, lockfileExists } from '../core/lockfile';
import {
  getAllPackagesInStore,
  getPackageVersionsInStore,
  readStoreConfig,
  packageExistsInStore,
} from '../core/store';
import { readInstalledPackageManifest, isValidProject } from '../utils/package';
import { pathExistsSync, lstatSync } from '../utils/file';
import { resolveVersion, compareVersions } from '../utils/version';
import { getRuntime } from '../core/runtime';
import { LATEST_VERSION, getProjectPackageDir } from '../constants';
import { NlmError } from '../types';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

interface PackageStatus {
  name: string;
  lockedVersion: string;
  installedVersion: string | null;
  latestVersion: string | null;
  linkOk: boolean;
  hasUpdate: boolean;
  inStore: boolean;
}

const checkSymlink = (workingDir: string, packageName: string): boolean => {
  const nodeModulesPath = join(workingDir, 'node_modules', packageName);
  const nlmPackagePath = getProjectPackageDir(workingDir, packageName);
  if (!pathExistsSync(nodeModulesPath)) return false;
  try {
    const stat = lstatSync(nodeModulesPath);
    if (!stat?.isSymbolicLink()) return false;
    if (!pathExistsSync(nlmPackagePath)) return false;
    return true;
  } catch {
    return false;
  }
};

const getPackageStatus = (
  workingDir: string,
  name: string,
  lockedVersion: string,
): PackageStatus => {
  const inStore = packageExistsInStore(name);
  const installedPkg = readInstalledPackageManifest(workingDir, name);
  const installedVersion = installedPkg?.version || null;
  const storeVersions = getPackageVersionsInStore(name);
  const latestVersion =
    storeVersions.length > 0 ? storeVersions[storeVersions.length - 1] : null;
  const linkOk = checkSymlink(workingDir, name);
  let hasUpdate = false;
  if (installedVersion && latestVersion && inStore) {
    const resolved = resolveVersion(lockedVersion, storeVersions);
    if (resolved && resolved.version !== installedVersion) hasUpdate = true;
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
 * 执行 list 命令
 * showStore=true 时列 store；否则列当前项目包并带状态（含原 status 能力）
 */
export const list = async (showStore: boolean): Promise<void> => {
  const { workingDir } = getRuntime();

  if (showStore) {
    await listStore();
  } else {
    await listProject(workingDir);
  }
};

/** 列出当前项目 nlm 包及状态（合并原 status 能力） */
const listProject = async (workingDir: string): Promise<void> => {
  if (!isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProjectSimple'));
  }
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
  const statuses: PackageStatus[] = [];
  for (const [name, entry] of packages) {
    statuses.push(getPackageStatus(workingDir, name, entry.version));
  }

  const totalCount = statuses.length;
  const okCount = statuses.filter((s) => s.linkOk && s.inStore).length;
  const brokenCount = statuses.filter((s) => !s.linkOk).length;
  const missingCount = statuses.filter((s) => !s.inStore).length;
  const outdatedCount = statuses.filter((s) => s.hasUpdate).length;

  logger.log(t('statusTitle'));
  console.log();

  for (const pkg of statuses) {
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
    console.log(`${statusIcon} ${logger.pkg(pkg.name)} ${statusText}`);

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
    const entry = storeConfig[pkg.name];
    if (entry?.target) {
      console.log(
        `  ${chalk.gray(t('statusSource'))} ${logger.path(entry.target)}`,
      );
    }
  }

  console.log();
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

  if (brokenCount > 0) {
    console.log();
    logger.warn(t('statusFixBroken', { cmd: logger.cmd('nlm update') }));
  }
  if (missingCount > 0) {
    console.log();
    logger.warn(t('statusFixMissing', { cmd: logger.cmd('nlm push') }));
  }
};

/** 列出全局 store 中的包 */
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
    console.log(
      `  ${chalk.gray(t('listSourcePath'))} ${logger.path(entry?.target ?? '-')}`,
    );
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
