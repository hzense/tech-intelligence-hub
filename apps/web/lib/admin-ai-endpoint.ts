/** Browser-only guidance, not an authorization or network-safety boundary.
 * The server still validates the endpoint, current allowlist and resolved IPs.
 */
export const aiProviderPresets = [
  {
    id: 'vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    host: 'ai-gateway.vercel.sh',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    host: 'openrouter.ai',
  },
] as const;

export type AiProviderPresetId = (typeof aiProviderPresets)[number]['id'] | 'custom';
type EndpointIssue =
  | 'required'
  | 'invalid_url'
  | 'https_required'
  | 'private_fields'
  | 'invalid_port'
  | 'invalid_host'
  | 'encoded_path'
  | 'unapproved_host'
  | 'request_endpoint';
export type AiEndpointGuidance =
  { valid: true } | { valid: false; issue: EndpointIssue; suggestedBaseUrl?: string };

const endpointMessages: Record<EndpointIssue, string> = {
  required: '请填写供应商的 HTTPS 接口基础地址。',
  invalid_url: '接口地址格式不正确；请填写完整 HTTPS 地址，不要包含空白或反斜杠。',
  https_required: '接口基础地址必须使用 HTTPS。',
  private_fields: '接口地址不能包含用户名、密码、查询参数或片段；API Key 只能填写在密码字段中。',
  invalid_port: '接口基础地址只允许 HTTPS 默认端口 443。',
  invalid_host: '请使用获准的公网域名，不要填写 IP、localhost 或本地域名。',
  encoded_path: '接口路径不能包含编码后的斜杠、反斜杠或空字符。',
  unapproved_host:
    '该域名尚未获服务端授权。请由管理员更新 Production 的 HZENSE_AI_ALLOWED_HOSTS 并重新部署，再刷新此页面；选择预设不会自动授权。',
  request_endpoint:
    '请填写基础路径，不要以 /chat/completions 或 /models 结尾；服务端会自行追加请求路径。可点击按钮明确修正，未自动更改地址。',
};

/** Static messages deliberately never interpolate user input or credentials. */
export function aiEndpointMessage(guidance: AiEndpointGuidance): string {
  return guidance.valid ? '' : endpointMessages[guidance.issue];
}

function canonicalEndpoint(value: string, storedBaseUrl?: string): string {
  // An unchanged stored value is omitted from PATCH, not normalized a second time.
  // The server removes one trailing slash, so stored /v1/ can differ from new /v1.
  if (value === storedBaseUrl) return value;
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

export function aiEndpointChanged(previous: string, next: string, storedBaseUrl?: string): boolean {
  return canonicalEndpoint(previous, storedBaseUrl) !== canonicalEndpoint(next, storedBaseUrl);
}

export function aiPresetForEndpoint(value: string, storedBaseUrl?: string): AiProviderPresetId {
  return (
    aiProviderPresets.find((preset) => !aiEndpointChanged(preset.baseUrl, value, storedBaseUrl))
      ?.id ?? 'custom'
  );
}

export function inspectAiEndpoint(
  value: string,
  allowedHosts: readonly string[],
): AiEndpointGuidance {
  if (!value) return { valid: false, issue: 'required' };
  if (
    value.length > 2048 ||
    /[\s\\]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return { valid: false, issue: 'invalid_url' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, issue: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { valid: false, issue: 'https_required' };
  if (url.username || url.password || /[?#]/.test(value))
    return { valid: false, issue: 'private_fields' };
  if (url.port && url.port !== '443') return { valid: false, issue: 'invalid_port' };
  if (
    url.hostname.includes(':') ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.local')
  )
    return { valid: false, issue: 'invalid_host' };
  if (/%2f|%5c|%00/i.test(url.pathname)) return { valid: false, issue: 'encoded_path' };
  if (!allowedHosts.includes(url.hostname)) return { valid: false, issue: 'unapproved_host' };
  const basePath = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/i, '');
  if (basePath !== url.pathname) {
    url.pathname = basePath || '/';
    return {
      valid: false,
      issue: 'request_endpoint',
      suggestedBaseUrl: url.toString().replace(/\/$/, ''),
    };
  }
  return { valid: true };
}
