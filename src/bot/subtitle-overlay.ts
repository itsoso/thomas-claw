import { Page } from 'playwright';

const OVERLAY_SCRIPT = `
(function() {
  if (document.getElementById('tc-subtitle-overlay')) return;

  var overlay = document.createElement('div');
  overlay.id = 'tc-subtitle-overlay';
  overlay.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;width:70%;max-width:800px;display:flex;flex-direction:column;align-items:center;gap:6px;';

  // 主播语音字幕行
  var voiceLine = document.createElement('div');
  voiceLine.id = 'tc-voice-line';
  voiceLine.style.cssText = 'background:rgba(0,0,0,0.75);color:#fff;font-size:18px;padding:8px 20px;border-radius:8px;text-align:center;max-width:100%;word-break:break-word;transition:opacity 0.3s;opacity:0;font-family:-apple-system,sans-serif;line-height:1.5;text-shadow:0 1px 3px rgba(0,0,0,0.5);';
  overlay.appendChild(voiceLine);

  // AI 回复 / 系统消息行
  var infoLine = document.createElement('div');
  infoLine.id = 'tc-info-line';
  infoLine.style.cssText = 'background:rgba(108,92,231,0.85);color:#fff;font-size:14px;padding:5px 16px;border-radius:6px;text-align:center;max-width:100%;transition:opacity 0.3s;opacity:0;font-family:-apple-system,sans-serif;';
  overlay.appendChild(infoLine);

  document.body.appendChild(overlay);

  // 字幕显示函数
  window.__showVoiceSub = function(text) {
    voiceLine.textContent = text;
    voiceLine.style.opacity = '1';
    clearTimeout(voiceLine.__timer);
    voiceLine.__timer = setTimeout(function() { voiceLine.style.opacity = '0'; }, 8000);
  };

  window.__showInfoSub = function(text, color) {
    infoLine.textContent = text;
    infoLine.style.background = color || 'rgba(108,92,231,0.85)';
    infoLine.style.opacity = '1';
    clearTimeout(infoLine.__timer);
    infoLine.__timer = setTimeout(function() { infoLine.style.opacity = '0'; }, 5000);
  };
})();
`;

/** 注入字幕浮层到直播页面 */
export async function injectSubtitleOverlay(page: Page): Promise<void> {
  await page.addScriptTag({ content: OVERLAY_SCRIPT });
  console.log('[字幕] 页面字幕浮层已注入');
}

/** 显示主播语音字幕 */
export async function showVoiceSubtitle(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    if ((window as any).__showVoiceSub) (window as any).__showVoiceSub(t);
  }, text).catch(() => {});
}

/** 显示信息字幕（AI 回复、送礼等） */
export async function showInfoSubtitle(page: Page, text: string, color?: string): Promise<void> {
  await page.evaluate(({ t, c }) => {
    if ((window as any).__showInfoSub) (window as any).__showInfoSub(t, c);
  }, { t: text, c: color }).catch(() => {});
}
