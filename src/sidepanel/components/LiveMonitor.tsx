import { Streamer } from '../../shared/types';

interface Props {
  streamers: Streamer[];
  onRefresh: () => void;
}

function formatTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LiveMonitor({ streamers, onRefresh }: Props) {
  const liveStreamers = streamers.filter((s) => s.isLive);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          直播状态
        </h3>
        <button className="btn btn-sm btn-primary" onClick={onRefresh}>
          刷新
        </button>
      </div>

      {liveStreamers.length === 0 ? (
        <p className="empty-state">当前没有关注的主播在直播</p>
      ) : (
        liveStreamers.map((s) => (
          <div key={s.roomId} className="streamer-item">
            <div className="streamer-info">
              <span className="live-dot online" />
              <span style={{ fontWeight: 600 }}>{s.nickname}</span>
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              开播于 {formatTime(s.lastLiveAt)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
