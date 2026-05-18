import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { useToast } from '../../../shared/ui';
import { CATEGORY_LABELS, USER_CATEGORIES, streamPreAnalysis, generateAnnotationId } from '../services/preAnalysisWorkflow';
import type { HighlightAnnotation, PreAnalysisState } from '../types';

interface PreAnalysisPageProps {
  fileContent: string;
  preAnalysisState?: PreAnalysisState;
  onAnnotationsChange: (annotations: HighlightAnnotation[]) => void;
  onPreAnalysisTaskChange: (task: any) => void;
  originalFilePath?: string;
  originalFileExtension?: string;
}

interface EditingAnnotation {
  id: string;
  field: 'category' | 'highlightText' | 'explanation' | 'sourceLocation';
  value: string;
}

// ─── buildHighlightedHtml ───────────────────────────────────────────────────
// Uses placeholder tokens to mark each occurrence independently, preventing
// overlapping annotations from destroying each other's markup.
// Supports fuzzy matching for better AI text alignment.

// Normalize text for fuzzy matching (remove extra spaces, normalize line breaks, unify punctuation)
function normalizeText(text: string): string {
  const punctuationMap: Record<string, string> = {
    '，': ',', '。': '.', '！': '!', '？': '?', '；': ';', '：': ':',
    '（': '(', '）': ')', '【': '[', '】': ']',
    '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'"
  };
  
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：（）【】\u201C\u201D\u2018\u2019]/g, (c) => {
      return punctuationMap[c] || c;
    })
    .trim();
}

// Normalize text but keep special characters like circled numbers
function normalizeTextKeepSpecial(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Find best matching position using fuzzy search
function findFuzzyMatch(content: string, searchText: string): { start: number; end: number; matchedText: string } | null {
  if (!searchText.trim()) return null;
  
  // First try exact match
  let idx = content.indexOf(searchText);
  if (idx !== -1) {
    return { start: idx, end: idx + searchText.length, matchedText: searchText };
  }
  
  // Try normalized match (with punctuation normalization)
  const normalizedContent = normalizeText(content);
  const normalizedSearch = normalizeText(searchText);
  
  if (normalizedSearch.length >= 5) {
    const normalizedIdx = normalizedContent.indexOf(normalizedSearch);
    if (normalizedIdx !== -1) {
      return findOriginalPosition(content, normalizedContent, normalizedIdx, normalizedSearch.length);
    }
  }
  
  // Try match keeping special characters (circled numbers, etc.)
  const specialContent = normalizeTextKeepSpecial(content);
  const specialSearch = normalizeTextKeepSpecial(searchText);
  
  if (specialSearch.length >= 5) {
    const specialIdx = specialContent.indexOf(specialSearch);
    if (specialIdx !== -1) {
      return findOriginalPosition(content, specialContent, specialIdx, specialSearch.length, true);
    }
  }
  
  // Try partial match (first 50 chars)
  const partialLength = Math.min(50, Math.floor(searchText.length * 0.7));
  if (partialLength >= 10) {
    const partialSearch = searchText.slice(0, partialLength);
    idx = content.indexOf(partialSearch);
    if (idx !== -1) {
      const endIdx = Math.min(idx + searchText.length, content.length);
      return { start: idx, end: endIdx, matchedText: content.slice(idx, endIdx) };
    }
    
    // Try normalized partial match
    const normPartialSearch = normalizeText(partialSearch);
    const normIdx = normalizedContent.indexOf(normPartialSearch);
    if (normIdx !== -1) {
      const result = findOriginalPosition(content, normalizedContent, normIdx, normPartialSearch.length);
      if (result) {
        // Extend to approximate full length
        const estimatedEnd = Math.min(result.start + searchText.length, content.length);
        return { ...result, end: estimatedEnd, matchedText: content.slice(result.start, estimatedEnd) };
      }
    }
  }
  
  return null;
}

// Helper function to map normalized position back to original
function findOriginalPosition(
  originalContent: string, 
  normalizedContent: string, 
  normalizedIdx: number, 
  normalizedLength: number,
  keepSpecial = false
): { start: number; end: number; matchedText: string } | null {
  // Map normalized position back to original
  let originalPos = 0;
  let normalizedPos = 0;
  
  const normalizeFn = keepSpecial ? normalizeTextKeepSpecial : normalizeText;
  
  for (let i = 0; i < originalContent.length && normalizedPos < normalizedIdx; i++) {
    const char = originalContent[i];
    const normalizedChar = normalizeFn(char);
    
    if (normalizedChar.length > 0) {
      normalizedPos += normalizedChar.length;
    }
    originalPos++;
  }
  
  const startPos = originalPos;
  
  // Find end position
  let endPos = startPos;
  let matchedLength = 0;
  
  while (endPos < originalContent.length && matchedLength < normalizedLength) {
    const char = originalContent[endPos];
    const normalizedChar = normalizeFn(char);
    
    if (normalizedChar.length > 0) {
      matchedLength += normalizedChar.length;
    }
    endPos++;
  }
  
  return { start: startPos, end: endPos, matchedText: originalContent.slice(startPos, endPos) };
}

function buildHighlightedHtml(
  content: string,
  annotations: HighlightAnnotation[],
  occurrenceIndexMap?: Map<string, number[]>,
  annNumberMap?: Map<string, number>
): string {
  if (!annotations.length) return content;

  // Assign a unique color index (0-4) to each annotation based on sort order.
  // This gives us up to 5 distinct highlight shades for visual layering.
  const colorClassMap: Record<string, string> = {};
  annotations.forEach((ann, i) => {
    colorClassMap[ann.id] = `annotation-highlight-color-${i % 5}`;
  });

  // Phase 1: for each annotation, find all character positions of its highlightText.
  // Collect them in a map for navigation (ann.id → [pos0, pos1, ...]).
  const occMap = occurrenceIndexMap || new Map<string, number[]>();

  // Phase 2: build the output using a list of segments rather than string replace.
  // Each segment is either plain text or { annId, text }.
  // We walk the content once, greedily matching the earliest upcoming annotation.
  const sorted = [...annotations].filter(a => a.highlightText);
  if (!sorted.length) return content;

  // Pre-compute all occurrences: for each annotation, find all start indices.
  const allOccurrences: { ann: HighlightAnnotation; start: number; end: number; matchedText: string }[] = [];
  let unmatchedCount = 0;
  
  for (const ann of sorted) {
    const text = ann.highlightText;
    
    // Try exact match first
    let pos = 0;
    let idx = content.indexOf(text, pos);
    
    while (idx !== -1) {
      allOccurrences.push({ ann, start: idx, end: idx + text.length, matchedText: text });
      occMap.set(ann.id, [...(occMap.get(ann.id) || []), allOccurrences.length - 1]);
      idx = content.indexOf(text, idx + 1);
    }
    
    // If no exact match found, try fuzzy match
    if (!allOccurrences.some(occ => occ.ann.id === ann.id)) {
      const fuzzyMatch = findFuzzyMatch(content, text);
      if (fuzzyMatch) {
        console.error(`[HIGHLIGHT] Fuzzy match found for annotation ${ann.id}: "${text.slice(0, 50)}..." -> "${fuzzyMatch.matchedText.slice(0, 50)}..."`);
        allOccurrences.push({ 
          ann, 
          start: fuzzyMatch.start, 
          end: fuzzyMatch.end, 
          matchedText: fuzzyMatch.matchedText 
        });
        occMap.set(ann.id, [...(occMap.get(ann.id) || []), allOccurrences.length - 1]);
      } else {
        unmatchedCount++;
        console.error(`[HIGHLIGHT] No match found for annotation ${ann.id}: "${text.slice(0, 100)}..."`);
      }
    }
  }
  
  console.error(`[HIGHLIGHT] Total annotations: ${sorted.length}, matched: ${allOccurrences.length}, unmatched: ${unmatchedCount}`);
  
  if (allOccurrences.length === 0) return content;

  // Sort by start position ascending.
  allOccurrences.sort((a, b) => a.start - b.start);

  // Build segments.
  // Use external annNumberMap if provided, otherwise generate locally
  const localNumberMap = annNumberMap || (() => {
    const map = new Map<string, number>();
    let counter = 1;
    for (const occ of allOccurrences) {
      if (!map.has(occ.ann.id)) {
        map.set(occ.ann.id, counter++);
      }
    }
    return map;
  })();

  const segments: Array<{ type: 'text'; content: string } | { type: 'mark'; annId: string; content: string; colorClass: string; annNumber: number }> = [];
  let cur = 0;
  for (const occ of allOccurrences) {
    if (occ.start > cur) {
      segments.push({ type: 'text', content: content.slice(cur, occ.start) });
    }
    segments.push({
      type: 'mark',
      annId: occ.ann.id,
      content: occ.matchedText,
      colorClass: colorClassMap[occ.ann.id],
      annNumber: localNumberMap.get(occ.ann.id) || 0,
    });
    cur = occ.end;
  }
  if (cur < content.length) {
    segments.push({ type: 'text', content: content.slice(cur) });
  }

  // Render to HTML string.
  const html = segments
    .map(seg => {
      if (seg.type === 'text') {
        return seg.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
      const escaped = seg.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const annNumber = (seg as { annNumber: number }).annNumber;
      return `<mark class="annotation-highlight ${seg.colorClass}" data-ann-id="${seg.annId}" data-ann-number="${annNumber}"><span class="annotation-number-badge">${annNumber}</span>${escaped}</mark>`;
    })
    .join('');

  return html;
}

function PreAnalysisPage({
  fileContent,
  preAnalysisState,
  onAnnotationsChange,
  onPreAnalysisTaskChange,
  originalFilePath,
  originalFileExtension,
}: PreAnalysisPageProps) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('全部');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showSourcePreview, setShowSourcePreview] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState({ category: '技术要求', highlightText: '', explanation: '', sourceLocation: '' });
  const [sourceViewMode, setSourceViewMode] = useState<'markdown' | 'pdf'>('markdown');
  const sourceRef = useRef<HTMLDivElement>(null);

  // Tracks current occurrence index per annotation id: annId → which occurrence is selected (0-based)
  const [currentOccurrence, setCurrentOccurrence] = useState<Record<string, number>>({});

  const annotations = preAnalysisState?.annotations || [];
  const verifiedCount = annotations.filter(a => a.isVerified).length;

  const filteredAnnotations = useMemo(() => {
    if (filterCategory === '全部') return annotations;
    return annotations.filter(a => a.category === filterCategory);
  }, [annotations, filterCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { 全部: annotations.length };
    for (const ann of annotations) {
      counts[ann.category] = (counts[ann.category] || 0) + 1;
    }
    return counts;
  }, [annotations]);

  // 分析进度状态
  const [analysisStage, setAnalysisStage] = useState<'idle' | 'connecting' | 'waiting' | 'parsing' | 'done' | 'error'>('idle');
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const startAnalysis = useCallback(async () => {
    if (!fileContent) {
      showToast('请先上传招标文件', 'info');
      return;
    }

    console.error('[PRE_ANALYSIS] startAnalysis called, fileContent length:', fileContent.length);
    setRunning(true);
    setAnalysisStage('connecting');
    setAnalysisProgress(10);
    onAnnotationsChange([]);

    let batchIndex = 0;
    const newAnnotations: HighlightAnnotation[] = [];

    try {
      setAnalysisStage('waiting');
      setAnalysisProgress(30);

      streamPreAnalysis(
        fileContent,
        (batch) => {
          console.error('[PAGE onBatch] called, batch size:', batch.length, 'total so far:', newAnnotations.length + batch.length);
          setAnalysisStage('parsing');
          setAnalysisProgress(40 + batchIndex * 15);
          const mapped = batch.map(a => ({
            id: generateAnnotationId(),
            category: a.category,
            highlightText: a.highlightText,
            explanation: a.explanation,
            sourceLocation: a.sourceLocation,
            sourceLine: undefined,
            isManual: false,
            isVerified: false,
            createdAt: new Date().toISOString(),
          }));
          newAnnotations.push(...mapped);
          onAnnotationsChange([...newAnnotations]);
          batchIndex++;
        },
        () => {
          console.error('[PRE_ANALYSIS] stream done, total annotations:', newAnnotations.length);
          setRunning(false);
          setAnalysisStage('done');
          setAnalysisProgress(100);
          showToast(`预分析完成，共提取 ${newAnnotations.length} 条标注`, 'success');
        },
        (error) => {
          console.error('[PRE_ANALYSIS] stream error:', error);
          setRunning(false);
          setAnalysisStage('error');
          showToast(`预分析失败：${error}`, 'error');
        }
      );
    } catch (err) {
      console.error('[PRE_ANALYSIS] startAnalysis caught error:', err);
      setRunning(false);
      setAnalysisStage('error');
    }
  }, [fileContent, onAnnotationsChange, showToast]);

  const toggleVerify = useCallback((id: string) => {
    onAnnotationsChange(annotations.map(a =>
      a.id === id ? { ...a, isVerified: !a.isVerified } : a
    ));
  }, [annotations, onAnnotationsChange]);

  const deleteAnnotation = useCallback((id: string) => {
    onAnnotationsChange(annotations.filter(a => a.id !== id));
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
  }, [annotations, onAnnotationsChange, selectedAnnotationId]);

  const startEdit = (id: string, field: string, value: string) => {
    setEditingId(id);
    setEditingField(field);
    setEditValue(value);
  };

  const saveEdit = useCallback(() => {
    if (!editingId || !editingField) return;
    onAnnotationsChange(annotations.map(a =>
      a.id === editingId ? { ...a, [editingField]: editValue } : a
    ));
    setEditingId(null);
    setEditingField(null);
    setEditValue('');
  }, [editingId, editingField, editValue, annotations, onAnnotationsChange]);

  const submitNewAnnotation = useCallback(() => {
    if (!newAnnotation.highlightText.trim()) {
      showToast('请填写原文高亮内容', 'info');
      return;
    }
    const ann: HighlightAnnotation = {
      id: generateAnnotationId(),
      category: newAnnotation.category,
      highlightText: newAnnotation.highlightText,
      explanation: newAnnotation.explanation,
      sourceLocation: newAnnotation.sourceLocation,
      sourceLine: undefined,
      isManual: true,
      isVerified: false,
      createdAt: new Date().toISOString(),
    };
    onAnnotationsChange([...annotations, ann]);
    setNewAnnotation({ category: '技术要求', highlightText: '', explanation: '', sourceLocation: '' });
    setShowAddForm(false);
    showToast('标注已添加', 'success');
  }, [newAnnotation, annotations, onAnnotationsChange, showToast]);

  // Build occurrence index map for all annotations: annId → array of mark indices
  const annotationOccurrences = useMemo<Map<string, number[]>>(() => {
    const map = new Map<string, number[]>();
    buildHighlightedHtml(fileContent, annotations, map);
    return map;
  }, [fileContent, annotations]);

  const scrollToAnnotation = (ann: HighlightAnnotation) => {
    setSelectedAnnotationId(ann.id);
    if (!sourceRef.current) return;

    // Find all mark elements for this annotation
    const allMarkers = Array.from(sourceRef.current.querySelectorAll<HTMLElement>(`[data-ann-id="${ann.id}"]`));
    if (allMarkers.length === 0) return;

    // Determine which occurrence to navigate to
    const totalOcc = allMarkers.length;
    const currentOcc = currentOccurrence[ann.id] ?? 0;
    const targetIndex = Math.min(currentOcc, totalOcc - 1);

    // Remove is-selected from all markers, add to target
    allMarkers.forEach(m => m.classList.remove('is-selected'));
    const targetEl = allMarkers[targetIndex];
    if (targetEl) {
      targetEl.classList.add('is-selected');
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const navigateOccurrence = (ann: HighlightAnnotation, direction: 'prev' | 'next') => {
    const total = annotationOccurrences.get(ann.id)?.length ?? 0;
    if (total <= 1) return;
    const current = currentOccurrence[ann.id] ?? 0;
    const next = direction === 'next'
      ? (current + 1) % total
      : (current - 1 + total) % total;
    setCurrentOccurrence(prev => ({ ...prev, [ann.id]: next }));
    // Scroll to new occurrence
    if (sourceRef.current) {
      const markers = Array.from(sourceRef.current.querySelectorAll<HTMLElement>(`[data-ann-id="${ann.id}"]`));
      markers.forEach(m => m.classList.remove('is-selected'));
      const target = markers[next];
      if (target) {
        target.classList.add('is-selected');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const getOccurrenceDisplay = (annId: string): string => {
    const total = annotationOccurrences.get(annId)?.length ?? 0;
    if (total <= 1) return '';
    const current = (currentOccurrence[annId] ?? 0) + 1;
    return `${current}/${total}`;
  };

  const getCategoryColor = (category: string) => {
    return CATEGORY_LABELS.find(c => c.id === category)?.color || '#6366f1';
  };

  // Shared annotation number map - used by both source highlights and cards
  const annotationNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!fileContent || annotations.length === 0) return map;
    
    // Build all occurrences first (same logic as buildHighlightedHtml)
    const allOccurrences: Array<{ ann: typeof annotations[0]; start: number }> = [];
    
    for (const ann of annotations) {
      const text = ann.highlightText;
      if (!text) continue;
      
      // Try exact match first
      let pos = 0;
      let idx = fileContent.indexOf(text, pos);
      while (idx !== -1) {
        allOccurrences.push({ ann, start: idx });
        idx = fileContent.indexOf(text, idx + 1);
      }
      
      // If no exact match, try fuzzy match
      if (!allOccurrences.some(occ => occ.ann.id === ann.id)) {
        const fuzzyMatch = findFuzzyMatch(fileContent, text);
        if (fuzzyMatch) {
          allOccurrences.push({ ann, start: fuzzyMatch.start });
        }
      }
    }
    
    // Sort by position
    allOccurrences.sort((a, b) => a.start - b.start);
    
    // Assign sequential numbers
    let counter = 1;
    for (const occ of allOccurrences) {
      if (!map.has(occ.ann.id)) {
        map.set(occ.ann.id, counter++);
      }
    }
    
    return map;
  }, [fileContent, annotations]);

  const getAnnotationNumber = annotationNumberMap;

  const sourceHighlightedHtml = useMemo(() => buildHighlightedHtml(fileContent, annotations, undefined, annotationNumberMap), [fileContent, annotations, annotationNumberMap]);

  // Handle click on source highlight marks - scroll to corresponding annotation card
  const handleSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const target = e.target as HTMLElement;
    const mark = target.closest('mark.annotation-highlight') as HTMLElement | null;
    if (!mark) return;
    
    const annId = mark.getAttribute('data-ann-id');
    if (!annId) return;
    
    // Find the annotation
    const ann = annotations.find(a => a.id === annId);
    if (!ann) return;
    
    // Save current scroll position of source panel
    const sourceContainer = sourceRef.current?.parentElement;
    const savedScrollTop = sourceContainer?.scrollTop ?? 0;
    const savedScrollLeft = sourceContainer?.scrollLeft ?? 0;
    
    // Update selected state
    setSelectedAnnotationId(annId);
    
    // Scroll to the annotation card in the middle panel
    const cardElement = document.querySelector(`[data-annotation-card="${annId}"]`);
    if (cardElement) {
      cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add visual highlight effect
      cardElement.classList.add('is-highlighted');
      setTimeout(() => cardElement.classList.remove('is-highlighted'), 2000);
    }
    
    // Restore source panel scroll position after a small delay to prevent scroll jump
    setTimeout(() => {
      if (sourceContainer) {
        sourceContainer.scrollTop = savedScrollTop;
        sourceContainer.scrollLeft = savedScrollLeft;
      }
    }, 300);
  }, [annotations]);

  // --- Resizable panel widths ---
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(420);
  const minLeft = 220;
  const minMid = 300;
  const minRight = 280;
  const resizing = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null);

  const onResizerMouseDown = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = {
      side,
      startX: e.clientX,
      startW: side === 'left' ? leftWidth : rightWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const dx = e.clientX - resizing.current.startX;
      if (resizing.current.side === 'left') {
        setLeftWidth(Math.max(minLeft, Math.min(window.innerWidth - minMid - minRight - 80, resizing.current.startW + dx)));
      } else {
        setRightWidth(Math.max(minRight, Math.min(window.innerWidth - minLeft - minMid - 80, resizing.current.startW - dx)));
      }
    };
    const onUp = () => {
      resizing.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [leftWidth, rightWidth, minLeft, minMid, minRight]);

  return (
    <div className="plan-step-body pre-analysis-page">
      <section className="bid-analysis-command-bar">
        <div>
          <span className="section-kicker">STEP 01.5</span>
          <strong>招标文件预分析</strong>
          <p>AI 标注重点内容，用户复核后进入正式解析。</p>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={startAnalysis}
          disabled={running || !fileContent}
        >
          {running ? '分析中...' : annotations.length > 0 ? '重新分析' : '开始分析'}
        </button>
      </section>

      {/* 分析进度动画 */}
      {running && (
        <section className="pre-analysis-progress-bar">
          <div className="pre-analysis-progress-info">
            <span className="pre-analysis-progress-stage">
              {analysisStage === 'connecting' && '🔗 正在连接服务器...'}
              {analysisStage === 'waiting' && '⏳ 等待 AI 响应（首次响应较慢）...'}
              {analysisStage === 'parsing' && `📝 正在解析标注（${annotations.length} 条）...`}
            </span>
            <span className="pre-analysis-progress-pct">{analysisProgress}%</span>
          </div>
          <div className="content-generation-progress-track">
            <span style={{ width: `${analysisProgress}%` }} />
          </div>
        </section>
      )}

      <section className="bid-analysis-workspace" style={{ gridTemplateColumns: `${leftWidth}px 1fr ${rightWidth}px` }}>
        {/* Left sidebar */}
        <aside className="bid-analysis-task-pane pre-analysis-left-sidebar grid-col-1" aria-label="标注筛选">
          <div className="analysis-result-head bid-analysis-task-head">
            <strong>标注分类</strong>
            <span>{annotations.length} 条</span>
          </div>

          <div className="bid-analysis-task-list">
            {['全部', ...USER_CATEGORIES].map(cat => (
              <button
                type="button"
                key={cat}
                className={`bid-analysis-task-item${filterCategory === cat ? ' is-active' : ''}`}
                onClick={() => setFilterCategory(cat)}
              >
                <strong>{cat}</strong>
                <small>{categoryCounts[cat] || 0} 条</small>
              </button>
            ))}
          </div>

          <div className="pre-analysis-stats-actions">
            <div className="pre-analysis-stats">
              <div className="pre-analysis-stat-row">
                <span>已复核</span>
                <strong>{verifiedCount}</strong>
              </div>
              <div className="pre-analysis-stat-row">
                <span>待复核</span>
                <strong>{annotations.length - verifiedCount}</strong>
              </div>
              <div className="content-generation-progress-track" style={{ marginTop: 8 }}>
                <span style={{ width: `${annotations.length ? (verifiedCount / annotations.length) * 100 : 0}%` }} />
              </div>
            </div>

            <div className="pre-analysis-actions">
              <button type="button" className="secondary-action" onClick={() => setShowAddForm(!showAddForm)}>
                + 添加标注
              </button>
            </div>
          </div>
        </aside>

        {/* Left resizer */}
        <div className="panel-resizer grid-resizer-left" onMouseDown={onResizerMouseDown('left')} />

        {/* Center content */}
        <div className="pre-analysis-content grid-col-2">
          {/* Add form */}
          {showAddForm && (
            <div className="pre-analysis-add-form">
              <h4>手动添加标注</h4>
              <div className="pre-analysis-form-row">
                <label>分类</label>
                <select
                  value={newAnnotation.category}
                  onChange={e => setNewAnnotation(prev => ({ ...prev, category: e.target.value }))}
                >
                  {USER_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="pre-analysis-form-row">
                <label>原文高亮</label>
                <textarea
                  value={newAnnotation.highlightText}
                  onChange={e => setNewAnnotation(prev => ({ ...prev, highlightText: e.target.value }))}
                  placeholder="从原文中复制粘贴相关内容..."
                  rows={3}
                />
              </div>
              <div className="pre-analysis-form-row">
                <label>标注说明</label>
                <textarea
                  value={newAnnotation.explanation}
                  onChange={e => setNewAnnotation(prev => ({ ...prev, explanation: e.target.value }))}
                  placeholder="这条标注为什么重要..."
                  rows={2}
                />
              </div>
              <div className="pre-analysis-form-row">
                <label>原文位置</label>
                <input
                  type="text"
                  value={newAnnotation.sourceLocation}
                  onChange={e => setNewAnnotation(prev => ({ ...prev, sourceLocation: e.target.value }))}
                  placeholder="如：第3页第2段"
                />
              </div>
              <div className="pre-analysis-form-actions">
                <button type="button" className="secondary-action" onClick={() => setShowAddForm(false)}>取消</button>
                <button type="button" className="primary-action" onClick={submitNewAnnotation}>保存</button>
              </div>
            </div>
          )}

        {/* Annotation cards */}
        <div className="pre-analysis-annotation-list">
          {filteredAnnotations.length === 0 && !running && (
            <div className="pre-analysis-empty">
              <p>{annotations.length === 0 ? '点击"开始分析"让 AI 提取重点标注' : '当前分类下没有标注'}</p>
            </div>
          )}

          {filteredAnnotations.map(ann => (
            <div
              key={ann.id}
              data-annotation-card={ann.id}
              className={`pre-analysis-annotation-card${ann.isVerified ? ' is-verified' : ''}${selectedAnnotationId === ann.id ? ' is-selected' : ''}`}
              onClick={() => scrollToAnnotation(ann)}
            >
              <div className="annotation-card-header">
                <span className="annotation-number-badge-card">#{getAnnotationNumber.get(ann.id) || '?'}</span>
                <span
                  className="annotation-category-badge"
                  style={{ backgroundColor: getCategoryColor(ann.category) }}
                >
                  {ann.category}
                </span>
                {ann.isManual && <span className="annotation-manual-badge">手动</span>}
                {/* Occurrence navigation: show when there are multiple occurrences */}
                {(annotationOccurrences.get(ann.id)?.length ?? 0) > 1 && (
                  <span className="annotation-occurrence-nav">
                    <button
                      type="button"
                      className="annotation-occ-btn"
                      onClick={(e) => { e.stopPropagation(); navigateOccurrence(ann, 'prev'); }}
                      title="上一处"
                    >◀</button>
                    <span className="annotation-occurrence-label">
                      第{(currentOccurrence[ann.id] ?? 0) + 1}处/共{annotationOccurrences.get(ann.id)?.length}处
                    </span>
                    <button
                      type="button"
                      className="annotation-occ-btn"
                      onClick={(e) => { e.stopPropagation(); navigateOccurrence(ann, 'next'); }}
                      title="下一处"
                    >▶</button>
                  </span>
                )}
                <div className="annotation-card-actions">
                  <button
                    type="button"
                    className={`annotation-verify-btn${ann.isVerified ? ' is-verified' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleVerify(ann.id); }}
                    title={ann.isVerified ? '取消复核' : '标记已复核'}
                  >
                    {ann.isVerified ? '✓ 已复核' : '○ 复核'}
                  </button>
                  <button
                    type="button"
                    className="annotation-edit-btn"
                    onClick={(e) => { e.stopPropagation(); startEdit(ann.id, 'highlightText', ann.highlightText); }}
                    title="编辑原文"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="annotation-delete-btn"
                    onClick={(e) => { e.stopPropagation(); deleteAnnotation(ann.id); }}
                    title="删除"
                  >
                    🗑
                  </button>
                </div>
              </div>

              <div className="annotation-highlight-text">
                {editingId === ann.id && editingField === 'highlightText' ? (
                  <div className="annotation-edit-form">
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                    <div className="annotation-edit-actions">
                      <button type="button" onClick={() => { setEditingId(null); setEditingField(null); }}>取消</button>
                      <button type="button" className="primary-action" onClick={saveEdit}>保存</button>
                    </div>
                  </div>
                ) : (
                  <pre>{ann.highlightText}</pre>
                )}
              </div>

              {ann.explanation && (
                <div className="annotation-explanation">
                  <strong>说明：</strong>{ann.explanation}
                </div>
              )}

              {ann.sourceLocation && (
                <div className="annotation-source-location">
                  📍 {ann.sourceLocation}
                </div>
              )}
            </div>
          ))}
        </div>
        </div>

        {/* Right resizer */}
        <div className="panel-resizer grid-resizer-right" onMouseDown={onResizerMouseDown('right')} />

        {/* Right panel: source preview */}
        <div className="pre-analysis-source-panel grid-col-3">
          <div className="pre-analysis-source-header">
            <strong>原文预览</strong>
            <div className="source-view-tabs">
              <button
                type="button"
                className={`source-view-tab${sourceViewMode === 'markdown' ? ' is-active' : ''}`}
                onClick={() => setSourceViewMode('markdown')}
              >
                Markdown
              </button>
              <button
                type="button"
                className={`source-view-tab${sourceViewMode === 'pdf' ? ' is-active' : ''}`}
                onClick={() => setSourceViewMode('pdf')}
                disabled={!originalFilePath || !originalFileExtension?.includes('pdf')}
              >
                PDF
              </button>
            </div>
            <button type="button" onClick={() => setShowSourcePreview(false)}>隐藏</button>
          </div>
          
          {sourceViewMode === 'markdown' ? (
            <div
              className="pre-analysis-source-content"
              ref={sourceRef}
              onClick={handleSourceClick}
              dangerouslySetInnerHTML={{ __html: sourceHighlightedHtml }}
            />
          ) : (
            <div className="pre-analysis-pdf-content">
              {originalFileExtension?.includes('pdf') && originalFilePath ? (
                <object
                  data={`file:///${originalFilePath}`}
                  type="application/pdf"
                  className="pdf-viewer"
                >
                  <div className="pdf-fallback">
                    <p>无法直接预览 PDF，请在外部打开查看：</p>
                    <a href={`file:///${originalFilePath}`} target="_blank" className="pdf-external-link">
                      打开原始文件
                    </a>
                  </div>
                </object>
              ) : (
                <div className="pdf-not-available">
                  <p>当前文件不是 PDF 格式</p>
                  <p>原始文件格式：{originalFileExtension?.toUpperCase() || '未知'}</p>
                </div>
              )}
            </div>
          )}
          {!showSourcePreview && (
            <button
              type="button"
              className="secondary-action"
              onClick={() => setShowSourcePreview(true)}
              style={{ marginTop: 12 }}
            >
              显示原文预览
            </button>
          )}
        </div>
      </section>

      {/* Bottom actions */}
      <section className="pre-analysis-bottom-bar">
        <button
          type="button"
          className="secondary-action"
          onClick={startAnalysis}
          disabled={running || !fileContent}
        >
          {running ? '分析中...' : '重新分析'}
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={annotations.length === 0}
          onClick={() => {
            // Check if there's at least one verified annotation or user has manually confirmed
            showToast('标注已完成，可进入 Step02 招标文件解析', 'success');
            // The parent component handles navigation via step change
          }}
        >
          确认并进入 Step02
        </button>
      </section>
    </div>
  );
}

export default PreAnalysisPage;