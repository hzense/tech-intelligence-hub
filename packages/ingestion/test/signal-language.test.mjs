import assert from 'node:assert/strict';
import test from 'node:test';
import { isChineseSignalText, SIGNAL_LANGUAGE_RULES } from '../src/signal-language.mjs';

test('Chinese prose permits English names, models and technical terms', () => {
  for (const text of [
    'OpenAI 发布 GPT-6',
    'NVIDIA 发布新款 GeForce RTX 5090 显卡',
    'd-Matrix 计划通过 NVIDIA NVLink Fusion 接入 Raptor XPU',
    'OpenAI 发布 GPT-6 Astra',
    'OpenAI 发布 GPT-oss',
    'DeepSeek 发布 deepseek-chat',
    'Anthropic 推出 Claude Opus 5.5',
    'Microsoft 公布 Copilot Home、Code 与 Autopilot',
    'NVIDIA 发布 Open Agent Safety Platform',
    'Google DeepMind 发布新研究成果',
    'Microsoft 与 OpenAI 扩大合作',
    'NVIDIA 发布 CUDA 更新，改善 GPU 开发工具；性能收益仍需独立测试。',
    'OpenAI 發布新模型，研究團隊說明安全評估的限制。',
    'ＯｐｅｎＡＩ 发布 ＧＰＴ－６',
  ]) {
    assert.equal(isChineseSignalText(text), true, text);
  }
});

test('English prose, token Chinese suffixes and non-prose cannot pass', () => {
  for (const text of [
    'OpenAI announces a new model',
    'The company released an updated model with improved reasoning and efficiency.',
    'OpenAI announces a new model with improved performance 中文',
    'OpenAI launches GPT-6 新品发布',
    'OpenAI Announces A New Model 新品发布',
    'NVIDIA and OpenAI Launch GPU 发布',
    '中 OpenAI releases GPT-6',
    'AI GPU CPU LLM NVIDIA OpenAI 技术',
    '新しいモデルを公開しました',
    '人工智能 모델을 공개했습니다',
    '2026-11-02 100% ——',
    '',
    null,
    123,
    {},
  ]) {
    assert.equal(isChineseSignalText(text), false, String(text));
  }
});

test('language policy does not normalize stored text or require translated evidence', () => {
  const title = 'ＯｐｅｎＡＩ 发布新模型';
  assert.equal(isChineseSignalText(title), true);
  assert.equal(title, 'ＯｐｅｎＡＩ 发布新模型');
  assert.match(SIGNAL_LANGUAGE_RULES, /title.*summary/);
  assert.match(SIGNAL_LANGUAGE_RULES, /quote.*原文原语言/);
  assert.match(SIGNAL_LANGUAGE_RULES, /不添加事实/);
});
