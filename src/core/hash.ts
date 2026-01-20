import fs from 'fs-extra';
import { join } from 'path';
import xxhash, { type XXHashAPI } from 'xxhash-wasm';
import { SIGNATURE_FILE_NAME } from '../constants';
import logger from '../utils/logger';
import { t } from '../utils/i18n';

/**
 * 计算目录下所有文件的签名（使用 xxhash64 流式计算）
 * @param files 文件列表（相对路径）
 * @param baseDir 基础目录
 */
export const computeFilesSignature = async (
  files: string[],
  baseDir: string,
): Promise<string> => {
  const startTime = Date.now();
  const hasher = await xxhash();

  // 对文件列表排序，确保顺序一致
  const sortedFiles = [...files].sort();

  const fileHashes = await Promise.all(
    sortedFiles.map(async (file) => {
      const normalizedPath = file.replace(/\\/g, '/');
      const data = await fs.readFile(join(baseDir, file));
      const h = hasher.create64();
      h.update(normalizedPath).update(data);
      return h.digest().toString(16);
    }),
  );

  const h64 = hasher.create64();
  h64.update(fileHashes.join(''));
  const signature = h64.digest().toString(16).padStart(16, '0');

  const endTime = Date.now();
  logger.debug(
    t('debugComputeFilesSignatureTime', {
      signature,
      time: endTime - startTime,
    }),
  );

  return signature;
};

/**
 * 读取签名文件
 */
export const readSignatureFile = (dir: string): string => {
  const signaturePath = join(dir, SIGNATURE_FILE_NAME);
  try {
    return fs.readFileSync(signaturePath, 'utf-8').trim();
  } catch {
    return '';
  }
};

/**
 * 写入签名文件
 */
export const writeSignatureFile = (dir: string, signature: string): void => {
  const signaturePath = join(dir, SIGNATURE_FILE_NAME);
  fs.writeFileSync(signaturePath, signature);
};

/**
 * 比较签名是否相同
 */
export const compareSignatures = (sig1: string, sig2: string): boolean => {
  return sig1 === sig2 && sig1 !== '';
};
