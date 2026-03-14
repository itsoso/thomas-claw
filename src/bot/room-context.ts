import { Page } from 'playwright';
import { DanmakuMessage } from '../shared/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

/** 直播间理解 */
export interface RoomUnderstanding {
  streamerName: string;
  category: string;
  appearance: string;
  currentActivity: string;
  mood: string;
  hotTopics: string[];
  activeViewers: string[];
  recentEvents: string[];
  updatedAt: number;
}

const DEFAULT_UNDERSTANDING: RoomUnderstanding = {
  streamerName: '', category: '', appearance: '', currentActivity: '',
  mood: '', hotTopics: [], activeViewers: [], recentEvents: [], updatedAt: 0,
};

let current: RoomUnderstanding = { ...DEFAULT_UNDERSTANDING };

export function getRoomUnderstanding(): RoomUnderstanding {
  return current;
}

// ─── 方案 2：DOM 元数据（免费） ───

export async function parseRoomMeta(page: Page): Promise<Partial<RoomUnderstanding>> {
  return page.evaluate(() => {
    var result: any = {};

    // 直播分类/标签
    var tags = document.querySelectorAll('[class*="tag"], [class*="category"], [class*="label"]');
    var categories: string[] = [];
    tags.forEach(function(t) {
      var text = (t.textContent || '').trim();
      var rect = t.getBoundingClientRect();
      if (text.length > 0 && text.length < 10 && rect.width > 0 && rect.y < 100) {
        categories.push(text);
      }
    });
    result.category = categories.join(' ');

    // PK 状态
    var pkEl = document.querySelector('[class*="pk"], [class*="PK"], [class*="battle"]');
    if (pkEl && pkEl.getBoundingClientRect().width > 0) {
      result.recentEvents = ['正在PK中'];
    }

    // 在线人数
    var viewerEl = document.querySelector('[class*="viewer"], [class*="audience"]');
    if (viewerEl) {
      var vt = (viewerEl.textContent || '').trim();
      if (vt) result.recentEvents = (result.recentEvents || []).concat(['在线: ' + vt]);
    }

    return result;
  });
}

// ─── 方案 1：截图 + GPT-4o Vision ───

export async function analyzeScreenshot(page: Page): Promise<string> {
  if (!OPENAI_API_KEY) return '';

  const screenshot = await page.screenshot({
    type: 'jpeg', quality: 40,  // 低质量省钱
    clip: { x: 0, y: 0, width: 1100, height: 800 },  // 只截直播画面
    timeout: 5000,
  }).catch(() => null);

  if (!screenshot) return '';

  const base64 = screenshot.toString('base64');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: '用中文简要描述这个直播间画面（50字内）：主播在做什么、外貌特征、环境、情绪。只描述，不评价。',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' },
          },
        ],
      }],
    }),
  });

  if (!response.ok) return '';
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ─── 方案 3：语音+弹幕摘要 ───

export async function generateSummary(
  danmakuHistory: DanmakuMessage[],
  voiceHistory: string[],
  currentUnderstanding: RoomUnderstanding,
): Promise<RoomUnderstanding> {
  if (!OPENAI_API_KEY) return currentUnderstanding;

  const recentDanmaku = danmakuHistory.slice(-20).map(d =>
    `${d.sender}: ${d.content}`
  ).join('\n');

  const recentVoice = voiceHistory.slice(-10).join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `分析直播间状态，输出JSON：
{"currentActivity":"主播在做什么","mood":"主播情绪","hotTopics":["话题1","话题2"],"activeViewers":["活跃观众1"],"recentEvents":["近期事件"]}
只基于提供的数据分析，不要编造。`,
        },
        {
          role: 'user',
          content: `主播: ${currentUnderstanding.streamerName}
外观: ${currentUnderstanding.appearance || '未知'}

主播语音:
${recentVoice || '（无）'}

弹幕:
${recentDanmaku || '（无）'}`,
        },
      ],
    }),
  });

  if (!response.ok) return currentUnderstanding;
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '{}';

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return currentUnderstanding;
    const parsed = JSON.parse(match[0]);
    return {
      ...currentUnderstanding,
      currentActivity: parsed.currentActivity || currentUnderstanding.currentActivity,
      mood: parsed.mood || currentUnderstanding.mood,
      hotTopics: parsed.hotTopics || currentUnderstanding.hotTopics,
      activeViewers: parsed.activeViewers || currentUnderstanding.activeViewers,
      recentEvents: parsed.recentEvents || currentUnderstanding.recentEvents,
      updatedAt: Date.now(),
    };
  } catch {
    return currentUnderstanding;
  }
}

// ─── 组合：启动持续理解循环 ───

export async function startRoomAnalysis(
  page: Page,
  streamerName: string,
  getDanmaku: () => DanmakuMessage[],
  getVoice: () => string[],
): Promise<void> {
  current.streamerName = streamerName;

  // 立即：DOM 元数据
  const meta = await parseRoomMeta(page);
  Object.assign(current, meta);

  // 10 秒后：首次截图分析
  setTimeout(async () => {
    const desc = await analyzeScreenshot(page);
    if (desc) {
      current.appearance = desc;
      console.log(`\x1b[34m[直播间画像]\x1b[0m ${desc}`);
    }
  }, 10_000);

  // 每 3 分钟：截图分析
  setInterval(async () => {
    try {
      const desc = await analyzeScreenshot(page);
      if (desc && desc !== current.appearance) {
        current.appearance = desc;
        console.log(`\x1b[34m[画面更新]\x1b[0m ${desc}`);
      }
    } catch {}
  }, 180_000);

  // 每 5 分钟：综合摘要
  setInterval(async () => {
    try {
      const danmaku = getDanmaku();
      const voice = getVoice();
      if (danmaku.length < 3 && voice.length < 2) return;

      current = await generateSummary(danmaku, voice, current);
      console.log(`\x1b[34m[直播间理解]\x1b[0m 活动:${current.currentActivity} | 情绪:${current.mood} | 话题:${current.hotTopics.join(',')} | 活跃:${current.activeViewers.join(',')}`);
    } catch {}
  }, 300_000);

  // DOM 元数据持续更新
  setInterval(async () => {
    try {
      const meta = await parseRoomMeta(page);
      Object.assign(current, meta);
    } catch {}
  }, 60_000);
}
