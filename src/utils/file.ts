import fs from 'fs-extra';
import { dirname } from 'path';

/**
 * 确保目录存在
 */
export const ensureDir = async (dir: string): Promise<void> => {
  await fs.ensureDir(dir);
};

/**
 * 同步确保目录存在
 */
export const ensureDirSync = (dir: string): void => {
  fs.ensureDirSync(dir);
};

/**
 * 检查路径是否存在
 */
export const pathExists = async (path: string): Promise<boolean> => {
  return fs.pathExists(path);
};

/**
 * 同步检查路径是否存在
 */
export const pathExistsSync = (path: string): boolean => {
  return fs.pathExistsSync(path);
};

/**
 * 读取 JSON 文件
 */
export const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return await fs.readJson(path);
  } catch {
    return null;
  }
};

/**
 * 同步读取 JSON 文件
 */
export const readJsonSync = <T>(path: string): T | null => {
  try {
    return fs.readJsonSync(path);
  } catch {
    return null;
  }
};

/**
 * 写入 JSON 文件
 */
export const writeJson = async <T>(path: string, data: T): Promise<void> => {
  await fs.ensureDir(dirname(path));
  await fs.writeJson(path, data, { spaces: 2 });
};

/**
 * 同步写入 JSON 文件
 */
export const writeJsonSync = <T>(path: string, data: T): void => {
  fs.ensureDirSync(dirname(path));
  fs.writeJsonSync(path, data, { spaces: 2 });
};

/**
 * 复制文件或目录
 */
export const copy = async (src: string, dest: string): Promise<void> => {
  await fs.copy(src, dest);
};

/**
 * 同步复制文件或目录
 */
export const copySync = (src: string, dest: string): void => {
  fs.copySync(src, dest);
};

/**
 * 删除文件或目录
 */
export const remove = async (path: string): Promise<void> => {
  await fs.remove(path);
};

/**
 * 同步删除文件或目录
 */
export const removeSync = (path: string): void => {
  fs.removeSync(path);
};

/**
 * 读取目录内容
 */
export const readdir = async (dir: string): Promise<string[]> => {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
};

/**
 * 同步读取目录内容
 */
export const readdirSync = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * 获取文件状态
 */
export const stat = async (path: string): Promise<fs.Stats | null> => {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
};

/**
 * 同步获取文件状态
 */
export const statSync = (path: string): fs.Stats | null => {
  try {
    return fs.statSync(path);
  } catch {
    return null;
  }
};

/**
 * 读取文件内容
 */
export const readFile = async (path: string): Promise<string> => {
  return fs.readFile(path, 'utf-8');
};

/**
 * 同步读取文件内容
 */
export const readFileSync = (path: string): string => {
  return fs.readFileSync(path, 'utf-8');
};

/**
 * 写入文件内容
 */
export const writeFile = async (path: string, content: string): Promise<void> => {
  await fs.ensureDir(dirname(path));
  await fs.writeFile(path, content, 'utf-8');
};

/**
 * 同步写入文件内容
 */
export const writeFileSync = (path: string, content: string): void => {
  fs.ensureDirSync(dirname(path));
  fs.writeFileSync(path, content, 'utf-8');
};

/**
 * 检查是否是符号链接
 */
export const isSymlink = (path: string): boolean => {
  try {
    return !!fs.readlinkSync(path);
  } catch {
    return false;
  }
};

/**
 * 创建符号链接
 */
export const createSymlink = async (target: string, path: string): Promise<void> => {
  await fs.ensureDir(dirname(path));
  await fs.ensureSymlink(target, path, 'junction');
};

/**
 * 同步创建符号链接
 */
export const createSymlinkSync = (target: string, path: string): void => {
  fs.ensureDirSync(dirname(path));
  fs.ensureSymlinkSync(target, path, 'junction');
};
