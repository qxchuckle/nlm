# nlm - npm local modules

本地 npm 包联调工具，类似 yalc，但更简洁。

## 特性

- 不修改 `package.json`
- 与包管理工具（npm/yarn/pnpm）无关
- 支持依赖版本冲突检测和处理
- 支持嵌套依赖递归替换
- 简洁的命令设计

## 安装

```bash
npm install -g nlm
# 或
yarn global add nlm
# 或
pnpm add -g nlm
```

## 使用方法

### 在依赖包中

构建完成后，推送到全局 store：

```bash
# 推送包
nlm push
nlm p

# 强制推送（跳过 hash 检查）
nlm push --force
nlm p -f
```

### 在项目中

```bash
# 安装指定包
nlm install @scope/package-name
nlm i @scope/package-name

# 安装指定版本
nlm i @scope/package-name@1.0.0

# 强制安装
nlm i @scope/package-name --force

# 更新所有 nlm 包
nlm update
nlm up

# 更新指定包
nlm up @scope/package-name

# 强制更新
nlm up --force

# 卸载包
nlm uninstall @scope/package-name
nlm un @scope/package-name

# 列出已安装的 nlm 包
nlm ls
nlm l

# 列出全局 store 中的所有包
nlm ls --store
nlm l -s
```

## 工作流程

### Push 流程

1. 读取当前目录的 `package.json`
2. 使用 `npm-packlist` 获取要发布的文件列表
3. 计算所有文件的 hash 生成 signature
4. 复制文件到 `~/.nlm/packages/包名/版本号/`
5. 更新全局 `nlm-store.json`
6. 自动更新所有使用此包的项目

### Install 流程

1. 检查 `node_modules` 和 `package.json` 存在
2. 从 store 中找到对应版本的包
3. 复制到项目的 `node_modules`
4. 检测并处理依赖版本冲突
5. 递归替换嵌套的同名包
6. 更新项目的 `nlm-lock.json`

## 文件结构

### 全局 Store

```
~/.nlm/
├── packages/
│   └── @scope/package-name/
│       └── 1.0.0/
│           ├── ... (包文件)
│           └── nlm.sig
└── nlm-store.json
```

### 项目目录

```
project/
├── .nlm/
│   ├── nlm-lock.json
│   ├── nlm.config.json (可选)
│   └── @scope/package-name/  (冲突依赖)
│       └── node_modules/
└── node_modules/
```

### nlm-lock.json

```json
{
  "packages": {
    "@scope/package-name": {
      "version": "latest",
      "signature": "da2b09bc1d9a38784005d04369963c40"
    }
  }
}
```

### nlm-store.json

```json
{
  "@scope/package-name": {
    "target": "/path/to/package-source",
    "usedBy": [
      "/path/to/project1",
      "/path/to/project2"
    ]
  }
}
```

## 配置

在项目 `.nlm/nlm.config.json` 中配置：

```json
{
  "packageManager": "npm"
}
```

支持的包管理器：`npm`、`yarn`、`pnpm`

## 依赖冲突处理

当 nlm 包和项目的依赖版本不兼容时（主版本号不同），nlm 会：

1. 检测冲突的依赖
2. 在 `.nlm/包名/node_modules/` 安装冲突版本
3. 显示警告信息

## 嵌套依赖处理

nlm 会自动递归查找并替换 `node_modules` 中所有同名的嵌套包，确保所有引用都指向 nlm 安装的版本。

## 与 yalc 的区别

| 特性 | nlm | yalc |
|------|-----|------|
| 修改 package.json | 否 | 是 |
| 依赖冲突处理 | 自动 | 无 |
| 嵌套依赖处理 | 自动 | 无 |
| 代码结构 | 模块化 | 平铺 |

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式
npm run dev
```

## License

MIT
