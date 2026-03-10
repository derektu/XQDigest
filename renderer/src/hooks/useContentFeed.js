import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { content as contentApi } from '../ipc';

const PAGE_SIZE = 20;

export default function useContentFeed() {
  const [items, setItems] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({ all: 0, bySource: {} });
  const [selectedSourceId, setSelectedSourceId] = useState(null); // null = All
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sortBy, setSortBy] = useState('time'); // 'time' or 'unread'
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

  // Refs for polling callback to avoid stale closures
  const selectedSourceIdRef = useRef(selectedSourceId);
  const selectedItemIdRef = useRef(selectedItemId);
  const itemsRef = useRef(items);

  useEffect(() => { selectedSourceIdRef.current = selectedSourceId; }, [selectedSourceId]);
  useEffect(() => { selectedItemIdRef.current = selectedItemId; }, [selectedItemId]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const fetchUnreadCounts = useCallback(async () => {
    try {
      const data = await contentApi.unreadCounts();
      setUnreadCounts(data);
    } catch (_) {
      // silently ignore
    }
  }, []);

  const loadItems = useCallback(async (sourceId, reset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const offset = reset ? 0 : offsetRef.current;
      const fetched = await contentApi.list({ sourceId: sourceId || undefined, limit: PAGE_SIZE, offset });
      setItems(prev => reset ? fetched : [...prev, ...fetched]);
      offsetRef.current = offset + fetched.length;
      setHasMore(fetched.length === PAGE_SIZE);
    } catch (_) {
      // silently ignore
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Initial load and when source filter changes
  useEffect(() => {
    offsetRef.current = 0;
    setItems([]);
    setSelectedItemId(null);
    setSelectedItem(null);
    setHasMore(true);
    loadItems(selectedSourceId, true);
    fetchUnreadCounts();
  }, [selectedSourceId, loadItems, fetchUnreadCounts]);

  // 統一 15 秒輪詢：涵蓋新項目、status 更新、badge 刷新
  const POLL_INTERVAL = 15000;

  useEffect(() => {
    const timer = setInterval(async () => {
      if (loadingRef.current) return;
      try {
        await fetchUnreadCounts();
        const fresh = await contentApi.list({
          sourceId: selectedSourceIdRef.current || undefined,
          limit: Math.max(offsetRef.current, PAGE_SIZE),
          offset: 0,
        });

        const currentItems = itemsRef.current;
        const curSelectedItemId = selectedItemIdRef.current;

        setItems(prev => {
          const prevIds = new Set(prev.map(i => i.id));
          const toAdd = fresh.filter(i => !prevIds.has(i.id));
          if (toAdd.length > 0) {
            offsetRef.current += toAdd.length;
          }
          const updated = prev.map(old => {
            const u = fresh.find(n => n.id === old.id);
            return u ? { ...old, ...u } : old;
          });
          return [...toAdd, ...updated];
        });

        // 若目前開啟的文章從 fetched 轉為 summarized，重新 fetch detail
        if (curSelectedItemId) {
          const oldItem = currentItems.find(i => i.id === curSelectedItemId);
          const newItem = fresh.find(n => n.id === curSelectedItemId);
          if (oldItem?.status === 'fetched' && newItem?.status === 'summarized') {
            try {
              const detail = await contentApi.get(curSelectedItemId);
              setSelectedItem(detail);
            } catch (_) {}
          }
        }
      } catch (_) {}
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchUnreadCounts]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    loadItems(selectedSourceId, false);
  }, [hasMore, loading, selectedSourceId, loadItems]);

  const selectItem = useCallback(async (item) => {
    setSelectedItemId(item.id);
    try {
      const full = await contentApi.get(item.id);
      setSelectedItem(full);
    } catch (_) {
      setSelectedItem(item);
    }
    // Mark as read if not already
    if (!item.is_read) {
      try {
        await contentApi.markRead(item.id, true);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_read: 1 } : i));
        setUnreadCounts(prev => {
          const newBySource = { ...prev.bySource };
          if (newBySource[item.source_id] > 0) {
            newBySource[item.source_id] = newBySource[item.source_id] - 1;
          }
          return { all: Math.max(0, prev.all - 1), bySource: newBySource };
        });
      } catch (_) {
        // silently ignore
      }
    }
  }, []);

  const markUnread = useCallback(async (item) => {
    try {
      await contentApi.markRead(item.id, false);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_read: 0 } : i));
      if (selectedItem && selectedItem.id === item.id) {
        setSelectedItem(prev => prev ? { ...prev, is_read: 0 } : prev);
      }
      setUnreadCounts(prev => {
        const newBySource = { ...prev.bySource };
        newBySource[item.source_id] = (newBySource[item.source_id] || 0) + 1;
        return { all: prev.all + 1, bySource: newBySource };
      });
    } catch (_) {
      // silently ignore
    }
  }, [selectedItem]);

  // Client-side 排序
  const sortedItems = useMemo(() => {
    const sorted = [...items];
    if (sortBy === 'unread') {
      // 未讀優先 (is_read: 0=未讀, 1=已讀)，同為未讀/已讀時依時間降序
      sorted.sort((a, b) => {
        if (a.is_read !== b.is_read) {
          return a.is_read - b.is_read; // 0 (unread) before 1 (read)
        }
        // 同樣 read status 時依時間降序
        return new Date(b.published_date) - new Date(a.published_date);
      });
    } else {
      // 預設：依發布時間降序
      sorted.sort((a, b) => new Date(b.published_date) - new Date(a.published_date));
    }
    return sorted;
  }, [items, sortBy]);

  return {
    items: sortedItems,  // 回傳排序後的 items
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
    refreshCounts: fetchUnreadCounts,
    sortBy,
    setSortBy,
  };
}
