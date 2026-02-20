import { useState, useEffect, useCallback } from 'react';
import { settings as settingsIpc } from '../ipc';

export default function useSettings() {
  const [llmSettings, setLlmSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const fetchLLM = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await settingsIpc.getLLM();
      setLlmSettings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLLM();
  }, [fetchLLM]);

  const saveLLM = useCallback(async (data) => {
    await settingsIpc.updateLLM(data);
    await fetchLLM();
  }, [fetchLLM]);

  const testLLM = useCallback(async ({ provider, apiKey, baseUrl }) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await settingsIpc.testLLM({ provider, apiKey, baseUrl });
      setTestResult(result);
    } catch (err) {
      setTestResult({ valid: false, error: err.message });
    } finally {
      setTesting(false);
    }
  }, []);

  return { llmSettings, loading, error, saveLLM, testLLM, testResult, testing };
}
