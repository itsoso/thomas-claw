import { Page } from 'playwright';
import { getMemory, recordMyMessage } from './persona';
import { dashLogInteraction, dashLog } from './web-dashboard';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

/** 从直播间页面提取主播的个人主页 URL */
export async function getStreamerProfileUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    var links = document.querySelectorAll('a[href*="/user/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.includes('/user/') && !href.includes('/user/self')) {
        if (!href.startsWith('http')) href = 'https:' + href;
        return href;
      }
    }
    return null;
  });
}

/** 判断是否应该发私信 — 更严格的条件 */
export function shouldSendDM(streamerName: string): boolean {
  const mem = getMemory(streamerName);
  // 未互关只能发 1 条！所以条件要严格：
  // 1. 主播至少注意到过我们（有 feedback）
  // 2. 关系至少 regular（来过 3 次）
  // 3. 还没发过私信
  const hasFeedback = (mem.streamerFeedback?.length || 0) > 0;
  const isRegular = mem.relationship === 'regular' || mem.relationship === 'familiar';
  const alreadyDMed = mem.myMessages?.some((m: string) => m.startsWith('[私信]')) || false;

  if (alreadyDMed) return false; // 已发过，不重复发（未互关只能1条）
  return hasFeedback && isRegular;
}

/** 生成高质量破冰私信 — 未互关只有 1 次机会！ */
async function generateDMMessage(streamerName: string): Promise<string> {
  const mem = getMemory(streamerName);

  const context = [
    `主播: ${streamerName}`,
    `我在直播间发过: ${mem.myMessages?.filter((m: string) => !m.startsWith('[私信]')).slice(-8).join('、') || '无'}`,
    `主播对我的反应: ${mem.streamerFeedback?.join('、') || '无'}`,
    `来过${mem.visitCount}次`,
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      temperature: 0.8,
      messages: [{
        role: 'system',
        content: `你在帮"小西瓜"给女主播发私信。
重要：对方没关注我们，我们只有这一次机会发消息！必须让她想回复。

要求：
- 提到具体的直播间互动细节（她说了什么、做了什么）
- 制造好奇心或情感共鸣
- 不要泛泛而谈（"你很有趣"这种谁都能说的别用）
- 25字以内，短比长好
- 不要用"你好"开头
- 不要表白/告白

好的例子：
- "你上次说的那个XX，后来怎么样了？一直想知道"
- "看你每次直播都很开心，是天生的还是练出来的"
- "你说过喜欢XX，我刚好也是，太巧了"`
      }, {
        role: 'user',
        content: context
      }],
    }),
  });

  if (!response.ok) return '你上次说的那个好有意思 一直想聊来着';
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '你上次说的那个好有意思';
}

/** 打开 DM 面板 */
async function openDMPanel(page: Page, profileUrl: string): Promise<boolean> {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // 方法1: Playwright locator
  const dmBtn = page.locator('button:has-text("私信")').first();
  if (await dmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dmBtn.click({ force: true });
    await page.waitForTimeout(3000);
    return true;
  }

  // 方法2: evaluate
  const clicked = await page.evaluate(() => {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || '').trim() === '私信') {
        btns[i].scrollIntoView();
        btns[i].click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    console.log('[私信] 未找到私信按钮');
    return false;
  }
  await page.waitForTimeout(3000);
  return true;
}

/** 检查是否已经发过私信（避免重复发送） */
async function hasExistingDM(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // 检查右侧面板是否有"只能发送一条"的提示
    var text = document.body?.innerText || '';
    return text.includes('只能发送一条') || text.includes('对方回复或关注你之前');
  });
}

/** 在 DM 面板中输入并发送 */
async function typeAndSendDM(page: Page, message: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const editor = page.locator('.public-DraftEditor-content[contenteditable="true"]');
    if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editor.click();
      await page.waitForTimeout(300);
      await page.keyboard.type(message, { delay: 30 });
      await page.waitForTimeout(300);

      // 验证输入
      const typed = await editor.textContent().catch(() => '');
      if (!typed || typed.length < 3) {
        await page.waitForTimeout(1000);
        continue;
      }

      await page.keyboard.press('Enter');
      return true;
    }

    // 找其他 contenteditable
    const allCE = page.locator('[contenteditable="true"]');
    const count = await allCE.count();
    for (let i = 0; i < count; i++) {
      const box = await allCE.nth(i).boundingBox().catch(() => null);
      if (box && box.x > 800 && box.width > 100) {
        await allCE.nth(i).click();
        await page.waitForTimeout(300);
        await page.keyboard.type(message, { delay: 30 });
        await page.waitForTimeout(300);
        await page.keyboard.press('Enter');
        return true;
      }
    }

    await page.waitForTimeout(2000);
  }
  return false;
}

/** 发送私信 — 完整流程 */
export async function sendDirectMessage(
  page: Page,
  profileUrl: string,
  streamerName: string,
): Promise<boolean> {
  console.log(`[私信] 打开 ${streamerName} 的主页...`);

  const opened = await openDMPanel(page, profileUrl);
  if (!opened) return false;

  // 检查是否已有对话（未互关只能发1条）
  const existing = await hasExistingDM(page);
  if (existing) {
    console.log(`[私信] ${streamerName} 已发过消息且对方未回复，跳过`);
    return false;
  }

  const message = await generateDMMessage(streamerName);
  console.log(`[私信] 破冰: "${message}"`);

  const sent = await typeAndSendDM(page, message);
  if (sent) {
    console.log(`[私信] ✅ 已发送给 ${streamerName}: "${message}"`);
    recordMyMessage(streamerName, `[私信] ${message}`);
    dashLogInteraction('私信发送', streamerName, message);
    dashLog('私信', '发送', `→ ${streamerName}: "${message}"`, 'dm');

    // 截图存证
    await page.screenshot({ path: `test-screenshots/dm-${streamerName.slice(0, 10)}-${Date.now()}.png`, timeout: 5000 }).catch(() => {});
    return true;
  }

  console.log('[私信] ❌ 发送失败');
  return false;
}

/** 检查已发私信的主播是否回复了 */
export async function checkAndReplyDMs(
  page: Page,
  profileUrl: string,
  streamerName: string,
): Promise<boolean> {
  const opened = await openDMPanel(page, profileUrl);
  if (!opened) return false;

  // 检查右侧面板是否有新消息（不只是我们发的）
  const chatTexts = await page.evaluate(() => {
    var texts: string[] = [];
    document.querySelectorAll('div, span, p').forEach(el => {
      var rect = (el as HTMLElement).getBoundingClientRect();
      // 右侧面板的聊天气泡
      if (rect.x > 850 && rect.x < 1350 && rect.width > 50 && rect.height > 15 && rect.height < 80 && rect.y > 200 && rect.y < 700) {
        var text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 100 && !text.includes('发送消息') && !text.includes('只能发送')) {
          texts.push(text);
        }
      }
    });
    return [...new Set(texts)];
  });

  console.log(`[私信检查] ${streamerName}: ${chatTexts.length} 条消息`);

  // 如果只有我们发的消息（或者系统提示），对方没回复
  const mem = getMemory(streamerName);
  const myLastDM = mem.myMessages?.filter((m: string) => m.startsWith('[私信]')).pop()?.replace('[私信] ', '') || '';

  // 检查是否有不是我们发的新消息
  const hasNewReply = chatTexts.some(t => t !== myLastDM && !t.includes('关闭会话') && !t.includes('对方回复') && t.length > 2);

  if (hasNewReply) {
    const replyText = chatTexts.find(t => t !== myLastDM && !t.includes('关闭会话') && !t.includes('对方回复')) || '';
    console.log(`[私信] 🎉 ${streamerName} 回复了: "${replyText}"`);
    dashLog('私信', '收到回复', `${streamerName}: "${replyText}"`, 'success');
    dashLogInteraction('私信收到', streamerName, replyText);
    return true;
  }

  return false;
}
