import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';

// 固定的 profile 目录，保持登录态
const PROFILE_DIR = path.join(os.homedir(), '.thomas-claw-profile');

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export async function launchBrowser(liveUrl: string): Promise<BrowserSession> {
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log(`[浏览器] 启动中...`);
  console.log(`[浏览器] Profile: ${PROFILE_DIR}（登录后下次自动保持）`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log(`[浏览器] 正在打开直播间: ${liveUrl}`);
  await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  await dismissLoginModal(page);

  return { context, page };
}

async function dismissLoginModal(page: Page): Promise<void> {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const closeSelectors = [
      '[class*="dy-account-close"]',
      '[class*="closeIcon"]',
      '[class*="close-icon"]',
      '[class*="modal"] [class*="close"]',
      '[class*="login"] [class*="close"]',
    ];

    for (const sel of closeSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click();
        console.log('[浏览器] 已关闭登录弹窗');
        return;
      }
    }
  } catch {
    // 没有弹窗
  }
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
  await session.context.close();
}
