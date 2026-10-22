# @hzense/intelligence

为 HZense 情报分析能力预留的包边界，规划职责包括排序、专题识别、科技雷达计算与 Ask HZense 编排。

## 当前状态

此目录目前只有说明文档，尚无 `package.json`、源码、导出接口或可运行脚本，因此不能作为已实现的工作区包使用。

现有搜索排序由 [`packages/search`](../search/) 提供；首页雷达通过 [`public-exploration-runtime.ts`](../../apps/web/lib/public-exploration-runtime.ts) 读取公开信号与资源，并由 [`signal-radar-model.ts`](../../apps/web/lib/signal-radar-model.ts) 计算领域、分类和资源热度。旧的快照雷达页面适配器已移除，Topic 历史评估投影仍保留。这些实现尚未迁入本目录，也不代表已实现自动专题识别或 Ask HZense 编排。

后续拆包应以实际实现和依赖边界为依据。产品与分析能力的目标设计见 [Signal-first v2 设计](../../docs/SIGNAL_FIRST_REDESIGN.md)。
