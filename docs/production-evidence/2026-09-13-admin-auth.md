# 管理员 Google 登录上线记录（2026-09-13）

## 结论与范围

Google-only 管理员认证已配置并部署到 `https://hzense.com`。指定的唯一管理员已完成真实 Google 授权、回调、后台访问及退出；匿名访问保护已独立检查。该结论只覆盖认证入口，不代表 AI 后台、信号发布、数据库迁移或全部安全验收已经完成。

本记录归档同日操作期间的只读检查、浏览器验收与部署结果；保存文档本身没有重新执行部署。以下状态绑定所列提交与部署，不保证未来配置不变。

## 代码与部署证据

| 项目               | 核验结果                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 代码交付           | [PR #77](https://github.com/hzense/tech-intelligence-hub/pull/77)，已合并                                                                 |
| 合并提交           | `33163b04bb0bb637e8418b279fa983870be85c60`                                                                                                |
| 合并时间           | `2026-09-13T18:48:16Z`                                                                                                                    |
| 合并后 CI          | [main CI #34775752832](https://github.com/hzense/tech-intelligence-hub/actions/runs/34775752832)，`completed / success`，对应上述完整 SHA |
| 认证配置后生产部署 | `dpl_7WkBFjeDqQDBDeCybkaFfVsjyM3A`，`READY`                                                                                               |
| 正式域名           | `hzense.com`，绑定上述生产部署                                                                                                            |
| 构建耗时           | 1 分 5 秒                                                                                                                                 |

归档时通过 GitHub 只读查询再次确认 PR 合并提交与 main CI 成功状态；代码合并／CI 通过与外部认证配置／部署分别记录。

## 配置范围（无凭据）

- 已使用 HZense 专用 Google Cloud 项目和 Web application OAuth 客户端，没有修改其他 Google 项目或开通付费服务。
- 经操作者同意完成 Google 用户数据政策确认；登录仅请求 `openid email`，不申请 Gmail、Drive 或离线访问权限。
- OAuth 回调地址精确为 `https://hzense.com/api/auth/callback/google`。
- Vercel 项目的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`、`HZENSE_ADMIN_EMAIL` 五项均保存为 **Secret**，环境范围仅为 **Production**。
- 唯一管理员身份保存在服务端配置中。本记录不包含真实邮箱、OAuth Client ID、Google 用户标识或任何变量值；凭据不写入仓库。
- 未配置 Preview 认证凭据，也未将生产密钥复制到本地。本次未执行 Neon 迁移、数据库角色变更或 AI 发布开关变更。

## 实际验收结果

### 真实浏览器登录与退出

1. 指定管理员完成 Google 登录和应用回调。
2. `/admin` 显示已验证的管理员状态，可以访问受保护后台页面。
3. 完成退出后再次直接访问 `/admin`，被重定向到登录页。

此过程未归档含账号资料、凭据、cookie、授权码或 token 的截图／响应正文。页面登录成功不自动证明独立会话 API 的已登录响应已经验收。

### 独立匿名 HTTP 检查

| 请求                  | 观察结果                  | 缓存边界   |
| --------------------- | ------------------------- | ---------- |
| `/admin`              | `307`，跳转登录页         | `no-store` |
| `/admin/login`        | `200`，配置不完整警告消失 | `no-store` |
| `/api/auth/providers` | `200`，认证提供方入口可用 | `no-store` |
| `/api/admin/session`  | `401`，匿名访问被拒绝     | `no-store` |

这些匿名请求未携带浏览器管理员会话，不把 `401` 误记为已登录会话失效。上线后的 admin／auth 错误短窗口扫描未发现异常记录；不据此宣称长期错误监控或日志转发已配置。

## 尚未完成的验证

- 非白名单真实 Google 账号的拒绝访问验收；本地拒绝用例不能替代真实账号测试。
- 线上 Preview 部署认证关闭的实际验收；Production-only 变量范围与代码 fail-closed 规则不等于线上测试通过。
- 已登录 `GET /api/admin/session` 返回 `200` 的独立 HTTP 验收：浏览器打开该 JSON 地址曾返回 `net::ERR_BLOCKED_BY_CLIENT`，属于客户端阻断观察，不能记为 API 验收通过，也不能仅据此归因为服务端故障。
- 长期认证错误监控、日志转发和持续观察；短窗口无错误不是上述工作的替代证据。

后续认证或配置变更应重复指定账号登录／退出、匿名页面和 API 拒绝访问检查，并补齐上述独立验收。不得为测试放宽白名单、泄露会话或复制生产密钥。

## 与业务发布的边界

此部署提供管理员身份入口，不提供数据库角色或生产维护授权。上线验收时采集配置、AI 执行、批量上传及业务发布接口尚未交付；已有私有候选、资格记录和发表事务不因登录功能上线而自动公开。后续新增写接口仍须逐入口验证会话、具体操作权限、可信 Origin 与 CSRF，并保留 Publisher 资格、任务授权及当前公开资格检查。

运行与安全契约见 [ADMIN_AUTH.md](../ADMIN_AUTH.md)；后续开发进度见 [PROGRESS.md](../PROGRESS.md)。
