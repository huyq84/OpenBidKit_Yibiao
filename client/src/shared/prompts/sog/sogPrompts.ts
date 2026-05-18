import type { ChatMessage, OutlineItem } from '../../types';
import type { TechnicalRequirementGroup } from '../../types/outline';

// ============================================================
// 工程类型
// ============================================================

export type EngineeringType = '房屋建筑' | '市政道路' | '园林绿化' | '公路工程';

export const ENGINEERING_TYPES: EngineeringType[] = ['房屋建筑', '市政道路', '园林绿化', '公路工程'];

export interface EngineeringTypeInfo {
  name: string;
  description: string;
}

// ============================================================
// 模板加载（静态 import，Vite 会打包 JSON）
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadTemplate(type: EngineeringType): any {
  // 静态 import 由构建工具处理
  switch (type) {
    case '房屋建筑': return import('./房屋建筑_目录模板.json');
    case '市政道路': return import('./市政道路_目录模板.json');
    case '园林绿化': return import('./园林绿化_目录模板.json');
    case '公路工程': return import('./公路工程_目录模板.json');
  }
}

export interface OutlineTemplate {
  name: string;
  description: string;
  outline_template: OutlineItem[];
}

/**
 * 获取指定工程类型的目录模板。
 * 用于目录生成时作为基线模板，AI 在此基础上根据招标文件调整。
 */
export function getOutlineTemplate(type: EngineeringType): OutlineTemplate | null {
  // 运行时使用动态 import 的同步替代——Vite 支持 import() 语法
  // 这里返回 null 表示在 renderer 中应通过 IPC 从 Main 侧读取
  // Main 侧 service 层负责加载 JSON 并注入到 task
  void loadTemplate(type);
  return null; // 实际加载由 Main 侧完成
}

// ============================================================
// 基于工程类型生成目录的 Prompt
// ============================================================

/**
 * 构建目录生成 Prompt，注入工程类型模板作为基线。
 * 当用户选择了工程类型时，模板 JSON 作为参考上下文注入。
 */
export function buildOutlineMessagesWithTemplate(input: {
  overview: string;
  requirements: string;
  engineeringType?: EngineeringType;
  templateOutline?: OutlineItem[];
  oldOutline?: string;
  suggestions?: string[];
}): ChatMessage[] {
  const { overview, requirements, engineeringType, templateOutline, oldOutline, suggestions } = input;

  const templateContext = templateOutline
    ? `\n\n## 工程类型目录模板（请在此基础上根据招标文件调整，不要照搬模板）\n${JSON.stringify(templateOutline, null, 2)}`
    : engineeringType
      ? `\n\n## 工程类型：${engineeringType}`
      : '';

  const oldOutlineContext = oldOutline
    ? `\n\n## 用户已有目录（请充分结合已有目录进行调整）\n${oldOutline}`
    : '';

  const suggestionContext = suggestions?.length
    ? `\n\n## 修正建议\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '';

  return [
    {
      role: 'system',
      content: `你是一个专业的施工组织设计专家。根据提供的项目概述和技术评分要求，生成投标文件中技术标部分的目录结构。

要求：
1. 目录结构要全面覆盖技术标的所有必要章节。
2. 章节名称要专业、准确，符合施工组织设计规范。
3. 一级目录名称要与技术评分要求中的章节名称一致；如果技术评分要求中没有明确章节名称，则结合内容总结一级目录名称。
4. 一共包括三级目录。
5. 返回标准 JSON 格式，包含章节编号、标题、描述和子章节。
6. 只返回 JSON，不要输出任何其他内容。

JSON 格式要求：
{
  "outline": [
    {
      "id": "1",
      "title": "",
      "description": "",
      "children": [
        { "id": "1.1", "title": "", "description": "", "children": [...] }
      ]
    }
  ]
}`,
    },
    { role: 'user', content: `项目概述：\n${overview}` },
    { role: 'user', content: `技术评分要求：\n${requirements}${templateContext}${oldOutlineContext}${suggestionContext}` },
  ];
}

/**
 * 构建基于模板目录 Patch 的 Prompt。
 * 用于在模板目录基础上进行修改（绑定知识库条目、新增节点等）。
 */
export function buildOutlinePatchMessages(input: {
  currentOutline: OutlineItem[];
  templateOutline?: OutlineItem[];
  knowledgeItems?: Array<{ id: string; title: string; resume: string }>;
  additions?: Array<{ parent_id: string; title: string; description?: string }>;
}): ChatMessage[] {
  const { currentOutline, templateOutline, knowledgeItems = [], additions = [] } = input;

  const templateCtx = templateOutline
    ? `\n\n## 工程类型模板目录（参考用）\n${JSON.stringify(templateOutline, null, 2)}`
    : '';

  const knowledgeCtx = knowledgeItems.length > 0
    ? `\n\n## 知识库条目（可绑定到相关目录节点）\n${knowledgeItems.map(k => `- [${k.id}] ${k.title}：${k.resume}`).join('\n')}`
    : '';

  const additionCtx = additions.length > 0
    ? `\n\n## 需要新增的目录节点\n${additions.map(a => `- 父节点 ${a.parent_id} 下新增：${a.title}${a.description ? `（${a.description}）` : ''}`).join('\n')}`
    : '';

  return [
    {
      role: 'system',
      content: `你是一个专业的施工组织设计专家。请对现有目录进行审核和修改。

修改规则：
1. 只允许新增目录节点（在现有节点下添加子节点）和绑定知识库条目。
2. 不允许删除、合并、重命名现有节点。
3. 新增节点必须使用三级目录（父节点+标题+描述），编号由程序自动分配。
4. 知识库条目只能绑定到已有目录节点，通过在对应节点添加 knowledge_item_ids 实现。
5. 只返回 JSON，不要输出其他内容。

返回格式：
{
  "outline": [...],  // 完整目录（只修改部分节点）
  "bindings": [{ "node_id": "1.2", "knowledge_item_ids": ["k1", "k2"] }],
  "additions": [{ "parent_id": "1.2", "title": "新节点标题", "description": "描述" }]
}`,
    },
    { role: 'user', content: `当前目录：\n${JSON.stringify(currentOutline, null, 2)}${templateCtx}${knowledgeCtx}${additionCtx}` },
  ];
}

/**
 * 工程类型信息表（供前端 UI 展示）
 */
export const ENGINEERING_TYPE_INFO: Record<EngineeringType, EngineeringTypeInfo> = {
  '房屋建筑': {
    name: '房屋建筑工程',
    description: '住宅楼、办公楼、商业综合体、学校、医院等',
  },
  '市政道路': {
    name: '市政道路工程',
    description: '城市道路、桥梁、管网等市政基础设施',
  },
  '园林绿化': {
    name: '园林绿化工程',
    description: '公园、广场、庭院景观、生态修复',
  },
  '公路工程': {
    name: '公路工程',
    description: '高速公路、一级公路、二级公路等',
  },
};
