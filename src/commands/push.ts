import chalk from 'chalk';
import { NlmError } from '../types';
import { readPackageManifest } from '../utils/package';
import { copyPackageToStore } from '../services/copy';
import { runPackageManagerScript } from '../services/dependency';
import {
  setPackageTarget,
  getPackageUsages,
  getPackageVersionsInStore,
} from '../core/store';
import { getLockfilePackage } from '../core/lockfile';
import { getRuntime, updateRuntime } from '../core/runtime';
import { updateSinglePackage } from './update';
import logger from '../utils/logger';
import { t } from '../utils/i18n';
import { promptSingleSelectPro } from '../utils/prompt';
import { ensureGitignoreHasNlm } from '../utils/gitignore';
import {
  isValidVersion,
  isValidVersionRange,
  compareVersions,
  resolveVersion,
} from '../utils/version';

/**
 * 执行 push 命令
 * 将当前包推送到全局 store，并更新所有使用此包的项目
 */
const SCRIPT_SKIP_VALUE = '__none__';

export const push = async (): Promise<void> => {
  const {
    workingDir,
    force,
    buildScript,
    pushShowScriptList,
    pushVersion,
    nlmConfig,
  } = getRuntime();
  const startTime = Date.now();

  // pushForceLatest 配置：未显式指定版本时强制推送到 store 最新版本
  const effectivePushVersion =
    pushVersion ?? (nlmConfig.pushForceLatest ? 'latest' : undefined);
  if (effectivePushVersion === 'latest' && pushVersion == null) {
    logger.info(t('pushForceLatestApplied'));
  }

  // 读取当前包的 package.json
  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    throw new NlmError(t('errInvalidPackage'));
  }

  // 确保当前目录 .gitignore 中包含 .nlm
  ensureGitignoreHasNlm(workingDir);

  if (
    effectivePushVersion != null &&
    effectivePushVersion !== 'latest' &&
    !isValidVersion(effectivePushVersion) &&
    !isValidVersionRange(effectivePushVersion)
  ) {
    throw new NlmError(
      t('pushVersionInvalid', { version: effectivePushVersion }),
    );
  }

  let scriptToRun = buildScript;
  if (
    pushShowScriptList &&
    pkg.scripts &&
    Object.keys(pkg.scripts).length > 0
  ) {
    const scriptNames = Object.keys(pkg.scripts);
    const choices = [
      { name: t('pushScriptSkip'), value: SCRIPT_SKIP_VALUE },
      ...scriptNames.map((name) => ({
        name: `${name}  ${chalk.gray(pkg.scripts![name])}`,
        value: name,
      })),
    ];
    const defaultScript = scriptNames.includes('build')
      ? 'build'
      : SCRIPT_SKIP_VALUE;
    const chosen =
      process.stdin.isTTY && process.stdout.isTTY
        ? await promptSingleSelectPro(
            t('pushSelectScript'),
            choices,
            defaultScript,
          )
        : defaultScript;
    scriptToRun = chosen === SCRIPT_SKIP_VALUE ? undefined : chosen;
    updateRuntime({ buildScript: scriptToRun });
  }

  // 若需执行脚本，先检查并执行
  if (scriptToRun) {
    if (!pkg.scripts || !(scriptToRun in pkg.scripts)) {
      throw new NlmError(t('pushBuildScriptNotFound', { script: scriptToRun }));
    }
    const scriptContent = pkg.scripts![scriptToRun];
    logger.info(
      t('pushBuildStart', { script: scriptToRun, content: scriptContent }),
    );
    await runPackageManagerScript(workingDir, scriptToRun);
  }

  const { name, version } = pkg;
  const storeVersions = getPackageVersionsInStore(name).sort((a, b) =>
    compareVersions(a, b),
  );
  // 解析推送版本：latest → store 最新；精确版本 → 直接使用；范围(^1.0.0 等) → 从 store 取满足条件的最高版本
  let effectiveVersion: string;
  if (effectivePushVersion === 'latest') {
    if (storeVersions.length === 0) {
      if (pushVersion == null) {
        // pushForceLatest 配置路径：store 为空（首次推送）时按 package.json 版本推送
        effectiveVersion = version;
        updateRuntime({ pushVersion: effectiveVersion });
      } else {
        throw new NlmError(t('pushVersionLatestNotAvailable'));
      }
    } else {
      const storeLatest = storeVersions[storeVersions.length - 1];
      if (
        pushVersion == null &&
        isValidVersion(version) &&
        compareVersions(version, storeLatest) > 0
      ) {
        // pushForceLatest 配置路径：package.json 版本高于 store 最新时以其为准（成为新 latest）
        effectiveVersion = version;
      } else {
        effectiveVersion = storeLatest;
      }
      updateRuntime({ pushVersion: effectiveVersion });
    }
  } else if (
    effectivePushVersion != null &&
    isValidVersionRange(effectivePushVersion) &&
    !isValidVersion(effectivePushVersion)
  ) {
    const resolved = resolveVersion(effectivePushVersion, storeVersions);
    if (!resolved) {
      throw new NlmError(
        t('pushVersionNoMatch', { range: effectivePushVersion }),
      );
    }
    effectiveVersion = resolved.version;
    updateRuntime({ pushVersion: effectiveVersion });
  } else {
    effectiveVersion = effectivePushVersion ?? version;
  }

  // 警告：推送版本落后于 store 最新版本，lockfile 为 latest 的项目不会收到此更新
  const storeLatestVersion = storeVersions[storeVersions.length - 1];
  if (
    storeLatestVersion &&
    isValidVersion(effectiveVersion) &&
    compareVersions(effectiveVersion, storeLatestVersion) < 0
  ) {
    logger.warn(
      t('pushVersionBehindLatest', {
        latest: storeLatestVersion,
        version: effectiveVersion,
      }),
    );
  }

  // 复制包到 store
  let copyResult;
  const pushStartTime = Date.now();
  try {
    logger.spin(t('pushToStore', { pkg: logger.pkg(name, effectiveVersion) }));
    copyResult = await copyPackageToStore();
    logger.spinSuccess(
      t('pushedToStore', {
        pkg: `${logger.pkg(name, effectiveVersion)} ${logger.duration(pushStartTime)}`,
      }),
    );
  } catch (error) {
    logger.spinFail(t('pushFailed', { error: String(error) }));
    throw new NlmError(t('pushFailed', { error: String(error) }));
  }

  // 更新 store 配置中的 target 路径
  setPackageTarget(name, workingDir);

  // 如果内容没有变化且不是强制模式，跳过更新项目
  // if (!copyResult.changed && !force) {
  //   logger.info(t('pushNoChange'));
  //   return;
  // }

  // 获取所有使用此包的项目并更新
  const usages = getPackageUsages(name);

  if (usages.length === 0) {
    logger.info(t('pushNoUsage'));
    return;
  }

  let updatedCount = 0;

  // 记录原 workingDir
  const originalWorkingDir = workingDir;

  for (let i = 0; i < usages.length; i++) {
    const projectPath = usages[i];
    const startTime = Date.now();
    logger.spin(
      t('pushUpdateProject', {
        current: i + 1,
        total: usages.length,
        path: logger.path(projectPath),
      }),
    );

    try {
      // 检查项目中安装的版本
      const lockEntry = getLockfilePackage(projectPath, name);

      if (!lockEntry) {
        logger.spinWarn(
          t('pushProjectNotInstalled', {
            path: `${logger.path(projectPath)} ${logger.duration(startTime)}`,
          }),
        );
        continue;
      }

      // 更新项目中的包（临时切换 workingDir）
      updateRuntime({ workingDir: projectPath });
      const updated = await updateSinglePackage(name);
      updateRuntime({ workingDir: originalWorkingDir });

      if (updated) {
        logger.spinSuccess(
          t('pushUpdatedProject', {
            path: `${logger.path(projectPath)} ${logger.duration(startTime)}`,
          }),
        );
        updatedCount++;
      } else {
        logger.spinInfo(
          t('pushProjectUpToDate', {
            path: `${logger.path(projectPath)} ${logger.duration(startTime)}`,
          }),
        );
      }
    } catch (error) {
      logger.spinFail(
        t('pushUpdateFailed', { path: projectPath, error: String(error) }),
      );
    }
  }

  logger.success(
    t('pushComplete', { count: updatedCount }),
    logger.duration(startTime),
  );
};

export default push;
