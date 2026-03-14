import fs from 'fs';
import path from 'path';
import os from 'os';

const MEMORY_FILE = path.join(os.homedir(), '.thomas-claw-memory.json');

/** 用户人设 */
export const PERSONA = {
  nickname: 'tapool',
  identity: '一个有趣的程序员，喜欢音乐和美食，偶尔幽默毒舌但内心温暖',
  style: '话不多但每句都有意思，不刻意讨好，有自己的态度',
  interests: ['音乐', '美食', '科技', '旅行', '电影'],
  dontDo: ['不舔、不跪、不表白', '不发重复的话', '不刷屏', '不用哥姐亲宝称呼'],
};

/** 对话记忆 —— 跨直播间持久化 */
export interface StreamerMemory {
  /** 主播昵称 */
  name: string;
  /** 已经聊过的话题（避免重复） */
  topicsCovered: string[];
  /** 主播对我的印象/反馈 */
  streamerFeedback: string[];
  /** 我发过的弹幕（最近 30 条） */
  myMessages: string[];
  /** 互动次数 */
  visitCount: number;
  /** 上次互动时间 */
  lastVisit: number;
  /** 关系阶段 */
  relationship: 'stranger' | 'newcomer' | 'regular' | 'familiar';
}

interface MemoryStore {
  streamers: Record<string, StreamerMemory>;
}

function loadStore(): MemoryStore {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    }
  } catch {}
  return { streamers: {} };
}

function saveStore(store: MemoryStore): void {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2));
}

/** 获取某个主播的记忆 */
export function getMemory(streamerName: string): StreamerMemory {
  const store = loadStore();
  if (!store.streamers[streamerName]) {
    store.streamers[streamerName] = {
      name: streamerName,
      topicsCovered: [],
      streamerFeedback: [],
      myMessages: [],
      visitCount: 0,
      lastVisit: 0,
      relationship: 'stranger',
    };
  }
  return store.streamers[streamerName];
}

/** 记录一次访问 */
export function recordVisit(streamerName: string): StreamerMemory {
  const store = loadStore();
  const mem = getMemory(streamerName);
  mem.visitCount++;
  mem.lastVisit = Date.now();

  // 更新关系阶段
  if (mem.visitCount >= 10) mem.relationship = 'familiar';
  else if (mem.visitCount >= 3) mem.relationship = 'regular';
  else if (mem.visitCount >= 1) mem.relationship = 'newcomer';

  store.streamers[streamerName] = mem;
  saveStore(store);
  return mem;
}

/** 记录我发的弹幕 */
export function recordMyMessage(streamerName: string, text: string): void {
  const store = loadStore();
  const mem = getMemory(streamerName);
  mem.myMessages.push(text);
  if (mem.myMessages.length > 30) mem.myMessages = mem.myMessages.slice(-30);
  store.streamers[streamerName] = mem;
  saveStore(store);
}

/** 记录主播对我的反馈 */
export function recordStreamerFeedback(streamerName: string, feedback: string): void {
  const store = loadStore();
  const mem = getMemory(streamerName);
  mem.streamerFeedback.push(feedback);
  if (mem.streamerFeedback.length > 10) mem.streamerFeedback = mem.streamerFeedback.slice(-10);
  store.streamers[streamerName] = mem;
  saveStore(store);
}

/** 记录聊过的话题 */
export function recordTopic(streamerName: string, topic: string): void {
  const store = loadStore();
  const mem = getMemory(streamerName);
  if (!mem.topicsCovered.includes(topic)) {
    mem.topicsCovered.push(topic);
    if (mem.topicsCovered.length > 20) mem.topicsCovered = mem.topicsCovered.slice(-20);
  }
  store.streamers[streamerName] = mem;
  saveStore(store);
}

/** 检查是否最近发过类似的话 */
export function isDuplicate(streamerName: string, text: string): boolean {
  const mem = getMemory(streamerName);
  const recent = mem.myMessages.slice(-10);
  // 完全相同
  if (recent.includes(text)) return true;
  // 相似度检查：超过一半字符重叠
  for (const prev of recent) {
    const overlap = [...text].filter(c => prev.includes(c)).length;
    if (overlap > text.length * 0.6 && overlap > prev.length * 0.6) return true;
  }
  return false;
}
