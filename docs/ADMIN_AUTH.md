# 管理员 Google 登录

## 当前能力与边界

本阶段提供 Google-only 管理员认证入口，使用 NextAuth.js `4.24.15`。代码实现不等于生产部署或真实 OAuth 验收：本阶段尚未部署生产，尚未完成真实 Google 账号的授权、回调与退出验收。

| 入口                      | 当前行为                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `/admin/login`            | 未登录显示 Google 登录按钮；配置不完整时禁用按钮并显示“管理员登录尚未配置完成”；已登录跳转 `/admin` |
| `/admin`                  | 服务端校验管理员会话，显示当前登录邮箱与退出入口；未登录跳转登录页                                  |
| `GET /api/admin/session`  | 独立校验会话；未授权返回 `401`，授权后仅返回用户标识、邮箱与授权到期时间；响应禁止共享缓存          |
| `/api/auth/[...nextauth]` | NextAuth 管理 OAuth、CSRF 与会话流程；配置不可用时返回 `503`                                        |

登录页不显示配置中的管理员邮箱。受保护布局和页面分别执行服务端鉴权；会话 API 也独立鉴权。管理员页面设置 `noindex, nofollow`，但搜索引擎指令不是访问控制。

目前没有接通信号采集配置、AI 调用、文档／链接批量上传、Publisher 或业务数据库操作；不会因为登录成功而获得数据库角色、发布授权或生产维护权限。会话不需要数据库 Adapter，也不创建用户表。

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

缺少任一变量、格式不符合要求或处于 Preview 环境时，认证保持关闭。配置更改需要经过单独的生产部署才能生效；保存变量、构建通过、上线和真实登录验收是不同步骤，本文不宣称已执行其中的外部操作。

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

## 后续上线验收与安全约束

实际生产部署后，仍需单独核对：未登录访问 `/admin` 被重定向，`/api/admin/session` 返回 `401`；唯一授权账号完成 Google 登录后才可访问；其他账号被拒绝；退出后受保护入口重新拒绝访问；Preview 仍保持禁用。保存脱敏结果，不记录 cookie、授权码、token、密钥或真实管理员邮箱。

以后增加上传、采集配置或发布等写操作时，每个 API／Server Action 都必须重新校验管理员会话与具体操作权限，并同时验证可信 `Origin` 和 CSRF。不能仅依赖页面／布局鉴权、隐藏按钮或 OAuth 登录结果。现有 NextAuth POST 入口已同时使用同源检查和库提供的 CSRF 防护，不能把这视为未来业务写接口已获得保护。

相关实现：[`admin-auth-policy.ts`](../apps/web/lib/admin-auth-policy.ts)、[`admin-auth-options.ts`](../apps/web/lib/admin-auth-options.ts)、[`server/admin-auth.ts`](../apps/web/lib/server/admin-auth.ts)。
