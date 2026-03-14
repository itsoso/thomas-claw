import { DanmakuMessage, LiveRoomContext } from '../shared/types';

/** 从 URL 提取房间 ID */
export function getRoomIdFromUrl(): string | null {
  const match = location.pathname.match(/^\/(\d+)/);
  return match ? match[1] : null;
}

/** 提取主播昵称 */
export function getStreamerName(): string {
  // 抖音直播页面标题格式："主播名的抖音直播间"
  const titleMatch = document.title.match(/^(.+?)的抖音直播间/);
  if (titleMatch) return titleMatch[1];

  const el =
    document.querySelector('[class*="anchorName"]') ??
    document.querySelector('[class*="nickname"]');
  return el?.textContent?.trim() ?? '未知主播';
}

/** 提取直播标题 */
export function getLiveTitle(): string {
  const el =
    document.querySelector('[class*="roomTitle"]') ??
    document.querySelector('[class*="live-title"]');
  if (el) return el.textContent?.trim() ?? '';

  // fallback: 用页面 title
  return document.title || '';
}

/** 提取在线人数 */
export function getViewerCount(): number {
  const el =
    document.querySelector('[class*="viewerCount"]') ??
    document.querySelector('[class*="viewer"]');
  const text = el?.textContent?.trim() ?? '0';
  const num = parseFloat(text);
  if (text.includes('万')) return Math.round(num * 10000);
  return Math.round(num) || 0;
}

/** 从 DOM 解析弹幕列表 */
export function parseDanmakuFromDOM(): DanmakuMessage[] {
  const container = document.querySelector('[class*="webcast-chatroom"]');
  if (!container) return [];

  // 实际 DOM 结构：
  // .webcast-chatroom___item > .webcast-chatroom___item-wrapper > div
  //   内含 span.v8LY0gZF（发送者名：） + span > .webcast-chatroom___content-with-emoji-text（内容）
  const items = container.querySelectorAll('[class*="webcast-chatroom___item"]');
  const messages: DanmakuMessage[] = [];

  items.forEach((item) => {
    // 跳过非消息元素（比如 wrapper div 本身）
    if (!item.classList.toString().includes('webcast-chatroom___item_new') &&
        !item.classList.toString().includes('webcast-chatroom___item ')) {
      // 如果 class 不含 item_new 或以 item 结尾，可能不是消息项
    }

    const wrapper = item.querySelector('[class*="webcast-chatroom___item-wrapper"]') || item;

    // 发送者：格式为 "用户名："
    const allSpans = wrapper.querySelectorAll('span');
    let sender = '';
    let content = '';

    // 找包含"："的 span 作为发送者
    for (const span of allSpans) {
      const text = span.textContent?.trim() ?? '';
      if (text.endsWith('：') || text.endsWith(':')) {
        sender = text.replace(/[：:]$/, '');
        break;
      }
    }

    // 内容在 .webcast-chatroom___content-with-emoji-text 中
    const contentEl = wrapper.querySelector('[class*="webcast-chatroom___content-with-emoji-text"]');
    if (contentEl) {
      content = contentEl.textContent?.trim() ?? '';
    }

    // 判断是否主播：通常主播有 host 相关标记
    const isStreamer = wrapper.querySelector('[class*="host"]') !== null ||
      wrapper.querySelector('[class*="anchor"]') !== null;

    if (sender && content) {
      messages.push({ sender, content, timestamp: Date.now(), isStreamer });
    }
  });

  return messages;
}

/** 构建完整的直播间上下文 */
export function buildRoomContext(): LiveRoomContext | null {
  const roomId = getRoomIdFromUrl();
  if (!roomId) return null;

  return {
    roomId,
    streamerName: getStreamerName(),
    title: getLiveTitle(),
    viewerCount: getViewerCount(),
    recentDanmaku: parseDanmakuFromDOM(),
  };
}

/** 监听弹幕变化 */
export function observeDanmaku(
  callback: (messages: DanmakuMessage[]) => void,
): MutationObserver | null {
  const container = document.querySelector('[class*="webcast-chatroom"]');
  if (!container) return null;

  const observer = new MutationObserver(() => {
    callback(parseDanmakuFromDOM());
  });

  observer.observe(container, { childList: true, subtree: true });
  return observer;
}
