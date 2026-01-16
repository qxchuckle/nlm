import crypto from 'crypto';
import fs from 'fs-extra';
import { join } from 'path';
import { SIGNATURE_FILE_NAME } from '../constants';

/**
 * 计算单个文件的 hash
 * @param filePath 文件路径
 * @param relativePath 相对路径（用于包含在 hash 计算中）
 */
export const getFileHash = (
  filePath: string,
  relativePath: string = '',
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const md5sum = crypto.createHash('md5');

    // 将相对路径也纳入 hash 计算，确保路径变化也会导致 hash 变化
    md5sum.update(relativePath.replace(/\\/g, '/'));

    stream.on('data', (data) => md5sum.update(data));
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(md5sum.digest('hex'));
    });
  });
};

/**
 * 计算多个文件的综合签名
 * @param fileHashes 各文件的 hash 数组
 */
export const computeSignature = (fileHashes: string[]): string => {
  return crypto.createHash('md5').update(fileHashes.join('')).digest('hex');
};

/**
 * 计算目录下所有文件的签名
 * @param files 文件列表（相对路径）
 * @param baseDir 基础目录
 */
export const computeFilesSignature = async (
  files: string[],
  baseDir: string,
): Promise<string> => {
  // 对文件列表排序，确保顺序一致
  const sortedFiles = [...files].sort();

  const hashes = await Promise.all(
    sortedFiles.map((file) => getFileHash(join(baseDir, file), file)),
  );

  return computeSignature(hashes);
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
