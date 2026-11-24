import fs from 'fs-extra';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getProjectNlmDir } from '../constants';
import { NlmError } from '../types';
import {
  ensureDirSync,
  pathExistsSync,
  removeSync,
  readJsonSync,
  statSync,
} from './file';
import logger from './logger';
import { t } from './i18n';

/** 项目锁文件名（位于 .nlm 下） */
export const PROJECT_LOCK_FILE = '.lock';

/** 陈旧锁判定阈值：进程异常退出后残留锁的兜底回收 */
const DEFAULT_STALE_MS = 5 * 60 * 1000;
/** 最长等待时间 */
const DEFAULT_WAIT_MS = 30 * 1000;
/** 轮询间隔 */
const DEFAULT_POLL_MS = 200;

/** 锁内容（用于释放时确认持有者，防止误删他人重建的锁） */
interface LockPayload {
  pid: number;
  time: number;
  token: string;
}

export interface ProjectLockOptions {
  /** 陈旧锁阈值（毫秒） */
  staleMs?: number;
  /** 最长等待时间（毫秒） */
  waitMs?: number;
  /** 轮询间隔（毫秒） */
  pollMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 锁是否为陈旧锁（文件缺失或超过阈值） */
const isStaleLock = (lockPath: string, staleMs: number): boolean => {
  const stats = statSync(lockPath);
  if (!stats) return true;
  return Date.now() - stats.mtimeMs > staleMs;
};

/**
 * 项目级互斥锁：串行化 .nlm 域的写操作（冲突依赖安装 / 清理 / 卸载），
 * 避免并行执行的 nlm 进程互相清理对方的产物（互踩致悬空链接）。
 * 采用 O_EXCL 创建锁文件实现，异常进程残留的锁按 mtime 超时回收。
 */
export const withProjectLock = async <T>(
  workingDir: string,
  task: () => Promise<T>,
  options: ProjectLockOptions = {},
): Promise<T> => {
  const {
    staleMs = DEFAULT_STALE_MS,
    waitMs = DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
  } = options;

  const nlmDir = getProjectNlmDir(workingDir);
  ensureDirSync(nlmDir);
  const lockPath = join(nlmDir, PROJECT_LOCK_FILE);
  const payload: LockPayload = {
    pid: process.pid,
    time: Date.now(),
    token: randomUUID(),
  };

  const startAt = Date.now();
  let notified = false;

  for (;;) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') {
        throw error;
      }
      // 陈旧锁（进程被 kill 等）直接回收后重试
      if (isStaleLock(lockPath, staleMs)) {
        removeSync(lockPath);
        continue;
      }
      if (Date.now() - startAt >= waitMs) {
        throw new NlmError(t('lockBusy', { path: lockPath }));
      }
      if (!notified) {
        logger.info(t('lockWaiting'));
        notified = true;
      }
      await sleep(pollMs);
    }
  }

  try {
    return await task();
  } finally {
    try {
      // 仅在锁仍属于本次持有者时释放（防误删他人重建的锁）
      if (pathExistsSync(lockPath)) {
        const current = readJsonSync<LockPayload>(lockPath);
        if (!current || current.token === payload.token) {
          removeSync(lockPath);
        }
      }
    } catch {
      // 释放失败不阻塞主流程（残留锁会按 mtime 超时回收）
    }
  }
};
