import { createJiti } from 'jiti';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 集成测试用 CLI 入口：直接加载 TS 源码运行（无需先 build），
 * 便于在临时沙箱（HOME / cwd / PATH 全部隔离）里跑真实命令链路。
 */
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);

// commander 与 preParse 都读取 process.argv，这里统一改写
process.argv = [process.argv[0], path.join(projectRoot, 'src/cli.ts'), ...args];

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(projectRoot, 'src') },
  fsCache: false,
});

const { nlmCliMain } = await jiti.import(
  path.join(projectRoot, 'src/cli/index.ts'),
);
await nlmCliMain();
