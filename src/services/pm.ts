import { basename } from 'path';

/**
 * 包管理器类别：决定冲突依赖的安装位置与参数策略（各命令组合均已实测验证）
 * 统一 wrap 独立安装：此前 app 域安装（file:/tarball）在多 nlm 包场景下，
 * 后装包会在 app 树重算时清理先装包的安装产物（互踩致悬空），故全部改为 wrap 独立
 */
export type PackageManagerKind =
  | 'wrap-pnpm' // pnpm：wrap 目录独立安装 + 后置复用优化
  | 'wrap-yarn' // yarn 1：wrap 目录独立安装 + 后置复用优化
  | 'wrap-npm' // npm / fnpm / cnpm：wrap 目录独立安装（npm 系参数）
  | 'wrap-plain'; // 未知：wrap 目录保守安装

/**
 * 按命令名识别包管理器类别（精确匹配，容忍路径前缀与参数后缀）
 * 注意 fnpm 与 cnpm 同属 wrap-npm（fnpm 为 cnpm 封装，npm 系参数一致）
 */
export const detectPackageManagerKind = (pm: string): PackageManagerKind => {
  const cmd = basename(pm.trim().split(/\s+/)[0] || '');
  if (cmd === 'pnpm') return 'wrap-pnpm';
  if (cmd === 'yarn' || cmd === 'yarnpkg') return 'wrap-yarn';
  if (cmd === 'npm' || cmd === 'fnpm' || cmd === 'cnpm') return 'wrap-npm';
  return 'wrap-plain';
};
