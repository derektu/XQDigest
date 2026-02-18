import { useState, useEffect, useCallback, useRef } from 'react';
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
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

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

  return {
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
    refreshCounts: fetchUnreadCounts,
  };
}
