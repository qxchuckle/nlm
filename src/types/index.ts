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
  browser?: string;
  files?: string[];
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
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  /** 其他配置项... */
}

/**
 * push 命令选项
 */
export interface PushOptions {
  /** 工作目录 */
  workingDir: string;
  /** 强制推送，跳过 hash 检查 */
  force?: boolean;
}

/**
 * install 命令选项
 */
export interface InstallOptions {
  /** 工作目录 */
  workingDir: string;
  /** 要安装的包名（可带版本号） */
  packageName?: string;
  /** 强制安装，跳过 hash 检查 */
  force?: boolean;
}

/**
 * update 命令选项
 */
export interface UpdateOptions {
  /** 工作目录 */
  workingDir: string;
  /** 要更新的包名 */
  packageName?: string;
  /** 强制更新，跳过 hash 检查 */
  force?: boolean;
}

/**
 * uninstall 命令选项
 */
export interface UninstallOptions {
  /** 工作目录 */
  workingDir: string;
  /** 要卸载的包名 */
  packageName: string;
}

/**
 * ls 命令选项
 */
export interface ListOptions {
  /** 工作目录 */
  workingDir: string;
  /** 是否列出全局 store */
  store?: boolean;
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
