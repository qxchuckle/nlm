/**
 * 默认配置
 */
export const DEFAULT_CONFIG: Required<NlmConfig> = {
  packageManager: 'npm',
};

/**
 * NLM 命令错误
 * 用于在命令执行中抛出错误，由外层统一捕获处理
 */
export class NlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NlmError';
  }
}

/**
 * 包名类型（带类型标记）
 */
export type PackageName = string & { __packageName: true };

/**
 * 包的基础信息
 */
export interface PackageInfo {
  name: string;
  version: string;
}

/**
 * package.json 中的依赖定义
 */
export interface Dependencies {
  [name: string]: string;
}

/**
 * package.json 结构
 */
export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  bin?: string | { [name: string]: string };
  main?: string;
  module?: string;
  browser?: string | { [key: string]: string | false };
  types?: string;
  typings?: string;
  exports?: unknown;
  files?: string[];
  man?: string | string[];
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  peerDependencies?: Dependencies;
  optionalDependencies?: Dependencies;
  bundleDependencies?: string[];
  bundledDependencies?: string[];
  /** monorepo 工作区配置 */
  workspaces?: string[] | { packages?: string[]; nohoist?: string[] };
  scripts?: { [name: string]: string };
  /** 内部使用：保存原始缩进 */
  __indent?: string;
}

/** 规范化后的 package.json 类型 */
export interface NormalizedPackage extends PackageManifest {
  // normalize-package-data 会将 bin 统一为对象形式
  bin?: { [name: string]: string };
  // 会添加默认的 main
  main: string;
  // browser 可以是字符串或对象形式
  browser?: string | { [key: string]: string | false };
  // man 可以是字符串或数组
  man?: string | string[];
}

/**
 * nlm-lock.json 中的包条目
 */
export interface LockfilePackageEntry {
  /** 安装的版本 */
  version: string;
  /** 产物签名 hash */
  signature: string;
}

/**
 * nlm-lock.json 结构
 */
export interface LockfileConfig {
  packages: {
    [packageName: string]: LockfilePackageEntry;
  };
}

/**
 * nlm-store.json 中的包条目
 */
export interface StorePackageEntry {
  /** 依赖包的实际项目根路径 */
  target: string;
  /** 使用过该依赖包的项目路径列表 */
  usedBy: string[];
}

/**
 * nlm-store.json 结构（全局）
 */
export interface StoreConfig {
  [packageName: string]: StorePackageEntry;
}

/**
 * nlm.config.json 结构（项目配置）
 */
export interface NlmConfig {
  /** 用于安装冲突依赖的包管理器 */
  packageManager?: string;
}

/**
 * 依赖冲突信息
 */
export interface DependencyConflict {
  /** 冲突的依赖包名 */
  name: string;
  /** nlm 包需要的版本 */
  requiredVersion: string;
  /** 项目中安装的版本 */
  installedVersion: string;
}

/**
 * 复制结果
 */
export interface CopyResult {
  /** 是否成功 */
  success: boolean;
  /** 产物签名 */
  signature: string;
  /** 是否有变化（用于判断是否跳过） */
  changed: boolean;
}

// 重新导出运行时配置类型
export type { RuntimeConfig } from '../core/runtime';

// 默认使用的
