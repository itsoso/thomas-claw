import {
  getStreamers,
  updateStreamerStatus,
  getSettings,
  addStreamer,
  removeStreamer,
  addInteraction,
} from '../shared/storage';
import { generateSuggestions } from '../shared/claude-api';
import {
  Message,
  onMessage,
  AddStreamerPayload,
  RemoveStreamerPayload,
  GenerateSuggestionsPayload,
  LogInteractionPayload,
} from '../shared/messages';
import { UserSettings } from '../shared/types';

// ─── 开播轮询 ───

async function checkLiveStatus(): Promise<void> {
  const streamers = await getStreamers();
  const settings = await getSettings();

  for (const streamer of streamers) {
    try {
      const response = await fetch(
        `https://live.douyin.com/${streamer.roomId}`,
        { method: 'GET', redirect: 'follow' },
      );
      const html = await response.text();
      // 抖音直播间在开播时页面包含特定标识
      const isLive =
        html.includes('isLiving":true') || html.includes('"status":2');
      const wasLive = streamer.isLive;

      await updateStreamerStatus(streamer.roomId, isLive);

      // 刚开播，发送通知
      if (isLive && !wasLive && settings.notifyOnLive) {
        chrome.notifications.create(`live-${streamer.roomId}`, {
          type: 'basic',
          iconUrl: 'assets/icons/icon128.png',
          title: '主播开播啦！',
          message: `${streamer.nickname} 正在直播，快去看看吧`,
        });
      }
    } catch {
      // 网络错误静默跳过
    }
  }
}

// 使用 chrome.alarms 定时轮询
chrome.alarms.create('checkLive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkLive') {
    checkLiveStatus();
  }
});

// 点击通知跳转直播间
chrome.notifications.onClicked.addListener((notificationId) => {
  const match = notificationId.match(/^live-(.+)$/);
  if (match) {
    chrome.tabs.create({ url: `https://live.douyin.com/${match[1]}` });
  }
});

// 点击扩展图标打开 Side Panel
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ─── 消息处理 ───

onMessage((message: Message, _sender, sendResponse) => {
  const msg = message as Message;

  switch (msg.type) {
    case 'GET_STREAMERS': {
      getStreamers().then(sendResponse);
      return true; // async
    }

    case 'ADD_STREAMER': {
      const { roomId, nickname } = msg.payload as AddStreamerPayload;
      addStreamer({ roomId, nickname }).then(sendResponse);
      return true;
    }

    case 'REMOVE_STREAMER': {
      const { roomId } = msg.payload as RemoveStreamerPayload;
      removeStreamer(roomId).then(sendResponse);
      return true;
    }

    case 'GENERATE_SUGGESTIONS': {
      const { context } = msg.payload as GenerateSuggestionsPayload;
      getSettings()
        .then((settings) => {
          if (!settings.claudeApiKey) {
            throw new Error('请先在设置中填写 Claude API Key');
          }
          return generateSuggestions(settings.claudeApiKey, context, settings.claudeBaseUrl);
        })
        .then((suggestions) => sendResponse({ suggestions }))
        .catch((err: Error) => sendResponse({ error: err.message }));
      return true;
    }

    case 'LOG_INTERACTION': {
      const payload = msg.payload as LogInteractionPayload;
      addInteraction({
        roomId: payload.roomId,
        streamerName: payload.streamerName,
        content: payload.content,
        timestamp: Date.now(),
      }).then(() => sendResponse({ ok: true }));
      return true;
    }

    case 'GET_SETTINGS': {
      getSettings().then(sendResponse);
      return true;
    }

    case 'SAVE_SETTINGS': {
      const settings = msg.payload as Partial<UserSettings>;
      import('../shared/storage').then(({ saveSettings }) =>
        saveSettings(settings).then(sendResponse),
      );
      return true;
    }

    default:
      return false;
  }
});

// 启动时立即检查一次
checkLiveStatus();
