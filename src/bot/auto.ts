/**
 * OpenClaw 全自动模式：发现 → 进入 → 互动 → 私信 → 切换 → 循环
 */
import { launchBrowser, closeBrowser } from './browser';
import { trainTaste, loadTasteProfile } from './taste';
import { discoverStreamers } from './discover';
import { parseRoomContext } from './room-parser';
import { startMonitor, getHistory } from './danmaku-monitor';
import { sendDanmaku } from './danmaku-sender';
import { sendGiftByBudget, decideGiftLevel } from './gift-sender';
import { startVoiceMonitor, getTranscriptHistory } from './voice-monitor';
import { injectSubtitleOverlay, showVoiceSubtitle, showInfoSubtitle } from './subtitle-overlay';
import { followStreamer, joinFanClub, likeStream, detectActions } from './auto-actions';
import { startRoomAnalysis, getRoomUnderstanding } from './room-context';
import { recordVisit, recordMyMessage, recordStreamerFeedback, isDuplicate } from './persona';
import { generateSuggestions, shouldSendGift } from './ai-suggest';
import { canAfford, recordSpending, getBudgetStatus } from './budget';
import { pickNext, calculateStayDuration, navigateToStream } from './scheduler';
import { getStreamerProfileUrl, sendDirectMessage, shouldSendDM, checkAndReplyDMs } from './messenger';
import { printDashboard, setDiscovered, addVisited, setCurrent, incDanmaku, incReply, incGift, addDM } from './dashboard';
import { DanmakuMessage } from '../shared/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

function randomMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!OPENAI_API_KEY) { console.error('请设置 OPENAI_API_KEY'); process.exit(1); }

  console.log('\n\x1b[1m  OpenClaw — 抖音全自动社交系统\x1b[0m\n');

  // 品味
  let taste = loadTasteProfile();
  if (!taste || !taste.summary) {
    taste = await trainTaste();
  } else {
    console.log(`[品味] ${taste.summary}`);
  }

  // 浏览器
  const session = await launchBrowser('https://live.douyin.com');
  const { page } = session;

  // 发现
  let discovered = await discoverStreamers(page, taste, 8);
  setDiscovered(discovered.length);

  if (discovered.length === 0) {
    console.log('[发现] 未找到符合的主播。用默认品味重试...');
    taste = { descriptions: [], summary: '年轻女性主播', updatedAt: Date.now() };
    discovered = await discoverStreamers(page, taste, 8);
    setDiscovered(discovered.length);
  }

  const visited = new Set<string>();  // 本轮已访问（每 5 个清空一次允许回访）
  let visitCount = 0;

  process.on('SIGINT', async () => {
    printDashboard();
    await closeBrowser(session);
    process.exit(0);
  });

  // ─── 主循环 ───
  while (true) {
    // 选下一个
    let target = pickNext(discovered, visited);

    if (!target) {
      printDashboard();
      console.log('[调度] 重新发现...');
      await page.goto('https://live.douyin.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      const more = await discoverStreamers(page, taste!, 8);
      discovered.push(...more);
      setDiscovered(discovered.length);
      if (more.length === 0) { console.log('[调度] 等待 3 分钟...'); await sleep(180_000); }
      continue;
    }

    visited.add(target.url);
    visitCount++;
    // 每访问 5 个直播间，清空 visited 允许回访
    if (visitCount % 5 === 0) visited.clear();

    // 进入直播间
    try {
      await navigateToStream(page, target.url);
    } catch (e: any) {
      console.log(`[调度] 导航失败: ${e.message}`);
      continue;
    }

    const roomCtx = await parseRoomContext(page);
    if (!roomCtx) { console.log('[调度] 解析失败，跳过'); continue; }

    // 录播/回放检测：检查页面是否有实时互动元素
    const isLive = await page.evaluate(() => {
      // 检查是否有弹幕输入框（录播通常没有）
      var hasInput = !!document.querySelector('[contenteditable="true"]') ||
        !!document.querySelector('input[placeholder*="说点什么"]') ||
        !!document.querySelector('[class*="chatroom___input"]');
      // 检查是否有"录播"/"回放"标记
      var pageText = document.body?.innerText?.slice(0, 2000) || '';
      var isReplay = pageText.includes('录播') || pageText.includes('回放') || pageText.includes('重播');
      // 检查聊天区是否存在
      var hasChat = !!document.querySelector('[class*="webcast-chatroom"]');
      return hasInput && hasChat && !isReplay;
    });

    if (!isLive) {
      console.log(`[调度] ${roomCtx.streamerName} 疑似录播/回放，跳过`);
      continue;
    }

    const memory = recordVisit(roomCtx.streamerName);
    addVisited(roomCtx.streamerName);
    setCurrent(roomCtx.streamerName);

    // 注入 UI
    try { await injectSubtitleOverlay(page); } catch {}

    console.log(`\n[进入] ${roomCtx.streamerName} | 评分:${target.score}/10 | ${memory.relationship} | 第${memory.visitCount}次\n`);

    // 启动监听
    const myReplies: string[] = [];
    let mentionedMe = false;
    const executedActions = new Set<string>();
    let profileUrl: string | null = null;
    let giftCountThisRoom = 0;

    try {
      // 先抓主播主页链接（后面发私信用）
      profileUrl = await getStreamerProfileUrl(page);

      await startMonitor(page, (msg: DanmakuMessage) => {
        incDanmaku();
        const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const pfx = msg.isStreamer ? '\x1b[31m[主播]\x1b[0m' : '\x1b[36m[弹幕]\x1b[0m';
        console.log(`${ts} ${pfx} ${msg.sender}: ${msg.content}`);
      });

      await startVoiceMonitor(page, async (voiceText: string) => {
        try { await showVoiceSubtitle(page, voiceText); } catch {}

        // 被提到
        if (/tapool|TAP|tap|太婆/i.test(voiceText) && !mentionedMe) {
          mentionedMe = true;
          recordStreamerFeedback(roomCtx.streamerName, voiceText);
          try { await showInfoSubtitle(page, '⭐ 主播提到了你！', 'rgba(241,196,15,0.9)'); } catch {}
        }

        // 语音触发即时回复：主播说了话就尝试回复（冷却 40 秒）
        const now = Date.now();
        if (now - lastReply >= 40_000) {
          try {
            const ctx = (await parseRoomContext(page).catch(() => null)) || roomCtx;
            const suggestions = await generateSuggestions(OPENAI_API_KEY, ctx, getHistory(), getTranscriptHistory(), myReplies);
            const valid = suggestions.filter(s => !isDuplicate(roomCtx.streamerName, s.text));
            if (valid.length > 0) {
              lastReply = now;
              const pick = valid[Math.floor(Math.random() * valid.length)];
              console.log(`\x1b[33m[AI]\x1b[0m "${pick.text}" \x1b[90m(${pick.reason})\x1b[0m`);
              try { await showInfoSubtitle(page, `💬 ${pick.text}`); } catch {}
              const sent = await sendDanmaku(page, pick.text);
              if (sent) { myReplies.push(pick.text); recordMyMessage(roomCtx.streamerName, pick.text); incReply(); }
            }
          } catch {}
        }

        // 指令
        for (const a of detectActions(voiceText)) {
          if (executedActions.has(a)) continue;
          try {
            if (a === 'follow') { executedActions.add(a); await followStreamer(page); }
            else if (a === 'join_fan_club') { executedActions.add(a); await joinFanClub(page); }
            else if (a === 'like') { await likeStream(page); }
          } catch {}
        }

        // 动态送礼（每个直播间最多 2 次，AI 决定金额）
        if (canAfford(1) && giftCountThisRoom < 2) {
          try {
            const d = await shouldSendGift(OPENAI_API_KEY, voiceText, roomCtx.streamerName);
            if (d.should) {
              const ru = getRoomUnderstanding();
              const level = await decideGiftLevel(voiceText, roomCtx.streamerName, memory.relationship, ru.mood || '正常');
              giftCountThisRoom++;
              console.log(`\x1b[35m[送礼]\x1b[0m AI 决定: ≤${level.maxDiamonds}钻 (${level.reason})`);
              try { await showInfoSubtitle(page, `🎁 ${level.reason} (≤${level.maxDiamonds}钻)`, 'rgba(231,76,60,0.85)'); } catch {}
              const result = await sendGiftByBudget(page, level.maxDiamonds);
              if (result.sent) {
                recordSpending(result.diamonds, roomCtx.streamerName, result.name);
                incGift();
                console.log(`\x1b[35m[送礼]\x1b[0m 已送 ${result.name} (${result.diamonds}钻 = ¥${(result.diamonds * 0.1).toFixed(1)})`);
              }
            }
          } catch {}
        }
      });

      try { await startRoomAnalysis(page, roomCtx.streamerName, getHistory, getTranscriptHistory); } catch {}
    } catch (e: any) {
      console.log(`[监听] 启动失败: ${e.message}，跳过`);
      continue;
    }

    // 停留 + 互动
    const stayMs = calculateStayDuration();
    const leaveAt = Date.now() + stayMs;
    console.log(`[调度] 停留 ${Math.round(stayMs / 60000)} 分钟\n`);

    // 第一次进入 20 秒后打招呼
    let lastReply = Date.now() - randomMs(100_000, 220_000);
    let firstGreetSent = false;

    // 20 秒后发第一条打招呼
    setTimeout(async () => {
      if (firstGreetSent) return;
      firstGreetSent = true;
      try {
        const greetings = ['来了来了', '晚上好呀', '路过看看', '刚到', '嗨'];
        const pick = greetings[Math.floor(Math.random() * greetings.length)];
        console.log(`\x1b[33m[AI]\x1b[0m "${pick}" \x1b[90m(打招呼)\x1b[0m`);
        const sent = await sendDanmaku(page, pick);
        if (sent) { myReplies.push(pick); recordMyMessage(roomCtx.streamerName, pick); incReply(); }
      } catch {}
    }, 20_000);

    let noReplyStreak = 0; // AI 连续判断不该回复的次数

    while (Date.now() < leaveAt) {
      await sleep(10_000);

      // 如果连续 5 次 AI 都认为不该回复（唱歌直播间），提前离开
      if (noReplyStreak >= 5 && Date.now() - lastReply > 120_000) {
        console.log(`[调度] 互动机会少（可能是唱歌直播间），提前离开`);
        break;
      }

      // 检查页面是否还在直播间
      try {
        const url = page.url();
        if (!url.includes('live.douyin.com')) { console.log('[调度] 页面离开了直播间'); break; }
      } catch { break; }

      const now = Date.now();
      const interval = mentionedMe ? 5000 : randomMs(45_000, 90_000);
      if (now - lastReply < interval || !OPENAI_API_KEY) continue;

      const history = getHistory();
      const voice = getTranscriptHistory();
      if (history.length < 2 && voice.length < 1) continue;

      try {
        lastReply = now;
        if (mentionedMe) mentionedMe = false;

        const ctx = (await parseRoomContext(page).catch(() => null)) || roomCtx;
        const suggestions = await generateSuggestions(OPENAI_API_KEY, ctx, history, voice, myReplies);
        const valid = suggestions.filter(s => !isDuplicate(roomCtx.streamerName, s.text));

        if (valid.length > 0) {
          noReplyStreak = 0;
          const pick = valid[Math.floor(Math.random() * valid.length)];
          console.log(`\x1b[33m[AI]\x1b[0m "${pick.text}" \x1b[90m(${pick.reason})\x1b[0m`);
          try { await showInfoSubtitle(page, `💬 ${pick.text}`); } catch {}
          const sent = await sendDanmaku(page, pick.text);
          if (sent) {
            myReplies.push(pick.text);
            recordMyMessage(roomCtx.streamerName, pick.text);
            incReply();
          }
        } else {
          noReplyStreak++;
        }
      } catch {}
    }

    // 离开：尝试发私信
    if (shouldSendDM(roomCtx.streamerName) && profileUrl) {
      try {
        console.log(`\n[私信] 关系=${memory.relationship}，发送破冰消息...`);
        const ok = await sendDirectMessage(page, profileUrl, roomCtx.streamerName);
        if (ok) addDM(roomCtx.streamerName);
      } catch (e: any) {
        console.log(`[私信] 失败: ${e.message}`);
      }
    }

    // 保存主页链接到记忆，方便后续检查私信回复
    if (profileUrl) {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const memFile = path.join(os.homedir(), '.thomas-claw-memory.json');
        const memData = JSON.parse(fs.readFileSync(memFile, 'utf8'));
        if (memData.streamers[roomCtx.streamerName]) {
          memData.streamers[roomCtx.streamerName].profileUrl = profileUrl;
          fs.writeFileSync(memFile, JSON.stringify(memData, null, 2));
        }
      } catch {}
    }

    setCurrent('');
    printDashboard();

    // 每 3 轮检查一次私信回复
    if (visitCount % 3 === 0) {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const memFile = path.join(os.homedir(), '.thomas-claw-memory.json');
        const memData = JSON.parse(fs.readFileSync(memFile, 'utf8'));

        for (const [name, mem] of Object.entries(memData.streamers || {}) as [string, any][]) {
          const hasDM = mem.myMessages?.some((m: string) => m.startsWith('[私信]'));
          const pUrl = mem.profileUrl;
          if (!hasDM || !pUrl) continue;

          console.log(`[私信检查] 检查 ${name} 是否有回复...`);
          try {
            const replied = await checkAndReplyDMs(page, pUrl, name);
            if (replied) addDM(name);
          } catch {}
        }
      } catch {}
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
