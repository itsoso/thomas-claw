import { getBudgetStatus } from './budget';
import { getMemory } from './persona';
import { getRoomUnderstanding } from './room-context';
import { getTranscriptHistory } from './voice-monitor';
import { getHistory } from './danmaku-monitor';

export interface DashboardStats {
  startTime: number;
  discoveredCount: number;
  visitedStreamers: string[];
  currentStreamer: string;
  totalDanmaku: number;
  totalReplies: number;
  totalGifts: number;
  dmsSent: string[];
}

const stats: DashboardStats = {
  startTime: Date.now(),
  discoveredCount: 0,
  visitedStreamers: [],
  currentStreamer: '',
  totalDanmaku: 0,
  totalReplies: 0,
  totalGifts: 0,
  dmsSent: [],
};

export function getStats(): DashboardStats { return stats; }
export function setDiscovered(n: number) { stats.discoveredCount = n; }
export function addVisited(name: string) { if (!stats.visitedStreamers.includes(name)) stats.visitedStreamers.push(name); }
export function setCurrent(name: string) { stats.currentStreamer = name; }
export function incDanmaku() { stats.totalDanmaku++; }
export function incReply() { stats.totalReplies++; }
export function incGift() { stats.totalGifts++; }
export function addDM(name: string) { if (!stats.dmsSent.includes(name)) stats.dmsSent.push(name); }

function pad(s: string, len: number): string {
  // handle wide chars
  let w = 0;
  for (const c of s) w += c.charCodeAt(0) > 0x7f ? 2 : 1;
  const need = Math.max(0, len - w);
  return s + ' '.repeat(need);
}

function elapsed(): string {
  const mins = Math.round((Date.now() - stats.startTime) / 60000);
  if (mins < 60) return `${mins}分钟`;
  return `${Math.floor(mins / 60)}小时${mins % 60}分`;
}

export function printDashboard(): void {
  const budget = getBudgetStatus();
  const room = getRoomUnderstanding();
  const voice = getTranscriptHistory();
  const danmaku = getHistory();

  const lines = [
    '',
    '\x1b[36m╔══════════════════════════════════════════════════╗\x1b[0m',
    '\x1b[36m║\x1b[0m  \x1b[1mOpenClaw Dashboard\x1b[0m                              \x1b[36m║\x1b[0m',
    '\x1b[36m╠══════════════════════════════════════════════════╣\x1b[0m',
    `\x1b[36m║\x1b[0m  运行时间: ${pad(elapsed(), 38)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  发现主播: ${pad(String(stats.discoveredCount), 38)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  已访问:   ${pad(stats.visitedStreamers.join(', ').slice(0, 36) || '无', 38)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  当前:     ${pad(stats.currentStreamer || '空闲', 38)}\x1b[36m║\x1b[0m`,
    '\x1b[36m╠──────────────────────────────────────────────────╣\x1b[0m',
    `\x1b[36m║\x1b[0m  弹幕捕获: ${pad(String(stats.totalDanmaku), 16)}AI回复: ${pad(String(stats.totalReplies), 12)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  语音转写: ${pad(String(voice.length), 16)}送礼:   ${pad(String(stats.totalGifts), 12)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  花费: ¥${pad(String(budget.spent), 10)} 剩余: ¥${pad(String(budget.remaining), 18)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  私信已发: ${pad(stats.dmsSent.join(', ').slice(0, 36) || '无', 38)}\x1b[36m║\x1b[0m`,
    '\x1b[36m╠──────────────────────────────────────────────────╣\x1b[0m',
    `\x1b[36m║\x1b[0m  ${pad(room.currentActivity ? '活动: ' + room.currentActivity : '等待分析...', 48)}\x1b[36m║\x1b[0m`,
    `\x1b[36m║\x1b[0m  ${pad(room.mood ? '情绪: ' + room.mood : '', 48)}\x1b[36m║\x1b[0m`,
    '\x1b[36m╚══════════════════════════════════════════════════╝\x1b[0m',
    '',
  ];
  console.log(lines.join('\n'));
}
