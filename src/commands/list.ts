import { ListOptions } from '../types';
import { readLockfile, lockfileExists } from '../core/lockfile';
import {
  getAllPackagesInStore,
  getPackageVersionsInStore,
  getStorePackageEntry,
  readStoreConfig,
} from '../core/store';
import logger from '../utils/logger';

/**
 * 执行 ls 命令
 */
export const list = async (options: ListOptions): Promise<void> => {
  const { workingDir, store = false } = options;
  
  if (store) {
    await listStore();
  } else {
    await listProject(workingDir);
  }
};

/**
 * 列出项目中安装的 nlm 包
 */
const listProject = async (workingDir: string): Promise<void> => {
  if (!lockfileExists(workingDir)) {
    logger.info('当前项目没有安装任何 nlm 包');
    return;
  }
  
  const lockfile = readLockfile(workingDir);
  const packages = Object.entries(lockfile.packages);
  
  if (packages.length === 0) {
    logger.info('当前项目没有安装任何 nlm 包');
    return;
  }
  
  logger.log('\n已安装的 nlm 包:\n');
  
  for (const [name, entry] of packages) {
    const versionDisplay = entry.version === 'latest' 
      ? `${logger.version('latest')}` 
      : logger.version(entry.version);
    
    logger.log(`  ${logger.pkg(name)} @ ${versionDisplay}`);
    logger.log(`    signature: ${entry.signature.substring(0, 8)}...`);
  }
  
  logger.log(`\n共 ${packages.length} 个包\n`);
};

/**
 * 列出全局 store 中的所有包
 */
const listStore = async (): Promise<void> => {
  const packages = getAllPackagesInStore();
  
  if (packages.length === 0) {
    logger.info('全局 store 中没有任何包');
    return;
  }
  
  const storeConfig = readStoreConfig();
  
  logger.log('\n全局 store 中的包:\n');
  
  for (const name of packages) {
    const versions = getPackageVersionsInStore(name);
    const entry = storeConfig[name];
    
    logger.log(`  ${logger.pkg(name)}`);
    logger.log(`    版本: ${versions.map((v) => logger.version(v)).join(', ')}`);
    
    if (entry?.target) {
      logger.log(`    源路径: ${logger.path(entry.target)}`);
    }
    
    if (entry?.usedBy && entry.usedBy.length > 0) {
      logger.log(`    使用项目 (${entry.usedBy.length}):`);
      entry.usedBy.forEach((p) => {
        logger.log(`      - ${logger.path(p)}`);
      });
    }
    
    logger.log('');
  }
  
  logger.log(`共 ${packages.length} 个包\n`);
};

export default list;
