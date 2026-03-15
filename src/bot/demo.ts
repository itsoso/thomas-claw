/**
 * OpenClaw Demo — Web Dashboard 版
 */
import { launchBrowser, closeBrowser } from './browser';
import { trainTaste, loadTasteProfile } from './taste';
import { discoverStreamers } from './discover';
import { parseRoomContext } from './room-parser';
import { startMonitor, getHistory } from './danmaku-monitor';
import { sendDanmaku } from './danmaku-sender';
import { sendCheapGift, listGifts } from './gift-sender';
import { startVoiceMonitor, getTranscriptHistory } from './voice-monitor';
import { injectSubtitleOverlay, showVoiceSubtitle } from './subtitle-overlay';
import { followStreamer, detectActions } from './auto-actions';
import { startRoomAnalysis, getRoomUnderstanding } from './room-context';
import { recordVisit, recordMyMessage, isDuplicate, getMemory, PERSONA } from './persona';
import { generateSuggestions } from './ai-suggest';
import { getStreamerProfileUrl, sendDirectMessage } from './messenger';
import { getBudgetStatus } from './budget';
import { startWebDashboard, dashLog, dashSetStep, dashSetTaste, dashAddDiscovered, dashSetStreamer, dashSetRoomImage, dashSetVoice, dashSetAI, dashSetGift, dashSetDM, dashUpdateStats } from './web-dashboard';
import { DanmakuMessage } from '../shared/types';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TASTE_DIR = path.join(os.homedir(), '.thomas-claw-taste');

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 启动 Web Dashboard
  startWebDashboard(3456);

  dashLog('系统', '启动', 'OpenClaw Demo 开始运行', 'system');

  // ══════ Step 1: 品味训练 ══════
  dashSetStep('Step 1', '品味训练 — 分析参考图片生成偏好画像');
  dashLog('Step 1', '品味', '检查品味目录: ' + TASTE_DIR, 'info');

  const tasteImages = fs.existsSync(TASTE_DIR)
    ? fs.readdirSync(TASTE_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    : [];
  dashLog('Step 1', '品味', `找到 ${tasteImages.length} 张参考图片`, 'info');

  let taste = loadTasteProfile();
  if (taste?.summary) {
    dashLog('Step 1', '缓存', '已有品味画像，直接加载', 'success');
    dashSetTaste(taste.summary);
    if (taste.descriptions.length > 0) {
      taste.descriptions.forEach((d, i) => dashLog('Step 1', `图${i+1}`, d, 'info'));
    }
  } else {
    dashLog('Step 1', 'Vision', '调用 GPT-4o Vision 分析图片...', 'ai');
    taste = await trainTaste();
    dashSetTaste(taste.summary);
  }
  dashLog('Step 1', '完成', `品味画像: ${taste.summary}`, 'success');
  await sleep(1500);

  // ══════ Step 2: 主播发现 ══════
  dashSetStep('Step 2', '主播发现 — 浏览推荐页，AI 截图筛选');
  dashLog('Step 2', '浏览器', '启动 Chrome (已登录 Profile)', 'system');

  const session = await launchBrowser('https://live.douyin.com');
  const { page } = session;

  dashLog('Step 2', '导航', '打开 live.douyin.com 推荐页', 'info');
  dashLog('Step 2', '标准', `品味: "${taste.summary}"`, 'info');
  dashLog('Step 2', '过滤', '排除: 录播/电台/唱歌/带货/教学', 'info');
  dashLog('Step 2', '方法', '逐个截图卡片 → GPT-4o Vision 判断', 'ai');

  const discovered = await discoverStreamers(page, taste, 5);

  if (discovered.length === 0) {
    dashLog('Step 2', '重试', '放宽品味标准重试...', 'warning');
    taste = { descriptions: [], summary: '年轻女性聊天主播', updatedAt: Date.now() };
    dashSetTaste(taste.summary);
    const more = await discoverStreamers(page, taste, 5);
    discovered.push(...more);
  }

  discovered.forEach(s => {
    dashAddDiscovered({ name: s.name, score: s.score, reason: s.reason });
    dashLog('Step 2', '匹配', `${s.name} (${s.score}/10) — ${s.reason}`, 'success');
  });
  dashLog('Step 2', '完成', `共找到 ${discovered.length} 个符合品味的主播`, 'success');
  await sleep(1500);

  // ══════ Step 3: 进入直播间 ══════
  dashSetStep('Step 3', '进入直播间 — 弹幕监听 + 语音转写 + AI 互动');

  const target = discovered[0];
  if (!target) {
    dashLog('Step 3', '错误', '无主播可进', 'error');
    await closeBrowser(session);
    return;
  }

  dashLog('Step 3', '选择', `进入: ${target.name} (${target.score}/10)`, 'info');
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);

  const roomCtx = await parseRoomContext(page);
  if (!roomCtx) { dashLog('Step 3', '错误', '解析失败', 'error'); await closeBrowser(session); return; }

  const memory = recordVisit(roomCtx.streamerName);
  dashSetStreamer(roomCtx.streamerName);
  try { await injectSubtitleOverlay(page); } catch {}

  dashLog('Step 3', '解析', `主播: ${roomCtx.streamerName} | 房间: ${roomCtx.roomId}`, 'info');
  dashLog('Step 3', '记忆', `关系: ${memory.relationship} | 第${memory.visitCount}次`, 'info');
  dashLog('Step 3', '人设', `"${PERSONA.nickname}" — ${PERSONA.identity}`, 'info');

  dashLog('Step 3', '监听', '启动弹幕监听 (MutationObserver)', 'system');
  let danmakuCount = 0;
  const myReplies: string[] = [];
  await startMonitor(page, (msg: DanmakuMessage) => {
    danmakuCount++;
    dashLog('Step 3', msg.isStreamer ? '主播' : '弹幕', `${msg.sender}: ${msg.content}`, 'danmaku');
    dashUpdateStats({ danmaku: danmakuCount });
  });

  dashLog('Step 3', '监听', '启动语音转写 (Whisper API)', 'system');
  let voiceCount = 0;
  await startVoiceMonitor(page, async (voiceText: string) => {
    voiceCount++;
    dashSetVoice(voiceText);
    dashLog('Step 3', '语音', voiceText, 'voice');
    dashUpdateStats({ voice: voiceCount });
    try { await showVoiceSubtitle(page, voiceText); } catch {}
    for (const a of detectActions(voiceText)) {
      if (a === 'follow') { dashLog('Step 3', '指令', '主播要求关注 → 执行', 'success'); await followStreamer(page); }
    }
  });

  dashLog('Step 3', '监听', '启动画面分析 (GPT-4o Vision)', 'system');
  try { await startRoomAnalysis(page, roomCtx.streamerName, getHistory, getTranscriptHistory); } catch {}

  // 等画面分析完成
  await sleep(12000);
  const ru = getRoomUnderstanding();
  if (ru.appearance) {
    dashSetRoomImage(ru.appearance);
    dashLog('Step 3', '画面', ru.appearance, 'info');
  }

  // 打招呼
  dashLog('Step 3', '策略', '15秒后打招呼（模拟真人节奏）', 'info');
  await sleep(3000);
  const greetings = ['来了来了', '路过看看', '晚上好', '嗨', '刚到'];
  const greet = greetings[Math.floor(Math.random() * greetings.length)];
  dashLog('Step 3', 'AI', `打招呼: "${greet}"`, 'ai');
  dashSetAI(greet);
  const sent = await sendDanmaku(page, greet);
  if (sent) { myReplies.push(greet); recordMyMessage(roomCtx.streamerName, greet); dashUpdateStats({ replies: 1 }); }

  // 互动 2 分钟
  dashLog('Step 3', '互动', '开始 2 分钟互动...', 'info');
  const demoEnd = Date.now() + 120_000;
  let lastReply = Date.now();
  let replyCount = 1;

  while (Date.now() < demoEnd) {
    await sleep(10_000);
    if (Date.now() - lastReply < 40_000) continue;

    const history = getHistory();
    const voice = getTranscriptHistory();
    if (history.length < 2 && voice.length < 1) continue;

    try {
      lastReply = Date.now();
      const ctx = (await parseRoomContext(page).catch(() => null)) || roomCtx;
      dashLog('Step 3', 'AI调用', `输入: ${history.length}弹幕 + ${voice.length}语音`, 'ai');

      const suggestions = await generateSuggestions(OPENAI_API_KEY, ctx, history, voice, myReplies);
      dashLog('Step 3', 'AI返回', `${suggestions.length}条: ${suggestions.map(s => `"${s.text}"`).join(', ') || '[]'}`, 'ai');

      const valid = suggestions.filter(s => !isDuplicate(roomCtx.streamerName, s.text));
      if (valid.length > 0) {
        const pick = valid[Math.floor(Math.random() * valid.length)];
        dashLog('Step 3', '发送', `"${pick.text}" — ${pick.reason}`, 'success');
        dashSetAI(pick.text);
        const s = await sendDanmaku(page, pick.text);
        if (s) { replyCount++; myReplies.push(pick.text); recordMyMessage(roomCtx.streamerName, pick.text); dashUpdateStats({ replies: replyCount }); }
      }
    } catch {}
  }

  // ══════ Step 4: 送礼 ══════
  dashSetStep('Step 4', '智能送礼 — 筛选便宜礼物并赠送');

  const budget = getBudgetStatus();
  dashLog('Step 4', '预算', `已花费 ¥${budget.spent} / ¥${budget.limit}`, 'info');
  dashUpdateStats({ spent: String(budget.spent), remaining: String(budget.remaining) });

  const gifts = await listGifts(page);
  if (gifts.length > 0) {
    dashLog('Step 4', '礼物栏', gifts.map(g => `${g.name}(${g.price})`).join(' | '), 'info');
    const cheap = gifts.filter(g => parseInt(g.price) <= 10);
    dashLog('Step 4', '筛选', `≤10钻: ${cheap.map(g => g.name).join(', ') || '无'}`, 'info');
  }

  dashLog('Step 4', '送礼', '点击最便宜的 → 赠送...', 'gift');
  const giftOk = await sendCheapGift(page);
  if (giftOk) {
    dashSetGift('小心心 (1钻 ≈ ¥0.1)');
    dashLog('Step 4', '完成', '✅ 礼物已送出', 'success');
    dashUpdateStats({ gifts: 1 });
  } else {
    dashLog('Step 4', '结果', '送礼未成功', 'warning');
  }
  await sleep(2000);

  // ══════ Step 5: 私信 ══════
  dashSetStep('Step 5', '私信 — 导航主页，AI 生成破冰消息');

  dashLog('Step 5', '提取', '从 DOM 查找主播主页 URL', 'info');
  const profileUrl = await getStreamerProfileUrl(page);
  if (profileUrl) {
    dashLog('Step 5', '主页', profileUrl, 'info');
    dashLog('Step 5', '导航', '打开主播抖音主页', 'info');
    dashLog('Step 5', '点击', '找到"私信"按钮 → 打开聊天面板', 'info');

    const mem = getMemory(roomCtx.streamerName);
    dashLog('Step 5', '记忆', `已发${mem.myMessages.length}条弹幕, 反馈${mem.streamerFeedback.length}条`, 'info');
    dashLog('Step 5', 'AI', '基于互动记忆生成破冰私信...', 'ai');

    const dmOk = await sendDirectMessage(page, profileUrl, roomCtx.streamerName);
    if (dmOk) {
      dashSetDM('破冰消息已发送');
      dashLog('Step 5', '完成', '✅ 私信已发送', 'success');
      dashLog('Step 5', '后续', '如果对方回复，AI 自动继续对话引导加微信', 'info');
    } else {
      dashLog('Step 5', '结果', '发送失败', 'error');
    }
  } else {
    dashLog('Step 5', '结果', '未找到主页链接', 'warning');
  }
  await sleep(2000);

  // ══════ Step 6: 完成 ══════
  dashSetStep('完成', '全链路演示结束');
  const finalBudget = getBudgetStatus();
  dashUpdateStats({ spent: String(finalBudget.spent), remaining: String(finalBudget.remaining) });

  try {
    const memFile = path.join(os.homedir(), '.thomas-claw-memory.json');
    const memData = JSON.parse(fs.readFileSync(memFile, 'utf8'));
    const total = Object.keys(memData.streamers || {}).length;
    const withDM = Object.values(memData.streamers || {}).filter((m: any) => m.myMessages?.some((msg: string) => msg.startsWith('[私信]'))).length;
    dashLog('统计', '记忆', `${total} 个主播, ${withDM} 个已私信`, 'info');
  } catch {}

  dashLog('系统', '完成', 'Demo 全链路结束！Dashboard 保持运行，可随时查看', 'success');

  console.log('\n  ✅ Demo 完成！Dashboard 保持运行中...');
  console.log('  🌐 http://localhost:3456\n');

  // 保持进程存活，Dashboard 持续可访问
  await closeBrowser(session);
  await new Promise(() => {});
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
