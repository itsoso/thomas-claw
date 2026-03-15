import { Page } from 'playwright';
import { DiscoveredStreamer } from './discover';
import { getMemory } from './persona';

export interface ScheduleConfig {
  minStayMinutes: number;
  maxStayMinutes: number;
  returnRatio: number;      // 回访老主播的比例（0-1）
}

const DEFAULT_CONFIG: ScheduleConfig = {
  minStayMinutes: 10,
  maxStayMinutes: 25,
  returnRatio: 0.4,  // 40% 概率回访
};

/** 从发现列表中选择下一个要去的直播间 */
export function pickNext(
  discovered: DiscoveredStreamer[],
  visitedThisRound: Set<string>,  // 本轮已访问（防连续重复）
  config: ScheduleConfig = DEFAULT_CONFIG,
): DiscoveredStreamer | null {
  // 分类
  const returning: DiscoveredStreamer[] = [];  // 去过的，可以回访
  const fresh: DiscoveredStreamer[] = [];      // 没去过的新主播

  for (const s of discovered) {
    // 本轮刚去过的跳过（防止连续去同一个）
    if (visitedThisRound.has(s.url)) continue;

    const mem = getMemory(s.name);
    if (mem.visitCount >= 1) returning.push(s);
    else fresh.push(s);
  }

  // 40% 概率回访老主播（有记忆的优先）
  const useReturning = Math.random() < config.returnRatio && returning.length > 0;
  const pool = useReturning ? returning : (fresh.length > 0 ? fresh : returning);

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
