const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const LIVE_URL = 'https://live.douyin.com/759479804680?column_type=single&from_search=true';
const EXTENSION_PATH = path.resolve(__dirname, 'dist');
const SCREENSHOT_DIR = path.resolve(__dirname, 'test-screenshots');
const CHROMIUM_PATH = '/Users/liqiuhua/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (p, name) => p.screenshot({ path: path.join(SCREENSHOT_DIR, name), timeout: 10000 }).catch(() => {});

async function run() {
  console.log('=== Thomas Claw 完整浏览器测试 ===\n');
  const results = [];
  const log = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const userDataDir = path.join(__dirname, '.test-chrome-profile');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  // 启动浏览器
  console.log('[1] 启动浏览器 + 加载插件...');
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
  await sleep(2000);

  // 获取扩展 ID
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const toolbar = mgr?.shadowRoot?.querySelector('extensions-toolbar');
    const toggle = toolbar?.shadowRoot?.querySelector('#devMode');
    if (toggle && !toggle.checked) toggle.click();
  });
  await sleep(1500);
  const extensionId = await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const itemList = mgr?.shadowRoot?.querySelector('extensions-item-list');
    const items = itemList?.shadowRoot?.querySelectorAll('extensions-item');
    if (items) for (const item of items) {
      const name = item.shadowRoot?.querySelector('#name')?.textContent;
      if (name?.includes('Thomas')) return item.id;
    }
    return items?.[0]?.id || null;
  });
  await extPage.close();
  log('扩展加载', !!extensionId, extensionId);

  // 打开直播间
  console.log('\n[2] 打开直播间...');
  const page = context.pages().find(p => p.url() === 'about:blank') || await context.newPage();
  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  log('页面加载', true, await page.title());
  await shot(page, '10-before-dismiss.png');

  // 检测并关闭登录弹窗
  console.log('\n[3] 检测登录弹窗...');
  const hasLoginModal = await page.evaluate(() => {
    const modals = document.querySelectorAll('[class*="login"], [class*="modal"], [class*="dialog"]');
    for (const m of modals) {
      const rect = m.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200) return true;
    }
    return false;
  });

  if (hasLoginModal) {
    console.log('  检测到登录弹窗，尝试关闭...');
    // 手动关闭：点击弹窗外围的遮罩层或关闭按钮
    await page.evaluate(() => {
      // 尝试各种关闭方式
      const closeSelectors = [
        '[class*="dy-account-close"]',
        '.dy-account-close',
        '[class*="closeIcon"]',
        '[class*="close-icon"]',
        '[class*="modal"] [class*="close"]',
        '[class*="login"] [class*="close"]',
      ];
      for (const sel of closeSelectors) {
        const el = document.querySelector(sel);
        if (el) { el.click(); return; }
      }
      // 查找所有 close 类元素
      document.querySelectorAll('[class*="close"], [class*="Close"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 10 && rect.width < 60) {
          const parent = el.closest('[class*="modal"], [class*="dialog"], [class*="login"], [class*="account"]');
          if (parent) el.click();
        }
      });
    });
    await sleep(2000);

    // 如果还在，按 ESC
    await page.keyboard.press('Escape');
    await sleep(1000);

    // 再检查
    const stillHasModal = await page.evaluate(() => {
      const modals = document.querySelectorAll('[class*="login"], [class*="modal"]');
      for (const m of modals) {
        const style = window.getComputedStyle(m);
        const rect = m.getBoundingClientRect();
        if (style.display !== 'none' && rect.width > 200 && rect.height > 200) return true;
      }
      return false;
    });
    log('登录弹窗关闭', !stillHasModal, stillHasModal ? '弹窗仍在显示' : '已关闭');
  } else {
    log('无登录弹窗', true, '直接可用');
  }

  await shot(page, '11-after-dismiss.png');
  await sleep(3000); // 等待 content script 初始化

  // DOM 解析
  console.log('\n[4] DOM 解析测试...');
  // 先滚动弹幕区触发虚拟列表渲染
  await page.evaluate(() => {
    const list = document.querySelector('[class*="webcast-chatroom___list"]');
    if (list) list.scrollTop = list.scrollHeight;
  });
  await sleep(2000);

  const parseResult = await page.evaluate(() => {
    const roomId = location.pathname.match(/^\/(\d+)/)?.[1] || null;
    const streamerName = document.title.match(/^(.+?)的抖音直播间/)?.[1] || null;
    const container = document.querySelector('[class*="webcast-chatroom"]');
    const messages = [];
    if (container) {
      container.querySelectorAll('[class*="chatroom___item"]').forEach(item => {
        if ((item.className || '').includes('wrapper') || (item.className || '').includes('list')) return;
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
    return { roomId, streamerName, hasChat: !!container, messages };
  });

  log('房间 ID', !!parseResult.roomId, parseResult.roomId);
  log('主播昵称', !!parseResult.streamerName, parseResult.streamerName);
  log('弹幕区域', parseResult.hasChat);
  log('弹幕消息', parseResult.messages.length > 0, `${parseResult.messages.length} 条`);
  if (parseResult.messages.length > 0) {
    parseResult.messages.slice(-3).forEach(m => console.log(`      ${m.sender}: ${m.content}`));
  }

  // Side Panel
  console.log('\n[5] Side Panel 测试...');
  if (extensionId) {
    const sp = await context.newPage();
    await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load', timeout: 10000 });
    await sleep(2000);
    const rendered = await sp.evaluate(() => document.getElementById('root')?.children.length > 0);
    log('Side Panel 渲染', rendered);

    // 设置页
    await sp.click('button.tab-btn:nth-child(4)');
    await sleep(800);
    const cfg = await sp.evaluate(() => {
      const inputs = document.querySelectorAll('.settings-panel input');
      return { keyLen: inputs[0]?.value?.length || 0, baseUrl: inputs[1]?.value || '' };
    });
    log('API Key 已配置', cfg.keyLen > 0, `${cfg.keyLen} 字符`);
    log('Base URL', cfg.baseUrl.includes('openai'), cfg.baseUrl);
    await shot(sp, '12-settings.png');

    await sp.close();
  }

  // Content Script 通信
  console.log('\n[6] Content Script 通信...');
  if (extensionId) {
    const cp = await context.newPage();
    await cp.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
    await sleep(1500);
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
        log('Content Script 通信', true, `${ctx.streamerName} | ${ctx.recentDanmaku?.length ?? 0} 条弹幕`);
      } else {
        log('Content Script 通信', false, ctx?.error);
      }
    }
    await cp.close();
  }

  // OpenAI API 调用
  console.log('\n[7] OpenAI API 弹幕生成...');
  if (extensionId) {
    const ap = await context.newPage();
    await ap.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
    await sleep(1500);
    try {
      const streamer = parseResult.streamerName || '主播';
      const sampleMsgs = parseResult.messages.slice(-5).map(m => ({
        sender: m.sender, content: m.content, timestamp: Date.now(), isStreamer: false,
      }));
      const result = await ap.evaluate((args) => {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout 30s')), 30000);
          chrome.runtime.sendMessage({
            type: 'GENERATE_SUGGESTIONS',
            payload: {
              context: {
                roomId: args.roomId, streamerName: args.streamer,
                title: args.streamer + '的直播间', viewerCount: 50,
                recentDanmaku: args.msgs,
              },
            },
          }, r => { clearTimeout(t); resolve(r); });
        });
      }, { roomId: parseResult.roomId || '759479804680', streamer, msgs: sampleMsgs });

      if (result?.suggestions?.length > 0) {
        log('OpenAI API 调用', true, `${result.suggestions.length} 条建议`);
        result.suggestions.forEach(s => console.log(`      💬 "${s.text}" — ${s.reason || ''}`));
      } else {
        log('OpenAI API 调用', false, result?.error || JSON.stringify(result));
      }
    } catch (e) {
      log('OpenAI API 调用', false, e.message);
    }
    await ap.close();
  }

  // 截图
  await shot(page, '13-final.png');

  // 总结
  console.log('\n' + '='.repeat(50));
  const p = results.filter(r => r.pass).length;
  const f = results.filter(r => !r.pass).length;
  console.log(`总计: ${p} 通过, ${f} 失败 (共 ${results.length} 项)`);
  if (f === 0) console.log('🎉 全部通过!');
  console.log('='.repeat(50));

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
