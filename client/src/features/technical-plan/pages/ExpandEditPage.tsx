/** @jsxImportSource react */
import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from '../../../shared/ui';
import type { OutlineData, OutlineItem } from '../../../shared/types';
import type { BackgroundTaskState } from '../types';
import { buildExpandMessages, buildBatchExpandMessages, type ExpandOperation } from '../../../shared/prompts';

interface ExpandEditPageProps {
  outlineData: OutlineData | null;
  projectOverview: string;
  task?: BackgroundTaskState;
}

type ExpandMode = 'single' | 'batch';
type TargetLength = 'brief' | 'moderate' | 'detailed';

const operationOptions: Array<{ value: ExpandOperation; label: string; description: string }> = [
  { value: 'expand', label: '扩写', description: '在原文基础上深化细化，篇幅扩充 2-4 倍' },
  { value: 'rewrite', label: '改写', description: '用更专业规范的语言重写，质量显著提升' },
  { value: 'continue', label: '续写', description: '承接上文结尾，自然延伸新内容' },
];

const lengthOptions: Array<{ value: TargetLength; label: string }> = [
  { value: 'brief', label: '简洁' },
  { value: 'moderate', label: '适中' },
  { value: 'detailed', label: '详细' },
];

function collectLeafItems(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap(item => item.children?.length ? collectLeafItems(item.children) : [item]);
}

function flattenOutlineWithParents(items: OutlineItem[], parents: OutlineItem[] = []): Array<{ item: OutlineItem; parents: OutlineItem[] }> {
  return items.flatMap(item => {
    const current = [...parents, item];
    if (item.children?.length) {
      return flattenOutlineWithParents(item.children, current);
    }
    return [{ item, parents: current }];
  });
}

function ExpandEditPage({ outlineData, projectOverview, task }: ExpandEditPageProps) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<ExpandMode>('single');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<ExpandOperation>('expand');
  const [targetLength, setTargetLength] = useState<TargetLength>('moderate');
  const [results, setResults] = useState<Record<string, { content: string; status: 'idle' | 'running' | 'done' | 'error'; error?: string }>>({});
  const [runningCount, setRunningCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  const leafItems = useMemo(() => outlineData?.outline ? collectLeafItems(outlineData.outline) : [], [outlineData]);
  const flatItems = useMemo(() => outlineData?.outline ? flattenOutlineWithParents(outlineData.outline) : [], [outlineData]);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(leafItems.map(i => i.id)));
  }, [leafItems]);

  const clearAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const runExpand = useCallback(async () => {
    if (!selectedIds.size) {
      showToast('请先选择要处理的章节', 'info');
      return;
    }

    abortRef.current = new AbortController();
    const ids = Array.from(selectedIds);
    const initial: typeof results = {};
    ids.forEach(id => { initial[id] = { content: '', status: 'idle' }; });
    setResults(initial);
    setRunningCount(ids.length);

    for (const id of ids) {
      setResults(prev => ({ ...prev, [id]: { content: '', status: 'running' } }));
      try {
        const { item, parents } = flatItems.find(f => f.item.id === id) || { item: leafItems.find(i => i.id === id), parents: [] };
        if (!item) continue;

        const messages = buildExpandMessages({
          chapterTitle: item.title,
          chapterContent: item.content || '（无正文内容，请根据章节标题扩写）',
          projectOverview,
          operation,
          targetLength,
        });

        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, temperature: 0.7 }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) throw new Error(`请求失败: ${response.status}`);
        const text = await response.text();
        setResults(prev => ({ ...prev, [id]: { content: text, status: 'done' } }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : '处理失败';
        setResults(prev => ({ ...prev, [id]: { content: '', status: 'error', error: msg } }));
      }
      setRunningCount(prev => prev - 1);
    }

    setRunningCount(0);
    showToast('批量处理完成', 'success');
  }, [selectedIds, flatItems, leafItems, projectOverview, operation, targetLength, showToast]);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setRunningCount(0);
  }, []);

  const exportAllResults = useCallback(() => {
    const done = Object.entries(results).filter(([, v]) => v.status === 'done');
    if (!done.length) { showToast('没有可导出的结果', 'info'); return; }
    const md = done.map(([id, v]) => {
      const item = leafItems.find(i => i.id === id);
      return `## ${item?.title || id}\n\n${v.content}`;
    }).join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '扩写结果.md'; a.click();
    URL.revokeObjectURL(url);
  }, [results, leafItems, showToast]);

  if (!outlineData?.outline?.length) {
    return (
      <div className="empty-panel">
        <p>请先生成目录和正文，再使用扩写改写功能。</p>
      </div>
    );
  }

  return (
    <div className="page-stack expand-workbench" style={{ height: '100%', overflow: 'auto', padding: '24px' }}>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>扩写改写</h2>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button className="secondary-action" onClick={selectAll} disabled={runningCount > 0}>全选</button>
          <button className="secondary-action" onClick={clearAll} disabled={runningCount > 0}>清空</button>
          <button
            className="primary-action"
            onClick={runningCount > 0 ? cancelRun : runExpand}
            disabled={!selectedIds.size && runningCount === 0}
          >
            {runningCount > 0 ? `取消 (${runningCount})` : `开始处理 (${selectedIds.size})`}
          </button>
          <button className="secondary-action" onClick={exportAllResults}>
            导出 Markdown
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
          <legend style={{ fontSize: '12px', color: '#6b7280' }}>操作类型</legend>
          <div style={{ display: 'flex', gap: '12px' }}>
            {operationOptions.map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="operation"
                  value={opt.value}
                  checked={operation === opt.value}
                  onChange={() => setOperation(opt.value)}
                />
                <span style={{ fontWeight: 500 }}>{opt.label}</span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>{opt.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
          <legend style={{ fontSize: '12px', color: '#6b7280' }}>目标篇幅</legend>
          <div style={{ display: 'flex', gap: '8px' }}>
            {lengthOptions.map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="length"
                  value={opt.value}
                  checked={targetLength === opt.value}
                  onChange={() => setTargetLength(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* 左侧：章节列表 */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 500 }}>
            选择章节（{selectedIds.size}/{leafItems.length}）
          </div>
          <div style={{ maxHeight: '500px', overflow: 'auto', padding: '8px' }}>
            {flatItems.map(({ item, parents }) => {
              const status = results[item.id]?.status;
              const isSelected = selectedIds.has(item.id);
              return (
                <label
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    padding: '8px', borderRadius: '6px', cursor: 'pointer',
                    background: isSelected ? '#eff6ff' : 'transparent',
                    border: '1px solid ' + (isSelected ? '#3b82f6' : 'transparent'),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleItem(item.id)}
                    disabled={runningCount > 0}
                    style={{ marginTop: '3px' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{item.title}</span>
                      {status === 'running' && <span style={{ fontSize: '11px', color: '#3b82f6' }}>处理中</span>}
                      {status === 'done' && <span style={{ fontSize: '11px', color: '#22c55e' }}>✓</span>}
                      {status === 'error' && <span style={{ fontSize: '11px', color: '#ef4444' }}>失败</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                      {parents.map(p => p.title).join(' → ')}
                    </div>
                    {item.content && (
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        原文 {item.content.length} 字
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* 右侧：结果预览 */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 500 }}>
            结果预览
          </div>
          <div style={{ maxHeight: '500px', overflow: 'auto', padding: '16px' }}>
            {Object.keys(results).length === 0 && (
              <p style={{ color: '#9ca3af', textAlign: 'center', marginTop: '48px' }}>
                选择章节并点击"开始处理"后，结果将显示在这里
              </p>
            )}
            {Object.entries(results).map(([id, result]) => {
              const item = leafItems.find(i => i.id === id);
              if (!item) return null;
              return (
                <div key={id} style={{ marginBottom: '24px', borderBottom: '1px solid #f3f4f6', paddingBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: '14px' }}>{item.title}</h4>
                  {result.status === 'running' && (
                    <div style={{ color: '#3b82f6', fontSize: '13px' }}>正在生成内容...</div>
                  )}
                  {result.status === 'done' && (
                    <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {result.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {result.status === 'error' && (
                    <div style={{ color: '#ef4444', fontSize: '13px' }}>错误: {result.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExpandEditPage;
