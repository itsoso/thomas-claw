import { Page } from 'playwright';
import { humanizeText, humanDelay, actionGap } from './anti-detect';

export async function sendDanmaku(page: Page, text: string): Promise<boolean> {
  // 反检测：微调文本
  const finalText = humanizeText(text);

  // 反检测：发送前随机等待
  await actionGap();

  const filled = await page.evaluate((t) => {
    // 优先查找 contenteditable 编辑器（登录后）
    var editor = document.querySelector('[contenteditable="true"][class*="editor-kit"]') as HTMLElement
      || document.querySelector('[class*="webcast-chatroom___input-container"] [contenteditable="true"]') as HTMLElement
      || document.querySelector('[contenteditable="true"][data-placeholder]') as HTMLElement;

    if (editor) {
      editor.focus();
      editor.textContent = '';
      editor.textContent = t;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: t }));
      return 'contenteditable';
    }

    // 兜底
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
  }, finalText);

  if (!filled) {
    console.log('[弹幕] 未找到输入框');
    return false;
  }

  // 反检测：模拟真人按回车前的停顿
  await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
  await page.keyboard.press('Enter');
  console.log(`[弹幕] 已发送: ${finalText}`);
  return true;
}
