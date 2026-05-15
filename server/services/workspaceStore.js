import fs from 'fs';
import path from 'path';

function createWorkspaceStore({ workspaceDir }) {
  const technicalPlanFile = path.join(workspaceDir, 'technical-plan.json');

  function getDefaults() {
    return {
      projectOverview: '',
      techRequirements: '',
      outlineData: null,
      outlineMode: 'free',
      referenceKnowledgeDocumentIds: [],
      bidAnalysisTask: null,
      outlineGenerationTask: null,
      contentGenerationTask: null,
      contentGenerationSections: {},
      contentGenerationPlans: {},
    };
  }

  function loadTechnicalPlan() {
    try {
      if (fs.existsSync(technicalPlanFile)) {
        return JSON.parse(fs.readFileSync(technicalPlanFile, 'utf-8'));
      }
    } catch {}
    return getDefaults();
  }

  function updateTechnicalPlan(updates) {
    const current = loadTechnicalPlan();
    const updated = { ...current, ...updates };
    fs.writeFileSync(technicalPlanFile, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  function clearTechnicalPlan() {
    fs.writeFileSync(technicalPlanFile, JSON.stringify(getDefaults(), null, 2), 'utf-8');
  }

  return { loadTechnicalPlan, updateTechnicalPlan, clearTechnicalPlan };
}

export { createWorkspaceStore };