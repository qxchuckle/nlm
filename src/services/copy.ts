import fs from 'fs-extra';
import { join } from 'path';
import { CopyResult } from '../types';
import { getPackageStoreDir } from '../constants';
import {
  computeFilesSignature,
  readSignatureFile,
  writeSignatureFile,
} from '../core/hash';
import { getPackFiles, readPackageManifest } from '../utils/package';
import { ensureDirSync, removeSync, pathExistsSync } from '../utils/file';
import logger from '../utils/logger';

/**
 * 复制单个文件
 */
const copyFile = async (src: string, dest: string): Promise<void> => {
  await fs.ensureDir(join(dest, '..'));
  await fs.copy(src, dest);
};

/**
 * 复制包到全局 store
 * @param workingDir 包的工作目录
 * @param force 是否强制复制（跳过 hash 检查）
 */
export const copyPackageToStore = async (
  workingDir: string,
  force: boolean = false,
): Promise<CopyResult> => {
  const pkg = readPackageManifest(workingDir);

  if (!pkg) {
    throw new Error('无法读取 package.json');
  }

  const { name, version } = pkg;
  const storeDir = getPackageStoreDir(name, version);

  // 获取要发布的文件列表
  const files = await getPackFiles(workingDir);
  if (files.length === 0) {
    throw new Error('没有找到要发布的文件');
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
      logger.info(`${logger.pkg(name, version)} no change`);
      return {
        success: true,
        signature: newSignature,
        changed: false,
      };
    }
  }

  // 清理目标目录并复制文件
  removeSync(storeDir);
  ensureDirSync(storeDir);

  // 复制所有文件
  await Promise.all(
    files.map((file) => copyFile(join(workingDir, file), join(storeDir, file))),
  );

  // 写入签名文件
  writeSignatureFile(storeDir, newSignature);

  logger.success(`已复制 ${logger.pkg(name, version)} 到 store`);

  return {
    success: true,
    signature: newSignature,
    changed: true,
  };
};

/**
 * 从 store 复制包到项目的 node_modules
 * @param packageName 包名
 * @param version 版本
 * @param targetDir 目标项目目录
 * @param force 是否强制复制
 */
export const copyPackageToProject = async (
  packageName: string,
  version: string,
  targetDir: string,
  force: boolean = false,
): Promise<CopyResult> => {
  const storeDir = getPackageStoreDir(packageName, version);

  if (!pathExistsSync(storeDir)) {
    throw new Error(`${packageName}@${version} 不存在于 store`);
  }

  const destDir = join(targetDir, 'node_modules', packageName);
  const storeSignature = readSignatureFile(storeDir);

  // 检查是否需要更新
  if (!force && pathExistsSync(destDir)) {
    const existingSignature = readSignatureFile(destDir);
    if (existingSignature === storeSignature) {
      logger.info(`${logger.pkg(packageName, version)} 已是最新，跳过复制`);
      return {
        success: true,
        signature: storeSignature,
        changed: false,
      };
    }
  }

  // 清理目标目录并复制
  removeSync(destDir);
  ensureDirSync(destDir);

  await fs.copy(storeDir, destDir);

  logger.success(
    `已安装 ${logger.pkg(packageName, version)} 到 ${logger.path(destDir)}`,
  );

  return {
    success: true,
    signature: storeSignature,
    changed: true,
  };
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
