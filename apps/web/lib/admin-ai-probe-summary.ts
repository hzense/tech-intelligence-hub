import {
  parseAiProbeAccounting,
  parseAiProbeDiagnostics,
  isConfirmedAiProbeRejection,
  type AiProbeDiagnosticReason,
  type AiProbeDiagnosticStage,
} from '../../../packages/database/src/ai-probe-diagnostics.mjs';
import type { AiProbe } from '../../../packages/database/src/ai-config-store.mjs';

const stages: Record<AiProbeDiagnosticStage, string> = {
  configuration: '检查配置',
  model_catalog: '读取模型目录',
  model_request: '请求模型',
  response_validation: '校验模型结果',
};
const reasons: Record<AiProbeDiagnosticReason, string> = {
  invalid_configuration: '测试配置未通过校验。',
  invalid_model: '模型 ID 不在当前可用目录中或格式无效。',
  blocked_target: '接口地址未通过允许域名或网络地址校验。',
  dns_failed: '接口域名解析失败。',
  timeout: '测试超过连接配置的等待时间，实际执行及费用需核对。',
  network_error: '连接中断或网络请求失败，实际执行及费用需核对。',
  response_too_large: '供应商响应超过允许大小。',
  redirect_blocked: '供应商返回重定向，测试已停止。',
  provider_rejected: '供应商拒绝了请求，请结合 HTTP 状态核对供应商记录。',
  invalid_response: '供应商响应不是可识别的完整数据。',
  capability_failed: '返回结果未通过所选能力测试。',
  unsupported_parameters: '模型或供应商不支持此次请求中的参数。',
  invalid_tool_call: '返回的工具调用数量、工具名称或参数未通过校验。',
  invalid_structured_output: '返回的结构化数据未通过校验。',
  sentinel_mismatch: '返回内容与固定测试内容不一致。',
  invalid_request: '供应商认为请求参数或格式无效。',
  authentication_failed: '供应商认证未通过，请核对当前连接的密钥。',
  insufficient_credit: '供应商账户余额或可用额度不足。',
  access_denied: '供应商拒绝访问，请核对账户权限和访问策略。',
  model_not_found: '供应商未找到所请求的模型或接口。',
  no_matching_provider: '没有符合当前请求条件的可用供应商。',
  rate_limited: '供应商请求频率或额度限制已触发。',
  provider_unavailable: '供应商暂不可用，实际执行及费用需核对。',
};

export function aiProbePresentation(
  probe: Pick<
    AiProbe,
    'status' | 'result' | 'error_code' | 'charged_microusd' | 'input_tokens' | 'output_tokens'
  >,
) {
  const diagnostics = parseAiProbeDiagnostics(probe.result?.diagnostics);
  const accounting = parseAiProbeAccounting(probe.result?.accounting);
  const terminal = ['succeeded', 'failed', 'stale'].includes(probe.status);
  const source =
    terminal &&
    accounting &&
    (accounting.source !== 'request_rejected' ||
      (probe.charged_microusd === '0' &&
        isConfirmedAiProbeRejection({
          success: probe.status === 'succeeded',
          error_code: probe.status === 'stale' ? 'provider_rejected' : probe.error_code,
          input_tokens: probe.input_tokens,
          output_tokens: probe.output_tokens,
          diagnostics,
        })))
      ? accounting.source
      : null;
  const costLabel =
    source === 'provider'
      ? 'API 返回费用'
      : source === 'request_rejected'
        ? '明确拒绝，不计费'
        : source === 'estimate'
          ? '估算'
          : '费用来源未记录';
  const accountingDetail =
    source === 'provider'
      ? '按供应商 API 返回值记账，尚未与最终账单对账。'
      : source === 'request_rejected'
        ? '请求已明确拒绝，本次记账为 $0，预留额度已释放。'
        : '费用未获确认，预算仍按预留或估算保留；请核对供应商记录。';
  const failureDetail = diagnostics
    ? reasons[diagnostics.reason]
    : probe.error_code === 'provider_rejected'
      ? '供应商拒绝了请求；此记录未保存 HTTP 状态与拒绝详情，不能据此判断具体原因或是否计费。'
      : probe.error_code
        ? '此记录未保存详细诊断；请结合错误分类和供应商记录核对。'
        : null;
  return {
    costLabel,
    accountingDetail,
    failureDetail,
    stageLabel: diagnostics ? stages[diagnostics.stage] : null,
    httpStatus: diagnostics?.http_status ?? null,
  };
}
