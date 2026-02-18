import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TYPE_LABEL = { youtube: 'YT', rss: 'RSS' };
const TYPE_COLOR_STYLE = {
  youtube: { color: '#c0392b', borderColor: '#e74c3c', background: 'rgba(192,57,43,0.08)' },
  rss:     { color: '#c06000', borderColor: '#e67e22', background: 'rgba(230,126,34,0.08)' },
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--color-bg-surface)',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-base)',
  },
  header: {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
    background: 'var(--color-bg-surface)',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--color-text-primary)',
    lineHeight: 1.4,
    marginBottom: 8,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--color-text-muted)',
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  typeTag: (type) => ({
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 12,
    padding: '1px 7px',
    border: '1px solid',
    ...(TYPE_COLOR_STYLE[type] || { color: 'var(--color-text-muted)', borderColor: 'var(--color-border)', background: 'transparent' }),
  }),
  actions: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  link: {
    fontSize: 13,
    color: 'var(--color-accent)',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  unreadBtn: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    background: 'none',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    padding: '3px 10px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 20px',
  },
  noSummary: {
    color: 'var(--color-text-muted)',
    fontSize: 13,
    fontStyle: 'italic',
  },
};

const mdStyles = `
  .md-content {
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    line-height: 1.7;
  }
  .md-content h1, .md-content h2, .md-content h3 {
    margin: 1em 0 0.4em;
    font-weight: 600;
    line-height: 1.3;
    color: var(--color-text-primary);
  }
  .md-content h1 { font-size: 1.3em; }
  .md-content h2 { font-size: 1.15em; }
  .md-content h3 { font-size: 1.05em; }
  .md-content p { margin: 0.5em 0; line-height: 1.7; color: var(--color-text-primary); }
  .md-content ul, .md-content ol { padding-left: 1.5em; margin: 0.5em 0; }
  .md-content li { margin: 0.25em 0; line-height: 1.6; color: var(--color-text-primary); }
  .md-content code {
    background: var(--color-code-bg);
    color: var(--color-text-primary);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.88em;
  }
  .md-content pre {
    background: var(--color-code-bg);
    padding: 10px 12px;
    border-radius: 6px;
    overflow-x: auto;
    border: 1px solid var(--color-border-light);
  }
  .md-content pre code { background: none; padding: 0; }
  .md-content table { border-collapse: collapse; width: 100%; font-size: 0.9em; margin: 0.5em 0; }
  .md-content th, .md-content td {
    border: 1px solid var(--color-border);
    padding: 6px 10px;
    text-align: left;
    color: var(--color-text-primary);
  }
  .md-content th { background: var(--color-code-bg); font-weight: 600; }
  .md-content hr { border: none; border-top: 1px solid var(--color-border); margin: 1em 0; }
  .md-content blockquote {
    border-left: 3px solid var(--color-border);
    margin: 0.5em 0;
    padding-left: 1em;
    color: var(--color-text-secondary);
  }
  .md-content a { color: var(--color-accent); text-decoration: none; }
  .md-content a:hover { text-decoration: underline; }
`;

export default function ContentDetail({ item, onMarkUnread }) {
  if (!item) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>選擇一篇文章來閱讀</div>
      </div>
    );
  }

  const typeLabel = TYPE_LABEL[item.source_type] || item.source_type?.toUpperCase();

  return (
    <div style={styles.container}>
      <style>{mdStyles}</style>
      <div style={styles.header}>
        <div style={styles.title}>{item.title || '（無標題）'}</div>
        <div style={styles.meta}>
          <span style={styles.typeTag(item.source_type)}>{typeLabel}</span>
          <span>{item.source_name || item.source_id}</span>
          {item.published_date && <><span>·</span><span>{formatDate(item.published_date)}</span></>}
          {item.author && <><span>·</span><span>{item.author}</span></>}
        </div>
        <div style={styles.actions}>
          {item.url && (
            <a
              href={item.url}
              style={styles.link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                window.open(item.url, '_blank');
              }}
            >
              原始連結 →
            </a>
          )}
          {item.is_read !== 0 && (
            <button style={styles.unreadBtn} onClick={() => onMarkUnread(item)}>
              標記為未讀 ↩
            </button>
          )}
        </div>
      </div>

      <div style={styles.body}>
        {item.summary ? (
          <div className="md-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {item.summary}
            </ReactMarkdown>
          </div>
        ) : (
          <div style={styles.noSummary}>尚無摘要</div>
        )}
      </div>
    </div>
  );
}
