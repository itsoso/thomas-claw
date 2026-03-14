import { Page } from 'playwright';

const CHEAP_GIFTS = ['小心心', '人气票', '鲜花'];

/** 点击赠送按钮 */
async function clickSendButton(page: Page, giftDesc: string): Promise<boolean> {
  // 方法1: 找选中状态的礼物上的赠送按钮
  const clicked = await page.evaluate(() => {
    // 查找所有"赠送"文字
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

  // 方法2: 双击礼物项
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

  console.log(`[打赏] 未能点击赠送按钮`);
  return false;
}

/** 发送便宜礼物（≤10钻 ≈ ≤1元） */
export async function sendCheapGift(page: Page): Promise<boolean> {
  // 直接从页面找第一个 ≤10钻 的礼物
  const result = await page.evaluate(() => {
    var items = document.querySelectorAll('[class*="gift_item_gift_bar"]');
    for (var i = 0; i < items.length; i++) {
      var text = (items[i].textContent || '').trim();
      var match = text.match(/^(\d+)钻/);
      if (match && parseInt(match[1]) <= 10) {
        // 点击选中
        (items[i] as HTMLElement).click();
        return { index: i, text: text };
      }
    }
    return null;
  });

  if (!result) {
    console.log('[打赏] 未找到 ≤1元 的礼物');
    return false;
  }

  await page.waitForTimeout(300);
  return clickSendButton(page, result.text);
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

  if (!found) {
    console.log(`[打赏] 未找到: ${giftName}`);
    return false;
  }

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
