import { Page } from 'playwright';
import { TasteProfile, matchesTaste } from './taste';

export interface DiscoveredStreamer {
  url: string;
  name: string;
  title: string;
  viewerCount: string;
  score: number;
  reason: string;
}

/** 在 live.douyin.com 推荐页发现主播 */
export async function discoverStreamers(
  page: Page,
  taste: TasteProfile,
  maxResults: number = 5,
): Promise<DiscoveredStreamer[]> {
  console.log('[发现] 正在浏览直播推荐页...');

  await page.goto('https://live.douyin.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const results: DiscoveredStreamer[] = [];
  const checkedUrls = new Set<string>();
  let scrollCount = 0;

  while (results.length < maxResults && scrollCount < 8) {
    // 获取当前页面上的直播卡片
    const cards = await page.evaluate(() => {
      var items: { url: string; text: string; x: number; y: number; w: number; h: number }[] = [];
      document.querySelectorAll('a[href*="live.douyin.com"]').forEach(function(a) {
        var href = a.getAttribute('href') || '';
        if (!href.match(/\/\d{5,}/)) return; // 必须有房间号
        var rect = a.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200 && rect.y > -100 && rect.y < window.innerHeight + 100) {
          items.push({
            url: href.startsWith('http') ? href : 'https://live.douyin.com' + href,
            text: (a.textContent || '').trim().slice(0, 60),
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
          });
        }
      });
      return items;
    });

    // 逐个截图判断
    for (const card of cards) {
      // 跳过已检查的
      if (checkedUrls.has(card.url)) continue;
      checkedUrls.add(card.url);

      // 标题预过滤：录播/电台/回放/助眠/男性明显的直接跳过
      const skipKeywords = ['录播', '回放', '精彩片段', '电台', '助眠', '哄睡', '读文', '催眠',
        '大厨', '炒饭', '草莓', '带货', '卖货', '优惠', '下单', '发货', '猛男',
        '象棋', '钓鱼', '游戏解说', '京剧', '展播', '频道',
        '唱歌', '🎤', '🎵', '🎶', '🎙', '点歌', '歌单', '翻唱', '弹唱', '民谣',
        '同传', '英语', '学习', '教学', '课堂', '露营', '烧烤', '采摘',
        '书法', '国学', '国画', '讲棋', '象棋', '围棋', '健身', '瑜伽', '跑步',
        '美食制作', '做饭', '烹饪', '菜谱', '知识', '科普', '历史', '地理',
        '武术', '太极', '冥想', '禅修', '静心', '佛', '道', '经典'];
      if (skipKeywords.some(kw => card.text.includes(kw))) {
        console.log(`  \x1b[90m✗ [skip] ${card.text.slice(0, 30)} — 标题过滤\x1b[0m`);
        continue;
      }

      try {
        // 截取卡片区域
        const screenshot = await page.screenshot({
          type: 'jpeg', quality: 40,
          clip: { x: Math.max(0, card.x), y: Math.max(0, card.y), width: card.w, height: card.h },
          timeout: 3000,
        });

        const base64 = screenshot.toString('base64');
        const result = await matchesTaste(base64, taste);

        // 解析名字和观众数
        const nameMatch = card.text.match(/^(\d+)(.+)/);
        const viewerCount = nameMatch ? nameMatch[1] : '';
        const titleAndName = nameMatch ? nameMatch[2] : card.text;

        if (result.match && result.score >= 6) {
          const streamer: DiscoveredStreamer = {
            url: card.url,
            name: titleAndName.slice(0, 20),
            title: card.text,
            viewerCount,
            score: result.score,
            reason: result.reason,
          };
          results.push(streamer);
          console.log(`  \x1b[32m✓\x1b[0m [${result.score}/10] ${titleAndName.slice(0, 20)} — ${result.reason}`);
        } else {
          console.log(`  \x1b[90m✗ [${result.score}/10] ${titleAndName.slice(0, 20)} — ${result.reason}\x1b[0m`);
        }
      } catch {
        // 截图失败，跳过
      }

      // 避免 API 调用太快
      await page.waitForTimeout(1000);
    }

    // 滚动加载更多
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(2000);
    scrollCount++;
  }

  // 按评分排序
  results.sort((a, b) => b.score - a.score);
  console.log(`[发现] 共找到 ${results.length} 个符合品味的主播`);
  return results;
}
