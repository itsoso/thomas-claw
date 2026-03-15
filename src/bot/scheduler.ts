import { Page } from 'playwright';
import { DiscoveredStreamer } from './discover';
import { getMemory } from './persona';

export interface ScheduleConfig {
  minStayMinutes: number;
  maxStayMinutes: number;
  returnRatio: number;      // 回访老主播的比例（0-1）
}

const DEFAULT_CONFIG: ScheduleConfig = {
  minStayMinutes: 15,
  maxStayMinutes: 35,  // 待更久，建立更深的印象
  returnRatio: 0.6,    // 60% 概率回访（深耕优先）
};

/** 从发现列表中选择下一个要去的直播间 */
export function pickNext(
  discovered: DiscoveredStreamer[],
  visitedThisRound: Set<string>,  // 本轮已访问（防连续重复）
  config: ScheduleConfig = DEFAULT_CONFIG,
): DiscoveredStreamer | null {
  // 分类：有反馈的高潜力 > 去过的 > 新主播
  const highPriority: DiscoveredStreamer[] = [];  // 有反馈的（主播注意到过我们）
  const returning: DiscoveredStreamer[] = [];      // 去过的
  const fresh: DiscoveredStreamer[] = [];          // 新主播

  for (const s of discovered) {
    if (visitedThisRound.has(s.url)) continue;

    const mem = getMemory(s.name);
    if (mem.streamerFeedback && mem.streamerFeedback.length > 0) {
      highPriority.push(s);  // 最高优先：主播认识我们
    } else if (mem.visitCount >= 1) {
      returning.push(s);
    } else {
      fresh.push(s);
    }
  }

  // 优先级：高潜力(50%) > 回访(30%) > 新主播(20%)
  let pool: DiscoveredStreamer[];
  const roll = Math.random();
  if (roll < 0.5 && highPriority.length > 0) {
    pool = highPriority;
  } else if (roll < 0.8 && returning.length > 0) {
    pool = returning;
  } else {
    pool = fresh.length > 0 ? fresh : (returning.length > 0 ? returning : highPriority);
  }

  if (pool.length === 0) return null;

  // 按评分加权随机
  const totalScore = pool.reduce((sum, s) => sum + s.score, 0);
  let rand = Math.random() * totalScore;
  for (const s of pool) {
    rand -= s.score;
    if (rand <= 0) return s;
  }
  return pool[0];
}

/** 计算在当前直播间应该待多久（毫秒） */
export function calculateStayDuration(config: ScheduleConfig = DEFAULT_CONFIG): number {
  const min = config.minStayMinutes * 60_000;
  const max = config.maxStayMinutes * 60_000;
  return min + Math.floor(Math.random() * (max - min));
}

/** 导航到新直播间 */
export async function navigateToStream(page: Page, url: string): Promise<void> {
  console.log(`\n[调度] 切换到: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}
