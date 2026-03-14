const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const LIVE_URL = 'https://live.douyin.com/552575662637?column_type=single&from_search=true&is_aweme_tied=1&search_id=202603142033039053E029A6CBFDDB57FE&search_result_id=7617086149588372736';
const EXTENSION_PATH = path.resolve(__dirname, 'dist');
const SCREENSHOT_DIR = path.resolve(__dirname, 'test-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('=== Thomas Claw Extension E2E Test ===\n');
  const results = [];

  function log(name, pass, detail = '') {
    results.push({ name, pass });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  }

  const userDataDir = path.join(__dirname, '.test-chrome-profile');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log('[1] Launching Chrome with extension...');
  const CHROMIUM_PATH = '/Users/liqiuhua/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });

  await sleep(3000);

  // Step 1: Go to chrome://extensions with developer mode to find extension
  console.log('[2] Detecting extension...');
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // Enable developer mode via keyboard shortcut / toggle
  await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr?.shadowRoot) return;
    const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
    if (!toolbar?.shadowRoot) return;
    const toggle = toolbar.shadowRoot.querySelector('#devMode');
    if (toggle) toggle.click();
  });
  await sleep(2000);
  await extPage.screenshot({ path: path.join(SCREENSHOT_DIR, '00-extensions.png') });

  // Read the extension page HTML to find our extension info
  const extInfo = await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr?.shadowRoot) return { error: 'no manager shadow root' };
    const itemList = mgr.shadowRoot.querySelector('extensions-item-list');
    if (!itemList?.shadowRoot) return { error: 'no item-list shadow root' };

    const items = itemList.shadowRoot.querySelectorAll('extensions-item');
    const extensions = [];
    for (const item of items) {
      const sr = item.shadowRoot;
      const name = sr?.querySelector('#name')?.textContent?.trim();
      const id = item.id;
      const warnings = sr?.querySelector('.warning-icon') !== null;
      const errors = sr?.querySelector('#errors-button') !== null;
      extensions.push({ id, name, warnings, errors });
    }
    return { extensions };
  });

  console.log('  Extensions found:', JSON.stringify(extInfo, null, 2));

  let extensionId = null;
  if (extInfo.extensions) {
    const thomas = extInfo.extensions.find(e => e.name && e.name.includes('Thomas'));
    if (thomas) {
      extensionId = thomas.id;
      if (thomas.errors) {
        console.log('  ⚠️ Extension has errors - checking details...');
        // Try to click the errors button
        await extPage.evaluate((eid) => {
          const mgr = document.querySelector('extensions-manager');
          const itemList = mgr?.shadowRoot?.querySelector('extensions-item-list');
          const items = itemList?.shadowRoot?.querySelectorAll('extensions-item');
          for (const item of items) {
            if (item.id === eid) {
              const errBtn = item.shadowRoot?.querySelector('#errors-button');
              if (errBtn) errBtn.click();
            }
          }
        }, extensionId);
        await sleep(1500);
        await extPage.screenshot({ path: path.join(SCREENSHOT_DIR, '00b-extension-errors.png') });
      }
    } else if (extInfo.extensions.length > 0) {
      extensionId = extInfo.extensions[0].id;
    }
  }

  await extPage.close();
  log('Extension ID', !!extensionId, extensionId || 'not found');

  // Now navigate to Douyin
  console.log('\n[3] Navigating to Douyin live room...');
  const page = context.pages().find(p => p.url() === 'about:blank') || await context.newPage();
  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  log('Page loaded', true, await page.title());
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-page-loaded.png'), timeout: 10000 }).catch(() => {});

  // Check service workers now
  await sleep(3000);
  let bgPage = null;
  const workers = context.serviceWorkers();
  console.log(`  Service workers: ${workers.length}`);
  for (const w of workers) {
    console.log(`    ${w.url()}`);
    if (extensionId && w.url().includes(extensionId)) bgPage = w;
  }

  // 4. DOM parsing
  console.log('\n[4] Testing DOM parsing...');
  // Scroll the chatroom to trigger virtual list rendering
  await page.evaluate(() => {
    const chatList = document.querySelector('[class*="webcast-chatroom___list"]');
    if (chatList) chatList.scrollTop = chatList.scrollHeight;
  });
  await sleep(2000);

  const parseResult = await page.evaluate(() => {
    const roomIdMatch = location.pathname.match(/^\/(\d+)/);
    const roomId = roomIdMatch ? roomIdMatch[1] : null;
    const titleMatch = document.title.match(/^(.+?)的抖音直播间/);
    const streamerName = titleMatch ? titleMatch[1] : null;
    const container = document.querySelector('[class*="webcast-chatroom"]');

    // Debug info
    const debugItems = container?.querySelectorAll('[class*="chatroom___item"]');
    const debugInfo = {
      containerClass: container?.className || 'none',
      itemsFound: debugItems?.length || 0,
    };

    // Sample first item's inner HTML for debugging
    if (debugItems && debugItems.length > 0) {
      debugInfo.firstItemHTML = debugItems[0].innerHTML.slice(0, 300);
    }

    const messages = [];
    if (container) {
      // Match any element that contains "chatroom___item" in its class
      container.querySelectorAll('[class*="chatroom___item"]').forEach(item => {
        // Skip wrapper-only elements
        const className = item.className || '';
        if (className.includes('wrapper') || className.includes('list')) return;

        const wrapper = item.querySelector('[class*="item-wrapper"]') || item;
        let sender = '';
        for (const span of wrapper.querySelectorAll('span')) {
          const t = (span.textContent || '').trim();
          if (t.endsWith('：') || t.endsWith(':')) { sender = t.replace(/[：:]$/, ''); break; }
        }
        const contentEl = wrapper.querySelector('[class*="content-with-emoji"]');
        const content = contentEl?.textContent?.trim() || '';
        if (sender && content) messages.push({ sender, content });
      });
    }
    return { roomId, streamerName, hasChat: !!container, messageCount: messages.length, messages: messages.slice(-5), debugInfo };
  });

  log('Room ID', !!parseResult.roomId, parseResult.roomId);
  log('Streamer name', !!parseResult.streamerName, parseResult.streamerName);
  log('Chatroom found', parseResult.hasChat);
  log('Messages parsed', parseResult.messageCount > 0, `${parseResult.messageCount} messages`);
  if (parseResult.messages.length > 0) {
    parseResult.messages.forEach(m => console.log(`      ${m.sender}: ${m.content}`));
  }
  if (parseResult.messageCount === 0 && parseResult.debugInfo) {
    console.log('    Debug:', JSON.stringify(parseResult.debugInfo, null, 2).slice(0, 500));
  }

  // 5. Side Panel
  console.log('\n[5] Testing Side Panel...');
  if (extensionId) {
    try {
      const sp = await context.newPage();
      await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load', timeout: 10000 });
      await sleep(2000);

      const rendered = await sp.evaluate(() => document.getElementById('root')?.children.length > 0);
      log('React rendered', rendered);

      const tabs = await sp.evaluate(() =>
        Array.from(document.querySelectorAll('.tab-btn')).map(b => b.textContent?.trim())
      );
      log('4 tabs', tabs.length === 4, tabs.join(' | '));
      await sp.screenshot({ path: path.join(SCREENSHOT_DIR, '03-sidepanel.png') });

      // Settings
      await sp.click('button.tab-btn:nth-child(4)');
      await sleep(800);
      const cfg = await sp.evaluate(() => {
        const inputs = document.querySelectorAll('.settings-panel input');
        return { keyLen: inputs[0]?.value?.length || 0, baseUrl: inputs[1]?.value || '' };
      });
      log('API Key loaded', cfg.keyLen > 0, `${cfg.keyLen} chars`);
      log('Base URL loaded', cfg.baseUrl.length > 0, cfg.baseUrl);
      await sp.screenshot({ path: path.join(SCREENSHOT_DIR, '04-settings.png') });

      // Add streamer
      await sp.click('button.tab-btn:nth-child(1)');
      await sleep(500);
      await sp.fill('.streamer-add input', '552575662637');
      await sp.click('.streamer-add button');
      await sleep(1000);
      const cnt = await sp.evaluate(() => document.querySelectorAll('.streamer-item').length);
      log('Streamer added', cnt > 0);
      await sp.screenshot({ path: path.join(SCREENSHOT_DIR, '05-streamer.png') });

      await sp.close();
    } catch (e) {
      log('Side Panel', false, e.message);
    }
  } else {
    log('Side Panel (skipped)', false, 'no extension ID');
  }

  // 6. Claude API call
  console.log('\n[6] Testing Claude API...');
  if (extensionId) {
    const ap = await context.newPage();
    await ap.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
    await sleep(1500);
    try {
      const result = await ap.evaluate(() => {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout 30s')), 30000);
          chrome.runtime.sendMessage({
            type: 'GENERATE_SUGGESTIONS',
            payload: {
              context: {
                roomId: '552575662637', streamerName: '小小美女',
                title: '小小美女的直播间', viewerCount: 88,
                recentDanmaku: [
                  { sender: '玩恐怖游戏的兄弟', content: '你还要播一会吗', timestamp: Date.now(), isStreamer: false },
                  { sender: '小小美女', content: '嗯还会播一阵', timestamp: Date.now(), isStreamer: true },
                  { sender: '神秘人三阶', content: '虎纠人？', timestamp: Date.now(), isStreamer: false },
                ],
              },
            },
          }, r => { clearTimeout(t); resolve(r); });
        });
      });
      if (result?.suggestions?.length > 0) {
        log('Claude API', true, `${result.suggestions.length} suggestions`);
        result.suggestions.forEach(s => console.log(`      💬 "${s.text}" — ${s.reason || ''}`));
      } else {
        log('Claude API', false, result?.error || JSON.stringify(result));
      }
    } catch (e) {
      log('Claude API', false, e.message);
    }
    await ap.close();
  } else {
    log('Claude API (skipped)', false, 'no extension ID');
  }

  // 7. Content script messaging
  console.log('\n[7] Content script ↔ Extension messaging...');
  if (extensionId) {
    try {
      const cp = await context.newPage();
      await cp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
      await sleep(1000);
      const tid = await cp.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://live.douyin.com/*' });
        return tabs[0]?.id ?? null;
      });
      if (tid) {
        const ctx = await cp.evaluate(async (id) => {
          try { return await chrome.tabs.sendMessage(id, { type: 'GET_ROOM_CONTEXT' }); }
          catch (e) { return { error: e.message }; }
        }, tid);
        if (ctx && !ctx.error) {
          log('Content script communication', true, `${ctx.streamerName} | ${ctx.recentDanmaku?.length ?? 0} msgs`);
        } else {
          log('Content script communication', false, ctx?.error);
        }
      } else {
        log('Content script communication', false, 'no douyin tab');
      }
      await cp.close();
    } catch (e) {
      log('Content script communication', false, e.message);
    }
  }

  // Summary
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-final.png'), timeout: 10000 }).catch(() => {});
  console.log('\n' + '='.repeat(50));
  const p = results.filter(r => r.pass).length;
  const f = results.filter(r => !r.pass).length;
  console.log(`TOTAL: ${p} passed, ${f} failed out of ${results.length}`);
  if (f === 0) console.log('🎉 ALL TESTS PASSED!');
  console.log('='.repeat(50));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
