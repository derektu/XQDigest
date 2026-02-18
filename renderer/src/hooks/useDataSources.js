import { useState, useEffect, useCallback } from 'react';
import { dataSources } from '../ipc';

export default function useDataSources() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await dataSources.list();
      setList(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (ds) => {
    const result = await dataSources.add(ds);
    await refresh();
    return result;
  }, [refresh]);

  const update = useCallback(async (id, fields) => {
    const result = await dataSources.update(id, fields);
    await refresh();
    return result;
  }, [refresh]);

  const remove = useCallback(async (id) => {
    await dataSources.remove(id);
    await refresh();
  }, [refresh]);

  const toggle = useCallback(async (id, enabled) => {
    await dataSources.toggle(id, enabled);
    await refresh();
  }, [refresh]);

  const validate = useCallback(async (type, url) => {
    return dataSources.validate(type, url);
  }, []);

  const checkNow = useCallback(async (id) => {
    return dataSources.checkNow(id);
  }, []);

  const getStats = useCallback(async (id) => {
    return dataSources.stats(id);
  }, []);

  return { list, loading, error, refresh, add, update, remove, toggle, validate, checkNow, getStats };
}
