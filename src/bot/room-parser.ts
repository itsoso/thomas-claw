import { Page } from 'playwright';
import { DanmakuMessage, LiveRoomContext } from '../shared/types';

export async function parseRoomContext(page: Page): Promise<LiveRoomContext | null> {
  return page.evaluate(() => {
    const roomIdMatch = location.pathname.match(/^\/(\d+)/);
    const roomId = roomIdMatch ? roomIdMatch[1] : null;
    if (!roomId) return null;

    const titleMatch = document.title.match(/^(.+?)的抖音直播间/);
    const streamerName = titleMatch ? titleMatch[1] : '未知主播';

    const viewerEl = document.querySelector('[class*="viewerCount"]') ??
      document.querySelector('[class*="viewer"]');
    const viewerText = viewerEl?.textContent?.trim() ?? '0';
    let viewerCount = parseFloat(viewerText) || 0;
    if (viewerText.includes('万')) viewerCount = Math.round(viewerCount * 10000);

    return {
      roomId,
      streamerName,
      title: document.title,
      viewerCount: Math.round(viewerCount),
      recentDanmaku: [] as any[],
    };
  });
}

export async function parseDanmaku(page: Page): Promise<DanmakuMessage[]> {
  return page.evaluate(() => {
    const container = document.querySelector('[class*="webcast-chatroom"]');
    if (!container) return [];

    const messages: any[] = [];
    container.querySelectorAll('[class*="chatroom___item"]').forEach(item => {
      const className = item.className || '';
      if (className.includes('wrapper') || className.includes('list')) return;

      const wrapper = item.querySelector('[class*="item-wrapper"]') || item;
      let sender = '';
      for (const span of wrapper.querySelectorAll('span')) {
        const t = (span.textContent || '').trim();
        if (t.endsWith('：') || t.endsWith(':')) {
          sender = t.replace(/[：:]$/, '');
          break;
        }
      }

      const contentEl = wrapper.querySelector('[class*="content-with-emoji"]');
      const content = contentEl?.textContent?.trim() || '';

      const isStreamer = wrapper.querySelector('[class*="host"]') !== null ||
        wrapper.querySelector('[class*="anchor"]') !== null;

      if (sender && content) {
        messages.push({ sender, content, timestamp: Date.now(), isStreamer });
      }
    });

    return messages;
  });
}
