// Only application-owned messages are rendered. Never use provider text or an
// unrecognized error code as a user-visible explanation.
const generationErrorMessages: Record<string, string> = {
  generation_dispatch_failed: '后台任务未能开始或排队已超时，未自动重试。请核对任务与配置。',
  generation_timeout:
    '生成达到本次任务的截止时间，未能确认完整结果。请先对账原任务，不要重复调用。',
  generation_provider_rejected: '供应商拒绝了生成请求。请核对模型与接口配置；该分类不代表未计费。',
  generation_network_error: '生成请求发生网络错误，结果与费用需核对，不要重复调用。',
  generation_dns_failed: '供应商域名解析失败。请核对服务端网络，不要重复提交任务。',
  generation_blocked_target: '供应商目标未通过安全校验，请核对已授权域名和地址。',
  generation_redirect_blocked: '供应商返回了不允许的跳转，请核对接口基础地址。',
  generation_response_too_large: '供应商响应超出安全大小限制，未采用结果；费用仍需核对。',
  generation_invalid_response: '供应商响应格式不符合要求，未采用结果；费用仍需核对。',
  generation_invalid_configuration: '生成配置未通过调用前校验，请核对连接和模型配置版本。',
  generation_invalid_output:
    '生成结果未通过结构或原文证据校验，未保存为可用候选。请查看下方已保存的字段诊断；若没有记录，无法据此判断具体原因。请先核对原任务及费用。',
  generation_invalid_json:
    '模型输出不是有效的 JSON，未保存为可用候选。未自动修补或重试，请核对原任务及费用。',
  generation_invalid_envelope:
    '模型输出的顶层字段或对象结构不符合约定，未保存为可用候选。未自动重试，请核对原任务及费用。',
  generation_invalid_candidates:
    '模型输出的 candidates 字段不是候选数组，未保存为可用候选。未自动重试，请核对原任务及费用。',
  generation_too_many_candidates:
    '模型输出超过单次最多 5 条候选的限制，未采用结果。未自动截断或重试，请核对原任务及费用。',
  generation_invalid_reason:
    '模型输出的 reason 字段格式不符合约定，未保存为可用候选。未展示原始文本或自动重试，请核对原任务及费用。',
  generation_output_too_large:
    '模型输出的正文超过安全大小限制，未采用结果。未自动截断或重试，请核对原任务及费用。',
  generation_output_truncated:
    '模型达到输出 token 上限，结果不完整（推理也可能占用额度）。未自动重试，请核对费用后调整模型或资料。',
  generation_capability_failed:
    '模型目录未声明本次所需的结构化输出能力，已在生成调用前停止。请选择支持 JSON Schema 的模型。',
  generation_invalid_model: '模型不在当前供应商目录中或能力信息缺失，请刷新模型列表后重新配置。',
  generation_output_rejected: '生成结果触发内容安全校验，未保存为可用候选。',
  generation_sdk_error: '模型调用发生未分类异常，请按任务编号核对脱敏日志与费用，不要重复调用。',
  generation_postflight_failed: '模型调用后的资料或配置复核失败，结果未交付；请核对原任务及费用。',
  generation_unknown: '旧记录未保留具体调用失败分类，结果及费用待核对，不要重复调用。',
  outcome_unknown: '执行已超时，未确认完整结果，按失败处理；费用记录保留。',
  generation_failed: '生成未得到可用候选，请核对原任务及费用。',
  input_too_large:
    '输入超过 100,000 tokens 估算上限或来源 JSON 安全大小上限。请先拆分资料；不会自动截断或调用模型。',
  invalid_source: '解析结果格式无效。请在导入页核对资料是否完整解析。',
  source_unavailable: '所选资料尚不可用，可能未完成解析或已被取消。',
  profile_not_ready: '模型配置尚未就绪。请核对抽取阶段模型、连接及能力测试。',
  revision_conflict:
    '模型配置版本已变化，原请求不能直接改用新版本。请核对任务；仅未创建的请求可放弃编号后刷新配置。',
  budget_exceeded: '预算不足，暂不能执行生成。请核对批次、每日及连接预算，不要重复提交。',
  not_configured: 'AI 信号生成尚未完成生产授权或配置，请联系管理员核对。',
  invalid_request: '请求参数未通过校验。请保留原请求编号并联系管理员核对。',
  request_id_conflict: '原请求编号已关联其他输入，禁止重新使用或自动更换编号。',
  response_identity_mismatch:
    '返回任务与所选资料或配置不一致。已保留原请求编号，未执行 AI；请联系管理员核对。',
  connection_unavailable: '所选 AI 连接暂不可用，请核对连接状态与授权。',
  worker_busy: '当前连接正在处理其他任务。请查询当前状态，稍后再手动操作。',
  configuration_changed: '任务创建后模型配置发生变化，本次结果不能直接采用。',
  source_changed: '原资料在任务创建后发生变化，请先核对来源与任务状态。',
  stale_attempt: '任务处理资格已失效，请查询最新状态，不要重复调用模型。',
  commit_unknown: '服务端尚无法确认任务记录，请保持原编号并查询，不要新建重复任务。',
  not_found: '暂未查到原任务。请保留原编号；确认配置后可使用原编号重新确认创建，不会自动调用 AI。',
  cancelled: '该资料或任务已取消，不能继续生成。',
  task_active: '任务仍在执行或执行保护期未结束，暂不能删除或重新生成；请稍后查询状态。',
  published_candidate_delete_forbidden: '请先撤回该任务已发布的候选，再删除任务。',
  task_deleted:
    '同一资料与配置的任务已删除。可手动创建重新生成任务，执行时可能再次计费；也可点击“核对并放弃未创建请求”选择其他资料。',
  duplicate_source: '该资料与已有解析内容重复，请从列表选择保留的资料。',
  limit_exceeded: '请求超出允许范围，请核对资料及配置限制。',
  unauthorized: '管理员登录已失效。请重新登录后按原请求编号核对。',
  forbidden: '当前请求未通过访问校验，请从本站管理页面重新进入并核对原请求。',
};

export function knownGenerationErrorMessage(code: unknown): string | null {
  return typeof code === 'string' && Object.hasOwn(generationErrorMessages, code)
    ? generationErrorMessages[code]!
    : null;
}

export function generationFailureMessage(run: {
  status: string;
  error_code?: unknown;
}): string | null {
  return (
    knownGenerationErrorMessage(run.error_code) ??
    (run.status === 'failed' || run.status === 'unknown'
      ? '任务未保留可识别的具体失败原因，请按任务编号核对记录与费用；不要重复调用。'
      : null)
  );
}
