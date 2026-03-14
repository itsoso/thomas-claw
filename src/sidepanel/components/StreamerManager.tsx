import { useState } from 'react';
import { Streamer } from '../../shared/types';

interface Props {
  streamers: Streamer[];
  onAdd: (roomId: string, nickname: string) => void;
  onRemove: (roomId: string) => void;
}

export default function StreamerManager({ streamers, onAdd, onRemove }: Props) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 支持输入直播间 URL 或纯数字 ID
    const match = trimmed.match(/(\d+)/);
    if (match) {
      onAdd(match[1], `主播${match[1]}`);
      setInput('');
    }
  };

  return (
    <div className="card">
      <h3 className="section-title">关注主播</h3>
      <div className="streamer-add">
        <input
          className="input-field"
          placeholder="输入直播间 ID 或 URL"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn btn-primary" onClick={handleAdd}>
          添加
        </button>
      </div>

      {streamers.length === 0 ? (
        <p className="empty-state">还没有关注任何主播</p>
      ) : (
        streamers.map((s) => (
          <div key={s.roomId} className="streamer-item">
            <div className="streamer-info">
              <span className={`live-dot ${s.isLive ? 'online' : ''}`} />
              <span>{s.nickname}</span>
              <span style={{ fontSize: 11, color: '#999' }}>
                #{s.roomId}
              </span>
            </div>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => onRemove(s.roomId)}
            >
              移除
            </button>
          </div>
        ))
      )}
    </div>
  );
}
