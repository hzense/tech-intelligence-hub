# 爬虫请求来源补充核查

2026-11-17 重新打开 Vercel Production → Observability → CDN Requests → Bot Name。本次总览滚动窗口为 **05:37–17:37 Europe/Berlin**，约 2.6K 网站请求；下列已识别机器人合计 **837** 次。与上一份 04:31–16:31 的 839 次是不同窗口，不能覆盖旧数据或相加。

| Vercel 名称         | 请求数 | 机构与用途                                                                      |
| ------------------- | -----: | ------------------------------------------------------------------------------- |
| googleother         |    586 | Google 通用公开网页抓取，可用于内部研究开发，不能仅凭名字判断具体用途或训练用途 |
| facebookexternalhit |    151 | Meta，主要用于分享链接的标题、摘要、缩略图预览，也可能执行安全检查              |
| petalbot            |     40 | Petal Search 搜索索引及华为相关内容推荐                                         |
| googlebot           |     23 | Google 搜索等服务的网页抓取                                                     |
| ahrefsbot           |     21 | Ahrefs 营销分析与 Yep 搜索的数据索引                                            |
| semrush             |      7 | Semrush SEO、外链等分析                                                         |
| bingbot             |      5 | Microsoft Bing 搜索抓取                                                         |
| exasearchbot        |      2 | Exa 搜索与检索索引                                                              |
| oai-searchbot       |      1 | OpenAI 搜索收录                                                                 |
| gptbot              |      1 | OpenAI 可能用于基础模型训练的内容采集                                           |

GoogleOther 占已识别机器人请求 70.0%，与 Meta 合计 88.1%。这是请求次数比例，不是数据库流量比例；剩余未命名请求不能统称真人访问。总览前三项显示验证徽标，GoogleOther 详情标题明确为 Bot Verified；未另行获取请求 IP 做独立验证。

## 发现入口与边界

- 实时只读获取 `https://hzense.com/robots.txt`：`User-Agent: *`、`Allow: /`，排除 `/admin`、`/api/admin`、`/api/auth`，提供 `/sitemap.xml`。
- `apps/web/app/sitemap.ts` 将公开信号、人物、组织、专题和洞察链接加入 sitemap。该配置和站内链接便于爬虫继续发现页面，但尚未证明每个机器人首次从何处发现域名。
- GoogleOther 单项详情受当前套餐限制，图表出现 **Demo Data** 和 Upgrade to Pro；其中 165K 请求、示例路由等均未用于分析。不能据此给出单机器人路径、IP、国家或流量归因。
- 这些是外部机器人访问 HZense；与 HZense 主动向外采集新闻的方向不同。机器人名称不能证明某个具体用户分享了链接，也不能单独证明恶意攻击或内容已被用于训练。

## 官方说明

- [Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)
- [Meta web crawlers](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers)
- [PetalBot](https://webmaster.petalsearch.com/site/petalbot)
- [Ahrefs bots](https://ahrefs.com/robot)
- [Semrush bot](https://www.semrush.com/bot/)
- [Bing crawling](https://www.bing.com/bingpolicies/archives)
- [Exa crawler](https://crawler.exa.ai/)
- [OpenAI crawlers](https://developers.openai.com/api/docs/bots)

本次未调整 robots.txt、防火墙或其他线上设置。
