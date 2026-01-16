import semver from 'semver';
import { join } from 'path';
import { readdirSync, statSync } from './file';

/**
 * 比较两个版本号
 * 返回: 1 (a > b), -1 (a < b), 0 (a == b)
 */
export const compareVersions = (a: string, b: string): number => {
  const cleanA = semver.clean(a) || a;
  const cleanB = semver.clean(b) || b;
  return semver.compare(cleanA, cleanB);
};

/**
 * 检查版本是否满足范围
 */
export const satisfiesVersion = (version: string, range: string): boolean => {
  const cleanVersion = semver.clean(version) || version;
  return semver.satisfies(cleanVersion, range);
};

/**
 * 获取主版本号
 */
export const getMajorVersion = (version: string): number | null => {
  const cleanVersion = semver.clean(version) || version;
  return semver.major(cleanVersion);
};

/**
 * 检查两个版本的主版本号是否相同
 */
export const isSameMajorVersion = (a: string, b: string): boolean => {
  const majorA = getMajorVersion(a);
  const majorB = getMajorVersion(b);
  return majorA !== null && majorB !== null && majorA === majorB;
};

/**
 * 检查版本是否有效
 */
export const isValidVersion = (version: string): boolean => {
  return semver.valid(version) !== null;
};

/**
 * 清理版本号（移除前缀等）
 */
export const cleanVersion = (version: string): string | null => {
  return semver.clean(version);
};

/**
 * 从目录中获取最新版本
 * 按照创建时间排序，返回最新的版本目录名
 */
export const getLatestVersion = (packageDir: string): string => {
  const versions = readdirSync(packageDir);
  if (versions.length === 0) {
    return '';
  }

  // 按创建时间排序，获取最新版本
  const versionWithTime = versions
    .map((version) => {
      const versionPath = join(packageDir, version);
      const stats = statSync(versionPath);
      return {
        version,
        ctime: stats?.ctime.getTime() || 0,
      };
    })
    .filter((item) => item.ctime > 0)
    .sort((a, b) => b.ctime - a.ctime);

  return versionWithTime[0]?.version || '';
};

/**
 * 查找满足版本范围的最佳版本
 */
export const findBestMatchVersion = (
  availableVersions: string[],
  range: string,
): string | null => {
  // 如果是 latest，返回最新版本
  if (range === 'latest' || !range) {
    // 按 semver 排序，返回最大版本
    const sorted = availableVersions
      .filter((v) => isValidVersion(v))
      .sort((a, b) => compareVersions(b, a));
    return sorted[0] || null;
  }

  // 查找满足范围的最大版本
  const matching = availableVersions
    .filter((v) => satisfiesVersion(v, range))
    .sort((a, b) => compareVersions(b, a));

  return matching[0] || null;
};
