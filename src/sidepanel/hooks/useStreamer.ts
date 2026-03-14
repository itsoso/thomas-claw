import { useState, useEffect, useCallback } from 'react';
import { Streamer } from '../../shared/types';
import { sendMessage } from '../../shared/messages';

export function useStreamer() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);

  const refresh = useCallback(async () => {
    const list = (await sendMessage({ type: 'GET_STREAMERS' })) as Streamer[];
    setStreamers(list ?? []);
  }, []);

  useEffect(() => {
    refresh();
    // 定时刷新状态
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const addStreamer = useCallback(
    async (roomId: string, nickname: string) => {
      const updated = (await sendMessage({
        type: 'ADD_STREAMER',
        payload: { roomId, nickname },
      })) as Streamer[];
      setStreamers(updated ?? []);
    },
    [],
  );

  const removeStreamer = useCallback(async (roomId: string) => {
    const updated = (await sendMessage({
      type: 'REMOVE_STREAMER',
      payload: { roomId },
    })) as Streamer[];
    setStreamers(updated ?? []);
  }, []);

  return { streamers, addStreamer, removeStreamer, refresh };
}
