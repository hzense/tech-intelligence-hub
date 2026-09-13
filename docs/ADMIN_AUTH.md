# 管理员 Google 登录

## 当前能力与边界

本阶段提供 Google-only 管理员认证入口，使用 NextAuth.js `4.24.15`。代码实现、生产配置、部署与真实 OAuth 验收分别记录，不能相互替代。

**2026-09-13 后续核验：** [PR #77](https://github.com/hzense/tech-intelligence-hub/pull/77) 已合并，认证配置后的 Production 部署已 READY 并绑定 `hzense.com`。指定管理员已完成真实 Google 授权、回调、后台访问和退出；匿名页面／API 拒绝访问已独立核验。详见[脱敏上线记录](production-evidence/2026-09-13-admin-auth.md)。非白名单真实账号、Preview 线上与登录后会话 API 的独立 HTTP 验收仍未完成，不能据此宣称完整安全验收已关闭。

历史检查点：本功能提交前仅完成本地实现和隔离测试，当时尚未部署生产、尚未完成真实 Google 授权／回调／退出。该记录保留为开发阶段证据，当前生产状态以上述后续核验为准。

| 入口                      | 当前行为                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `/admin/login`            | 未登录显示 Google 登录按钮；配置不完整时禁用按钮并显示“管理员登录尚未配置完成”；已登录跳转 `/admin` |
| `/admin`                  | 服务端校验管理员会话，显示当前登录邮箱与退出入口；未登录跳转登录页                                  |
| `GET /api/admin/session`  | 独立校验会话；未授权返回 `401`，授权后仅返回用户标识、邮箱与授权到期时间；响应禁止共享缓存          |
| `/api/auth/[...nextauth]` | NextAuth 管理 OAuth、CSRF 与会话流程；配置不可用时返回 `503`                                        |

登录页不显示配置中的管理员邮箱。受保护布局和页面分别执行服务端鉴权；会话 API 也独立鉴权。管理员页面设置 `noindex, nofollow`，但搜索引擎指令不是访问控制。

生产目前没有接通 Publisher 或 Signal 业务数据库操作；本地已实现[受限发布／撤回入口](SIGNAL_PUBLIC_PUBLICATION.md)，尚未部署或配置生产权限。信号采集配置、AI 调用和文档／链接批量上传仍未实现。登录成功不自动授予数据库角色、候选公开资格或生产维护权限；会话不需要数据库 Adapter，也不创建用户表。

## 身份和会话规则

- `HZENSE_ADMIN_EMAIL` 只接受一个 Gmail 邮箱，不支持邮箱列表、通配符、Workspace 域名、`googlemail.com` 或 `+` 别名。
- 邮箱比较忽略大小写及首尾空白，但保留地址中的点号，不做“去点”等账号合并。填写实际 Google 登录资料返回的地址，不能以同域其他地址替代。
- OAuth 提供方必须为 Google，返回资料的 `email_verified` 必须为布尔值 `true`；身份使用 Google `sub`，并核对 OAuth 账号标识与该 `sub` 一致。请求头、自报邮箱或客户端 session 更新不能建立管理员身份。
- 授权使用受保护的 JWT 会话 cookie；应用授权自首次成功登录起绝对有效期为 1 小时。读取或更新会话不会延长这一期限，到期需重新登录。
- 每次服务端鉴权重新检查当前白名单和配置绑定。环境变量更改在新部署生效后，不应继续把旧白名单下的会话视为有效授权。
- OAuth 只请求 `openid email`，不请求 Gmail 邮件内容、Google Drive 文件或离线访问权限。Google access token／refresh token 不保留在应用会话中。

## 生产配置：只在 Vercel Production 保存

进入 HZense 对应 Vercel 项目的 **Settings → Environment Variables**，添加以下服务端变量，环境范围仅选择 **Production**。不要勾选 Preview，不要使用 `NEXT_PUBLIC_` 前缀，不要把值写进代码、README、PR、截图或对话。变量的环境范围和保存操作参考 [Vercel 环境变量文档](https://vercel.com/docs/environment-variables)。

| 变量                   | 填写内容                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | Google Cloud 创建的 Web application OAuth Client ID，通常以 `.apps.googleusercontent.com` 结尾                                             |
| `GOOGLE_CLIENT_SECRET` | 同一个 OAuth 客户端的 Client Secret，直接从 Google Cloud 填入 Vercel                                                                       |
| `NEXTAUTH_SECRET`      | 用安全随机生成器产生的独立会话密钥，随机材料至少 32 字节；可将 32 随机字节编码为 64 位十六进制文本保存。不要使用占位文本、短密码或重复字符 |
| `NEXTAUTH_URL`         | 必须精确为 `https://hzense.com`，不带末尾 `/` 或回调路径                                                                                   |
| `HZENSE_ADMIN_EMAIL`   | 唯一获授权管理员的实际 Gmail 地址；不要把真实地址记入仓库                                                                                  |

生产环境使用 Vercel 提供的 `VERCEL_ENV=production` 识别部署，不需要人为新增或伪造该平台变量。生产 URL 不接受 `www.hzense.com`、Preview URL 或临时 `vercel.app` 域名。

缺少任一变量、格式不符合要求或处于 Preview 环境时，认证保持关闭。配置更改需要经过单独的生产部署才能生效；保存变量、构建通过、上线和真实登录验收是不同步骤。2026-09-13 已将以上五项变量保存为仅 Production 的 Secret，并完成后续部署；本文不保存任何变量值，详细验收范围以上线记录为准。

## Google Cloud 网页配置

1. 在 Google Cloud Console 选择要用于 HZense 的项目，打开 **Google Auth Platform**，按页面要求完善应用名称、支持邮箱等 Branding 信息。
2. 个人 Gmail 管理员使用 External 受众。若应用处于 Testing 状态且 Google 当前规则要求测试用户名单，在 **Audience → Test users** 添加该管理员账号。仅基础身份 scope 存在测试规则例外，以控制台提示为准；Google 测试用户名单不代替 HZense 自己的单邮箱白名单。参考 [Google 受众与测试用户说明](https://support.google.com/cloud/answer/15549945?hl=en)。
3. 在 **Clients** 创建 OAuth 客户端，应用类型选择 **Web application**。这是网站 OAuth Client，不是 API key 或服务账号。界面说明见 [Google Web Server OAuth 配置文档](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred)。
4. 在 **Authorized redirect URIs** 添加以下完整地址，必须精确匹配：

   ```text
   https://hzense.com/api/auth/callback/google
   ```

   不要填 `/admin`、`/admin/login`、仅域名或通配符。NextAuth 的 Google 回调约定见 [Google Provider 文档](https://next-auth.js.org/providers/google)。

5. 配置身份访问范围时仅保留本功能需要的 `openid email`；不要为管理员登录额外申请 Drive、Gmail 或其他业务 API 权限。
6. 将生成的 Client ID 与 Client Secret 直接填入 Vercel 的对应 Production 变量。不要发送到对话，也不要提交下载的客户端凭据 JSON。

## 本地开发与自动化检查

本地认证只接受以下两个固定来源之一，端口必须为 `3000`：

```text
http://localhost:3000
http://127.0.0.1:3000
```

若另行授权进行真实本地 OAuth 调试，应使用独立测试凭据，并在 Google 客户端添加与所选来源一致的 `/api/auth/callback/google` 回调；`localhost` 与 `127.0.0.1` 不可混用。生产密钥不应复制到本地或 Preview。仅运行站点的公开页面不要求配置管理员登录。

常规检查在仓库根目录运行：

```bash
pnpm --filter @hzense/web lint
pnpm --filter @hzense/web typecheck
pnpm --filter @hzense/web test
pnpm --filter @hzense/web build
```

构建后的真实本地服务回归测试需主动启用，并保持端口 `3000` 空闲：

```bash
pnpm --filter @hzense/web build
HZENSE_ADMIN_AUTH_INTEGRATION=1 pnpm --filter @hzense/web exec node --test test/admin-auth-runtime.test.mjs
```

`admin-auth-runtime.test.mjs` 启动隔离的本地 Next.js 服务，使用合成 OAuth 参数和随机测试密钥检查拒绝访问、受保护会话、绝对到期时间与 CSRF 等行为；不请求 Google、不登录真实账号，也不需要数据库或部署凭据。未设置 `HZENSE_ADMIN_AUTH_INTEGRATION=1` 时，此项集成测试默认跳过；跳过不能记录为通过。该测试通过不代表真实 Google OAuth 已验收。

CI 在构建之后单独启用该隔离回归，无需仓库 Secret 或真实管理员账号；同时运行桌面／移动端匿名后台访问测试。本地已通过 102 项新增认证单元测试、14 个构建后 HTTP 场景和全站 28 项浏览器测试；这些结果不替代下面的真实 OAuth 上线验收。

## 持续验收与安全约束

本次已核对匿名 `/admin` 重定向、匿名 `/api/admin/session` 返回 `401`、唯一授权账号真实登录及退出后的页面拒绝访问；配置警告已消失。未来认证配置或实现变更后，应重复这些检查。

以下仍为独立待验项：非白名单真实 Google 账号被拒绝、真实 Preview 部署保持禁用、已登录 `/api/admin/session` 返回 `200` 的独立 HTTP 验收，以及长期认证错误监控。浏览器打开会话 JSON 地址时曾被客户端以 `net::ERR_BLOCKED_BY_CLIENT` 阻断，不可记为该接口验收通过或服务端认证失败。短窗口错误扫描无记录，也不代表长期监控已建立。保存脱敏结果，不记录 cookie、授权码、token、密钥或真实管理员邮箱。

新增[受限发布与撤回入口](SIGNAL_PUBLIC_PUBLICATION.md)分别执行当前管理员会话校验、精确可信 `Origin`／Fetch Metadata 检查和仅限 JSON 的有界请求；拒绝跨站请求及调用者提供的正文、核验结论和角色。Publisher 数据库资格与任务门禁独立执行，不能用登录状态替代。NextAuth POST 入口仍使用库提供的 CSRF token 防护。

以后增加上传、采集配置等写操作时，每个 API／Server Action 都必须重新校验管理员会话与具体操作权限，并使用与该接口匹配的 CSRF 防护。不能仅依赖页面／布局鉴权、隐藏按钮或 OAuth 登录结果。新业务入口目前为未部署代码，不改变上述认证生产验收范围。

相关实现：[`admin-auth-policy.ts`](../apps/web/lib/admin-auth-policy.ts)、[`admin-auth-options.ts`](../apps/web/lib/admin-auth-options.ts)、[`server/admin-auth.ts`](../apps/web/lib/server/admin-auth.ts)。
