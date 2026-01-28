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
  const { workingDir, force, buildScript, pushShowScriptList, pushVersion } =
    getRuntime();
  const startTime = Date.now();

  // 读取当前包的 package.json
  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    throw new NlmError(t('errInvalidPackage'));
  }

  // 确保当前目录 .gitignore 中包含 .nlm
  ensureGitignoreHasNlm(workingDir);

  if (
    pushVersion != null &&
    pushVersion !== 'latest' &&
    !isValidVersion(pushVersion) &&
    !isValidVersionRange(pushVersion)
  ) {
    throw new NlmError(t('pushVersionInvalid', { version: pushVersion }));
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
  if (pushVersion === 'latest') {
    if (storeVersions.length === 0) {
      throw new NlmError(t('pushVersionLatestNotAvailable'));
    }
    effectiveVersion = storeVersions[storeVersions.length - 1];
    updateRuntime({ pushVersion: effectiveVersion });
  } else if (
    pushVersion != null &&
    isValidVersionRange(pushVersion) &&
    !isValidVersion(pushVersion)
  ) {
    const resolved = resolveVersion(pushVersion, storeVersions);
    if (!resolved) {
      throw new NlmError(t('pushVersionNoMatch', { range: pushVersion }));
    }
    effectiveVersion = resolved.version;
    updateRuntime({ pushVersion: effectiveVersion });
  } else {
    effectiveVersion = pushVersion ?? version;
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
