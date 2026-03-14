/** 查找弹幕输入框 */
function findInputElement(): HTMLInputElement | HTMLTextAreaElement | null {
  // 抖音直播间弹幕输入框的常见选择器
  const selectors = [
    'input[class*="webcast-chatroom___input"]',
    'textarea[class*="webcast-chatroom"]',
    '[class*="chatroom"] input',
    '[class*="chatroom"] textarea',
    'input[placeholder*="说点什么"]',
    'input[placeholder*="弹幕"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el as HTMLInputElement | HTMLTextAreaElement;
  }

  return null;
}

/**
 * 将文本填入弹幕输入框（不自动发送）
 * 用户需要手动按回车确认发送
 */
export function fillDanmaku(text: string): boolean {
  const input = findInputElement();
  if (!input) return false;

  // 聚焦输入框
  input.focus();

  // 使用 React 兼容的方式设置值
  const nativeInputValueSetter =
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set ??
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, text);
  } else {
    input.value = text;
  }

  // 触发 input 事件让 React 感知到变化
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}
