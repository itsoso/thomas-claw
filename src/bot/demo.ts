/**
 * OpenClaw Demo — 演示脚本（详细日志版）
 */
import { launchBrowser, closeBrowser } from './browser';
import { trainTaste, loadTasteProfile } from './taste';
import { discoverStreamers } from './discover';
import { parseRoomContext } from './room-parser';
import { startMonitor, getHistory } from './danmaku-monitor';
import { sendDanmaku } from './danmaku-sender';
import { sendCheapGift, listGifts } from './gift-sender';
import { startVoiceMonitor, getTranscriptHistory } from './voice-monitor';
import { injectSubtitleOverlay, showVoiceSubtitle, showInfoSubtitle } from './subtitle-overlay';
import { followStreamer, detectActions } from './auto-actions';
import { startRoomAnalysis, getRoomUnderstanding } from './room-context';
import { recordVisit, recordMyMessage, isDuplicate, getMemory, PERSONA } from './persona';
import { generateSuggestions } from './ai-suggest';
import { getStreamerProfileUrl, sendDirectMessage } from './messenger';
import { printDashboard, setDiscovered, addVisited, setCurrent, incDanmaku, incReply, incGift, addDM } from './dashboard';
import { DanmakuMessage } from '../shared/types';
import { getBudgetStatus } from './budget';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TASTE_DIR = path.join(os.homedir(), '.thomas-claw-taste');

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function log(tag: string, msg: string) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  console.log(`  ${ts} \x1b[90m[${tag}]\x1b[0m ${msg}`);
}

function section(step: number, title: string, desc: string) {
  console.log(`\n\x1b[1;36m${'═'.repeat(60)}`);
  console.log(`  Step ${step}: ${title}`);
  console.log(`${'═'.repeat(60)}\x1b[0m`);
  console.log(`\x1b[90m  ${desc}\x1b[0m\n`);
}

async function main() {
  console.log('\n\x1b[1;36m');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║     OpenClaw Demo — 全自动社交系统          ║');
  console.log('  ║     Powered by Playwright + GPT-4o         ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // ══════════ Step 1: 品味训练 ══════════
  section(1, '品味训练', '分析用户提供的参考图片，用 GPT-4o Vision 提取外貌特征，生成品味画像');

  log('检查', `品味目录: ${TASTE_DIR}`);
  const tasteImages = fs.existsSync(TASTE_DIR)
    ? fs.readdirSync(TASTE_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    : [];
  log('检查', `找到 ${tasteImages.length} 张参考图片${tasteImages.length > 0 ? ': ' + tasteImages.join(', ') : ''}`);

  let taste = loadTasteProfile();
  if (taste?.summary) {
    log('缓存', `已有品味画像，直接加载`);
    log('画像', `${taste.summary}`);
    if (taste.descriptions.length > 0) {
      taste.descriptions.forEach((d, i) => log(`图${i + 1}`, d));
    }
  } else {
    log('训练', '调用 GPT-4o Vision 逐张分析...');
    taste = await trainTaste();
  }
  console.log(`\n  ✅ 品味画像: \x1b[33m${taste.summary}\x1b[0m`);
  log('说明', '后续发现主播时，会用这个画像对比直播间截图，筛选符合条件的');
  await sleep(2000);

  // ══════════ Step 2: 主播发现 ══════════
  section(2, '主播发现', '打开 live.douyin.com 推荐页 → 截图每个直播卡片 → GPT-4o Vision 逐个判断是否符合品味');

  log('浏览器', '启动 Chrome（使用已登录的 Profile 保持登录态）');
  const session = await launchBrowser('https://live.douyin.com');
  const { page } = session;

  log('导航', '打开 https://live.douyin.com 直播推荐页');
  log('筛选', `品味标准: "${taste.summary}"`);
  log('筛选', '标题预过滤: 排除录播/电台/唱歌/带货/教学等关键词');
  log('筛选', '逐个截图卡片 → 发送给 GPT-4o Vision 判断 → 返回评分和理由');
  console.log('');

  const discovered = await discoverStreamers(page, taste, 5);
  setDiscovered(discovered.length);

  if (discovered.length === 0) {
    log('重试', '未找到符合的主播，放宽品味标准重试...');
    taste = { descriptions: [], summary: '年轻女性聊天主播', updatedAt: Date.now() };
    const more = await discoverStreamers(page, taste, 5);
    discovered.push(...more);
    setDiscovered(discovered.length);
  }

  console.log(`\n  ✅ 从推荐页筛选出 \x1b[33m${discovered.length}\x1b[0m 个符合品味的主播:`);
  discovered.forEach((s, i) => console.log(`     ${i + 1}. \x1b[33m${s.name}\x1b[0m (${s.score}/10) — ${s.reason}`));
  await sleep(2000);

  // ══════════ Step 3: 进入直播间 ══════════
  section(3, '进入直播间互动', '自动进入评分最高的直播间 → 启动弹幕监听 + 语音转写 + 画面分析 → AI 打招呼和互动');

  const target = discovered[0];
  if (!target) { console.log('  无主播可进'); await closeBrowser(session); return; }

  log('选择', `进入评分最高的: ${target.name} (${target.score}/10)`);
  log('导航', `打开 ${target.url}`);
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);

  const roomCtx = await parseRoomContext(page);
  if (!roomCtx) { console.log('  解析失败'); await closeBrowser(session); return; }

  const memory = recordVisit(roomCtx.streamerName);
  addVisited(roomCtx.streamerName);
  setCurrent(roomCtx.streamerName);
  try { await injectSubtitleOverlay(page); } catch {}

  log('解析', `主播: ${roomCtx.streamerName} | 房间: ${roomCtx.roomId}`);
  log('记忆', `关系: ${memory.relationship} | 第${memory.visitCount}次来访`);
  log('人设', `我是"${PERSONA.nickname}" — ${PERSONA.identity}`);

  log('启动', '弹幕监听 (MutationObserver 监听 DOM 变化)');
  const myReplies: string[] = [];
  await startMonitor(page, (msg: DanmakuMessage) => {
    incDanmaku();
    const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const pfx = msg.isStreamer ? '\x1b[31m[主播]\x1b[0m' : '\x1b[36m[弹幕]\x1b[0m';
    console.log(`  ${ts} ${pfx} ${msg.sender}: ${msg.content}`);
  });

  log('启动', '语音转写 (captureStream → MediaRecorder → Whisper API)');
  await startVoiceMonitor(page, async (voiceText: string) => {
    try { await showVoiceSubtitle(page, voiceText); } catch {}
    for (const a of detectActions(voiceText)) {
      if (a === 'follow') { log('指令', '主播要求关注 → 自动执行'); await followStreamer(page); }
    }
  });

  log('启动', '画面分析 (截图 → GPT-4o Vision → 主播外貌/环境/情绪)');
  try { await startRoomAnalysis(page, roomCtx.streamerName, getHistory, getTranscriptHistory); } catch {}

  // 打招呼
  log('等待', '15 秒后打招呼（模拟真人进入直播间的节奏）');
  await sleep(15000);
  const greetings = ['来了来了', '路过看看', '晚上好', '嗨', '刚到'];
  const greet = greetings[Math.floor(Math.random() * greetings.length)];
  log('AI', `生成打招呼弹幕: "${greet}"`);
  log('发送', `在弹幕输入框(contenteditable)中输入 → 按 Enter 发送`);
  const sent = await sendDanmaku(page, greet);
  if (sent) { myReplies.push(greet); recordMyMessage(roomCtx.streamerName, greet); incReply(); }

  // 互动
  log('互动', '开始 2 分钟互动（每 40 秒检查一次是否该回复）');
  log('策略', 'AI 根据弹幕+语音+画面理解生成回复，过滤歌词/广告，去重');
  console.log('');
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
      const ru = getRoomUnderstanding();

      log('AI调用', `输入: ${history.length}条弹幕 + ${voice.length}条语音 + 画面:"${ru.appearance?.slice(0, 30) || '分析中'}"`);
      const suggestions = await generateSuggestions(OPENAI_API_KEY, ctx, history, voice, myReplies);
      log('AI返回', `${suggestions.length}条候选: ${suggestions.map(s => `"${s.text}"`).join(', ') || '[]（判断不该回复）'}`);

      const valid = suggestions.filter(s => !isDuplicate(roomCtx.streamerName, s.text));
      if (valid.length > 0) {
        const pick = valid[Math.floor(Math.random() * valid.length)];
        log('选择', `发送: "${pick.text}" — ${pick.reason}`);
        try { await showInfoSubtitle(page, `💬 ${pick.text}`); } catch {}
        const s = await sendDanmaku(page, pick.text);
        if (s) { myReplies.push(pick.text); recordMyMessage(roomCtx.streamerName, pick.text); incReply(); }
      }
    } catch {}
  }

  // ══════════ Step 4: 送礼 ══════════
  section(4, '智能送礼', '从礼物栏找 ≤10 钻的礼物 → 点击选中 → 点击"赠送"按钮');

  log('预算', `已花费 ¥${getBudgetStatus().spent} / ¥${getBudgetStatus().limit}`);
  log('策略', '每个直播间最多送 2 次，单次 ≤1 元（10 钻）');

  const gifts = await listGifts(page);
  if (gifts.length > 0) {
    log('礼物栏', gifts.map(g => `${g.name}(${g.price})`).join(' | '));
    const cheap = gifts.filter(g => parseInt(g.price) <= 10);
    log('筛选', `≤10钻的: ${cheap.map(g => g.name).join(', ') || '无'}`);
  }

  log('送礼', '点击最便宜的礼物 → 点击"赠送"...');
  const giftOk = await sendCheapGift(page);
  if (giftOk) { incGift(); log('结果', '✅ 礼物已送出'); }
  else log('结果', '❌ 送礼未成功（可能余额不足）');
  await sleep(2000);

  // ══════════ Step 5: 私信 ══════════
  section(5, '私信', '从直播间提取主播主页URL → 导航到主页 → 点击"私信"按钮 → AI生成破冰消息 → 发送');

  log('提取', '从直播间 DOM 中查找 a[href*="/user/"] 链接');
  const profileUrl = await getStreamerProfileUrl(page);
  if (profileUrl) {
    log('主页', profileUrl);
    log('导航', '打开主播的抖音主页');
    log('点击', '找到并点击"私信"按钮 (button.semi-button)');
    log('面板', '右侧弹出 Draft.js 聊天编辑器');

    const mem = getMemory(roomCtx.streamerName);
    log('记忆', `已发${mem.myMessages.length}条弹幕, 主播反馈${mem.streamerFeedback.length}条`);
    log('AI', '基于互动记忆生成破冰私信（自然、不油腻、提到直播间经历）');

    const dmOk = await sendDirectMessage(page, profileUrl, roomCtx.streamerName);
    if (dmOk) {
      addDM(roomCtx.streamerName);
      log('结果', '✅ 破冰消息已发送');
      log('后续', '如果对方回复，AI 会自动继续对话，引导加微信');
    }
  } else {
    log('结果', '未找到主页链接（主播可能未开播）');
  }
  await sleep(2000);

  // ══════════ Step 6: Dashboard ══════════
  section(6, '全局统计', '展示本次运行的所有数据');
  printDashboard();
  const budget = getBudgetStatus();
  console.log(`  总花费: ¥${budget.spent} / ¥${budget.limit}`);
  console.log(`  剩余预算: ¥${budget.remaining}`);

  // 记忆统计
  try {
    const memFile = path.join(os.homedir(), '.thomas-claw-memory.json');
    if (fs.existsSync(memFile)) {
      const memData = JSON.parse(fs.readFileSync(memFile, 'utf8'));
      const streamers = Object.keys(memData.streamers || {});
      const withFeedback = Object.values(memData.streamers || {}).filter((m: any) => m.streamerFeedback?.length > 0);
      console.log(`\n  记忆中的主播: ${streamers.length} 个`);
      console.log(`  有反馈的: ${withFeedback.length} 个`);
      console.log(`  已发私信: ${Object.values(memData.streamers || {}).filter((m: any) => m.myMessages?.some((msg: string) => msg.startsWith('[私信]'))).length} 个`);
    }
  } catch {}

  console.log('\n\x1b[1;32m');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║              Demo 完成！                   ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('\x1b[0m');

  console.log('\x1b[90m  技术栈: Playwright + OpenAI GPT-4o-mini + Whisper + Vision');
  console.log('  架构: 17 个模块, ~3000 行 TypeScript');
  console.log('  能力: 品味训练 → 主播发现 → 弹幕/语音/画面理解 → AI互动 → 送礼 → 私信\x1b[0m\n');

  await closeBrowser(session);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
