import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSettings from '../hooks/useSettings';
import ValidationStatus from '../components/ValidationStatus';
import TabNav from '../components/TabNav';
import { DataSourcesContent } from './DataSourcesPage';

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--color-bg-main)',
  color: 'var(--color-text-primary)',
};

const headerStyle = {
  padding: '16px 24px',
  borderBottom: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexShrink: 0,
};

const backBtn = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  cursor: 'pointer',
  fontSize: 13,
  padding: '4px 0',
};

const contentStyle = {
  flex: 1,
  overflow: 'auto',
  padding: '24px',
};

const tabContentStyle = {
  flex: 1,
  overflow: 'auto',
};

const sectionStyle = {
  maxWidth: 600,
};

const sectionTitle = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 20,
  color: 'var(--color-text-primary)',
};

const fieldGroup = {
  marginBottom: 18,
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--font-size-base)',
  boxSizing: 'border-box',
};

const selectStyle = {
  ...inputStyle,
  cursor: 'pointer',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 80,
  fontFamily: 'inherit',
};

const rowStyle = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-end',
};

const btnPrimary = {
  padding: '8px 20px',
  borderRadius: 4,
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 'var(--font-size-base)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const btnSecondary = {
  padding: '8px 16px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  fontSize: 'var(--font-size-base)',
  whiteSpace: 'nowrap',
};

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
];

function makeInitialForm(settings) {
  return {
    provider: settings?.provider || 'openai',
    apiKey: settings?.apiKey || '',
    baseUrl: settings?.baseUrl || '',
    model: settings?.model || '',
    maxTokens: settings?.maxTokens ?? 4096,
    temperature: settings?.temperature ?? 0.7,
    requestsPerMinute: settings?.requestsPerMinute ?? 0,
    summarizationPrompt: settings?.summarizationPrompt || '',
  };
}

/**
 * LLM 設定內容區塊
 */
function LLMSettingsContent() {
  const { llmSettings, loading, saveLLM, testLLM, testResult, testing } = useSettings();

  const [form, setForm] = useState(makeInitialForm(null));
  const [modelList, setModelList] = useState([]);
  const [saveOk, setSaveOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Populate form once settings are loaded
  useEffect(() => {
    if (llmSettings !== undefined) {
      setForm(makeInitialForm(llmSettings));
    }
  }, [llmSettings]);

  // When test succeeds, populate model list
  useEffect(() => {
    if (testResult?.valid && testResult?.models) {
      setModelList(testResult.models);
    }
  }, [testResult]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleTest = () => {
    setModelList([]);
    testLLM({
      provider: form.provider,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl || undefined,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await saveLLM({
        provider: form.provider,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || null,
        model: form.model,
        maxTokens: parseInt(form.maxTokens) || 4096,
        temperature: parseFloat(form.temperature) || 0.7,
        requestsPerMinute: parseInt(form.requestsPerMinute) || 0,
        summarizationPrompt: form.summarizationPrompt,
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isUnset = !llmSettings;

  if (loading) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: 24 }}>載入中...</div>;
  }

  return (
    <div style={{ ...contentStyle, maxWidth: 600 }}>
      <div style={sectionStyle}>
            <div style={sectionTitle}>LLM 設定</div>

            {isUnset && (
              <div style={{
                background: 'rgba(255,160,0,0.12)',
                border: '1px solid rgba(255,160,0,0.5)',
                borderRadius: 4,
                padding: '10px 14px',
                marginBottom: 20,
                fontSize: 13,
                color: '#c97c00',
              }}>
                尚未設定 LLM。請填入 API Key 並儲存，以啟用文章摘要功能。
              </div>
            )}

            <div style={fieldGroup}>
              <label style={labelStyle}>Provider</label>
              <select style={selectStyle} value={form.provider} onChange={set('provider')}>
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div style={fieldGroup}>
              <label style={labelStyle}>API Key</label>
              <input
                style={inputStyle}
                type="password"
                value={form.apiKey}
                onChange={set('apiKey')}
                placeholder={isUnset ? '未設定' : '輸入新的 API Key（留空保留現有）'}
                autoComplete="off"
              />
            </div>

            {form.provider === 'openai-compatible' && (
              <div style={fieldGroup}>
                <label style={labelStyle}>Base URL</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.baseUrl}
                  onChange={set('baseUrl')}
                  placeholder="https://api.example.com/v1"
                />
              </div>
            )}

            <div style={{ ...fieldGroup, ...rowStyle }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Model</label>
                {modelList.length > 0 ? (
                  <select style={selectStyle} value={form.model} onChange={set('model')}>
                    <option value="">-- 選擇模型 --</option>
                    {modelList.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={inputStyle}
                    type="text"
                    value={form.model}
                    onChange={set('model')}
                    placeholder="例如：gpt-4o-mini"
                  />
                )}
              </div>
              <div style={{ flexShrink: 0, paddingBottom: 0 }}>
                <button style={btnSecondary} onClick={handleTest} disabled={testing || !form.apiKey}>
                  {testing ? '驗證中...' : '驗證並取得模型列表'}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <ValidationStatus
                result={testResult ? {
                  valid: testResult.valid,
                  info: testResult.valid
                    ? (testResult.models?.length > 0 ? `取得 ${testResult.models.length} 個模型` : '驗證通過')
                    : undefined,
                  error: testResult.error,
                } : null}
                loading={testing}
              />
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ ...fieldGroup, flex: 1 }}>
                <label style={labelStyle}>Max Tokens</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.maxTokens}
                  onChange={set('maxTokens')}
                  min={256}
                  max={32768}
                />
              </div>
              <div style={{ ...fieldGroup, flex: 1 }}>
                <label style={labelStyle}>Temperature</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.temperature}
                  onChange={set('temperature')}
                  min={0}
                  max={1}
                  step={0.1}
                />
              </div>
              <div style={{ ...fieldGroup, flex: 1 }}>
                <label style={labelStyle}>Rate Limit (req/min)</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.requestsPerMinute}
                  onChange={set('requestsPerMinute')}
                  min={0}
                  placeholder="0 = 無限制"
                />
              </div>
            </div>

            <div style={fieldGroup}>
              <label style={labelStyle}>Summarization Prompt（選填）</label>
              <textarea
                style={textareaStyle}
                value={form.summarizationPrompt}
                onChange={set('summarizationPrompt')}
                placeholder="留空使用預設 prompt。可在此輸入自訂摘要指示，例如：請以繁體中文摘要，列出 3 個重點..."
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button style={btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? '儲存中...' : '儲存設定'}
              </button>
              {saveOk && (
                <span style={{ color: 'var(--color-success)', fontSize: 13 }}>✓ 已儲存</span>
              )}
              {saveError && (
                <span style={{ color: 'var(--color-danger)', fontSize: 13 }}>✗ {saveError}</span>
              )}
            </div>
          </div>
    </div>
  );
}

/**
 * 統一的設定頁面（含 Tab 導覽）
 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'llm';

  const handleTabChange = (tabId) => {
    // 使用 replace 避免每次切換 tab 都產生新的 history entry
    setSearchParams({ tab: tabId }, { replace: true });
  };

  const handleBack = () => {
    // 統一返回至 Feed 頁面，確保從任何入口（tray menu、直接訪問等）都有一致的行為
    navigate('/feed', { replace: true });
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <button style={backBtn} onClick={handleBack}>← 返回</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>設定</span>
      </div>

      <TabNav
        tabs={[
          { id: 'llm', label: 'LLM 設定' },
          { id: 'datasources', label: '資料源管理' }
        ]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <div style={tabContentStyle}>
        {activeTab === 'llm' && <LLMSettingsContent />}
        {activeTab === 'datasources' && <DataSourcesContent />}
      </div>
    </div>
  );
}
