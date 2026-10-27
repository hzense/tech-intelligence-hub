import type { RadarHotspot } from './radar-hotspots.ts';
import type { RadarSignalIndexEntry } from './signal-radar-model.ts';

export interface RadarAssessmentTheme {
  id: string;
  label: string;
  count: number;
  signalIds: string[];
}

export interface RadarAssessment {
  activity: string;
  /** A transparent observation of current public material, not an AI forecast. */
  direction: string;
  themes: RadarAssessmentTheme[];
  /** Existing published judgments retain attribution to their individual Signal. */
  judgments: { signalId: string; title: string; text: string; truncated: boolean }[];
  milestones: { signalId: string; title: string; summary: string; occurredAt: string }[];
  nextQuestion: string;
  limitations: string[];
  people: { id: string; roleLabel: string; roleEvidence?: string; sourceUrl?: string }[];
}

const themes = [
  {
    id: 'research',
    label: '研究与能力验证',
    pattern: /研究|论文|评测|基准|实验|训练|\bresearch\b|\bpaper\b|\bbenchmark\w*\b|\btraining\b/i,
  },
  {
    id: 'engineering',
    label: '工程与效率',
    pattern:
      /推理|算力|成本|延迟|吞吐|功耗|芯片|架构|基础设施|\binference\b|\blatency\b|\bthroughput\b|\bchip\w*\b|\binfrastructure\b/i,
  },
  {
    id: 'adoption',
    label: '产品与应用',
    pattern:
      /产品|应用|部署|商用|客户|上线|开源|开放源代码|\bproduct\w*\b|\bdeploy\w*\b|\bcommercial\w*\b|\bopen.source\b/i,
  },
  {
    id: 'governance',
    label: '安全与治理',
    pattern:
      /安全|对齐|隐私|监管|标准|合规|风险|\bsafety\b|\bsecurity\b|\balignment\b|\bprivacy\b|\bregulat\w*\b/i,
  },
] as const;

const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function countThemes(signals: readonly RadarSignalIndexEntry[]): RadarAssessmentTheme[] {
  return themes
    .map((theme) => {
      const signalIds = signals
        .filter((signal) => theme.pattern.test(`${signal.title}\n${signal.summary}`))
        .map((signal) => signal.id);
      return { id: theme.id, label: theme.label, count: signalIds.length, signalIds };
    })
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count || compareId(a.id, b.id));
}

function activity(hotspot: RadarHotspot, count: number): string {
  if (hotspot.previousCount === null)
    return `所选历史范围收录 ${count} 条相关信号；没有可比的上一时段。`;
  if (!count)
    return `当前时段未收录相关信号，上一等长时段有 ${hotspot.previousCount} 条；这不等同于技术停滞。`;
  if (hotspot.trend.state === 'insufficient')
    return `当前 ${count} 条、上一等长时段 ${hotspot.previousCount} 条，样本较少，暂不判断升降温。`;
  if (!hotspot.previousCount)
    return `当前时段收录 ${count} 条、上一等长时段没有记录，属于本站新观察到的活跃信号。`;
  const change = count - hotspot.previousCount;
  return `当前 ${count} 条、上一等长时段 ${hotspot.previousCount} 条，${change === 0 ? '收录量持平' : `收录量${change > 0 ? '增加' : '减少'} ${Math.abs(change)} 条`}；这里只反映本站观察活跃度。`;
}

function direction(
  signals: readonly RadarSignalIndexEntry[],
  observations: readonly RadarAssessmentTheme[],
  hotspot: RadarHotspot,
): string {
  if (!signals.length) return '本时段缺少可引用的技术进展，暂不形成方向判断。';
  if (!observations.length)
    return '当前材料未形成可稳定归纳的技术路径；可结合下方原始信号与已发布研判继续判断。';
  const midpoint = hotspot.series[4]?.start;
  if (midpoint && signals.length >= 4) {
    const middle = Date.parse(midpoint);
    const beforeThemes = countThemes(
      signals.filter((signal) => Date.parse(signal.occurredAt) < middle),
    );
    const afterThemes = countThemes(
      signals.filter((signal) => Date.parse(signal.occurredAt) >= middle),
    );
    const before = beforeThemes[0];
    const after = afterThemes[0];
    if (
      before &&
      after &&
      before.id !== after.id &&
      before.count >= 2 &&
      after.count >= 2 &&
      before.count > (beforeThemes[1]?.count ?? 0) &&
      after.count > (afterThemes[1]?.count ?? 0)
    )
      return `窗口前半段较多涉及“${before.label}”，后半段较多涉及“${after.label}”，观察重点有所变化。`;
  }
  const focus = observations
    .slice(0, 2)
    .map((theme) => `“${theme.label}”`)
    .join('、');
  return `本期信号主要涉及${focus}。`;
}

function nextQuestion(observations: readonly RadarAssessmentTheme[]) {
  const ids = new Set(observations.map((theme) => theme.id));
  if (ids.has('research') && ids.has('engineering'))
    return '后续重点核对：研究或评测结果能否在成本、速度和真实场景中得到独立复现？';
  if (ids.has('engineering') && ids.has('adoption'))
    return '后续重点核对：实际部署是否披露可比较的性能、成本与持续使用数据？';
  if (ids.has('governance'))
    return '后续重点核对：安全与治理要求是否形成可重复的评估、实施与效果证据？';
  return '后续重点核对：同类进展是否出现独立复现、实际采用或可比较的效果指标？';
}

/**
 * Derive an inspectable reading guide from the selected public snapshot only.
 * No model invocation, fresh external facts, or automatic leadership claims.
 */
export function buildRadarAssessment(
  hotspot: RadarHotspot,
  signalIndex: readonly RadarSignalIndexEntry[],
): RadarAssessment {
  const ids = new Set(hotspot.signalIds);
  const unique = new Map<string, RadarSignalIndexEntry>();
  for (const signal of signalIndex) {
    if (ids.has(signal.id) && Number.isFinite(Date.parse(signal.occurredAt)))
      unique.set(signal.id, signal);
  }
  const selected = [...unique.values()].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || compareId(a.id, b.id),
  );
  const observations = countThemes(selected);
  const judgments = selected
    .filter(
      (signal) =>
        signal.analysis?.trim() && !/<\/?(?:think|analysis|reasoning)\b/i.test(signal.analysis),
    )
    .slice(0, 3)
    .map((signal) => ({
      signalId: signal.id,
      title: signal.title,
      text: signal.analysis!,
      truncated: signal.analysisTruncated === true,
    }));
  const people = hotspot.resources
    .filter((resource) => resource.type === 'person')
    .map((resource) => {
      // A source-backed profile can identify a role; it cannot establish that
      // the person leads this entire technical field or another listed entity.
      const roleEvidence = /^https?:\/\//i.test(resource.profileSourceUrl ?? '')
        ? resource.summary?.trim()
        : undefined;
      let roleLabel = '关联人物';
      if (roleEvidence) {
        roleLabel = /不是|并非|从未|\bnot\b|\bnever\b/i.test(roleEvidence)
          ? '已有身份资料'
          : /曾任|前任|\bformer\b/i.test(roleEvidence)
            ? '资料含历史职务'
            : /创始人|首席|总裁|董事长|负责人|主任|总监|\bfounder\b|\bchief\b|\bhead of\b|\bdirector\b|\bCEO\b|\bCTO\b/i.test(
                  roleEvidence,
                )
              ? '资料注明负责人'
              : /科学家|研究员|教授|工程师|作者|\bscientist\b|\bresearcher\b|\bprofessor\b|\bengineer\b/i.test(
                    roleEvidence,
                  )
                ? '资料注明研究者'
                : '已有身份资料';
      }
      return {
        id: resource.id,
        roleLabel,
        ...(roleEvidence ? { roleEvidence, sourceUrl: resource.profileSourceUrl } : {}),
      };
    });
  return {
    activity: activity(hotspot, selected.length),
    direction: direction(selected, observations, hotspot),
    themes: observations,
    judgments,
    milestones: selected.slice(0, 3).map(({ id, title, summary, occurredAt }) => ({
      signalId: id,
      title,
      summary,
      occurredAt,
    })),
    nextQuestion: nextQuestion(observations),
    limitations: [
      '内容主题由标题与摘要中的明确词语按规则识别，同一信号可命中多个主题；主题占比不代表行业份额或因果关系。',
      '观察重点变化不等于技术路线已经转换，主题出现次数也不能证明某条路线已成熟或占据优势。',
      '热度变化受本站采集覆盖影响，不能单独证明技术进步、持续趋势或未来走向。',
      ...(judgments.length
        ? ['以下研判来自已发布信号，保留各条原文的判断及不确定性；不是本次点击重新生成的结论。']
        : ['当前选中信号尚无可展示的已发布研判，以上为规则观察，等待更多证据。']),
    ],
    people,
  };
}
