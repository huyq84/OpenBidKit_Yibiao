import { useEffect, useState } from 'react';
import { sogplan } from '../../../shared/api/apiClient';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { useToast } from '../../../shared/ui';
import type { FileParserProvider } from '../../../shared/types';

const parserLabels: Record<FileParserProvider, string> = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};

interface DocumentAnalysisPageProps {
  fileName: string;
  fileContent: string;
  originalFilePath?: string;
  originalFileExtension?: string;
  pdfPath?: string;
  onFileImported: (fileName: string, fileContent: string, filePath?: string, fileExtension?: string, pdfPath?: string) => void;
}

function DocumentAnalysisPage({
  fileName,
  fileContent,
  originalFilePath,
  originalFileExtension,
  pdfPath,
  onFileImported,
}: DocumentAnalysisPageProps) {
  const [parserLabel, setParserLabel] = useState(parserLabels.local);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'pdf' | 'markdown'>('pdf');
  const { showToast } = useToast();

  const hasPdfPreview = pdfPath || (originalFileExtension === '.pdf' && originalFilePath);

  useEffect(() => {
    let mounted = true;

    const loadParserConfig = async () => {
      try {
        const config = await sogplan.config.load();
        if (mounted) {
          setParserLabel(parserLabels[config.file_parser.provider] || parserLabels.local);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '读取文件解析配置失败', 'error');
      }
    };

    loadParserConfig();

    return () => {
      mounted = false;
    };
  }, [showToast]);

  const importDocument = async () => {
    try {
      setBusy(true);
      const result = await sogplan.file.importDocument();

      if (!result?.success || !result.file_content) {
        showToast(result?.message || '未导入文件', 'info');
        return;
      }

      onFileImported(
        result.file_name || '未命名文件', 
        result.file_content,
        result.file_path,
        result.file_extension,
        result.pdf_path
      );
      if (result.parser_label) {
        setParserLabel(result.parser_label);
      }
      showToast(result.message, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '文件解析失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const renderDocumentPreview = () => {
    if (viewMode === 'markdown') {
      return (
        <div className="markdown-viewer">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {fileContent}
          </ReactMarkdown>
        </div>
      );
    }

    if (pdfPath) {
      return (
        <div className="document-pdf-preview">
          <object
            data={`file:///${pdfPath}`}
            type="application/pdf"
            className="pdf-viewer"
          >
            <div className="pdf-fallback">
              <p>无法直接预览 PDF，请在外部打开查看：</p>
              <a href={`file:///${pdfPath}`} target="_blank" className="pdf-external-link">
                打开预览文件
              </a>
            </div>
          </object>
        </div>
      );
    }

    if (originalFileExtension === '.pdf' && originalFilePath) {
      return (
        <div className="document-pdf-preview">
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
        </div>
      );
    }

    return (
      <div className="document-other-preview">
        <div className="document-info">
          <div className="document-icon">
            {originalFileExtension === '.docx' && '📄'}
            {originalFileExtension === '.doc' && '📄'}
            {originalFileExtension === '.wps' && '📄'}
            {!['.pdf', '.docx', '.doc', '.wps'].includes(originalFileExtension || '') && '📑'}
          </div>
          <div className="document-details">
            <strong>{decodeURIComponent(fileName)}</strong>
            <p>文件格式: {(originalFileExtension || '.unknown').toUpperCase()}</p>
            <p>字符数: {fileContent.length.toLocaleString()}</p>
            {!pdfPath && <p className="pdf-convert-hint">⚠️ 未安装 LibreOffice，无法转换为 PDF 预览</p>}
          </div>
        </div>
        <div className="document-actions">
          {originalFilePath && (
            <button
              type="button"
              className="secondary-action"
              onClick={() => window.open(`file:///${decodeURIComponent(originalFilePath)}`, '_blank')}
            >
              在外部打开原文件
            </button>
          )}
        </div>
        <div className="document-preview-hint">
          <p>解析后的文本预览（用于 AI 分析）：</p>
          <div className="document-text-preview">
            {fileContent.slice(0, 500)}...
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="plan-step-body">
      <section className="analysis-import-card">
        <div>
          <span className="section-kicker">STEP 01</span>
          <strong>上传招标文件</strong>
          <p>当前解析方案：{parserLabel}</p>
        </div>
        <div className="analysis-actions">
          <button type="button" className="primary-action" onClick={importDocument} disabled={busy}>
            {busy ? '解析中...' : fileContent ? '重新选择文件' : '选择文件'}
          </button>
        </div>
      </section>

      <section className="analysis-document-card">
        <div className="analysis-result-head">
          <strong>招标文件预览</strong>
          {fileContent && (
            <div className="document-view-tabs">
              <button
                type="button"
                className={`document-view-tab${viewMode === 'pdf' ? ' is-active' : ''}`}
                onClick={() => setViewMode('pdf')}
                disabled={!hasPdfPreview}
              >
                PDF
              </button>
              <button
                type="button"
                className={`document-view-tab${viewMode === 'markdown' ? ' is-active' : ''}`}
                onClick={() => setViewMode('markdown')}
              >
                Markdown
              </button>
            </div>
          )}
          <span>{fileContent ? `原始文件: ${decodeURIComponent(fileName)}` : '等待上传'}</span>
        </div>

        {fileContent ? (
          <div className="document-preview-container">
            {renderDocumentPreview()}
          </div>
        ) : (
          <div className="document-empty-state">
            <strong>尚未导入招标文件</strong>
            <p>支持格式：PDF、DOCX、DOC、WPS、Markdown</p>
            <p>上传后将自动转换为 PDF 预览，并解析为文本供 AI 分析</p>
          </div>
        )}
      </section>

    </div>
  );
}

export default DocumentAnalysisPage;
