import { useState, useCallback } from 'react';
import { ChatSuggestionItem, LiveRoomContext } from '../../shared/types';
import { sendMessage } from '../../shared/messages';

export function useChat() {
  const [suggestions, setSuggestions] = useState<ChatSuggestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSuggestions = useCallback(
    async (context: LiveRoomContext) => {
      setLoading(true);
      setError(null);
      try {
        const result = (await sendMessage({
          type: 'GENERATE_SUGGESTIONS',
          payload: { context },
        })) as { suggestions?: ChatSuggestionItem[]; error?: string };

        if (result?.error) {
          setError(result.error);
        } else {
          setSuggestions(result?.suggestions ?? []);
        }
      } catch (err: any) {
        setError(err.message ?? '生成失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fillDanmaku = useCallback(async (tabId: number, text: string) => {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'FILL_DANMAKU',
        payload: { text },
      });
    } catch {
      // Tab might not have content script
    }
  }, []);

  return { suggestions, loading, error, generateSuggestions, fillDanmaku };
}
