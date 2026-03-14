import { Page } from 'playwright';

export async function sendDanmaku(page: Page, text: string): Promise<boolean> {
  // 抖音登录后弹幕输入框是 contenteditable div
  const filled = await page.evaluate((t) => {
    // 优先查找 contenteditable 编辑器（登录后）
    var editor = document.querySelector('[contenteditable="true"][class*="editor-kit"]') as HTMLElement
      || document.querySelector('[class*="webcast-chatroom___input-container"] [contenteditable="true"]') as HTMLElement
      || document.querySelector('[contenteditable="true"][data-placeholder]') as HTMLElement;

    if (editor) {
      editor.focus();
      // 清空并输入
      editor.textContent = '';
      editor.textContent = t;
      // 触发 input 事件
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: t }));
      return 'contenteditable';
    }

    // 兜底：查找传统 input/textarea
    var selectors = [
      'input[class*="webcast-chatroom___input"]',
      'textarea[class*="webcast-chatroom"]',
      '[class*="chatroom"] input',
      '[class*="chatroom"] textarea',
      'input[placeholder*="说点什么"]',
      'input[placeholder*="弹幕"]',
    ];

    var input = null;
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) { input = el; break; }
    }
    if (!input) return null;

    (input as any).focus();
    var setter =
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(input, t);
    else (input as any).value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'input';
  }, text);

  if (!filled) {
    console.log('[弹幕] 未找到输入框');
    return false;
  }

  // 短暂等待让编辑器处理
  await page.waitForTimeout(200);

  // 按回车发送
  await page.keyboard.press('Enter');
  console.log(`[弹幕] 已发送: ${text}`);
  return true;
}
