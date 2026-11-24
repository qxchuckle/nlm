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

export interface WrapInstallCommandOptions {
  /** app 是否使用 pnpm 全局虚拟店（wrap 跟随启用同配置） */
  globalVirtualStore?: boolean;
}

/**
 * 构建 wrap 目录的冲突依赖安装命令
 *
 * 关键参数语义：
 * - 禁 lock（--lockfile=false / --no-lockfile / --no-package-lock）：零 lock 制品约束
 * - --prefer-offline：跳过 metadata 网络校验（大依赖树实测 116s → 7.6s）
 * - pnpm 必须同时关闭 `auto-install-peers`：pnpm 8+ 默认自动安装缺失 peer，
 *   会让「已在 nlm 侧判定为 peer/skip 的依赖」又被装进 wrap（典型：umi ^3.3.7 整树），
 *   使 L1「peer 不装」对传递依赖失效；`--legacy-peer-deps`（npm 系）本身不装 peer，无需此参数
 */
export const buildWrapInstallCommand = (
  pm: string,
  kind: PackageManagerKind,
  options: WrapInstallCommandOptions = {},
): string => {
  switch (kind) {
    case 'wrap-pnpm': {
      const globalStoreOpt = options.globalVirtualStore
        ? ' --config.enable-global-virtual-store=true'
        : '';
      return `${pm} install --ignore-workspace --lockfile=false --prefer-offline --config.strict-peer-dependencies=false --config.auto-install-peers=false${globalStoreOpt}`;
    }
    case 'wrap-yarn':
      return `${pm} install --no-lockfile --prefer-offline`;
    case 'wrap-npm':
      return `${pm} install --no-package-lock --prefer-offline --legacy-peer-deps`;
    default:
      return `${pm} install`;
  }
};
