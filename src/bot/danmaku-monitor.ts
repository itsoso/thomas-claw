import { Page } from 'playwright';
import { DanmakuMessage } from '../shared/types';

export type DanmakuCallback = (msg: DanmakuMessage) => void;

const MAX_HISTORY = 50;
const history: DanmakuMessage[] = [];
let lastSeenKey = '';

export function getHistory(): DanmakuMessage[] {
  return history;
}

// 页面内执行的脚本（纯字符串，避免 tsx 转换注入 __name）
const MONITOR_SCRIPT = `
  var lastParsedCount = 0;

  function parseAndNotify() {
    var container = document.querySelector('[class*="webcast-chatroom"]');
    if (!container) return;

    var items = container.querySelectorAll('[class*="chatroom___item"]');
    var messages = [];

    items.forEach(function(item) {
      var cls = item.className || '';
      if (cls.includes('wrapper') || cls.includes('list')) return;

      var wrapper = item.querySelector('[class*="item-wrapper"]') || item;
      var sender = '';
      var spans = wrapper.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        if (t.endsWith('：') || t.endsWith(':')) {
          sender = t.replace(/[：:]$/, '');
          break;
        }
      }

      var contentEl = wrapper.querySelector('[class*="content-with-emoji"]');
      var content = contentEl ? (contentEl.textContent || '').trim() : '';

      var isStreamer = wrapper.querySelector('[class*="host"]') !== null ||
        wrapper.querySelector('[class*="anchor"]') !== null;

      if (sender && content) {
        messages.push({ sender: sender, content: content, timestamp: Date.now(), isStreamer: isStreamer });
      }
    });

    var newMessages = messages.slice(lastParsedCount);
    lastParsedCount = messages.length;

    for (var j = 0; j < newMessages.length; j++) {
      window.__onDanmaku(newMessages[j]);
    }
  }

  parseAndNotify();

  var container = document.querySelector('[class*="webcast-chatroom"]');
  if (container) {
    var observer = new MutationObserver(function() { parseAndNotify(); });
    observer.observe(container, { childList: true, subtree: true });
  }

  setInterval(parseAndNotify, 3000);
`;

export async function startMonitor(
  page: Page,
  onMessage: DanmakuCallback,
): Promise<void> {
  // 注入 Node 回调到页面
  await page.exposeFunction('__onDanmaku', (msg: DanmakuMessage) => {
    const key = `${msg.sender}:${msg.content}`;
    if (key === lastSeenKey) return;
    lastSeenKey = key;

    history.push(msg);
    if (history.length > MAX_HISTORY) history.shift();
    onMessage(msg);
  });

  // 用 addScriptTag 注入纯 JS，避免 tsx 转换问题
  await page.addScriptTag({ content: MONITOR_SCRIPT });

  console.log('[弹幕] 监听已启动');
}
