import chalk from 'chalk';

/**
 * 日志工具
 */
export const logger = {
  /**
   * 普通信息
   */
  info: (message: string, ...args: unknown[]): void => {
    console.log(chalk.blue('info'), message, ...args);
  },

  /**
   * 成功信息
   */
  success: (message: string, ...args: unknown[]): void => {
    console.log(chalk.green('success'), message, ...args);
  },

  /**
   * 警告信息
   */
  warn: (message: string, ...args: unknown[]): void => {
    console.log(chalk.yellow('warn'), message, ...args);
  },

  /**
   * 错误信息
   */
  error: (message: string, ...args: unknown[]): void => {
    console.error(chalk.red('error'), message, ...args);
  },

  /**
   * 调试信息
   */
  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.DEBUG) {
      console.log(chalk.gray('debug'), message, ...args);
    }
  },

  /**
   * 普通日志（无前缀）
   */
  log: (message: string, ...args: unknown[]): void => {
    console.log(message, ...args);
  },

  /**
   * 包名高亮
   */
  pkg: (name: string): string => {
    return chalk.cyan(name);
  },

  /**
   * 版本号高亮
   */
  version: (version: string): string => {
    return chalk.magenta(version);
  },

  /**
   * 路径高亮
   */
  path: (path: string): string => {
    return chalk.gray(path);
  },

  /**
   * 命令高亮
   */
  cmd: (cmd: string): string => {
    return chalk.yellow(cmd);
  },
};

export default logger;
