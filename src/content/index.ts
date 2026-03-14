import { buildRoomContext, observeDanmaku } from './douyin-parser';
import { fillDanmaku } from './danmaku-sender';
import { onMessage, Message, FillDanmakuPayload } from '../shared/messages';

// 监听来自 SidePanel 的消息
onMessage((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_ROOM_CONTEXT': {
      const context = buildRoomContext();
      sendResponse(context);
      return true;
    }

    case 'FILL_DANMAKU': {
      const { text } = message.payload as FillDanmakuPayload;
      const success = fillDanmaku(text);
      sendResponse({ success });
      return true;
    }

    default:
      return false;
  }
});

// 开始监听弹幕变化，转发给 SidePanel
let observer: MutationObserver | null = null;

function startObserving(): void {
  if (observer) return;

  observer = observeDanmaku((messages) => {
    // 广播弹幕更新给所有监听者（SidePanel）
    chrome.runtime.sendMessage({
      type: 'DANMAKU_UPDATE',
      payload: { messages },
    }).catch(() => {
      // SidePanel 可能未打开，忽略错误
    });
  });
}

// 自动关闭登录弹窗
function dismissLoginModal(): void {
  // 关闭按钮：弹窗右上角的 X
  const closeSelectors = [
    '[class*="loginModal"] [class*="close"]',
    '[class*="login-guide"] [class*="close"]',
    '[class*="dy-account-close"]',
    '.dy-account-close',
    '[class*="modal"] [class*="close-btn"]',
    '[class*="dialog"] [class*="close"]',
  ];
  for (const sel of closeSelectors) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn) { btn.click(); return; }
  }
  // 通用方案：查找遮罩层上的关闭图标（SVG / img）
  document.querySelectorAll<HTMLElement>('[class*="close"], [class*="Close"]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    // 关闭按钮通常在右上角、尺寸较小
    if (rect.width > 10 && rect.width < 60 && rect.height > 10 && rect.height < 60) {
      const parent = el.closest('[class*="modal"], [class*="dialog"], [class*="login"]');
      if (parent) el.click();
    }
  });
}

// 持续尝试关闭登录弹窗（页面可能延迟弹出）
const loginDismissInterval = setInterval(dismissLoginModal, 1500);
setTimeout(() => clearInterval(loginDismissInterval), 15000);

// 页面加载后延迟启动，等待弹幕区域渲染
setTimeout(startObserving, 3000);

// 如果初始化时弹幕区域还没渲染，持续重试
const retryInterval = setInterval(() => {
  if (observer) {
    clearInterval(retryInterval);
    return;
  }
  startObserving();
}, 5000);

// 30 秒后停止重试
setTimeout(() => clearInterval(retryInterval), 30000);
