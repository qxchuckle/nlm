import { createJiti } from 'jiti';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 测试用 TS 加载器：借助仓库已有的 jiti（devDependency）直接加载 src 下的 TS 源，
 * 无需额外构建步骤或测试框架依赖。
 * 注意：本仓库 node_modules 由其他用户的 pnpm store 链接，新增 devDependency 需整体重装，
 * 故测试基建采用「零新增依赖」方案（node:test + jiti）。
 */
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const srcDir = join(projectRoot, 'src');

const jiti = createJiti(import.meta.url, {
  alias: { '@': srcDir },
  fsCache: false,
  moduleCache: false,
});

/** 加载模块（路径相对于仓库根目录），如 loadTs('src/services/pm.ts') */
export const loadTs = (relativePath) =>
  jiti.import(join(projectRoot, relativePath));
