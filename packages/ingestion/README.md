# 资料导入前置契约

`@hzense/ingestion` 当前提供混合批次的**接收前声明校验**。这是资料导入中心的一个独立子模块，不是已经接通的上传、抓取、解析、AI 或发布服务。

## 已实现的边界

`validateImportManifest(input, { capabilities })` 是无网络、无数据库、无文件读写、无 AI 调用的同步纯函数。输出固定错误码、逐项校验结果和声明数量，不生成批次或对象 ID。

- `valid: true` 仅表示声明通过校验，不表示服务器已接收、已上传、已解析、已入库或已发表。
- `clientItemId` 是调用者提供的临时标识，合法时原样回传，重复值报错；它不是持久化 ID。文件 `inputIndex` 从 0 开始，链接 `lineNumber` 从 1 开始。
- 所有输出都是私有资料。`originalUrl` 保留输入原行，可能包含已被拒绝的凭据；文件名和原始 URL 不得写入日志、公开 DTO、遥测或公开错误提示。
- 未配置的解析、OCR 或链接抓取能力返回 `capability_unavailable`。能力由可信配置注入，不能让浏览器或模型自行声明服务可用。

## 默认限制

| 项目             | `IMPORT_LIMITS` 字段 | 默认值                 |
| ---------------- | -------------------- | ---------------------- |
| 单文件大小       | `maxFileBytes`       | 25 × 1024 × 1024 字节  |
| 每批文件数       | `maxFiles`           | 20                     |
| 每批非空链接行数 | `maxLinks`           | 100                    |
| 每批文件声明总量 | `maxBatchBytes`      | 200 × 1024 × 1024 字节 |
| 单文档页数       | `maxDocumentPages`   | 300                    |

普通业务超限逐项标记，并给出 `batchErrors`；不删除超限项或只保留前 20 个文件／100 个链接。重复链接仍计入输入行数预算。大整数使用精确累计，未知或无法安全表示的总字节数返回 `null`，不会伪报较小的总量。

为限制契约本身的处理量，另有硬输入封套：最多 1000 个文件声明、1000 个链接物理行、262144 个链接输入字符（UTF-16 单元）。超过封套时整体返回 `manifest_too_large`，不返回“部分已处理”的结果。HTTP 层仍须在反序列化之前限制实际请求字节数与读取期限。

## 输入与能力

```js
import { validateImportManifest, IMPORT_LIMITS } from '@hzense/ingestion';

const result = validateImportManifest(
  {
    files: [
      {
        clientItemId: 'file-1',
        name: '研究资料.pdf',
        size: 2048,
        mime: 'application/pdf',
        pageCount: 12,
        requiresOcr: true,
      },
    ],
    urlLines: 'https://example.org/report?a=1&a=2#section\n',
  },
  {
    capabilities: {
      // 仅示意字段；生产只能在相应服务完成配置与能力测试后设为可用。
      parsers: ['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx'],
      ocr: true,
      urlFetch: true,
    },
  },
);
```

文件支持 PDF、DOCX、MD／Markdown、TXT、HTML／HTM、CSV、XLSX、PNG、JPEG／JPG。图片需要 OCR；扫描 PDF 除 PDF 解析器外还需要 OCR。`requiresOcr: false` 或缺失不能豁免实际扫描检测；`pageCount` 未提供也不能豁免解析时的真实页数上限。

旧 DOC、旧 Office、宏文件和用户压缩包返回 `conversion_required`；未列出的格式返回 `unsupported_format`。文件名不允许路径、控制字符或首尾空白。文件大小必须是大于零的安全整数。空 MIME、`application/octet-stream` 或与扩展名对应的已知 MIME 可以通过声明检查，**这不是真实类型验证**；不接受以 MIME 声明绕过转换要求。

URL 仅允许 HTTPS 默认端口或 443，拒绝凭据、控制字符、IP 字面量、单标签主机及 localhost／local／internal 等保留后缀。去空行但保留非空行原始位置。规范化只由 URL 标准解析器处理地址并移除 fragment；不排序、删除或重新序列化 query 参数。相同规范 URL 的后续行标记 `duplicate` 和 `duplicateOfLine`，首次保留；不推断跨批重复、相同文件内容或相同事件。

## 本契约不能替代的校验

- 认证、固定 Host／Origin、CSRF、速率、预算、批次归属与持久化幂等检查。
- 短期、对象键受限的私有上传凭证，以及服务器对实际字节、MIME／文件签名、哈希、归属和上传完成的确认。
- 初始 DNS、每次重定向、实际连接地址的出口控制和地址固定；这里**没有 DNS 查询**，域名可解析到私网，声明通过不代表可安全抓取。
- 响应流与解压后字节、CPU、内存、超时、页数、ZIP 条目和展开比例等限制；不执行宏、脚本、表格公式或外部资源。
- PDF／DOCX／表格／HTML／OCR 的隔离解析、精确定位、质量判断、私有材料与公开佐证分离，以及 Signal 提取、核验、去重和发布。

上述所有格式仍属于首版完整交付目标。能力未配置只是明确阻止当前使用，不表示将 OCR、表格或扫描 PDF 延后到可选范围。

## 验证

```sh
pnpm --filter @hzense/ingestion test
pnpm --filter @hzense/ingestion lint
pnpm --filter @hzense/ingestion typecheck
pnpm --filter @hzense/ingestion build
```

源码直接使用 `.mjs`，声明使用 `.d.mts`，没有运行时依赖或生成产物。现有 `packages/*` 工作区模式可以发现此包；调用方仍需声明工作区依赖并更新根锁文件。
