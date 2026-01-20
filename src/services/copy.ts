import fs from 'fs-extra';
import { join, relative } from 'path';
import { CopyResult } from '../types';
import { getPackageStoreDir, getProjectPackageDir } from '../constants';
import {
  computeFilesSignature,
  readSignatureFile,
  writeSignatureFile,
} from '../core/hash';
import { getPackFiles, readPackageManifest } from '../utils/package';
import { ensureDirSync, removeSync, pathExistsSync } from '../utils/file';
import { getRuntime } from '../core/runtime';
import logger from '../utils/logger';
import { ensureGitignoreHasNlm } from '@/utils/gitignore';
import { t } from '../utils/i18n';

/**
 * 提取顶层路径，直接复制整个目录/文件
 */
const copyFilesByTopLevel = async (
  files: string[],
  srcDir: string,
  destDir: string,
): Promise<void> => {
  const copyStartTime = Date.now();
  // 清理目标目录并复制文件
  // removeSync(destDir);
  // ensureDirSync(destDir);
  // 提取顶层路径
  const topLevelPaths = [...new Set(files.map((f) => f.split('/')[0]))];
  // 并行复制每个顶层路径
  await Promise.all(
    topLevelPaths.map(async (topLevel) => {
      const src = join(srcDir, topLevel);
      const dest = join(destDir, topLevel);
      await fs.copy(src, dest);
    }),
  );
  const copyEndTime = Date.now();
  logger.debug(t('debugCopyTime', { time: copyEndTime - copyStartTime }));
};

/**
 * 复制包到全局 store
 * 从 runtime 读取 workingDir 和 force 配置
 */
export const copyPackageToStore = async (): Promise<CopyResult> => {
  const { workingDir, force } = getRuntime();
  const pkg = readPackageManifest(workingDir);

  if (!pkg) {
    throw new Error(t('copyReadPackageJsonFailed'));
  }

  const { name, version } = pkg;
  const storeDir = getPackageStoreDir(name, version);

  // 获取要发布的文件列表
  const files = await getPackFiles(workingDir);
  if (files.length === 0) {
    throw new Error(t('copyNoFilesToPublish'));
  }

  // 计算新签名
  const newSignature = await computeFilesSignature(files, workingDir);

  // 检查是否需要更新
  if (!force && pathExistsSync(storeDir)) {
    const existingSignature = readSignatureFile(storeDir);
    logger.debug(
      `${logger.pkg(name, version)} signature: exists=${existingSignature} current=${newSignature}`,
    );
    if (existingSignature === newSignature) {
      logger.info(t('copyNoChange', { pkg: logger.pkg(name, version) }));
      return {
        success: true,
        signature: newSignature,
        changed: false,
      };
    }
  }

  await copyFilesByTopLevel(files, workingDir, storeDir);

  // 写入签名文件
  writeSignatureFile(storeDir, newSignature);

  logger.success(t('copyCopiedToStore', { pkg: logger.pkg(name, version) }));

  return {
    success: true,
    signature: newSignature,
    changed: true,
  };
};

/**
 * 从 store 复制包到项目的 .nlm 并在 node_modules 中创建软链接
 * 从 runtime 读取 workingDir 和 force 配置
 * @param packageName 包名
 * @param version 版本
 */
export const copyPackageToProject = async (
  packageName: string,
  version: string,
): Promise<CopyResult> => {
  const { workingDir: targetDir, force } = getRuntime();
  const storeDir = getPackageStoreDir(packageName, version);

  if (!pathExistsSync(storeDir)) {
    throw new Error(t('copyNotInStore', { pkg: `${packageName}@${version}` }));
  }

  // 确保 .gitignore 中包含 .nlm
  ensureGitignoreHasNlm(targetDir);

  // 项目 .nlm 中的包目录
  const nlmPackageDir = getProjectPackageDir(targetDir, packageName);
  // node_modules 中的链接目标
  const nodeModulesDir = join(targetDir, 'node_modules', packageName);
  const storeSignature = readSignatureFile(storeDir);

  // 检查 .nlm 中是否已存在且签名相同
  if (!force && pathExistsSync(nlmPackageDir)) {
    const existingSignature = readSignatureFile(nlmPackageDir);
    logger.debug(
      `${logger.pkg(packageName, version)} signature: exists=${existingSignature} current=${storeSignature}`,
    );
    if (existingSignature === storeSignature) {
      // 确保软链接存在且正确
      await ensureSymlink(nlmPackageDir, nodeModulesDir);
      logger.info(t('copyNoChange', { pkg: logger.pkg(packageName, version) }));
      return {
        success: true,
        signature: storeSignature,
        changed: false,
      };
    }
  }

  // 清理并复制到 .nlm
  // removeSync(nlmPackageDir);
  ensureDirSync(nlmPackageDir);
  await fs.copy(storeDir, nlmPackageDir);

  // 在 node_modules 中创建软链接
  await ensureSymlink(nlmPackageDir, nodeModulesDir);

  logger.debug(
    `${logger.pkg(packageName, version)} -> ${logger.path(targetDir)}`,
  );

  return {
    success: true,
    signature: storeSignature,
    changed: true,
  };
};

/**
 * 确保软链接存在且指向正确的目标
 * @param target 链接目标（实际文件位置）
 * @param linkPath 链接路径（node_modules 中的位置）
 */
const ensureSymlink = async (
  target: string,
  linkPath: string,
): Promise<void> => {
  const expectedTarget = relative(join(linkPath, '..'), target);

  // 使用 lstat 检查路径本身（不跟随软链接）
  try {
    const stats = await fs.lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const currentTarget = await fs.readlink(linkPath);
      if (currentTarget === expectedTarget || currentTarget === target) {
        // 链接已正确
        return;
      }
    }
    // 删除现有的目录或错误的链接
    removeSync(linkPath);
  } catch {
    // 路径不存在，继续创建
  }

  // 确保父目录存在（处理 scoped packages 如 @scope/pkg）
  await fs.ensureDir(join(linkPath, '..'));

  // 创建相对路径的软链接
  await fs.symlink(expectedTarget, linkPath, 'junction');
};

/**
 * 获取 store 中包的签名
 */
export const getStorePackageSignature = (
  packageName: string,
  version: string,
): string => {
  const storeDir = getPackageStoreDir(packageName, version);
  return readSignatureFile(storeDir);
};
