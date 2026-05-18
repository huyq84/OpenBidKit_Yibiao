import type { OutlineData } from './outline';

export type AnalysisType = 'overview' | 'requirements';

export interface BidProjectDraft {
  currentStep: number;
  fileContent: string;
  projectOverview: string;
  techRequirements: string;
  outlineData: OutlineData | null;
}

export interface FileImportResult {
  success: boolean;
  message: string;
  file_content?: string;
  file_name?: string;
  file_path?: string;
  file_extension?: string;
  pdf_path?: string;
  parser_provider?: string;
  parser_label?: string;
  old_outline?: string;
}

export interface ChapterContentContext {
  project_overview: string;
}
