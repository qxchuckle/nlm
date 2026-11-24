import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTs } from './support/loader.mjs';

const lock = await loadTs('src/utils/lock.ts');

const createRoot = () => fs.mkdtempSync(join(tmpdir(), 'nlm-lock-'));
const lockPathOf = (root) => join(root, '.nlm', lock.PROJECT_LOCK_FILE);

test('withProjectLock：任务执行期间持有锁，结束后释放', async (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const observed = await lock.withProjectLock(root, async () => {
    assert.equal(fs.existsSync(lockPathOf(root)), true);
    return 'done';
  });
  assert.equal(observed, 'done');
  assert.equal(fs.existsSync(lockPathOf(root)), false);
});

test('withProjectLock：任务抛错时仍释放锁', async (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    lock.withProjectLock(root, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(fs.existsSync(lockPathOf(root)), false);
});

test('withProjectLock：锁被占用时等待超时报错', async (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(join(root, '.nlm'), { recursive: true });
  fs.writeFileSync(
    lockPathOf(root),
    JSON.stringify({ pid: 1, time: Date.now(), token: 'other' }),
  );

  let executed = false;
  await assert.rejects(
    lock.withProjectLock(
      root,
      async () => {
        executed = true;
      },
      { waitMs: 60, pollMs: 10 },
    ),
    (error) => String(error.message).includes('.lock'),
  );
  assert.equal(executed, false);
});

test('withProjectLock：陈旧锁按 mtime 回收后可获取', async (t) => {
  const root = createRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(join(root, '.nlm'), { recursive: true });
  const lockPath = lockPathOf(root);
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: 99999, time: Date.now(), token: 'stale' }),
  );
  const oldTime = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(lockPath, oldTime, oldTime);

  const result = await lock.withProjectLock(root, async () => 'acquired', {
    staleMs: 1000,
    waitMs: 500,
    pollMs: 10,
  });
  assert.equal(result, 'acquired');
  assert.equal(fs.existsSync(lockPath), false);
});
