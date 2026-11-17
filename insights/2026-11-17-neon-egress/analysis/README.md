# 复算说明

使用系统 Python 3 标准库，无需安装依赖：

```sh
python3 insights/2026-11-17-neon-egress/analysis/analyze.py
```

耗时不到 1 秒。只读取同目录聚合数据，生成 `calculations.json` 和 `figures/partial-window-egress.svg`，不联网、不连接数据库。

数据字典：

- `daily.csv`：`day_label` 是仪表盘日期标签；`egress_mb` 为十进制 MB；`from/through` 为带 UTC 偏移的实际采样边界；全部 `coverage=partial`。数值四舍五入到 0.01 MB，边界取页面分钟显示。
- `routes.csv`：11/17 04:31–16:31 的部分路由请求数、CDN 缓存百分比；不是 SQL 执行次数。
- `bots.csv`：同窗口已识别机器人请求数；不是全部机器人、也不是全部网站访问。
- `activity.csv`：按生成任务创建时间统计的当前状态及其他业务动作；`measured_26h21` 与日行重叠，禁止汇总相加。

脚本检查唯一日期、正向区间和部分覆盖标记。情景乘法使用当前目录 303852 字节，假设每个所选详情请求都触发一次全量读取；不计其他列、协议、ACL、洞察报告、失败请求或内容随时间变化。结果既不是昨天实测分摊，也不是可保证的节省额。确定性聚合和情景算术不构造统计置信区间。
