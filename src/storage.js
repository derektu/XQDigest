const fs = require('fs-extra');
const path = require('path');
const matter = require('gray-matter');

const DEFAULT_CONTENT_FORMATTERS = {
  youtube: (item) => `### YouTube 字幕\n\n${item.content}\n`,
  rss: (item) => `### RSS 文章內容\n\n${item.content}\n`,
};

function defaultContentFormatter(item) {
  return `${item.content}\n`;
}

class Storage {
  constructor(db, dataPath, options = {}) {
    this.db = db;
    this.contentDir = path.join(dataPath, 'content');
    this.contentFormatters = { ...DEFAULT_CONTENT_FORMATTERS, ...(options.contentFormatters || {}) };
  }

  async saveContent(item) {
    // Build markdown file
    const markdown = this._buildMarkdown(item);
    const relativePath = this._getRelativePath(item);
    const fullPath = path.join(this.contentDir, relativePath);

    // Write markdown file
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, markdown, 'utf8');

    // Write to database
    this.db.insertContentItem({
      source_type: item.sourceType,
      source_id: item.sourceId,
      item_id: item.itemId,
      title: item.title,
      url: item.url,
      author: item.author || null,
      published_date: item.publishedDate || null,
      fetched_date: new Date().toISOString(),
      markdown_file_path: relativePath,
      summary: null,
      tags: null,
      status: 'new',
    });

    return relativePath;
  }

  /**
   * Update content item with LLM summary.
   * @param {Object} item - Content item (must have itemId)
   * @param {string} summaryText - Raw summary text from LLM
   */
  async updateSummary(item, summaryText) {
    // Read existing markdown from DB-recorded path to avoid path drift.
    const existing = this.db.getContentItemByItemId(item.itemId);
    const relativePath = existing ? existing.markdown_file_path : this._getRelativePath(item);
    const fullPath = path.join(this.contentDir, relativePath);
    let content = await fs.readFile(fullPath, 'utf8');

    // Replace or append summary section (idempotent on retry)
    const summaryHeading = '\n## AI 摘要\n\n';
    const summarySection = `${summaryHeading}${summaryText}\n`;
    const headingIndex = content.indexOf(summaryHeading);
    if (headingIndex !== -1) {
      content = content.substring(0, headingIndex) + summarySection;
    } else {
      content += summarySection;
    }
    await fs.writeFile(fullPath, content, 'utf8');

    // Update database
    this.db.updateContentSummary(item.itemId, summaryText);
  }

  _buildMarkdown(item) {
    const frontMatter = {
      title: item.title,
      source: item.sourceType,
      item_id: item.itemId,
      author: item.author || '',
      published: item.publishedDate || '',
      url: item.url,
      fetched: new Date().toISOString(),
    };

    const formatter = this.contentFormatters[item.sourceType] || defaultContentFormatter;
    let body = `# ${item.title}\n\n## 原始內容\n\n`;
    body += formatter(item);

    return matter.stringify(body, frontMatter);
  }

  _getRelativePath(item) {
    const date = item.publishedDate
      ? new Date(item.publishedDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    const safeId = item.itemId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = item.sourceId || item.sourceType;
    return path.join(dir, `${date}_${safeId}.md`);
  }
}

module.exports = Storage;
