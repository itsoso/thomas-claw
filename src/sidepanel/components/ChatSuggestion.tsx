import { useState, useEffect } from 'react';
import { useChat } from '../hooks/useChat';
import { DanmakuMessage, LiveRoomContext } from '../../shared/types';

export default function ChatSuggestion() {
  const { suggestions, loading, error, generateSuggestions, fillDanmaku } = useChat();
  const [danmaku, setDanmaku] = useState<DanmakuMessage[]>([]);
  const [context, setContext] = useState<LiveRoomContext | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  // 获取当前抖音标签页的弹幕上下文
  useEffect(() => {
    async function fetchContext() {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !tab.url?.includes('live.douyin.com')) return;
      setActiveTabId(tab.id);

      try {
        const ctx = (await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_ROOM_CONTEXT',
        })) as LiveRoomContext | null;
        if (ctx) {
          setContext(ctx);
          setDanmaku(ctx.recentDanmaku);
        }
      } catch {
        // Content script not ready
      }
    }

    fetchContext();
    const interval = setInterval(fetchContext, 10_000);
    return () => clearInterval(interval);
  }, []);

  // 监听弹幕更新
  useEffect(() => {
    const handler = (message: any) => {
      if (message.type === 'DANMAKU_UPDATE') {
        setDanmaku(message.payload.messages);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleGenerate = () => {
    if (!context) return;
    // 用最新弹幕更新 context
    generateSuggestions({ ...context, recentDanmaku: danmaku });
  };

  const handleFill = (text: string) => {
    if (!activeTabId) return;
    fillDanmaku(activeTabId, text);

    // 记录互动日志
    if (context) {
      chrome.runtime.sendMessage({
        type: 'LOG_INTERACTION',
        payload: {
          roomId: context.roomId,
          streamerName: context.streamerName,
          content: text,
        },
      });
    }
  };

  if (!context) {
    return (
      <div className="empty-state">
        请先打开一个抖音直播间
        <br />
        <span style={{ fontSize: 11 }}>
          访问 live.douyin.com 的任意直播间
        </span>
      </div>
    );
  }

  return (
    <div>
      {/* 直播间信息 */}
      <div className="card">
        <div style={{ fontWeight: 600 }}>{context.streamerName}</div>
        <div style={{ fontSize: 12, color: '#999' }}>
          {context.title} · {context.viewerCount} 人观看
        </div>
      </div>

      {/* 最近弹幕 */}
      <div className="card">
        <h3 className="section-title">最近弹幕</h3>
        <div className="danmaku-list">
          {danmaku.length === 0 ? (
            <p className="hint">暂无弹幕</p>
          ) : (
            danmaku.slice(-15).map((d, i) => (
              <div key={i} className="danmaku-item">
                <span className={`sender ${d.isStreamer ? 'is-streamer' : ''}`}>
                  {d.sender}
                </span>
                : {d.content}
              </div>
            ))
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={loading}
          style={{ width: '100%' }}
        >
          {loading ? '生成中...' : '生成弹幕建议'}
        </button>

        {error && (
          <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>

      {/* 建议列表 */}
      {suggestions.length > 0 && (
        <div className="card">
          <h3 className="section-title">候选弹幕（点击填入输入框）</h3>
          {suggestions.map((s, i) => (
            <div key={i} className="suggestion-item">
              {editingIdx === i ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input-field"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleFill(editText);
                        setEditingIdx(null);
                      }
                    }}
                    autoFocus
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      handleFill(editText);
                      setEditingIdx(null);
                    }}
                  >
                    发
                  </button>
                </div>
              ) : (
                <div onClick={() => handleFill(s.text)}>
                  <div className="suggestion-text">{s.text}</div>
                  {s.reason && (
                    <div className="suggestion-reason">{s.reason}</div>
                  )}
                  <button
                    className="btn btn-sm"
                    style={{ marginTop: 4, background: '#f0f0f0' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingIdx(i);
                      setEditText(s.text);
                    }}
                  >
                    编辑
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
