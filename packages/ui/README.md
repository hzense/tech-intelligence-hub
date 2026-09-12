# @hzense/ui

为 HZense 设计系统与可复用界面组件预留的包边界。

## 当前状态

此目录目前只有说明文档，尚无 `package.json`、组件源码、导出接口或可运行脚本，因此不能作为已实现的组件库使用。

现有站点外壳、移动导航和主题切换组件位于 [`apps/web/components/`](../../apps/web/components/)，语义化 CSS 类与集中管理的设计变量位于 [`apps/web/app/globals.css`](../../apps/web/app/globals.css)。这些实现尚未抽取为独立的 `@hzense/ui` 包。

新增界面应先遵循 [Web 应用的样式与组件约定](../../apps/web/README.md#样式与组件约定)。后续需要跨应用复用时，再明确组件接口、依赖和构建方式，并同步更新本说明。
