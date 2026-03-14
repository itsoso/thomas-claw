import { useState, useEffect } from 'react';
import { InteractionRecord } from '../../shared/types';

export default function InteractionLog() {
  const [records, setRecords] = useState<InteractionRecord[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    chrome.storage.local.get('interactions').then((result) => {
      setRecords((result.interactions ?? []) as InteractionRecord[]);
    });
  }, []);

  const filtered = filter
    ? records.filter(
        (r) =>
          r.streamerName.includes(filter) || r.content.includes(filter),
      )
    : records;

  // 按时间倒序
  const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div>
      <div className="card">
        <h3 className="section-title">互动日志</h3>
        <input
          className="input-field"
          placeholder="搜索主播或内容..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="empty-state">暂无互动记录</p>
      ) : (
        <div className="card">
          {sorted.slice(0, 100).map((r) => (
            <div key={r.id} className="log-item">
              <div>{r.content}</div>
              <div className="log-meta">
                {r.streamerName} ·{' '}
                {new Date(r.timestamp).toLocaleString('zh-CN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
