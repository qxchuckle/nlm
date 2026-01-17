export const zh = {
  // CLI 描述
  cliDescription: 'npm local modules - 本地 npm 包联调工具',
  optionDebug: '开启调试模式，输出详细日志',
  optionLang: '设置语言 (zh/en)',

  // push 命令
  cmdPushDesc: '推送当前包到全局 store，并更新所有使用此包的项目',
  optionForce: '强制执行，跳过 hash 检查',
  pushToStore: '推送 {pkg} 到 store...',
  pushedToStore: '已推送 {pkg} 到 store',
  pushFailed: '推送失败: {error}',
  pushNoChange: '包内容未变化，跳过更新项目',
  pushNoUsage: '没有项目使用此包',
  pushUpdateProject: '更新项目 ({current}/{total}): {path}',
  pushProjectNotInstalled: '{path} 未安装此包，跳过',
  pushVersionNotExist: '{path} 依赖的版本 {version} 不存在，跳过',
  pushUpdatedProject: '已更新 {path}',
  pushUpdateFailed: '更新 {path} 失败: {error}',
  pushComplete: '推送完成，已更新 {count} 个项目',

  // install 命令
  cmdInstallDesc: '安装 nlm 包到当前项目',
  installNoPackage: '未指定包名，更新所有已安装的 nlm 包...',
  installRunPushFirst: '请先在 {name} 项目中运行 {cmd}',
  installNotInStore: '{pkg} 不存在于 store',
  installAvailableVersions: '可用版本: {versions}',
  installNoMatchVersion: '没有满足 {version} 的版本',
  installNoVersion: '{pkg} 没有可用版本',
  installTargetVersion: '目标版本 {target} 安装版本: {actual}',
  installPackage: '安装 {pkg}',
  installProcessDeps: '处理依赖冲突...',
  installContinue: '继续安装...',
  installReplaceNested: '替换嵌套包...',
  installComplete: '安装完成 {pkg}',

  // uninstall 命令
  cmdUninstallDesc: '卸载 nlm 包',
  uninstallNotInstalled: '{pkg} 未通过 nlm 安装',
  uninstallPackage: '卸载 {pkg}...',
  uninstallComplete: '卸载完成 {pkg}',
  uninstallNote:
    '注意：请手动重新安装实际依赖（运行 npm install / yarn / pnpm install）',

  // update 命令
  cmdUpdateDesc: '更新已安装的 nlm 包',
  updateNotInstalled: '{pkg} 未安装，请先使用 {cmd} 安装',
  updateNoPackages: '没有已安装的 nlm 包',
  updatePackage: '更新包 ({current}/{total}): {pkg}...',
  updateUpdated: '已更新 {pkg}',
  updateUpToDate: '{pkg} 已是最新，跳过',
  updateFailed: '更新 {pkg} 失败: {error}',
  updateComplete: '更新完成: {updated} 个更新, {skipped} 个跳过',
  updateNotInStore: '{pkg} 不存在于 store，跳过',
  updateNotInLockfile: '{pkg} 不在 lockfile 中，跳过',
  updateNoMatchVersion: '{pkg} 没有满足 {version} 的版本，跳过',
  updateSingle: '更新 {pkg}',

  // list 命令
  cmdListDesc: '列出已安装的 nlm 包',
  optionStore: '列出全局 store 中的所有包',
  listNoPackages: '当前项目没有安装任何 nlm 包',
  listInstalled: '已安装的 nlm 包:',
  listTotal: '共 {count} 个包',
  listStoreEmpty: '全局 store 中没有任何包',
  listStoreTitle: '全局 store 中的包:',
  listSourcePath: '源路径:',
  listUsedBy: '使用项目:',
  listUsedByCount: '{count} 个',

  // 通用错误
  errInvalidProject:
    '当前目录不是有效的项目（缺少 package.json 或 node_modules）',
  errInvalidProjectSimple: '当前目录不是有效的项目',
  errInvalidPackage:
    '当前目录不是有效的 npm 包（缺少 package.json 或格式错误）',
  errInvalidPackageName: '无效的包名: {name}',
  errUnknownCommand: '未知命令: {cmd}',
  errUnknown: '未知错误: {error}',
  helpRunCommand: '运行 {cmd} 查看可用命令',

  // runtime
  runtimeInitialized: '运行时配置初始化完成: {config}',

  // gitignore
  gitignoreNotExist: '.gitignore 文件不存在，请手动添加 {entry} 到 .gitignore',
  gitignoreAdded: '已自动添加 {entry} 到 .gitignore',
  gitignoreAddFailed: '添加 {entry} 到 .gitignore 失败，请手动添加',
};
