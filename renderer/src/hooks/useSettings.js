import { useState, useEffect, useCallback } from 'react';
import { settings as settingsIpc } from '../ipc';

export default function useSettings() {
  const [llmSettings, setLlmSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [oauthStatus, setOauthStatus] = useState(null);  // {loggedIn, accountId, expires} | null
  const [oauthPolling, setOauthPolling] = useState(false);

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

  const fetchOAuthStatus = useCallback(async () => {
    try {
      const data = await settingsIpc.getOAuthStatus();
      setOauthStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchOAuthStatus(); }, [fetchOAuthStatus]);

  const triggerOAuthLogin = useCallback(async () => {
    await settingsIpc.loginOAuth();
    setOauthPolling(true);
  }, []);

  useEffect(() => {
    if (!oauthPolling) return;
    let attempts = 0;
    const MAX = 150; // 150 * 2s = 300s
    const id = setInterval(async () => {
      attempts++;
      try {
        const data = await settingsIpc.getOAuthStatus();
        setOauthStatus(data);
        if (data.loggedIn) {
          setOauthPolling(false);
          clearInterval(id);
        }
      } catch { /* ignore */ }
      if (attempts >= MAX) {
        setOauthPolling(false);
        clearInterval(id);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [oauthPolling]);

  const logoutOAuth = useCallback(async () => {
    await settingsIpc.logoutOAuth();
    await fetchOAuthStatus();
  }, [fetchOAuthStatus]);

  return { llmSettings, loading, error, saveLLM, testLLM, testResult, testing,
           oauthStatus, oauthPolling, triggerOAuthLogin, logoutOAuth };
}
