import { Page } from 'playwright';
import { getMemory, recordMyMessage } from './persona';

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

/** 生成私信内容（破冰 or 持续对话） */
async function generateDMMessage(
  streamerName: string,
  chatHistory: string[],  // 之前的对话记录
  isFirstMessage: boolean,
): Promise<string> {
  const mem = getMemory(streamerName);

  const context = [
    `主播: ${streamerName}`,
    mem.myMessages.length > 0 ? `我在直播间发过: ${mem.myMessages.slice(-5).join('、')}` : '',
    mem.streamerFeedback.length > 0 ? `主播对我的反应: ${mem.streamerFeedback.slice(-3).join('、')}` : '',
    `来过${mem.visitCount}次, 关系: ${mem.relationship}`,
    chatHistory.length > 0 ? `\n之前的私信对话:\n${chatHistory.slice(-10).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = isFirstMessage
    ? `你在帮用户(tapool)给女主播发第一条私信。要求：
- 自然、不油腻、不谄媚
- 提到在直播间的互动经历，让对方想起你
- 表达想进一步了解的意思，但不要太直接
- 40字以内，要有记忆点
- 不要用"你好"开头`
    : `你在帮用户(tapool)继续和女主播私信聊天。要求：
- 自然、有趣，像朋友聊天
- 根据对方的回复自然接话
- 适当分享自己（程序员、喜欢音乐美食旅行）
- 如果聊得开，可以提议加微信方便联系（但不要太突兀）
- 40字以内`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 80,
      temperature: 0.85,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
    }),
  });

  if (!response.ok) return isFirstMessage ? '之前在直播间聊过，觉得你很有意思' : '哈哈是的';
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '你好';
}

/** 在 DM 面板中输入并发送消息 */
async function typeAndSendDM(page: Page, message: string): Promise<boolean> {
  const filled = await page.evaluate((msg) => {
    var editor = document.querySelector('.public-DraftEditor-content[contenteditable="true"]') as HTMLElement;
    if (!editor) {
      var all = document.querySelectorAll('[contenteditable="true"]');
      for (var i = 0; i < all.length; i++) {
        var rect = all[i].getBoundingClientRect();
        if (rect.x > 800 && rect.width > 100) { editor = all[i] as HTMLElement; break; }
      }
    }
    if (!editor) return false;
    editor.focus();
    document.execCommand('insertText', false, msg);
    return true;
  }, message);

  if (!filled) return false;
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  return true;
}

/** 读取 DM 面板中的对话记录 */
async function readDMHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    var messages: string[] = [];
    // DM 面板中的消息气泡
    var bubbles = document.querySelectorAll('[class*="msg"], [class*="message"], [class*="bubble"], [class*="chat-item"]');
    bubbles.forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.x > 800 && rect.width > 50 && rect.height > 10) {
        var text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 200) {
          messages.push(text);
        }
      }
    });
    return messages;
  });
}

/** 打开主播主页的私信面板 */
async function openDMPanel(page: Page, profileUrl: string): Promise<boolean> {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  const clicked = await page.evaluate(() => {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var text = (btns[i].textContent || '').trim();
      if (text === '私信' && btns[i].className.includes('semi-button')) {
        btns[i].click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) return false;
  await page.waitForTimeout(3000);
  return true;
}

/** 完整的私信流程：打开面板 → 检查历史 → 发送/继续对话 */
export async function sendDirectMessage(
  page: Page,
  profileUrl: string,
  streamerName: string,
  customMessage?: string,
): Promise<boolean> {
  console.log(`[私信] 打开 ${streamerName} 的主页...`);

  const opened = await openDMPanel(page, profileUrl);
  if (!opened) {
    console.log('[私信] 未找到私信按钮');
    return false;
  }

  // 读取已有对话
  const history = await readDMHistory(page);
  const isFirst = history.length === 0;

  const message = customMessage || await generateDMMessage(streamerName, history, isFirst);
  console.log(`[私信] ${isFirst ? '破冰' : '继续对话'}: "${message}"`);

  const sent = await typeAndSendDM(page, message);
  if (sent) {
    console.log(`[私信] ✅ 已发送给 ${streamerName}`);
    recordMyMessage(streamerName, `[私信] ${message}`);
    return true;
  }

  console.log('[私信] ❌ 发送失败');
  return false;
}

/** 检查是否有主播回复了私信，并自动回复 */
export async function checkAndReplyDMs(
  page: Page,
  profileUrl: string,
  streamerName: string,
): Promise<boolean> {
  const opened = await openDMPanel(page, profileUrl);
  if (!opened) return false;

  const history = await readDMHistory(page);
  if (history.length === 0) return false;

  // 检查最后一条是不是对方发的（不是我们发的）
  const lastMsg = history[history.length - 1];
  const mem = getMemory(streamerName);
  const myLastDM = mem.myMessages.filter(m => m.startsWith('[私信]')).pop();

  if (myLastDM && lastMsg === myLastDM.replace('[私信] ', '')) {
    // 最后一条是我发的，对方没回复
    return false;
  }

  // 对方回复了！继续对话
  console.log(`[私信] ${streamerName} 回复了: "${lastMsg}"`);
  const reply = await generateDMMessage(streamerName, history, false);
  const sent = await typeAndSendDM(page, reply);
  if (sent) {
    console.log(`[私信] ✅ 回复: "${reply}"`);
    recordMyMessage(streamerName, `[私信] ${reply}`);
  }
  return sent;
}

/** 判断是否应该发私信 */
export function shouldSendDM(streamerName: string): boolean {
  const mem = getMemory(streamerName);
  return mem.relationship === 'regular' || mem.relationship === 'familiar';
}
