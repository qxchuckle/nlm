import semver from 'semver';
import { readdirSync } from './file';

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
 * 支持版本范围（如 ^2.50.9, ~1.2.3）
 */
export const getMajorVersion = (version: string): number | null => {
  // 尝试直接清理版本号
  const cleanVersion = semver.clean(version);
  if (cleanVersion) {
    return semver.major(cleanVersion);
  }

  // 如果是版本范围，尝试用 coerce 提取版本号
  const coerced = semver.coerce(version);
  if (coerced) {
    return semver.major(coerced);
  }

  // 尝试用 minVersion 获取范围的最小版本
  const minVer = semver.minVersion(version);
  if (minVer) {
    return semver.major(minVer);
  }

  return null;
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
 * 检查两个版本范围是否兼容（有交集）
 * 用于判断项目中的依赖版本是否满足 nlm 包的依赖要求
 *
 * @param required nlm 包要求的版本范围（如 ^17.0.0）
 * @param installed 项目中声明的版本范围（如 ^17.0.2）
 * @returns 是否兼容
 */
export const areVersionRangesCompatible = (
  required: string,
  installed: string,
): boolean => {
  try {
    // 使用 semver.intersects 检查两个范围是否有交集
    return semver.intersects(required, installed);
  } catch {
    // 如果解析失败，回退到主版本号比较
    return isSameMajorVersion(required, installed);
  }
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
 * 按照版本号排序，返回最新的版本目录名
 */
export const getLatestVersion = (packageDir: string): string => {
  const versions = readdirSync(packageDir);
  if (versions.length === 0) {
    return '';
  }

  // 按版本号降序排序，获取最新版本
  const sortedVersions = versions
    .filter((v) => isValidVersion(v))
    .sort((a, b) => compareVersions(b, a));

  return sortedVersions[0] || '';
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

/**
 * 版本解析结果
 */
export interface ResolveVersionResult {
  /** 实际要安装的版本 */
  version: string;
  /** 版本类型: latest-最新版, exact-精确版本, range-版本范围 */
  type: 'latest' | 'exact' | 'range';
}

/**
 * 解析并确定要安装的版本
 * 支持 latest、精确版本、版本范围（^1.0.0, ~1.0.0, >=1.0.0 等）
 *
 * @param requestedVersion 请求的版本（可以是 latest、精确版本或版本范围）
 * @param availableVersions 可用的版本列表
 * @returns 解析结果，包含实际版本和版本类型；如果没有匹配版本则返回 null
 */
export const resolveVersion = (
  requestedVersion: string | undefined,
  availableVersions: string[],
): ResolveVersionResult | null => {
  const version = requestedVersion || 'latest';

  // latest: 返回最新版本
  if (version === 'latest') {
    const latestVersion = findBestMatchVersion(availableVersions, 'latest');
    if (!latestVersion) {
      return null;
    }
    return { version: latestVersion, type: 'latest' };
  }

  // 精确版本: 检查是否存在
  if (isValidVersion(version)) {
    const exists = availableVersions.includes(version);
    if (!exists) {
      return null;
    }
    return { version, type: 'exact' };
  }

  // 版本范围: 查找满足范围的最佳版本
  const matchedVersion = findBestMatchVersion(availableVersions, version);
  if (!matchedVersion) {
    return null;
  }
  return { version: matchedVersion, type: 'range' };
};
