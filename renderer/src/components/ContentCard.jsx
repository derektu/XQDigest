import React from 'react';

function getSummaryPreview(summaryText) {
  if (!summaryText) return null;
  return summaryText
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins}分鐘前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}小時前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}天前`;
  return date.toLocaleDateString('zh-TW');
}

const TYPE_LABEL = { youtube: 'YT', rss: 'RSS' };
const TYPE_COLOR_STYLE = {
  youtube: { color: '#c0392b', borderColor: '#e74c3c', background: 'rgba(192,57,43,0.08)' },
  rss:     { color: '#c06000', borderColor: '#e67e22', background: 'rgba(230,126,34,0.08)' },
};

const styles = {
  card: (active) => ({
    padding: '12px 16px',
    margin: '0 8px 6px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? 'var(--color-bg-active)' : 'var(--color-bg-surface)',
    borderLeft: active ? '3px solid var(--color-active-accent)' : '3px solid transparent',
    transition: 'background 0.15s',
  }),
  title: (isRead) => ({
    fontSize: 'var(--font-size-base)',
    fontWeight: isRead ? 400 : 600,
    color: 'var(--color-text-primary)',
    marginBottom: 4,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    lineHeight: 1.4,
  }),
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: 'var(--color-text-muted)',
    marginBottom: 4,
  },
  typeTag: (type) => ({
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 12,
    padding: '0 6px',
    lineHeight: '16px',
    border: '1px solid',
    ...(TYPE_COLOR_STYLE[type] || { color: 'var(--color-text-muted)', borderColor: 'var(--color-border)', background: 'transparent' }),
  }),
  preview: {
    fontSize: '12px',
    color: 'var(--color-text-secondary)',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    lineHeight: 1.5,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--color-accent)',
    display: 'inline-block',
    marginRight: 6,
    flexShrink: 0,
    verticalAlign: 'middle',
  },
};

export default function ContentCard({ item, active, onClick }) {
  const preview = getSummaryPreview(item.summary);
  const relTime = formatRelativeTime(item.published_date);
  const typeLabel = TYPE_LABEL[item.source_type] || item.source_type?.toUpperCase();
  const isPending = item.status === 'fetched';

  return (
    <div style={styles.card(active)} onClick={onClick}>
      <div style={styles.title(item.is_read)}>
        {!item.is_read && <span style={styles.unreadDot} />}
        {item.title || '（無標題）'}
      </div>
      <div style={styles.meta}>
        <span>{item.source_name || item.source_id}</span>
        {relTime && <><span>·</span><span>{relTime}</span></>}
        <span style={styles.typeTag(item.source_type)}>{typeLabel}</span>
      </div>
      {isPending
        ? <div style={{ ...styles.preview, fontStyle: 'italic', color: 'var(--color-text-muted)' }}>摘要產生中...</div>
        : preview && <div style={styles.preview}>{preview}</div>
      }
    </div>
  );
}
