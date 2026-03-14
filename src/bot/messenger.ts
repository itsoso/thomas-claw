import { Page } from 'playwright';
import { getMemory } from './persona';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

/** 从直播间页面提取主播的个人主页 URL */
export async function getStreamerProfileUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    var links = document.querySelectorAll('a[href*="/user/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      // 排除 /user/self（自己的主页）
      if (href.includes('/user/') && !href.includes('/user/self')) {
        if (!href.startsWith('http')) href = 'https:' + href;
        return href;
      }
    }
    return null;
  });
}

/** 生成破冰私信内容 */
async function generateIcebreaker(
  streamerName: string,
): Promise<string> {
  const mem = getMemory(streamerName);

  const context = [
    `主播: ${streamerName}`,
    mem.myMessages.length > 0 ? `我在直播间发过的弹幕: ${mem.myMessages.slice(-5).join('、')}` : '',
    mem.streamerFeedback.length > 0 ? `主播对我的反应: ${mem.streamerFeedback.slice(-3).join('、')}` : '',
    `来过${mem.visitCount}次, 关系: ${mem.relationship}`,
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      temperature: 0.85,
      messages: [
        {
          role: 'system',
          content: `你在帮用户(tapool)给女主播发第一条私信。要求：
- 自然、不油腻、不谄媚
- 提到在直播间的互动经历，让对方想起你
- 表达想进一步了解的意思，但不要太直接
- 50字以内
- 不要用"你好"开头，要有记忆点`,
        },
        { role: 'user', content: context },
      ],
    }),
  });

  if (!response.ok) return '你好，在直播间经常看你直播，很有意思';
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '你好，经常看你直播';
}

/** 在主播主页打开私信面板并发送消息 */
export async function sendDirectMessage(
  page: Page,
  profileUrl: string,
  streamerName: string,
  customMessage?: string,
): Promise<boolean> {
  console.log(`[私信] 正在打开 ${streamerName} 的主页...`);

  // 导航到主播主页
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // 点击私信按钮
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

  if (!clicked) {
    console.log('[私信] 未找到私信按钮');
    return false;
  }

  await page.waitForTimeout(3000);

  // 生成或使用自定义消息
  const message = customMessage || await generateIcebreaker(streamerName);
  console.log(`[私信] 准备发送: "${message}"`);

  // 在 Draft.js 编辑器中输入
  const filled = await page.evaluate((msg) => {
    // 找 Draft.js 编辑器
    var editor = document.querySelector('.public-DraftEditor-content[contenteditable="true"]') as HTMLElement;
    if (!editor) {
      // 备选：找任何右侧的 contenteditable
      var allEditors = document.querySelectorAll('[contenteditable="true"]');
      for (var i = 0; i < allEditors.length; i++) {
        var rect = allEditors[i].getBoundingClientRect();
        if (rect.x > 800 && rect.width > 100) {
          editor = allEditors[i] as HTMLElement;
          break;
        }
      }
    }
    if (!editor) return false;

    editor.focus();
    // Draft.js 需要通过 execCommand 或者 InputEvent 输入
    document.execCommand('insertText', false, msg);
    return true;
  }, message);

  if (!filled) {
    console.log('[私信] 未找到输入框');
    return false;
  }

  await page.waitForTimeout(500);

  // 按 Enter 发送
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  console.log(`[私信] ✅ 已发送给 ${streamerName}: "${message}"`);
  return true;
}

/** 判断是否应该发私信（基于关系阶段） */
export function shouldSendDM(streamerName: string): boolean {
  const mem = getMemory(streamerName);
  // 至少来过 3 次（regular 以上）才发私信
  return mem.relationship === 'regular' || mem.relationship === 'familiar';
}
