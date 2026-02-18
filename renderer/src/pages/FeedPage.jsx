import React, { useEffect, useRef, useState } from 'react';
import useContentFeed from '../hooks/useContentFeed';
import SourceNav from '../components/SourceNav';
import ContentCard from '../components/ContentCard';
import ContentDetail from '../components/ContentDetail';

const styles = {
  page: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif',
    background: 'var(--color-bg-page)',
  },
  cardList: (width) => ({
    width,
    minWidth: 200,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    flexShrink: 0,
    background: 'var(--color-bg-page)',
  }),
  cardListHeader: {
    padding: '10px 16px 8px',
    borderBottom: '1px solid var(--color-border-light)',
    fontSize: 13,
    color: 'var(--color-text-muted)',
    flexShrink: 0,
    fontWeight: 500,
    letterSpacing: '0.02em',
    background: 'var(--color-bg-surface)',
  },
  cardListScroll: {
    flex: 1,
    overflowY: 'auto',
    paddingTop: 4,
  },
  emptyCards: {
    padding: 32,
    color: 'var(--color-text-muted)',
    fontSize: 13,
    textAlign: 'center',
  },
  loadMoreTrigger: {
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-muted)',
    fontSize: 12,
  },
  detail: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
};

export default function FeedPage() {
  const {
    items,
    unreadCounts,
    selectedSourceId,
    setSelectedSourceId,
    selectedItemId,
    selectedItem,
    loading,
    hasMore,
    loadMore,
    selectItem,
    markUnread,
  } = useContentFeed();

  const [cardWidth, setCardWidth] = useState(() =>
    parseInt(localStorage.getItem('feed-card-width') || '340')
  );
  const [splitterHover, setSplitterHover] = useState(false);
  const cardWidthRef = useRef(cardWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onSplitterMouseDown = (e) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = cardWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(200, Math.min(600, startWidth.current + delta));
      cardWidthRef.current = newWidth;
      setCardWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('feed-card-width', String(cardWidthRef.current));
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const bottomRef = useRef(null);
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  return (
    <div style={styles.page}>
      <SourceNav
        selectedSourceId={selectedSourceId}
        onSelect={setSelectedSourceId}
        unreadCounts={unreadCounts}
      />

      <div style={styles.cardList(cardWidth)}>
        <div style={styles.cardListHeader}>
          {selectedSourceId ? '篩選中' : '全部'} · {items.length} 篇
        </div>
        <div style={styles.cardListScroll}>
          {items.length === 0 && !loading ? (
            <div style={styles.emptyCards}>尚無內容</div>
          ) : (
            <>
              {items.map(item => (
                <ContentCard
                  key={item.id}
                  item={item}
                  active={item.id === selectedItemId}
                  onClick={() => selectItem(item)}
                />
              ))}
              <div ref={bottomRef} style={styles.loadMoreTrigger}>
                {loading ? '載入中...' : hasMore ? '' : '已載入全部'}
              </div>
            </>
          )}
        </div>
      </div>

      <div
        onMouseDown={onSplitterMouseDown}
        style={{
          width: 5,
          cursor: 'col-resize',
          background: splitterHover ? 'var(--color-accent)' : 'var(--color-border)',
          flexShrink: 0,
          transition: 'background 0.15s',
          zIndex: 10,
        }}
        onMouseEnter={() => setSplitterHover(true)}
        onMouseLeave={() => setSplitterHover(false)}
      />

      <div style={styles.detail}>
        <ContentDetail
          item={selectedItem}
          onMarkUnread={markUnread}
        />
      </div>
    </div>
  );
}
