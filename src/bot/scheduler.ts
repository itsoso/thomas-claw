import { Page } from 'playwright';
import { DiscoveredStreamer } from './discover';
import { getMemory } from './persona';

export interface ScheduleConfig {
  minStayMinutes: number;   // 每个直播间最少待几分钟
  maxStayMinutes: number;   // 最多待几分钟
  returnRatio: number;      // 回访老主播的比例（0-1）
}

const DEFAULT_CONFIG: ScheduleConfig = {
  minStayMinutes: 10,
  maxStayMinutes: 30,
  returnRatio: 0.3,
};

/** 从发现列表中选择下一个要去的直播间 */
export function pickNext(
  discovered: DiscoveredStreamer[],
  visited: Set<string>,
  config: ScheduleConfig = DEFAULT_CONFIG,
): DiscoveredStreamer | null {
  // 分成：老朋友 vs 新主播
  const returning: DiscoveredStreamer[] = [];
  const fresh: DiscoveredStreamer[] = [];

  for (const s of discovered) {
    if (visited.has(s.url)) continue;
    const mem = getMemory(s.name);
    if (mem.visitCount >= 2) returning.push(s);
    else fresh.push(s);
  }

  // 按比例选择
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

  // 关闭可能的弹窗
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}
