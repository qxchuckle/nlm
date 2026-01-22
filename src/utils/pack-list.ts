import { NormalizedPackage } from '@/types';
import { readPackageManifest, normalizePackage } from './pkg-manifest';
import { glob } from 'tinyglobby';
import ignore from 'ignore';
import { join } from 'path';
import { pathExistsSync, readFileSync, statSync } from './file';
import { t } from './i18n';
import logger from './logger';

/** npm 默认排除的文件模式 */
const NPM_DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'CVS',
  '.DS_Store',
  '._*',
  '.npmrc',
  '.lock-wscript',
  '.wafpickle-*',
  'config.gypi',
  'npm-debug.log',
  '*.orig',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

/** npm 默认始终包含的文件模式 (不受 ignore 规则影响) */
const NPM_ALWAYS_INCLUDE_PATTERNS = [
  'package.json',
  'README',
  'README.*',
  'readme',
  'readme.*',
  'LICENSE',
  'LICENSE.*',
  'license',
  'license.*',
  'LICENCE',
  'LICENCE.*',
  'licence',
  'licence.*',
  'CHANGELOG',
  'CHANGELOG.*',
  'changelog',
  'changelog.*',
  'HISTORY',
  'HISTORY.*',
  'history',
  'history.*',
];

const readIgnoreFile = (workingDir: string, filename: string): string => {
  const ignorePath = join(workingDir, filename);
  return readFileSync(ignorePath) || '';
};

/**
 * 从规范化的 package.json 提取入口文件路径
 * 这些文件始终会被包含在发布包中
 */
const getEntryFiles = (pkg: NormalizedPackage): string[] => {
  const entries: string[] = [];

  // 主入口 (normalize-package-data 会确保 main 存在，默认 index.js)
  entries.push(pkg.main);

  // ESM 入口
  if (pkg.module) entries.push(pkg.module);

  // 浏览器入口（支持字符串和对象两种形式）
  if (pkg.browser) {
    if (typeof pkg.browser === 'string') {
      entries.push(pkg.browser);
    } else if (typeof pkg.browser === 'object') {
      // 对象形式: { "./lib/foo.js": "./lib/foo-browser.js" }
      Object.values(pkg.browser).forEach((v) => {
        if (typeof v === 'string') entries.push(v);
      });
    }
  }

  // TypeScript 类型入口
  if (pkg.types) entries.push(pkg.types);
  if (pkg.typings) entries.push(pkg.typings);

  // bin 文件 (normalize-package-data 会统一为对象形式)
  if (pkg.bin) {
    entries.push(...Object.values(pkg.bin));
  }

  // man 文件
  if (pkg.man) {
    if (typeof pkg.man === 'string') {
      entries.push(pkg.man);
    } else if (Array.isArray(pkg.man)) {
      entries.push(...pkg.man);
    }
  }

  // exports 字段（递归提取所有字符串路径）
  if (pkg.exports) {
    const extractExports = (obj: unknown): void => {
      if (typeof obj === 'string') {
        entries.push(obj);
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(extractExports);
      }
    };
    extractExports(pkg.exports);
  }

  // 去重并过滤空值，移除开头的 ./
  return [...new Set(entries)]
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ''));
};

/**
 * 判断 files 字段中的模式是否是目录
 * 使用文件系统检查来准确判断
 */
const isDirectoryPattern = (workingDir: string, pattern: string): boolean => {
  // 包含 glob 字符的不是纯目录
  if (pattern.includes('*') || pattern.includes('?') || pattern.includes('{')) {
    return false;
  }
  // 使用文件系统检查是否是目录
  const fullPath = join(workingDir, pattern);
  const stats = statSync(fullPath);
  return stats?.isDirectory() ?? false;
};

/**
 * 获取包的发布文件列表
 */
export const getPackFilesInternal = async (
  workingDir: string,
): Promise<string[]> => {
  const startTime = Date.now();

  const rawPkg = readPackageManifest(workingDir);
  if (!rawPkg) {
    throw new Error(t('copyReadPackageJsonFailed'));
  }

  // 规范化 package.json
  const pkg = normalizePackage(rawPkg);

  const ig = ignore();
  // 添加 npm 默认排除规则
  ig.add(NPM_DEFAULT_IGNORES);

  // 获取入口文件
  const entryFiles = getEntryFiles(pkg);

  let patterns: string[];

  if (pkg.files && Array.isArray(pkg.files) && pkg.files.length > 0) {
    // 分离包含模式和排除模式
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];

    pkg.files.forEach((pattern) => {
      if (pattern.startsWith('!')) {
        // 排除模式
        excludePatterns.push(pattern.slice(1));
      } else if (isDirectoryPattern(workingDir, pattern)) {
        // 目录模式，添加 /** 后缀
        includePatterns.push(`${pattern}/**`);
      } else {
        includePatterns.push(pattern);
      }
    });

    // 添加排除模式到 ignore
    if (excludePatterns.length > 0) {
      ig.add(excludePatterns);
    }

    patterns = includePatterns;
  } else {
    // 没有 files 字段，使用 ignore 规则
    patterns = ['**/*'];

    // 读取 .npmignore
    const npmIgnore = readIgnoreFile(workingDir, '.npmignore');
    if (npmIgnore) {
      ig.add(npmIgnore);
    }
  }

  // 使用 tinyglobby 获取主文件列表
  // ignore 在 glob 阶段排除大目录，避免扫描 node_modules 等
  const mainFiles = await glob(patterns, {
    cwd: workingDir,
    dot: true,
    onlyFiles: true,
    expandDirectories: true,
    ignore: NPM_DEFAULT_IGNORES,
  });

  // 应用 ignore 规则过滤
  const filteredFiles = ig.filter(mainFiles);

  // 获取始终包含的文件（README, LICENSE 等）- 这些不受 ignore 影响
  const alwaysIncludeFiles = await glob(NPM_ALWAYS_INCLUDE_PATTERNS, {
    cwd: workingDir,
    dot: false,
    onlyFiles: true,
    ignore: NPM_DEFAULT_IGNORES,
  });

  // 获取入口文件（如果存在）
  const existingEntryFiles: string[] = [];
  for (const entry of entryFiles) {
    const entryPath = join(workingDir, entry);
    if (pathExistsSync(entryPath)) {
      existingEntryFiles.push(entry);
    }
  }

  // 合并所有文件并去重
  const files = [
    ...new Set([
      ...filteredFiles,
      ...alwaysIncludeFiles,
      ...existingEntryFiles,
    ]),
  ];

  logger.debug(`tinyglobby ${logger.duration(startTime)}`);

  return files;
};
