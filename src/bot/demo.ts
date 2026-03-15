/**
 * OpenClaw Demo — 演示脚本
 * 给托总/一笑展示完整能力链路
 *
 * 演示流程（约 5 分钟）：
 * 1. 品味训练：展示 AI 分析参考图片
 * 2. 主播发现：浏览推荐页，AI 逐个筛选
 * 3. 进入直播间：自动打招呼 + 语音字幕 + AI 回复
 * 4. 智能送礼：主播说感谢时送小心心
 * 5. 私信：导航到主页发破冰消息
 * 6. Dashboard：展示全局统计
 */
import { launchBrowser, closeBrowser } from './browser';
import { trainTaste, loadTasteProfile } from './taste';
import { discoverStreamers } from './discover';
import { parseRoomContext } from './room-parser';
import { startMonitor, getHistory } from './danmaku-monitor';
import { sendDanmaku } from './danmaku-sender';
import { sendCheapGift } from './gift-sender';
import { startVoiceMonitor, getTranscriptHistory } from './voice-monitor';
import { injectSubtitleOverlay, showVoiceSubtitle, showInfoSubtitle } from './subtitle-overlay';
import { followStreamer, detectActions } from './auto-actions';
import { startRoomAnalysis } from './room-context';
import { recordVisit, recordMyMessage, isDuplicate } from './persona';
import { generateSuggestions } from './ai-suggest';
import { getStreamerProfileUrl, sendDirectMessage } from './messenger';
import { printDashboard, setDiscovered, addVisited, setCurrent, incDanmaku, incReply, incGift, addDM } from './dashboard';
import { DanmakuMessage } from '../shared/types';
import { getBudgetStatus } from './budget';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function section(title: string) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(50)}\n`);
}

async function main() {
  console.log('\n\x1b[1;36m');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║     OpenClaw Demo — 全自动社交系统      ║');
  console.log('  ║     Powered by Playwright + GPT-4o     ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('\x1b[0m');

  // ── Step 1: 品味训练 ──
  section('Step 1: 品味训练');
  let taste = loadTasteProfile();
  if (taste?.summary) {
    console.log(`已有品味画像: ${taste.summary}`);
  } else {
    console.log('分析参考图片中...');
    taste = await trainTaste();
  }
  console.log(`\n✅ 品味画像: \x1b[33m${taste.summary}\x1b[0m`);
  await sleep(2000);

  // ── Step 2: 启动浏览器 + 发现主播 ──
  section('Step 2: 主播发现');
  const session = await launchBrowser('https://live.douyin.com');
  const { page } = session;

  console.log('浏览推荐页，AI 逐个筛选...\n');
  const discovered = await discoverStreamers(page, taste, 5);
  setDiscovered(discovered.length);

  if (discovered.length === 0) {
    console.log('未找到符合的主播，使用默认品味重试...');
    taste = { descriptions: [], summary: '年轻女性聊天主播', updatedAt: Date.now() };
    const more = await discoverStreamers(page, taste, 5);
    discovered.push(...more);
  }

  console.log(`\n✅ 找到 \x1b[33m${discovered.length}\x1b[0m 个符合品味的主播`);
  discovered.forEach((s, i) => console.log(`   ${i + 1}. ${s.name} (${s.score}/10) — ${s.reason}`));
  await sleep(2000);

  // ── Step 3: 进入直播间互动 ──
  section('Step 3: 进入直播间');
  const target = discovered[0];
  if (!target) { console.log('无主播可进'); await closeBrowser(session); return; }

  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);

  const roomCtx = await parseRoomContext(page);
  if (!roomCtx) { console.log('解析失败'); await closeBrowser(session); return; }

  recordVisit(roomCtx.streamerName);
  addVisited(roomCtx.streamerName);
  setCurrent(roomCtx.streamerName);
  try { await injectSubtitleOverlay(page); } catch {}

  console.log(`进入: \x1b[33m${roomCtx.streamerName}\x1b[0m (${target.score}/10)\n`);

  // 启动监听
  const myReplies: string[] = [];
  await startMonitor(page, (msg: DanmakuMessage) => {
    incDanmaku();
    const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const pfx = msg.isStreamer ? '\x1b[31m[主播]\x1b[0m' : '\x1b[36m[弹幕]\x1b[0m';
    console.log(`${ts} ${pfx} ${msg.sender}: ${msg.content}`);
  });

  await startVoiceMonitor(page, async (voiceText: string) => {
    try { await showVoiceSubtitle(page, voiceText); } catch {}

    for (const a of detectActions(voiceText)) {
      if (a === 'follow') await followStreamer(page);
    }
  });

  try { await startRoomAnalysis(page, roomCtx.streamerName, getHistory, getTranscriptHistory); } catch {}

  // 打招呼
  await sleep(15000);
  const greetings = ['来了来了', '路过看看', '晚上好', '嗨'];
  const greet = greetings[Math.floor(Math.random() * greetings.length)];
  console.log(`\n\x1b[33m[AI]\x1b[0m "${greet}" \x1b[90m(打招呼)\x1b[0m`);
  const sent = await sendDanmaku(page, greet);
  if (sent) { myReplies.push(greet); recordMyMessage(roomCtx.streamerName, greet); incReply(); }

  // 互动 2 分钟
  console.log('\n[演示] 互动中（2 分钟）...\n');
  const demoEnd = Date.now() + 120_000;
  let lastReply = Date.now();

  while (Date.now() < demoEnd) {
    await sleep(10_000);

    if (Date.now() - lastReply < 40_000) continue;

    const history = getHistory();
    const voice = getTranscriptHistory();
    if (history.length < 2 && voice.length < 1) continue;

    try {
      lastReply = Date.now();
      const ctx = (await parseRoomContext(page).catch(() => null)) || roomCtx;
      const suggestions = await generateSuggestions(OPENAI_API_KEY, ctx, history, voice, myReplies);
      const valid = suggestions.filter(s => !isDuplicate(roomCtx.streamerName, s.text));

      if (valid.length > 0) {
        const pick = valid[Math.floor(Math.random() * valid.length)];
        console.log(`\x1b[33m[AI]\x1b[0m "${pick.text}" \x1b[90m(${pick.reason})\x1b[0m`);
        try { await showInfoSubtitle(page, `💬 ${pick.text}`); } catch {}
        const s = await sendDanmaku(page, pick.text);
        if (s) { myReplies.push(pick.text); recordMyMessage(roomCtx.streamerName, pick.text); incReply(); }
      }
    } catch {}
  }

  // ── Step 4: 送礼 ──
  section('Step 4: 智能送礼');
  console.log('送一个小心心...');
  const giftOk = await sendCheapGift(page);
  if (giftOk) { incGift(); console.log('✅ 礼物已送出（¥0.1）'); }
  else console.log('送礼未成功');
  await sleep(2000);

  // ── Step 5: 私信 ──
  section('Step 5: 私信');
  const profileUrl = await getStreamerProfileUrl(page);
  if (profileUrl) {
    console.log(`导航到 ${roomCtx.streamerName} 主页...\n`);
    const dmOk = await sendDirectMessage(page, profileUrl, roomCtx.streamerName);
    if (dmOk) { addDM(roomCtx.streamerName); console.log('\n✅ 破冰消息已发送'); }
  } else {
    console.log('未找到主页链接');
  }
  await sleep(3000);

  // ── Step 6: Dashboard ──
  section('Step 6: 全局统计');
  printDashboard();
  const budget = getBudgetStatus();
  console.log(`  总花费: ¥${budget.spent} / ¥${budget.limit}`);
  console.log(`  剩余预算: ¥${budget.remaining}\n`);

  console.log('\x1b[1;32m');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║           Demo 完成！                  ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('\x1b[0m');

  await closeBrowser(session);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
