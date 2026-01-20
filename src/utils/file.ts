import fs from 'fs-extra';
import { dirname, join } from 'path';

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
 * 同步清空目录（保留目录本身）
 */
export const emptyDirSync = (dir: string): void => {
  fs.emptyDirSync(dir);
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
 * 同步读取目录内容（带文件类型信息）
 * 减少系统调用次数，比 readdirSync + lstatSync 更高效
 */
export const readdirWithFileTypesSync = (dir: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
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
 * 同步获取文件状态（不跟随符号链接）
 */
export const lstatSync = (path: string): fs.Stats | null => {
  try {
    return fs.lstatSync(path);
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
export const writeFile = async (
  path: string,
  content: string,
): Promise<void> => {
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
export const createSymlink = async (
  target: string,
  path: string,
): Promise<void> => {
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

/**
 * 追加内容到文件（如果文件不存在会创建）
 */
export const appendFileSync = (path: string, content: string): void => {
  fs.appendFileSync(path, content, 'utf-8');
};

/**
 * 提取顶层路径
 */
export const extractTopLevelPaths = (paths: string[]): string[] => {
  return [...new Set(paths.map((p) => p.split('/')[0]))];
};

/**
 * 递归遍历源目录，为每个文件创建硬链接
 */
export const copyWithHardlinks = async (
  srcDir: string,
  destDir: string,
): Promise<void> => {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const destPath = join(destDir, entry.name);
      await fs.remove(destPath);
    }),
  );

  const _fn = async (srcDir: string, destDir: string) => {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const srcPath = join(srcDir, entry.name);
        const destPath = join(destDir, entry.name);

        if (entry.isDirectory()) {
          await _fn(srcPath, destPath);
        } else if (entry.isFile()) {
          // 从store分发到项目里用硬链接速度更快
          await fs.ensureLink(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
          // 保留符号链接
          const linkTarget = await fs.readlink(srcPath);
          await fs.symlink(linkTarget, destPath);
        }
      }),
    );
  };

  await _fn(srcDir, destDir);
};
