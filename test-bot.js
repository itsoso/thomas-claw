const { chromium } = require('playwright');
const path = require('path');

const LIVE_URL = 'https://live.douyin.com/759479804680';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== Thomas Claw Bot 完整测试 ===\n');
  const results = [];
  const log = (n, p, d='') => { results.push({n,p}); console.log(`  ${p?'✅':'❌'} ${n}${d?' — '+d:''}`); };

  // 1. 启动浏览器
  console.log('[1] 启动浏览器...');
  const context = await chromium.launchPersistentContext('', {
    headless: false, channel: 'chrome',
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);
  await page.keyboard.press('Escape');
  await sleep(1000);
  log('页面加载', true, await page.title());

  // 2. 直播间解析
  console.log('\n[2] 直播间解析...');
  const roomCtx = await page.evaluate(() => {
    const roomId = location.pathname.match(/^\/(\d+)/)?.[1];
    const streamer = document.title.match(/^(.+?)的抖音直播间/)?.[1];
    return { roomId, streamer };
  });
  log('房间 ID', !!roomCtx.roomId, roomCtx.roomId);
  log('主播名', !!roomCtx.streamer, roomCtx.streamer);

  // 3. 弹幕监听
  console.log('\n[3] 弹幕监听...');
  const danmaku = [];
  await page.exposeFunction('__testDanmaku', (msg) => danmaku.push(msg));
  await page.addScriptTag({ content: `
    var lastCount = 0;
    function parse() {
      var c = document.querySelector('[class*="webcast-chatroom"]');
      if (!c) return;
      var items = c.querySelectorAll('[class*="chatroom___item"]');
      var msgs = [];
      items.forEach(function(item) {
        var cls = item.className || '';
        if (cls.includes('wrapper') || cls.includes('list')) return;
        var w = item.querySelector('[class*="item-wrapper"]') || item;
        var sender = '';
        var spans = w.querySelectorAll('span');
        for (var i=0;i<spans.length;i++) {
          var t = (spans[i].textContent||'').trim();
          if (t.endsWith('：')||t.endsWith(':')) { sender=t.replace(/[：:]$/,''); break; }
        }
        var ce = w.querySelector('[class*="content-with-emoji"]');
        var content = ce ? (ce.textContent||'').trim() : '';
        if (sender&&content) msgs.push({sender:sender,content:content});
      });
      var newM = msgs.slice(lastCount);
      lastCount = msgs.length;
      for(var j=0;j<newM.length;j++) window.__testDanmaku(newM[j]);
    }
    parse();
    var co = document.querySelector('[class*="webcast-chatroom"]');
    if(co) new MutationObserver(function(){parse()}).observe(co,{childList:true,subtree:true});
    setInterval(parse, 2000);
  `});
  await sleep(8000);
  log('弹幕捕获', danmaku.length > 0, `${danmaku.length} 条`);
  if (danmaku.length > 0) {
    danmaku.slice(-3).forEach(m => console.log(`      ${m.sender}: ${m.content}`));
  }

  // 4. OpenAI API 调用
  console.log('\n[4] OpenAI API 弹幕生成...');
  try {
    const sampleMsgs = danmaku.slice(-5).map(m => ({
      sender: m.sender, content: m.content, timestamp: Date.now(), isStreamer: false,
    }));
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 300,
        messages: [
          { role: 'system', content: '你是直播间弹幕助手。生成3条候选弹幕，JSON数组，每条含text和reason字段。每条不超过20字。' },
          { role: 'user', content: `主播：${roomCtx.streamer}\n最近弹幕：\n${sampleMsgs.map(m=>m.sender+':'+m.content).join('\n')}\n\n生成3条弹幕建议，直接输出JSON数组。` },
        ],
      }),
    });
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    const suggestions = match ? JSON.parse(match[0]) : [];
    log('AI 建议生成', suggestions.length > 0, `${suggestions.length} 条`);
    suggestions.forEach(s => console.log(`      💬 "${s.text}" — ${s.reason || ''}`));
  } catch(e) {
    log('AI 建议生成', false, e.message);
  }

  // 5. 礼物面板检测
  console.log('\n[5] 礼物面板...');
  const giftInfo = await page.evaluate(() => {
    // 查找所有可能的礼物相关元素
    var giftEls = document.querySelectorAll('[class*="gift"], [class*="Gift"]');
    var found = [];
    giftEls.forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        found.push({
          tag: el.tagName,
          cls: (el.className||'').slice(0,60),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (el.textContent||'').trim().slice(0,30),
        });
      }
    });
    return found.slice(0, 8);
  });
  log('礼物元素检测', giftInfo.length > 0, `${giftInfo.length} 个`);
  giftInfo.forEach(g => console.log(`      <${g.tag}> "${g.text}" (${g.w}x${g.h})`));

  // Summary
  console.log('\n' + '='.repeat(50));
  const p = results.filter(r=>r.p).length;
  const f = results.filter(r=>!r.p).length;
  console.log(`总计: ${p} 通过, ${f} 失败 (共 ${results.length} 项)`);
  if (f === 0) console.log('🎉 全部通过!');
  console.log('='.repeat(50));

  await context.close();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
