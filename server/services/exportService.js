function createExportService() {
  async function exportToWord(content, outputPath) {
    // 复用现有的 Word 导出逻辑（docx 包）
    // 这里需要实现导出逻辑
    return { output_path: outputPath };
  }

  return { exportToWord };
}

export { createExportService };