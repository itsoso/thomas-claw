import { useState } from 'react';
import StreamerManager from './components/StreamerManager';
import LiveMonitor from './components/LiveMonitor';
import ChatSuggestion from './components/ChatSuggestion';
import InteractionLog from './components/InteractionLog';
import { useStreamer } from './hooks/useStreamer';
import './App.css';

type Tab = 'monitor' | 'chat' | 'log' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('monitor');
  const { streamers, addStreamer, removeStreamer, refresh } = useStreamer();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  // 加载设置
  useState(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then((settings: any) => {
      if (settings?.claudeApiKey) setApiKey(settings.claudeApiKey);
      if (settings?.claudeBaseUrl) setBaseUrl(settings.claudeBaseUrl);
    });
  });

  const saveSetting = (patch: Record<string, string>) => {
    chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: patch,
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Thomas Claw</h1>
        <p className="subtitle">抖音直播助手</p>
      </header>

      <nav className="tab-bar">
        {([
          ['monitor', '监控'],
          ['chat', '弹幕'],
          ['log', '日志'],
          ['settings', '设置'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        {tab === 'monitor' && (
          <>
            <StreamerManager
              streamers={streamers}
              onAdd={addStreamer}
              onRemove={removeStreamer}
            />
            <LiveMonitor streamers={streamers} onRefresh={refresh} />
          </>
        )}
        {tab === 'chat' && <ChatSuggestion />}
        {tab === 'log' && <InteractionLog />}
        {tab === 'settings' && (
          <div className="settings-panel">
            <h3>OpenAI API Key</h3>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                saveSetting({ claudeApiKey: e.target.value });
              }}
              placeholder="sk-proj-..."
              className="input-field"
            />
            <h3 style={{ marginTop: 16 }}>API Base URL</h3>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                saveSetting({ claudeBaseUrl: e.target.value });
              }}
              placeholder="https://api.openai.com"
              className="input-field"
            />
            <p className="hint">
              配置已从环境变量自动加载，仅存储在本地。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
