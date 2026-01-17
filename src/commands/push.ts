import { NlmError } from '../types';
import { readPackageManifest } from '../utils/package';
import { copyPackageToStore } from '../services/copy';
import { setPackageTarget, getPackageUsages } from '../core/store';
import { getLockfilePackage } from '../core/lockfile';
import { getRuntime, updateRuntime } from '../core/runtime';
import { updateSinglePackage } from './update';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

/**
 * 执行 push 命令
 * 将当前包推送到全局 store，并更新所有使用此包的项目
 */
export const push = async (): Promise<void> => {
  const { workingDir, force } = getRuntime();

  // 读取当前包的 package.json
  const pkg = readPackageManifest(workingDir);
  if (!pkg) {
    throw new NlmError(t('errInvalidPackage'));
  }

  const { name, version } = pkg;

  // 复制包到 store
  let copyResult;
  const pushStartTime = Date.now();
  try {
    logger.spin(t('pushToStore', { pkg: logger.pkg(name, version) }));
    copyResult = await copyPackageToStore();
    logger.spinSuccess(
      t('pushedToStore', {
        pkg: `${logger.pkg(name, version)} ${logger.duration(pushStartTime)}`,
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

  logger.success(t('pushComplete', { count: updatedCount }));
};

export default push;
