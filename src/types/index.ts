/**
 * 默认配置
 */
export const DEFAULT_CONFIG: Required<NlmConfig> = {
  packageManager: 'npm',
  lang: 'auto',
  installForceLatest: false,
  pushForceLatest: false,
  conflictDeps: {},
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
  /** npm 依赖强制版本覆盖（作用于整棵依赖树） */
  overrides?: Record<string, unknown>;
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
  /** 被替换为 nlm 链接的嵌套包路径（相对工作目录，供卸载时回收） */
  nestedPaths?: string[];
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
 * 冲突依赖处理策略
 * - install：隔离安装到 .conflict-deps（现状行为）
 * - skip：不安装，依赖解析回退到项目自身副本
 * - host：不安装，并显式建链指向项目实体
 */
export type ConflictDepsStrategy = 'install' | 'skip' | 'host';

/**
 * 冲突依赖配置（nlm.config.json 的 conflictDeps 字段）
 * 全部可缺省，缺省即 nlm 推荐默认：peer 依赖由项目提供、构建期依赖不重复安装
 */
export interface ConflictDepsConfig {
  /** 默认策略（缺省 install） */
  strategy?: ConflictDepsStrategy;
  /** peerDependencies 冲突时不隔离安装（由项目提供），默认 true */
  skipPeerDependencies?: boolean;
  /** 产物中无运行时引用的依赖判为构建期依赖并跳过安装，默认 true */
  skipBuildOnlyDependencies?: boolean;
  /** 强制不安装的包名模式（支持 * 通配） */
  skip?: string[];
  /** 强制共享项目版本（不安装 + 链到项目实体）的包名模式 */
  host?: string[];
  /** 强制隔离安装的包名模式（优先级最高，用于覆盖默认裁决） */
  install?: string[];
}

/**
 * 规范化后的冲突依赖配置（缺省值已补齐）
 */
export interface ResolvedConflictDepsConfig {
  strategy: ConflictDepsStrategy;
  skipPeerDependencies: boolean;
  skipBuildOnlyDependencies: boolean;
  skip: string[];
  host: string[];
  install: string[];
}

/**
 * nlm.config.json 结构（项目配置）
 */
export interface NlmConfig {
  /** 用于安装冲突依赖的包管理器 */
  packageManager?: string;
  /** 语言设置，auto 表示自动识别 */
  lang?: 'auto' | 'zh' | 'en';
  /** 安装/更新时忽略指定版本，强制安装 store 中的最新版本 */
  installForceLatest?: boolean;
  /** 推送时忽略 package.json 版本，强制推送到 store 中的最新版本 */
  pushForceLatest?: boolean;
  /** 冲突依赖处理策略 */
  conflictDeps?: ConflictDepsConfig;
}

/**
 * 冲突依赖的来源声明
 */
export type DependencyConflictSource = 'dependencies' | 'peerDependencies';

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
  /** 该依赖在 nlm 包中的声明位置（缺省视为 dependencies） */
  source?: DependencyConflictSource;
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
