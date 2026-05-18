const systemPrompt = `你是专业的招标文件预分析专家。请从招标文件中提取重点内容，并为每条重点添加标注说明。

通用要求：
1. 只提取招标文件原文中有明确依据的内容，不要自行编造。
2. 原文没有明确提及的内容不要提取。
3. 每条标注需要：分类标签、原文高亮片段、标注说明、原文位置。
4. 标注说明要说明这条内容为什么重要、对投标有什么影响。
5. 优先提取对技术标编写有影响的内容：技术要求、商务评分项、时间节点、废标条件、资质要求。

分类标签可选值：技术要求、商务条款、时间节点、风险项、资质要求、重要说明。

输出格式：
输出一批标注（最多10条），格式为 JSON。后续如有更多标注，会继续输出。
{
  "batch_id": "批次ID（自增）",
  "annotations": [
    {
      "category": "分类标签",
      "highlightText": "原文高亮片段（尽量完整，可含换行）",
      "explanation": "标注说明：为什么重要，对投标有什么影响",
      "sourceLocation": "原文位置描述，如「第3页第2段」「表2-1」等"
    }
  ]
}

仅输出 JSON，不要输出其他内容。`;

function buildMessages(fileContent) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `以下是完整招标文件 Markdown 原文。请提取重点内容并给出标注：\n\n${fileContent}` },
  ];
}

async function runPreAnalysisTask({ aiService, workspaceStore, updateTask, payload }) {
  console.error('[PRE_TASK] runPreAnalysisTask started, has aiService:', !!aiService, 'has streamChat:', typeof aiService?.streamChat);
  const { fileContent } = payload || {};
  if (!fileContent) {
    throw new Error('缺少 fileContent 参数');
  }

  let batchIndex = 0;
  let annotationCount = 0;

  updateTask({ status: 'running', progress: 0, logs: ['开始预分析招标文件...'] });

  function parseAnnotations(content) {
    // Try to extract JSON from content
    try {
      const parsed = JSON.parse(content);
      if (parsed.annotations && Array.isArray(parsed.annotations)) {
        return parsed.annotations;
      }
    } catch {
      // Try to find JSON in content
      const jsonMatch = content.match(/\{[\s\S]*"annotations"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.annotations && Array.isArray(parsed.annotations)) {
            return parsed.annotations;
          }
        } catch {}
      }
    }
    return [];
  }

  let accumulatedContent = '';

  await aiService.streamChat(
    {
      messages: buildMessages(fileContent),
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    (event) => {
      console.error('[PRE_TASK] stream event type:', event.type);
      if (event.type === 'chunk' && event.chunk) {
        accumulatedContent += event.chunk;
        console.error('[PRE_TASK] accumulated content length:', accumulatedContent.length);

        // Try to parse accumulated content for annotations
        const annotations = parseAnnotations(accumulatedContent);
        if (annotations.length > annotationCount) {
          annotationCount = annotations.length;
          const newAnnotations = annotations.slice(annotationCount - (annotations.length - annotationCount));
          console.error('[PRE_TASK] new annotations batch:', newAnnotations.length);

          // Store in workspace
          const prev = workspaceStore.loadTechnicalPlan() || {};
          workspaceStore.updateTechnicalPlan({
            preAnalysisState: {
              ...(prev.preAnalysisState || {}),
              annotations: [
                ...((prev.preAnalysisState?.annotations) || []),
                ...newAnnotations.map((a, i) => ({
                  id: `ann_${Date.now()}_${batchIndex}_${i}`,
                  category: a.category || '重要说明',
                  highlightText: a.highlightText || a.highlight_text || '',
                  explanation: a.explanation || '',
                  sourceLocation: a.sourceLocation || a.source_location || '',
                  isManual: false,
                  isVerified: false,
                  createdAt: new Date().toISOString(),
                })),
              ],
            },
          });

          updateTask({
            status: 'running',
            progress: Math.min(90, Math.round(annotationCount / 2)),
            logs: [`已提取 ${annotationCount} 条标注...`],
          });

          batchIndex++;
        }
      }
    }
  );

  // Save final state
  const prev = workspaceStore.loadTechnicalPlan() || {};
  const finalCount = prev.preAnalysisState?.annotations?.length || 0;
  workspaceStore.updateTechnicalPlan({
    preAnalysisState: {
      ...(prev.preAnalysisState || {}),
      preAnalysisTask: updateTask({ status: 'success', progress: 100, logs: [`预分析完成，共提取 ${finalCount} 条标注。`] }),
    },
  });

  updateTask({ status: 'success', progress: 100 }, workspaceStore.loadTechnicalPlan());
}

module.exports = { runPreAnalysisTask };