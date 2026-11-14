/** Historical HTTP refusal receipts contain no provider prose or credentials.
 * Explain only what that status proves; never infer the present account balance.
 */
export function discoveryRequestFailureMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
  if (field('version') !== 1 || field('accounting') !== 'request_rejected') return null;
  const status = field('httpStatus');
  if (typeof status !== 'number' || !Number.isInteger(status)) return null;
  const reasons: Record<number, string> = {
    400: '请求参数被拒绝，请核对分析模型的联网搜索与结构化输出兼容性。',
    401: '身份验证失败，请核对所选 AI 连接的密钥是否有效。',
    402: '供应商额度检查未通过；请核对 OpenRouter 可用额度及并发请求预留。这不是本站每日预算不足，历史记录未细分具体额度原因，也不代表当前余额。',
    403: '访问被拒绝，请核对供应商的权限、预算限制或内容策略；仅凭状态码不能确定是哪一项。',
    404: '模型或接口不可用，请核对模型名称、接口路径及供应商路由。',
    405: '接口不支持当前请求方式，请核对接口配置。',
    413: '供应商拒绝了过大的请求，请核对模型与接口输入上限。',
    415: '供应商不接受当前请求格式，请核对接口兼容性。',
    422: '请求参数校验失败，请核对模型支持的搜索工具与输出格式。',
    429: '供应商限流，请在其限制解除后再执行；查看详情不会重试。',
  };
  return Object.hasOwn(reasons, status) ? `供应商 HTTP ${status}：${reasons[status]}` : null;
}
