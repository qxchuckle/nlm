import fs from 'fs-extra';
import { dirname, join, relative } from 'path';
import { Dependencies } from '../types';
import { readPackageManifest } from '../utils/package';
import { satisfiesVersion, isSemverVersionOrRange } from '../utils/version';
import {
  pathExistsSync,
  readdirWithFileTypesSync,
  isSymlink,
  removeSync,
  createSymlinkSync,
} from '../utils/file';
import { getConflictDepsPackageDir } from '../constants';
import logger from '../utils/logger';
import { t } from '../utils/i18n';
import { PackageManagerKind } from './pm';

/**
 * 冲突依赖复用优化（三层模型的 L2）
 * 目标：wrap 树中能与 app 已有副本合一的依赖，替换为指向 app 实体的 symlink
 * （Node 以 realpath 作模块缓存键，指向同一实体即模块单实例，防大型 app 内存崩溃）
 * 口径：
 * - 候选：app 全树任意深度（软链只登记不递归），顶层优先（最稳定）
 * - 版本：完全相同优先 → 满足 wrap 树内该包名全部声明范围的 semver 兼容版本
 *   存在非 semver 范围（git / workspace / latest）时只认版本完全相同，宁少复用不复用错
 * 全程 best-effort：任何异常跳过，保留独立副本，不影响正确性
 */

/** app 依赖树中的包实体条目 */
export interface AppEntityEntry {
  /** 实体所在目录 */
  dir: string;
  /** 距 app 顶层 node_modules 的深度（越小越优先） */
  depth: number;
}

/** 复用优化遍历深度上限 */
export const REUSE_MAX_DEPTH = 16;

/**
 * 从 pnpm 虚拟店条目键解析包名
 * is-number@7.0.0 → is-number；@hbos+foo@1.0.0 → @hbos/foo（忽略 peer 后缀）
 */
export const parsePkgNameFromPnpmKey = (key: string): string | null => {
  const at = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  if (at <= 0) return null;
  const name = key.slice(0, at);
  return name.startsWith('@') ? name.replace('+', '/') : name;
};

/** 判断 .pnpm 目录是否为有效的本地虚拟店（含包实体目录条目） */
const hasPnpmStoreEntries = (pnpmDir: string): boolean =>
  readdirWithFileTypesSync(pnpmDir).some(
    (entry) => entry.isDirectory() && entry.name !== 'node_modules',
  );

/**
 * 将 wrap 中的包实体替换为指向 app 实体的 symlink
 * 采用「备份挪走 → 建链 → 清理备份 / 失败回滚」保证实体不丢失
 */
const replaceEntityWithSymlink = (
  wrapEntity: string,
  appEntity: string,
): void => {
  const backupPath = `${wrapEntity}.nlm-opt-bak`;
  removeSync(backupPath); // 清理历史残留备份
  fs.renameSync(wrapEntity, backupPath); // 原子挪走，实体未丢失
  try {
    const relativeTarget = relative(dirname(wrapEntity), appEntity);
    createSymlinkSync(relativeTarget, wrapEntity);
    removeSync(backupPath);
  } catch (error) {
    // 回滚：恢复原实体，保留独立副本
    removeSync(wrapEntity);
    fs.renameSync(backupPath, wrapEntity);
    throw error;
  }
};

/**
 * 建立 app 依赖树索引：包名 → 实体目录（任意深度）
 * 软链目录（pnpm 顶层包）只登记不递归，避免进入虚拟店；一次遍历即可匹配任意深度
 */
export const buildAppEntityIndex = (
  appModules: string,
): Map<string, AppEntityEntry[]> => {
  const index = new Map<string, AppEntityEntry[]>();

  const register = (pkgDir: string, pkgName: string, depth: number): void => {
    const list = index.get(pkgName) || [];
    list.push({ dir: pkgDir, depth });
    index.set(pkgName, list);
    if (!isSymlink(pkgDir)) {
      walk(join(pkgDir, 'node_modules'), depth + 1);
    }
  };

  const walk = (modulesDir: string, depth: number): void => {
    if (depth > REUSE_MAX_DEPTH || !pathExistsSync(modulesDir)) return;
    for (const entry of readdirWithFileTypesSync(modulesDir)) {
      if (entry.name.startsWith('.')) continue; // .bin / .pnpm 等
      const entryPath = join(modulesDir, entry.name);
      if (!entry.isDirectory() && !isSymlink(entryPath)) continue;
      if (entry.name.startsWith('@')) {
        for (const sub of readdirWithFileTypesSync(entryPath)) {
          const subPath = join(entryPath, sub.name);
          if (!sub.isDirectory() && !isSymlink(subPath)) continue;
          register(subPath, `${entry.name}/${sub.name}`, depth);
        }
        continue;
      }
      register(entryPath, entry.name, depth);
    }
  };

  walk(appModules, 0);
  // 浅层优先（app 顶层副本优先于深层副本）
  index.forEach((list) => list.sort((a, b) => a.depth - b.depth));
  return index;
};

/**
 * 收集 wrap 树中所有包对各依赖声明的版本范围
 * 用于「semver 兼容复用」的全集校验（同一顶层槽位可能被多个消费者共享）
 * 包含 wrap 包装包自身（冲突依赖的声明范围所在）
 */
export const collectWrapDeclaredRanges = (
  wrapModules: string,
): Map<string, Set<string>> => {
  const ranges = new Map<string, Set<string>>();

  const addRanges = (deps?: Dependencies): void => {
    for (const [name, range] of Object.entries(deps || {})) {
      const set = ranges.get(name) || new Set<string>();
      set.add(range);
      ranges.set(name, set);
    }
  };

  // wrap 包装包自身的声明（冲突依赖的直接范围）
  const wrapRootManifest = readPackageManifest(join(wrapModules, '..'));
  if (wrapRootManifest) addRanges(wrapRootManifest.dependencies);

  const walk = (modulesDir: string, depth: number): void => {
    if (depth > REUSE_MAX_DEPTH || !pathExistsSync(modulesDir)) return;
    for (const entry of readdirWithFileTypesSync(modulesDir)) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        const scopeDir = join(modulesDir, entry.name);
        for (const sub of readdirWithFileTypesSync(scopeDir)) {
          if (!sub.isDirectory()) continue;
          walkPackage(join(scopeDir, sub.name), depth);
        }
        continue;
      }
      walkPackage(join(modulesDir, entry.name), depth);
    }
  };

  const walkPackage = (pkgDir: string, depth: number): void => {
    // 已优化为软链的包由其目标实体自行解析依赖，不再参与范围收集
    if (isSymlink(pkgDir)) return;
    const manifest = readPackageManifest(pkgDir);
    if (manifest) {
      addRanges(manifest.dependencies);
      addRanges(manifest.peerDependencies);
      addRanges(manifest.optionalDependencies);
    }
    walk(join(pkgDir, 'node_modules'), depth + 1);
  };

  walk(wrapModules, 0);
  return ranges;
};

/**
 * 从 app 索引中挑选可复用的实体
 * 顺序：app 顶层可接受副本（最稳定） → 任意深度版本完全相等 → 任意深度 semver 兼容
 */
export const pickReusableAppEntity = (
  index: Map<string, AppEntityEntry[]>,
  pkgName: string,
  declaredRanges: Set<string> | undefined,
  wrapVersion: string,
  versionCache: Map<string, string | null>,
): AppEntityEntry | null => {
  const candidates = index.get(pkgName);
  if (!candidates || candidates.length === 0) return null;

  const readVersion = (dir: string): string | null => {
    if (!versionCache.has(dir)) {
      versionCache.set(dir, readPackageManifest(dir)?.version || null);
    }
    return versionCache.get(dir) || null;
  };

  const rangeList = Array.from(declaredRanges || []);
  const rangesAreSemver = rangeList.every((range) =>
    isSemverVersionOrRange(range),
  );

  /** 版本是否可接受：完全相等，或满足 wrap 树内全部声明范围 */
  const isAcceptable = (version: string | null): boolean => {
    if (!version) return false;
    if (version === wrapVersion) return true;
    if (rangeList.length === 0 || !rangesAreSemver) return false;
    if (!isSemverVersionOrRange(version)) return false;
    try {
      return rangeList.every((range) => satisfiesVersion(version, range));
    } catch {
      return false;
    }
  };

  // 1) app 顶层副本优先（顶层最稳定，不会随其它包的树变动而消失）
  const topLevel = candidates.find((candidate) => candidate.depth === 0);
  if (topLevel && isAcceptable(readVersion(topLevel.dir))) {
    return topLevel;
  }

  // 2) 任意深度的版本完全相等副本（不改变任何版本语义）
  for (const candidate of candidates) {
    if (readVersion(candidate.dir) === wrapVersion) {
      return candidate;
    }
  }

  // 3) 任意深度的 semver 兼容副本
  for (const candidate of candidates) {
    if (isAcceptable(readVersion(candidate.dir))) {
      return candidate;
    }
  }

  return null;
};

/**
 * 平铺树替换（yarn 1 / npm 系 / pnpm node-linker=hoisted 等）
 * 返回复用统计（供调用方汇总输出）
 */
export const optimizeFlatReuse = (
  wrapModules: string,
  appModules: string,
): { replaced: number; compatible: number } => {
  const stats = { replaced: 0, compatible: 0 };
  if (!pathExistsSync(wrapModules) || !pathExistsSync(appModules)) return stats;

  const appIndex = buildAppEntityIndex(appModules);
  const declaredRanges = collectWrapDeclaredRanges(wrapModules);
  const versionCache = new Map<string, string | null>();

  // 单个包实体：可复用则替换；返回是否已替换
  const handlePackage = (pkgDir: string, pkgName: string): boolean => {
    if (isSymlink(pkgDir)) return false; // 已是 symlink（幂等）
    const wrapManifest = readPackageManifest(pkgDir);
    if (!wrapManifest?.version) return false;
    const appEntity = pickReusableAppEntity(
      appIndex,
      pkgName,
      declaredRanges.get(pkgName),
      wrapManifest.version,
      versionCache,
    );
    if (!appEntity) return false;
    replaceEntityWithSymlink(pkgDir, appEntity.dir);
    stats.replaced += 1;
    if (versionCache.get(appEntity.dir) !== wrapManifest.version) {
      stats.compatible += 1;
    }
    return true;
  };

  // 递归遍历 node_modules 层（已替换为 symlink 的包不再深入）
  const walk = (modulesDir: string, depth: number): void => {
    if (depth > REUSE_MAX_DEPTH) return; // 防御性深度上限
    for (const entry of readdirWithFileTypesSync(modulesDir)) {
      if (entry.name.startsWith('.')) continue; // .bin 等
      if (entry.name.startsWith('@')) {
        if (!entry.isDirectory()) continue;
        const scopeDir = join(modulesDir, entry.name);
        for (const sub of readdirWithFileTypesSync(scopeDir)) {
          const subDir = join(scopeDir, sub.name);
          if (
            !isSymlink(subDir) &&
            !handlePackage(subDir, `${entry.name}/${sub.name}`)
          ) {
            walk(join(subDir, 'node_modules'), depth + 1);
          }
        }
        continue;
      }
      const pkgDir = join(modulesDir, entry.name);
      if (isSymlink(pkgDir) || !entry.isDirectory()) continue;
      if (!handlePackage(pkgDir, entry.name)) {
        walk(join(pkgDir, 'node_modules'), depth + 1);
      }
    }
  };

  walk(wrapModules, 0);
  return stats;
};

/**
 * pnpm 本地虚拟店——键对齐替换
 * 对 wrap 虚拟店中与 app 同键（含 peer hash 的完整条目名）的条目，
 * 将包实体替换为指向 app 实体的 symlink（Node realpath 单实例）
 */
export const optimizePnpmReuse = (
  workingDir: string,
  packageName: string,
): { replaced: number } => {
  const stats = { replaced: 0 };
  const wrapModulesDir = join(
    getConflictDepsPackageDir(workingDir, packageName),
    'node_modules',
  );
  const appModulesDir = join(workingDir, 'node_modules');
  const wrapPnpmDir = join(wrapModulesDir, '.pnpm');
  const appPnpmDir = join(appModulesDir, '.pnpm');
  if (!hasPnpmStoreEntries(wrapPnpmDir) || !hasPnpmStoreEntries(appPnpmDir)) {
    // 非本地虚拟店（如 node-linker=hoisted 平铺 / 全局虚拟店）：退回平铺树替换
    const flatStats = optimizeFlatReuse(wrapModulesDir, appModulesDir);
    stats.replaced = flatStats.replaced;
    return stats;
  }

  for (const entry of readdirWithFileTypesSync(wrapPnpmDir)) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const appEntryDir = join(appPnpmDir, entry.name);
    if (!pathExistsSync(appEntryDir)) continue; // app 无同键条目 → 保守跳过
    const depName = parsePkgNameFromPnpmKey(entry.name);
    if (!depName) continue;
    const wrapEntity = join(wrapPnpmDir, entry.name, 'node_modules', depName);
    const appEntity = join(appEntryDir, 'node_modules', depName);
    if (!pathExistsSync(wrapEntity) || !pathExistsSync(appEntity)) continue;
    if (isSymlink(wrapEntity)) continue; // 幂等：已优化过
    replaceEntityWithSymlink(wrapEntity, appEntity);
    stats.replaced += 1;
  }
  return stats;
};

/**
 * 后置复用优化总入口（best-effort）
 * 汇总输出：让用户看到本次省下了多少重复安装
 */
export const applyReuseOptimizations = (
  kind: PackageManagerKind,
  packageName: string,
  workingDir: string,
): void => {
  try {
    if (kind === 'wrap-pnpm') {
      const stats = optimizePnpmReuse(workingDir, packageName);
      if (stats.replaced > 0) {
        logger.info(t('depReuseSummary', { count: stats.replaced }));
      }
      return;
    }
    // 平铺树（yarn 1 / npm 系 / pnpm hoisted / 未知）
    const stats = optimizeFlatReuse(
      join(getConflictDepsPackageDir(workingDir, packageName), 'node_modules'),
      join(workingDir, 'node_modules'),
    );
    if (stats.replaced > 0) {
      logger.info(
        t('depReuseSummary', { count: stats.replaced }) +
          (stats.compatible > 0
            ? t('depReuseSummaryCompatible', { count: stats.compatible })
            : ''),
      );
    }
  } catch (error) {
    logger.debug(
      `冲突依赖复用优化失败（已跳过，不影响安装）: ${String(error)}`,
    );
  }
};
