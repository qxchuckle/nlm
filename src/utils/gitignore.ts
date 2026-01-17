import { join } from 'path';
import ignore from 'ignore';
import { pathExistsSync, readFileSync, appendFileSync } from './file';
import { PROJECT_NLM_DIR } from '../constants';
import logger from './logger';
import { t } from './i18n';

/**
 * 检查 .gitignore 是否已忽略指定的条目
 * 使用 ignore 库来正确解析 gitignore 规则
 */
const isIgnored = (content: string, entry: string): boolean => {
  const ig = ignore().add(content);
  // 检查目录和文件两种形式
  return ig.ignores(entry) || ig.ignores(`${entry}/`);
};

/**
 * 确保 .gitignore 中包含 .nlm 目录
 * 如果 .gitignore 存在且未包含 .nlm，则自动添加
 * 如果 .gitignore 不存在，则提示用户手动添加
 *
 * @param workingDir 项目目录
 * @returns 是否成功添加或已存在
 */
export const ensureGitignoreHasNlm = (workingDir: string): boolean => {
  const gitignorePath = join(workingDir, '.gitignore');
  const nlmEntry = PROJECT_NLM_DIR;

  if (!pathExistsSync(gitignorePath)) {
    // .gitignore 不存在，提示用户手动添加
    logger.warn(t('gitignoreNotExist', { entry: nlmEntry }));
    return false;
  }

  try {
    const content = readFileSync(gitignorePath);

    if (isIgnored(content, nlmEntry)) {
      // 已经被忽略，无需添加
      logger.debug(`${nlmEntry} 已在 .gitignore 中`);
      return true;
    }

    // 添加 .nlm 到 .gitignore
    const newLine = content.endsWith('\n') ? '' : '\n';
    appendFileSync(gitignorePath, `${newLine}${nlmEntry}\n`);
    logger.info(t('gitignoreAdded', { entry: nlmEntry }));
    return true;
  } catch (error) {
    logger.warn(t('gitignoreAddFailed', { entry: nlmEntry }));
    logger.debug(`添加 .gitignore 失败: ${error}`);
    return false;
  }
};
