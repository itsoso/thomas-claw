import { Page } from 'playwright';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// 钻石→元：1钻 = 0.1元
const DIAMOND_TO_YUAN = 0.1;

export interface GiftDecision {
  maxDiamonds: number;  // 本次最多花多少钻
  reason: string;
}

/** AI 决定送多少钱的礼物（1-100钻 = 0.1-10元） */
export async function decideGiftLevel(
  voiceText: string,
  streamerName: string,
  relationship: string,
  mood: string,
): Promise<GiftDecision> {
  if (!OPENAI_API_KEY) return { maxDiamonds: 1, reason: '默认最低' };

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 80,
        messages: [{
          role: 'system',
          content: `你是打赏策略顾问。根据主播状态决定送多少钻的礼物。
等级（测试阶段从低开始）：
- 1-2钻（0.1-0.2元）：日常互动、打招呼
- 9-10钻（0.9-1元）：主播唱完歌、感谢观众
- 52-99钻（5-10元）：主播特别开心/感动/生日/重要时刻
默认送最低级别。只有真正值得的时刻才升级。
JSON: {"maxDiamonds":数字,"reason":"原因"}`,
        }, {
          role: 'user',
          content: `主播${streamerName}（关系:${relationship}，情绪:${mood}）说：「${voiceText}」`,
        }],
      }),
    });
    if (!resp.ok) return { maxDiamonds: 1, reason: 'API error' };
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? '{}';
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // 测试阶段硬限制：最多 100 钻 = 10 元
      return { maxDiamonds: Math.min(parsed.maxDiamonds || 1, 100), reason: parsed.reason || '' };
    }
  } catch {}
  return { maxDiamonds: 1, reason: '默认' };
}

/** 点击赠送按钮 */
async function clickSendButton(page: Page, giftDesc: string): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    var allEls = document.querySelectorAll('span, div, button, a');
    for (var j = 0; j < allEls.length; j++) {
      var t = (allEls[j].textContent || '').trim();
      if (t === '赠送') {
        var rect = allEls[j].getBoundingClientRect();
        if (rect.y > 750 && rect.width > 10 && rect.width < 120 && rect.height > 10) {
          (allEls[j] as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  });

  if (clicked) {
    console.log(`[打赏] 已赠送: ${giftDesc}`);
    return true;
  }

  const items = page.locator('[class*="gift_item_gift_bar"]');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).textContent();
    if (text?.includes(giftDesc.replace(/\d+钻|赠送/g, ''))) {
      await items.nth(i).dblclick();
      console.log(`[打赏] 双击赠送: ${giftDesc}`);
      return true;
    }
  }

  return false;
}

/** 根据预算上限选择合适的礼物并发送 */
export async function sendGiftByBudget(page: Page, maxDiamonds: number): Promise<{ sent: boolean; diamonds: number; name: string }> {
  // 获取所有礼物，按价格排序
  const gifts = await page.evaluate((max) => {
    var items = document.querySelectorAll('[class*="gift_item_gift_bar"]');
    var parsed: { index: number; price: number; text: string; name: string }[] = [];
    items.forEach(function(item, i) {
      var text = (item.textContent || '').trim();
      var match = text.match(/^(\d+)钻(.+?)\d+钻/);
      if (match) {
        var price = parseInt(match[1]);
        if (price <= max) {
          parsed.push({ index: i, price: price, text: text, name: match[2] });
        }
      }
    });
    // 按价格降序（在预算内选最贵的）
    parsed.sort(function(a, b) { return b.price - a.price; });
    return parsed;
  }, maxDiamonds);

  if (gifts.length === 0) {
    return { sent: false, diamonds: 0, name: '' };
  }

  // 选最贵的那个（在预算内）
  const chosen = gifts[0];

  // 点击选中
  await page.evaluate((idx) => {
    var items = document.querySelectorAll('[class*="gift_item_gift_bar"]');
    if (items[idx]) (items[idx] as HTMLElement).click();
  }, chosen.index);

  await page.waitForTimeout(300);
  const sent = await clickSendButton(page, chosen.text);

  return { sent, diamonds: chosen.price, name: chosen.name };
}

/** 简单版：发最便宜的礼物 */
export async function sendCheapGift(page: Page): Promise<boolean> {
  const result = await sendGiftByBudget(page, 10);
  return result.sent;
}

/** 按名字发送礼物 */
export async function sendGiftByName(page: Page, giftName: string): Promise<boolean> {
  const found = await page.evaluate((name) => {
    var items = document.querySelectorAll('[class*="gift_item_gift_bar"]');
    for (var i = 0; i < items.length; i++) {
      var text = (items[i].textContent || '').trim();
      if (text.includes(name)) {
        (items[i] as HTMLElement).click();
        return text;
      }
    }
    return null;
  }, giftName);

  if (!found) return false;
  await page.waitForTimeout(300);
  return clickSendButton(page, found);
}

/** 列出所有可见礼物 */
export async function listGifts(page: Page): Promise<{ name: string; price: string }[]> {
  return page.evaluate(() => {
    var results: { name: string; price: string }[] = [];
    var items = document.querySelectorAll('[class*="gift_item_gift_bar"]');
    items.forEach(function(item) {
      var text = (item.textContent || '').trim();
      var match = text.match(/(\d+)钻(.+?)\d+钻/);
      if (match) {
        results.push({ name: match[2], price: match[1] + '钻' });
      }
    });
    return results;
  });
}
