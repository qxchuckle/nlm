import { NlmError } from '../types';
import { LATEST_VERSION, getProjectPackageDir } from '../constants';
import { parsePackageName, isValidProject } from '../utils/package';
import { resolveVersion } from '../utils/version';
import {
  packageExistsInStore,
  addPackageUsage,
  getPackageVersionsInStore,
  getAllPackagesInStore,
} from '../core/store';
import { addPackageToLockfile, isPackageInLockfile } from '../core/lockfile';
import { copyPackageToProject } from '../services/copy';
import { checkAndHandleDependencyConflicts } from '../services/dependency';
import { replaceNestedPackages } from '../services/nested';
import { getRuntime } from '../core/runtime';
import { updateSinglePackage } from './update';
import logger from '../utils/logger';
import { t } from '../utils/i18n';
import { promptMultiSelectPro, type MultiSelectChoice } from '../utils/prompt';

/**
 * 安装单个包
 */
const installPackage = async (
  workingDir: string,
  packageName: string,
): Promise<void> => {
  logger.info(t('installPackage', { pkg: logger.pkg(packageName) }));

  // 解析包名和版本
  const { name, version: requestedVersion } = parsePackageName(packageName);

  if (!name) {
    throw new NlmError(t('errInvalidPackageName', { name: packageName }));
  }

  // 检查包是否存在于 store
  if (!packageExistsInStore(name)) {
    logger.info(
      t('installRunPushFirst', { name, cmd: logger.cmd('nlm push') }),
    );
    throw new NlmError(t('installNotInStore', { pkg: logger.pkg(name) }));
  }

  // 确定要安装的版本
  const availableVersions = getPackageVersionsInStore(name);
  const resolved = resolveVersion(requestedVersion, availableVersions);

  if (!resolved) {
    if (availableVersions.length > 0) {
      logger.info(
        t('installAvailableVersions', {
          versions: availableVersions.join(' '),
        }),
      );
    }
    const versionStr = requestedVersion || LATEST_VERSION;
    throw new NlmError(
      resolved === null && requestedVersion
        ? t('installNoMatchVersion', { version: logger.version(versionStr) })
        : t('installNoVersion', { pkg: logger.pkg(name) }),
    );
  }

  const versionToInstall = resolved.version;

  // 打印版本解析信息
  logger.info(
    t('installTargetVersion', {
      target: logger.version(requestedVersion || LATEST_VERSION),
      actual: logger.version(versionToInstall),
    }),
  );

  // 复制包到 .nlm 并在 node_modules 中创建软链接
  const startTime = Date.now();
  logger.spin(
    t('installPackage', {
      pkg: `${logger.pkg(name)}@${logger.version(versionToInstall)}`,
    }),
  );

  const copyResult = await copyPackageToProject(name, versionToInstall);

  // 获取 .nlm 中的实际包路径
  const nlmPackageDir = getProjectPackageDir(workingDir, name);

  // 处理依赖冲突
  logger.spinText(t('installProcessDeps'));
  await checkAndHandleDependencyConflicts(name, nlmPackageDir, workingDir);
  logger.spin(t('installContinue'));

  // 替换嵌套的同名包（使用软链接指向 .nlm 中的包）
  logger.spinText(t('installReplaceNested'));
  await replaceNestedPackages(workingDir, name, nlmPackageDir);

  // 更新 lockfile
  addPackageToLockfile(workingDir, name, {
    version: requestedVersion || LATEST_VERSION,
    signature: copyResult.signature,
  });

  // 更新 store 使用记录
  addPackageUsage(name, workingDir);

  logger.spinSuccess(
    t('installComplete', {
      pkg: `${logger.pkg(name, versionToInstall)} ${logger.duration(startTime)}`,
    }),
  );
};

/**
 * 判断应该安装还是更新
 */
export const shouldInstallOrUpdate = (
  workingDir: string,
  packageName: string,
): 'install' | 'update' => {
  const { name, version } = parsePackageName(packageName);
  if (!name) {
    return 'install';
  }
  // 指定了版本，则安装
  if (version) {
    return 'install';
  }
  // 在 lockfile 中存在，且没有指定版本，则按 lock 更新
  if (isPackageInLockfile(workingDir, name)) {
    return 'update';
  }
  return 'install';
};

/**
 * 执行 install 命令
 */
export const install = async (packageNames?: string[]): Promise<void> => {
  const { workingDir } = getRuntime();

  // 检查当前目录是否是有效项目
  if (!isValidProject(workingDir)) {
    throw new NlmError(t('errInvalidProject'));
  }

  // 如果没有指定包名，提供 store 中所有包的多选
  if (!packageNames || packageNames.length === 0) {
    const allPackages = getAllPackagesInStore();

    if (allPackages.length === 0) {
      logger.info(t('installStoreEmpty'));
      return;
    }

    // 构建选项，已安装的包添加后缀
    const choices: MultiSelectChoice<string>[] = allPackages.map((pkg) => ({
      value: pkg,
      suffix: isPackageInLockfile(workingDir, pkg)
        ? t('tagInstalled')
        : undefined,
    }));

    const selectedPackages = await promptMultiSelectPro(
      t('installSelectPackages'),
      choices,
    );

    if (selectedPackages.length === 0) {
      logger.info(t('installCancelled'));
      return;
    }

    packageNames = selectedPackages;
  }

  const startTime = Date.now();
  let installedCount = 0;
  let updatedCount = 0;

  // 安装所有包
  for (const packageName of packageNames) {
    const action = shouldInstallOrUpdate(workingDir, packageName);
    if (action === 'install') {
      await installPackage(workingDir, packageName);
      installedCount++;
    } else {
      await updateSinglePackage(packageName);
      updatedCount++;
    }
  }

  if (installedCount > 0 || updatedCount > 0) {
    logger.success(
      `${t('installed', { count: installedCount })} ${t('updated', { count: updatedCount })} ${logger.duration(startTime)}`,
    );
  }
};

export default install;
