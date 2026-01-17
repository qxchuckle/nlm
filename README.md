# nlm - npm local modules

本地 npm 包联调工具，足够简单易用，不修改 `package.json`，不影响 git 流程。仅增加一个 `.nlm` 目录，且自动加入 `.gitignore`。

## Why

在开发多个npm包时，除了在包内维护demo及测试用例外，往往还需要在项目中安装最新的包产物进行联调，以实际查看效果。

[npm-link](https://docs.npmjs.com/cli/v11/commands/npm-link) 在有限程度上解决了这个问题，但使用上仍然存在一些约束与问题。  
[yalc](https://github.com/wclr/yalc) 是我之前使用的工具，本工具也参考了其部分设计，但存在依赖冲突、间接依赖包不生效等问题。

## What

- `nlm` 在本地模拟发包，将**包产物**发布到全局 store，具有符合 npm 版本规范的管理方式，在安装时派发产物副本到项目的 `.nlm` 目录，并在 `node_modules` 中建立**软链接**。
- `nlm` 帮你处理了许多繁琐的工作，只需要 `push` 你的包，然后 `install` 或 `update` 即可。
- 支持 i18n，默认自动识别语言环境，或使用 `--lang` 选项手动指定。
- 本质来说，`nlm` 仅仅只是修改了 `node_modules` 中某个包的指向，其它一切都不会和包管理器有任何冲突。

## Todo

- 配套的vscode插件，以更方便管理 nlm store

## Installation

```bash
npm i nlm -g
```

## Config

- 项目级配置文件 `<project>/.nlm/nlm.config.json`
- 全局配置文件 `~/.nlm/nlm.config.json`

```json
{
  // 指定使用的包管理器，用于需要时安装部分依赖，默认 npm
  "packageManager": "npm"
}
```

## Usage

### push

推送包到全局 store，并更新所有使用此包的项目。

```bash
nlm push [options]
nlm p

Options:
  -f, --force 强制推送，跳过 hash 检查
```

### install

安装包到当前项目，如果没有指定包名，则更新所有已安装的 nlm 包

```bash
nlm install [package] [options]
nlm i

Options:
  -f, --force 强制安装，跳过 hash 检查
```

### update

更新包到当前项目，如果没有指定包名，则更新所有已安装的 nlm 包

```bash
nlm update [package] [options]
nlm up

Options:
  -f, --force 强制更新，跳过 hash 检查
```

## list

列出项目或全局 store 中的所有包

```bash
nlm list [options]
nlm ls

Options:
  -s, --store 列出全局 store 中的所有包
```

## uninstall

在当前项目中卸载包

```bash
nlm uninstall [package]
nlm un
```

## Common Options

```bash
--debug 开启调试模式，输出详细日志
--lang 设置语言 (zh/en)，默认自动推断
```

# Reference

- [yalc](https://github.com/wclr/yalc)
