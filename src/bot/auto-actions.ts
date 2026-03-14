import { Page } from 'playwright';

/** 点击关注主播 */
export async function followStreamer(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    // 查找"关注"按钮（未关注状态才有）
    var btns = document.querySelectorAll('button, div, span');
    for (var i = 0; i < btns.length; i++) {
      var text = (btns[i].textContent || '').trim();
      var cls = (btns[i].className || '').toString();
      var rect = btns[i].getBoundingClientRect();
      // 关注按钮在顶部区域(y<80), 文字为"关注"或"+关注"
      if ((text === '关注' || text === '+关注') && rect.y < 80 && rect.y > 0 && rect.width > 20 && rect.width < 120) {
        (btns[i] as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (clicked) {
    console.log('[操作] 已关注主播');
    return true;
  }

  // 可能已经关注了
  console.log('[操作] 未找到关注按钮（可能已关注）');
  return false;
}

/** 加入粉丝团 */
export async function joinFanClub(page: Page): Promise<boolean> {
  // 用 Playwright locator 直接找粉丝团按钮
  const fanBtn = page.locator('button').filter({ hasText: '粉丝团' }).first();
  let panelOpened = false;
  if (await fanBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await fanBtn.click();
    panelOpened = true;
  }

  if (!panelOpened) {
    // fallback: evaluate
    panelOpened = await page.evaluate(() => {
      var btns = document.querySelectorAll('button, div');
      for (var i = 0; i < btns.length; i++) {
        var text = (btns[i].textContent || '').trim();
        var rect = btns[i].getBoundingClientRect();
        if (text.includes('粉丝团') && rect.y < 80 && rect.width > 30 && rect.width < 200) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
  }

  if (!panelOpened) {
    console.log('[操作] 未找到粉丝团按钮');
    return false;
  }

  await page.waitForTimeout(1500);

  // 在弹出的面板中点击"加入"/"加入粉丝团"按钮
  const joined = await page.evaluate(() => {
    var btns = document.querySelectorAll('button, div, span');
    for (var i = 0; i < btns.length; i++) {
      var text = (btns[i].textContent || '').trim();
      var rect = btns[i].getBoundingClientRect();
      var cls = (btns[i].className || '').toString();
      // 加入按钮通常在弹出面板中（y > 100），文字包含"加入"
      if ((text === '加入' || text === '加入粉丝团' || text === '立即加入') &&
          rect.width > 30 && rect.height > 15 && rect.y > 50) {
        (btns[i] as HTMLElement).click();
        return 'joined';
      }
      // 如果显示"已加入"则已经是团员
      if ((text === '已加入' || text.includes('已加入')) && rect.y > 50) {
        return 'already';
      }
    }
    return 'not_found';
  });

  if (joined === 'joined') {
    console.log('[操作] 已加入粉丝团');
    // 关闭面板
    await page.keyboard.press('Escape');
    return true;
  } else if (joined === 'already') {
    console.log('[操作] 已经是粉丝团成员');
    await page.keyboard.press('Escape');
    return true;
  }

  // 尝试直接点击面板内任何像"加入"的按钮
  const fallback = await page.evaluate(() => {
    // 查找弹窗/面板中的确认按钮
    var modals = document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="popup"], [class*="panel"], [class*="overlay"]');
    for (var m = 0; m < modals.length; m++) {
      var btns = modals[m].querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        var text = (btns[j].textContent || '').trim();
        if (text.includes('加入') || text.includes('确认') || text.includes('确定')) {
          btns[j].click();
          return true;
        }
      }
    }
    return false;
  });

  if (fallback) {
    console.log('[操作] 已加入粉丝团（通过弹窗确认）');
    await page.keyboard.press('Escape');
    return true;
  }

  console.log('[操作] 加入粉丝团失败，可能需要手动操作');
  await page.keyboard.press('Escape');
  return false;
}

/** 自动点赞（双击直播画面） */
export async function likeStream(page: Page): Promise<void> {
  const video = page.locator('video').first();
  if (await video.isVisible({ timeout: 500 }).catch(() => false)) {
    await video.dblclick({ position: { x: 200, y: 300 } });
  }
}

/**
 * 根据主播语音内容判断是否需要执行操作
 */
export function detectActions(voiceText: string): string[] {
  const actions: string[] = [];
  const text = voiceText;

  if (text.includes('关注') || text.includes('点个关注') || text.includes('加个关注') ||
      text.includes('点一下关注') || text.includes('帮我关注') || text.includes('给个关注')) {
    actions.push('follow');
  }

  if (text.includes('加团') || text.includes('粉丝团') || text.includes('加入粉丝团') ||
      text.includes('入团') || text.includes('加个团') || text.includes('点个粉丝团') ||
      text.includes('加一下团') || text.includes('进团') || text.includes('小黄星') ||
      text.includes('灯牌') || text.includes('点亮')) {
    actions.push('join_fan_club');
  }

  if (text.includes('点赞') || text.includes('双击') || text.includes('点个赞') ||
      text.includes('帮我点') || text.includes('给个赞')) {
    actions.push('like');
  }

  return actions;
}
