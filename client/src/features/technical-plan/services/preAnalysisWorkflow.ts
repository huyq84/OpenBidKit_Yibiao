import { aiClient } from '../../../shared/ai/aiClient';
import type { AiStreamEvent } from '../types';
import type { HighlightAnnotation } from '../types';

// 预设分类（LLM 可自主选择，不受此限制）
export const CATEGORY_LABELS = [
  { id: '技术要求', label: '技术要求', color: '#3b82f6' },
  { id: '商务条款', label: '商务条款', color: '#8b5cf6' },
  { id: '时间节点', label: '时间节点', color: '#f59e0b' },
  { id: '风险项', label: '风险项', color: '#ef4444' },
  { id: '资质要求', label: '资质要求', color: '#10b981' },
  { id: '重要说明', label: '重要说明', color: '#6366f1' },
];

// 用户可新增分类（前端下拉框用）
export const USER_CATEGORIES = ['技术要求', '商务条款', '时间节点', '风险项', '资质要求', '重要说明'];

const systemPrompt = `你是专业的招标文件预分析专家。请从招标文件中提取重点内容，并为每条重点添加标注说明。

通用要求：
1. 只提取招标文件原文中有明确依据的内容，不要自行编造。
2. 原文没有明确提及的内容不要提取。
3. 每条标注需要：分类标签、原文高亮片段、标注说明、原文位置。
4. 标注说明要说明这条内容为什么重要、对投标有什么影响。
5. 优先提取对技术标编写有影响的内容：技术要求、商务评分项、时间节点、废标条件、资质要求。
6. 分类由你根据内容自主判断，可选分类包括：技术要求、商务条款、时间节点、风险项、资质要求、重要说明。如果内容不符合预设分类，可以在分类名称后加括号补充说明（如"风险项（报价风险）"）。
7. 用户可在分析后新增任意分类，不受上述限制。

输出格式：
每次输出一批标注，每批最多10条。格式为 JSON：
{
  "batch_id": "批次ID",
  "annotations": [
    {
      "category": "分类标签（自主判断，可添加补充说明）",
      "highlightText": "原文高亮片段（尽量完整，可含换行）",
      "explanation": "标注说明：为什么重要，对投标有什么影响",
      "sourceLocation": "原文位置描述，如「第3页第2段」「表2-1」等"
    }
  ]
}

仅输出 JSON，不要输出其他内容。`;

function buildMessages(fileContent: string): Parameters<typeof aiClient.streamChat>[0]['messages'] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `以下是完整招标文件 Markdown 原文。请提取重点内容并给出标注：\n\n${fileContent}` },
  ];
}

export function streamPreAnalysis(
  fileContent: string,
  onBatch: (annotations: Omit<HighlightAnnotation, 'id' | 'isManual' | 'isVerified' | 'createdAt'>[]) => void,
  onDone: () => void,
  onError: (error: string) => void
) {
  let batchIndex = 0;
  let buffer = '';

  // 找到 { 和最后一个 }，尝试解析完整 JSON（支持任意嵌套层级）
  const tryFlush = (buf: string): { consumed: number; remaining: string } => {
    if (!buf.trim()) return { consumed: 0, remaining: '' };

    // 去掉思考链（兼容 ‹think>‹/think>› 和 <think>...</think> 两种格式）
    const withoutThink = buf
      .replace(/\u2039think>[\s\S]*?\u2039\/think>/gi, '')        // ‹think>...‹/think>
      .replace(/<think>[\s\S]*?<\/think>/gi, '');                 // <think>...</think>
    if (!withoutThink.trim()) return { consumed: 0, remaining: '' };

    const firstBrace = withoutThink.indexOf('{');
    if (firstBrace === -1) {
      // 无 JSON，直接返回空
      return { consumed: 0, remaining: '' };
    }

    // 找最后一个 }（外层对象的闭合）
    const lastBrace = withoutThink.lastIndexOf('}');
    if (lastBrace === -1 || lastBrace <= firstBrace) {
      // 还未收到完整的 }，保留等待后续 chunk
      return { consumed: 0, remaining: withoutThink.slice(firstBrace) };
    }

    // 尝试解析 firstBrace~lastBrace 这一段（完整 JSON 对象）
    const toTry = withoutThink.slice(firstBrace, lastBrace + 1);
    let parsed: any;
    try {
      parsed = JSON.parse(toTry);
    } catch {
      // JSON 不完整或损坏，等下一个 chunk
      return { consumed: 0, remaining: withoutThink.slice(firstBrace) };
    }

    if (parsed.annotations && Array.isArray(parsed.annotations) && parsed.annotations.length > 0) {
      console.error('[PRE_ANALYSIS] flush SUCCESS, annotations count:', parsed.annotations.length);
      const annotations = parsed.annotations.map((ann: any) => ({
        category: ann.category || '重要说明',
        highlightText: ann.highlightText || ann.highlight_text || '',
        explanation: ann.explanation || '',
        sourceLocation: ann.sourceLocation || ann.source_location || '',
        sourceLine: undefined,
      }));
      try {
        console.error('[PRE_ANALYSIS] calling onBatch, batch size:', annotations.length);
        onBatch(annotations);
        console.error('[PRE_ANALYSIS] onBatch returned OK');
      } catch (batchErr) {
        console.error('[PRE_ANALYSIS] onBatch threw, error:', batchErr, 'stack:', batchErr?.stack);
      }
      batchIndex++;

      // 返回 consuming 后的剩余内容
      const remaining = withoutThink.slice(lastBrace + 1);
      console.error('[PRE_ANALYSIS] flush consumed, remaining len:', remaining.length);
      return { consumed: lastBrace + 1, remaining };
    }

    // JSON 解析成功但不是标注对象（可能是片段），继续等
    return { consumed: 0, remaining: withoutThink.slice(firstBrace) };
  };

  const handleEvent = (event: AiStreamEvent) => {
    if (event.type === 'content') {
      // 剥离 <think>...</think> 或 ‹think>...‹/think>› 思考标签（‹ = U+2039，/think> 闭合标签也用 guillemet）
      const cleaned = event.content
        .replace(/\u2039think>[\s\S]*?\u2039\/think>/gi, '')        // ‹think>...‹/think>
        .replace(/<think>[\s\S]*?<\/think>/gi, '');                 // <think>...</think> (普通ASCII版本)
      buffer += cleaned;
      const hasAnnotations = cleaned.includes('"annotations"') || cleaned.includes('"batch_id"');
      console.error('[PRE_ANALYSIS] content event, hasAnnotations:', hasAnnotations, 'cleaned len:', cleaned.length, 'last 100:', JSON.stringify(cleaned.slice(-100)));
      const result = tryFlush(buffer);
      if (result.consumed > 0) {
        console.error('[PRE_ANALYSIS] flush consumed', result.consumed, 'chars, new remaining:', result.remaining.length);
        buffer = result.remaining;
      } else {
        console.error('[PRE_ANALYSIS] flush failed, buffer kept len:', buffer.length);
      }
    } else if (event.type === 'done') {
      console.error('[PRE_ANALYSIS] done event, final buffer length:', buffer.length, 'buffer head:', JSON.stringify(buffer.slice(0, 300)));
      const { consumed, remaining } = tryFlush(buffer);
      buffer = remaining;
      if (consumed === 0 && buffer.trim()) {
        console.error('[PRE_ANALYSIS] done with unparsed remaining buffer:', buffer.slice(0, 500));
      }
      try {
        console.error('[PRE_ANALYSIS] calling onDone');
        onDone();
        console.error('[PRE_ANALYSIS] onDone returned OK');
      } catch (doneErr) {
        console.error('[PRE_ANALYSIS] onDone threw, error:', doneErr, 'stack:', doneErr?.stack);
      }
    }
  };

  try {
    aiClient.streamChat(
      {
        messages: buildMessages(fileContent),
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      handleEvent
    );
  } catch (err) {
    console.error('[PRE_ANALYSIS] streamChat throw:', err);
    onError(String(err));
  }
}

export function generateAnnotationId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}