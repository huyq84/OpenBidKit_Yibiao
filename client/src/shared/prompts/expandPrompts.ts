import type { ChatMessage } from '../types';

// ============================================================
// 扩写改写类型
// ============================================================

export type ExpandOperation = 'expand' | 'rewrite' | 'continue';

export interface BuildExpandMessagesInput {
  chapterTitle: string;
  chapterContent: string;
  projectOverview?: string;
  operation: ExpandOperation;   // expand=扩写, rewrite=改写, continue=续写
  targetLength?: 'brief' | 'moderate' | 'detailed';  // 目标篇幅
  focusPoints?: string[];      // 重点强调方向
}

// ============================================================
// 系统 Prompt
// ============================================================

function buildSystemPrompt(operation: ExpandOperation, chapterTitle: string): string {
  const templates: Record<ExpandOperation, string> = {
    expand: `你是一个专业的施工组织设计专家。请对"${chapterTitle}"章节进行扩写。

扩写原则：
1. 保留原文核心观点和专业术语，只在原有基础上深化和细化。
2. 可补充：更多技术细节、操作要点、注意事项、参考规范。
3. 扩写后的内容要逻辑连贯、衔接自然，不生硬堆砌字数。
4. 不引入与主题无关的新内容。
5. 扩写后的篇幅为原文的 2-4 倍。

输出格式：纯 Markdown 正文。`,

    rewrite: `你是一个专业的施工组织设计专家。请对"${chapterTitle}"章节进行改写。

改写原则：
1. 保留原章节的核心框架和主要论点。
2. 用更专业、更规范的语言重新表达。
3. 优化结构，使逻辑更清晰、层次更分明。
4. 补充或更新可能已过时/不准确的内容。
5. 改写后的篇幅与原文相当，但内容质量显著提升。

输出格式：纯 Markdown 正文。`,

    continue: `你是一个专业的施工组织设计专家。请为"${chapterTitle}"章节续写内容。

续写原则：
1. 严格承接上文结尾，自然过渡，不重复已有内容。
2. 续写方向应符合章节主题的逻辑延伸（如：措施→实施要点→验收标准）。
3. 篇幅适中，通常为 300-800 字。
4. 保持与原文风格一致。

输出格式：纯 Markdown 正文。`,
  };

  return templates[operation];
}

// ============================================================
// 主函数
// ============================================================

export function buildExpandMessages(input: BuildExpandMessagesInput): ChatMessage[] {
  const {
    chapterTitle,
    chapterContent,
    projectOverview,
    operation,
    targetLength,
    focusPoints = [],
  } = input;

  const systemContent = buildSystemPrompt(operation, chapterTitle);

  let userContent = `## 待处理章节\n标题：${chapterTitle}\n\n正文：\n${chapterContent}`;

  if (projectOverview) {
    userContent += `\n\n## 项目概述\n${projectOverview}`;
  }

  if (targetLength) {
    const lengthMap = {
      brief: '简洁扼要，约 300-500 字',
      moderate: '适中篇幅，约 500-800 字',
      detailed: '详细深入，约 800-1500 字',
    };
    userContent += `\n\n## 目标篇幅\n${lengthMap[targetLength] || '适中篇幅'}`;
  }

  if (focusPoints.length > 0) {
    userContent += `\n\n## 重点强调\n${focusPoints.map(p => `- ${p}`).join('\n')}`;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

// ============================================================
// 全文改写（用于批量处理多章节）
// ============================================================

export interface BuildBatchExpandMessagesInput {
  chapters: Array<{ title: string; content: string; id?: string }>;
  projectOverview?: string;
  operation: ExpandOperation;
  targetLength?: 'brief' | 'moderate' | 'detailed';
}

export function buildBatchExpandMessages(input: BuildBatchExpandMessagesInput): ChatMessage[] {
  const { chapters, projectOverview, operation, targetLength } = input;

  const systemContent = `你是一个专业的施工组织设计专家。请对提供的多个章节依次进行${operation === 'expand' ? '扩写' : operation === 'rewrite' ? '改写' : '续写'}处理。

要求：
1. 依次处理每个章节，保持各自的独立性和专业性。
2. 各章节之间不要相互引用或重复内容。
3. 统一按目标篇幅要求处理。
4. 每个章节用 ## 标题 分隔，输出完整结果。

输出格式：多个 ## 标题 + 正文 区块，Markdown 格式。`;

  let userContent = '';

  if (projectOverview) {
    userContent += `## 项目概述\n${projectOverview}\n\n`;
  }

  userContent += '## 待处理章节\n';
  chapters.forEach((ch, i) => {
    userContent += `\n### 章节 ${i + 1}：${ch.title}\n${ch.content}\n`;
  });

  if (targetLength) {
    const lengthMap = {
      brief: '简洁扼要，每章节约 300-500 字',
      moderate: '适中篇幅，每章节约 500-800 字',
      detailed: '详细深入，每章节约 800-1500 字',
    };
    userContent += `\n## 目标篇幅\n${lengthMap[targetLength] || '适中篇幅'}`;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}
