import { builtinModules } from 'module';
import { dirname, extname, join } from 'path';
import {
  ConflictDepsStrategy,
  DependencyConflict,
  PackageManifest,
  ResolvedConflictDepsConfig,
} from '../types';
import { pathExistsSync, readFileSync, statSync } from '../utils/file';

/** 冲突依赖裁决原因（用于日志文案分流） */
export type ConflictDecisionReason =
  | 'config-install' // 命中 install 规则
  | 'config-host' // 命中 host 规则
  | 'config-skip' // 命中 skip 规则
  | 'peer-host' // peer 依赖由项目提供
  | 'build-only' // 产物无运行时引用（构建期依赖）
  | 'config-strategy' // 命中 conflictDeps.strategy
  | 'fallback-unresolvable' // 项目侧未实际安装该依赖，降级为隔离安装
  | 'default'; // 默认：隔离安装

/** 单条冲突的裁决结果 */
export interface ConflictDecision {
  action: ConflictDepsStrategy;
  reason: ConflictDecisionReason;
}

/** 可扫描的运行时文件扩展名 */
const SCANNABLE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];

/** Node 内建模块集合（含 node: 前缀形式的裸名） */
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 包名模式匹配：支持 `*` 通配（如 `@umijs/*`、`umi`）
 */
export const matchesPackagePattern = (
  name: string,
  pattern: string,
): boolean => {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (!trimmed.includes('*')) return name === trimmed;
  const regex = new RegExp(
    `^${trimmed.split('*').map(escapeRegExp).join('.*')}$`,
  );
  return regex.test(name);
};

/** 是否命中模式列表中的任意一条 */
export const matchesAnyPattern = (name: string, patterns?: string[]): boolean =>
  !!patterns?.some((pattern) => matchesPackagePattern(name, pattern));

/** 把 import 说明符归一为包名（`@scope/a/b` → `@scope/a`，`a/b` → `a`） */
const toPackageName = (specifier: string): string | null => {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.includes(':')
  ) {
    return null;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0];
};

/**
 * 从源码文本中提取模块说明符
 * 覆盖 `import x from` / `export ... from` / `import 'x'` / `require('x')` / `import('x')`
 * 排除 `import type` / `export type`（编译期被擦除，不构成运行时依赖）
 */
const extractSpecifiers = (content: string): string[] => {
  const pattern =
    /(?:^|[^\w$])(?:import\s+(?!type\b)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]|export\s+(?!type\b)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const specifier = match[1] || match[2] || match[3] || match[4];
    if (specifier) result.push(specifier);
  }
  return result;
};

/** 是否含无法静态判定的动态引用（决定扫描结果是否可信） */
const hasDynamicReference = (content: string): boolean =>
  /\brequire\s*\(\s*(?!['"])/.test(content) ||
  /\bimport\s*\(\s*(?!['"])/.test(content);

/** 解析相对说明符到实际文件（含扩展名与 index 补全） */
const resolveRelativeFile = (fromFile: string, specifier: string): string[] => {
  const base = join(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SCANNABLE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SCANNABLE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.filter((file) => {
    if (!pathExistsSync(file)) return false;
    const stats = statSync(file);
    if (!stats?.isFile()) return false;
    return SCANNABLE_EXTENSIONS.includes(extname(file).toLowerCase());
  });
};

/** 递归收集 exports 字段中的路径（忽略含通配符的条目） */
const collectExportPaths = (value: unknown, result: string[]): void => {
  if (typeof value === 'string') {
    if (value.startsWith('.') && !value.includes('*')) result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectExportPaths(item, result));
    return;
  }
  if (value && typeof value === 'object') {
    // 子路径键（"."、"./x"）与条件键（import / require / default）的值都可能是路径，
    // 需一并递归，否则仅用 exports 声明入口的包会被误判为「无入口」
    Object.values(value).forEach((item) => collectExportPaths(item, result));
  }
};

/** 收集包的运行时入口文件 */
const collectEntryFiles = (
  packageDir: string,
  manifest: PackageManifest,
): string[] => {
  const paths: string[] = [];
  const pushPath = (value?: unknown): void => {
    if (typeof value !== 'string' || !value) return;
    if (!value.startsWith('.')) paths.push(`./${value}`);
    else paths.push(value);
  };

  pushPath(manifest.main);
  pushPath(manifest.module);
  if (typeof manifest.browser === 'string') {
    pushPath(manifest.browser);
  } else if (manifest.browser && typeof manifest.browser === 'object') {
    Object.values(manifest.browser).forEach(pushPath);
  }
  collectExportPaths(manifest.exports, paths);

  // 无任何入口声明时按 npm 惯例回退到 index.js
  if (paths.length === 0) paths.push('./index.js');

  const files: string[] = [];
  for (const relativePath of paths) {
    const base = join(packageDir, relativePath);
    const candidates = [
      base,
      ...SCANNABLE_EXTENSIONS.map((ext) => `${base}${ext}`),
      ...SCANNABLE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
    ];
    const found = candidates.find((file) => {
      if (!pathExistsSync(file)) return false;
      return SCANNABLE_EXTENSIONS.includes(extname(file).toLowerCase());
    });
    if (found) files.push(found);
  }
  return [...new Set(files)];
};

/** 扫描规模上限（防御异常包结构） */
const MAX_SCAN_FILES = 4000;
const MAX_SCAN_DEPTH = 24;

/**
 * 收集 nlm 包产物的运行时模块引用（闭包扫描，仅包内相对引用）
 * 返回 null 表示「无法判定」（入口缺失 / 含动态 require）——调用方须按可达处理
 */
export const collectRuntimeSpecifiers = (
  packageDir: string,
  manifest: PackageManifest,
): Set<string> | null => {
  const entryFiles = collectEntryFiles(packageDir, manifest);
  if (entryFiles.length === 0) return null;

  const visited = new Set<string>();
  const queue: Array<{ file: string; depth: number }> = entryFiles.map(
    (file) => ({ file, depth: 0 }),
  );
  const specifiers = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.size >= MAX_SCAN_FILES) break;
    if (visited.has(current.file) || current.depth > MAX_SCAN_DEPTH) continue;
    visited.add(current.file);

    const content = readFileSync(current.file);
    if (content == null) continue;
    // 存在动态引用时静态结论不可信，交由调用方按「可能可达」处理
    if (hasDynamicReference(content)) return null;

    for (const specifier of extractSpecifiers(content)) {
      if (specifier.startsWith('.')) {
        resolveRelativeFile(current.file, specifier).forEach((file) => {
          queue.push({ file, depth: current.depth + 1 });
        });
        continue;
      }
      if (BUILTIN_MODULES.has(specifier)) continue;
      const packageName = toPackageName(specifier);
      if (packageName) specifiers.add(packageName);
    }
  }

  return specifiers;
};

/** 构建期工具包的典型包名模式（仅用于 push 侧生态引导，不参与安装裁决） */
const BUILD_TOOL_PATTERNS = [
  'umi',
  '@umijs/*',
  'webpack',
  'webpack-*',
  'vite',
  '@vitejs/*',
  'rollup',
  'rollup-*',
  'esbuild',
  'tsup',
  'father',
  'typescript',
  '@babel/*',
  '@swc/*',
  'terser',
];

/**
 * 找出「疑似构建期工具却声明在 dependencies」的包
 * 用于 push 侧提示包作者修正声明（安装侧只能被动兜底）
 * 仅在运行时引用扫描结论可信（非 null）时判定，避免误报
 */
export const findMisplacedBuildDependencies = (
  manifest: PackageManifest,
  runtimeSpecifiers: Set<string> | null,
): string[] => {
  if (!runtimeSpecifiers) return [];
  return Object.keys(manifest.dependencies || {}).filter(
    (name) =>
      matchesAnyPattern(name, BUILD_TOOL_PATTERNS) &&
      !runtimeSpecifiers.has(name),
  );
};

/**
 * 裁决单个冲突依赖的处理方式
 * 优先级：install 规则 > host 规则 > skip 规则 > peer 语义 > 构建期判定 > 全局策略 > 默认隔离安装
 */
export const decideConflictActions = (params: {
  conflicts: DependencyConflict[];
  packageDir: string;
  manifest: PackageManifest | null;
  config: ResolvedConflictDepsConfig;
}): Map<string, ConflictDecision> => {
  const { conflicts, packageDir, manifest, config } = params;
  const decisions = new Map<string, ConflictDecision>();

  let runtimeSpecifiers: Set<string> | null | undefined;
  const getRuntimeSpecifiers = (): Set<string> | null => {
    if (runtimeSpecifiers === undefined) {
      runtimeSpecifiers =
        manifest && pathExistsSync(packageDir)
          ? collectRuntimeSpecifiers(packageDir, manifest)
          : null;
    }
    return runtimeSpecifiers;
  };

  const applyGlobalStrategy = (): ConflictDecision => {
    if (config.strategy === 'skip') {
      return { action: 'skip', reason: 'config-strategy' };
    }
    if (config.strategy === 'host') {
      return { action: 'host', reason: 'config-strategy' };
    }
    return { action: 'install', reason: 'default' };
  };

  for (const conflict of conflicts) {
    if (matchesAnyPattern(conflict.name, config.install)) {
      decisions.set(conflict.name, {
        action: 'install',
        reason: 'config-install',
      });
      continue;
    }
    if (matchesAnyPattern(conflict.name, config.host)) {
      decisions.set(conflict.name, {
        action: 'host',
        reason: 'config-host',
      });
      continue;
    }
    if (matchesAnyPattern(conflict.name, config.skip)) {
      decisions.set(conflict.name, {
        action: 'skip',
        reason: 'config-skip',
      });
      continue;
    }
    // peer 依赖由项目提供（peer 声明即「宿主供给」语义）
    if (conflict.source === 'peerDependencies' && config.skipPeerDependencies) {
      decisions.set(conflict.name, {
        action: 'skip',
        reason: 'peer-host',
      });
      continue;
    }
    // 产物中无运行时引用 → 构建期/类型期依赖，重复安装无收益
    if (config.skipBuildOnlyDependencies) {
      const specifiers = getRuntimeSpecifiers();
      if (specifiers && !specifiers.has(conflict.name)) {
        decisions.set(conflict.name, {
          action: 'skip',
          reason: 'build-only',
        });
        continue;
      }
    }
    decisions.set(conflict.name, applyGlobalStrategy());
  }

  return decisions;
};
