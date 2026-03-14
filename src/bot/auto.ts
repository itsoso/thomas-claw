/**
 * 全自动模式入口：发现 → 进入 → 互动 → 切换 → 循环
 */
import { launchBrowser, closeBrowser } from './browser';
import { trainTaste, loadTasteProfile } from './taste';
import { discoverStreamers, DiscoveredStreamer } from './discover';
import { parseRoomContext } from './room-parser';
import { startMonitor, getHistory } from './danmaku-monitor';
import { sendDanmaku } from './danmaku-sender';
import { sendCheapGift } from './gift-sender';
import { startVoiceMonitor, getTranscriptHistory } from './voice-monitor';
import { injectSubtitleOverlay, showVoiceSubtitle, showInfoSubtitle } from './subtitle-overlay';
import { followStreamer, joinFanClub, likeStream, detectActions } from './auto-actions';
import { startRoomAnalysis, getRoomUnderstanding } from './room-context';
import { recordVisit, recordMyMessage, recordStreamerFeedback, isDuplicate } from './persona';
import { getStreamerProfileUrl, sendDirectMessage, shouldSendDM } from './messenger';
import { generateSuggestions, shouldSendGift } from './ai-suggest';
import { canAfford, recordSpending, getBudgetStatus } from './budget';
import { pickNext, calculateStayDuration, navigateToStream } from './scheduler';
import { DanmakuMessage } from '../shared/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

function randomInterval(minMs: number, maxMs: number): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('请设置 OPENAI_API_KEY 环境变量');
    process.exit(1);
  }

  console.log('\n╔════════════════════════════════════╗');
  console.log('║  OpenClaw — 抖音全自动社交系统      ║');
  console.log('╚════════════════════════════════════╝\n');

  // 1. 品味训练
  let taste = loadTasteProfile();
  if (!taste || taste.descriptions.length === 0) {
    taste = await trainTaste();
  } else {
    console.log(`[品味] 已加载画像: ${taste.summary}`);
  }

  // 2. 启动浏览器
  const session = await launchBrowser('https://live.douyin.com');
  const { page } = session;

  // 3. 发现主播
  const discovered = await discoverStreamers(page, taste, 10);
  if (discovered.length === 0) {
    console.log('[发现] 未找到符合品味的主播，请检查品味训练图片');
    await closeBrowser(session);
    process.exit(1);
  }

  // 4. 开始自动循环
  const visited = new Set<string>();
  let totalInteractions = 0;

  process.on('SIGINT', async () => {
    const budget = getBudgetStatus();
    console.log(`\n\n[结束] 互动 ${totalInteractions} 次 | 花费 ¥${budget.spent}/${budget.limit} | 送礼 ${budget.count} 次`);
    await closeBrowser(session);
    process.exit(0);
  });

  while (true) {
    // 选择下一个直播间
    const target = pickNext(discovered, visited);
    if (!target) {
      console.log('[调度] 所有推荐主播已访问，重新发现...');
      const newDiscovered = await discoverStreamers(page, taste, 10);
      discovered.push(...newDiscovered);
      if (newDiscovered.length === 0) {
        console.log('[调度] 没有更多主播，等待 5 分钟...');
        await sleep(300_000);
        continue;
      }
      continue;
    }

    visited.add(target.url);
    await navigateToStream(page, target.url);

    // 解析直播间
    const roomCtx = await parseRoomContext(page);
    if (!roomCtx) {
      console.log('[调度] 无法解析直播间，跳过');
      continue;
    }

    const memory = recordVisit(roomCtx.streamerName);
    await injectSubtitleOverlay(page);

    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  ${roomCtx.streamerName.padEnd(34)}║`);
    console.log(`║  评分: ${target.score}/10 | ${target.reason.padEnd(24)}║`);
    console.log(`║  关系: ${memory.relationship} | 第${memory.visitCount}次来访${' '.repeat(16)}║`);
    console.log(`╚══════════════════════════════════════╝\n`);

    // 启动监听
    let danmakuCount = 0;
    const myReplies: string[] = [];
    let mentionedMe = false;
    const executedActions = new Set<string>();

    await startMonitor(page, (msg: DanmakuMessage) => {
      danmakuCount++;
      const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const prefix = msg.isStreamer ? '\x1b[31m[主播]\x1b[0m' : '\x1b[36m[弹幕]\x1b[0m';
      console.log(`${ts} ${prefix} ${msg.sender}: ${msg.content}`);
    });

    await startVoiceMonitor(page, async (voiceText: string) => {
      await showVoiceSubtitle(page, voiceText);

      // 检测提到我
      if (voiceText.includes('tapool') || voiceText.includes('TAP') || voiceText.includes('太婆')) {
        if (!mentionedMe) {
          mentionedMe = true;
          recordStreamerFeedback(roomCtx.streamerName, voiceText);
          await showInfoSubtitle(page, '⭐ 主播提到了你！', 'rgba(241,196,15,0.9)');
        }
      }

      // 自动动作
      const actions = detectActions(voiceText);
      for (const a of actions) {
        if (executedActions.has(a)) continue;
        if (a === 'follow') { executedActions.add(a); await followStreamer(page); }
        else if (a === 'join_fan_club') { executedActions.add(a); await joinFanClub(page); }
        else if (a === 'like') { await likeStream(page); }
      }

      // 智能送礼
      if (canAfford(1)) {
        try {
          const decision = await shouldSendGift(OPENAI_API_KEY, voiceText, roomCtx.streamerName);
          if (decision.should) {
            await showInfoSubtitle(page, `🎁 ${decision.reason}`, 'rgba(231,76,60,0.85)');
            await sendCheapGift(page);
            recordSpending(1, roomCtx.streamerName, '小心心');
          }
        } catch {}
      }
    });

    await startRoomAnalysis(page, roomCtx.streamerName, getHistory, getTranscriptHistory);

    // 计算停留时间
    const stayDuration = calculateStayDuration();
    const leaveAt = Date.now() + stayDuration;
    console.log(`[调度] 将在此停留 ${Math.round(stayDuration / 60000)} 分钟\n`);

    // 互动循环
    let lastReply = 0;
    while (Date.now() < leaveAt) {
      await sleep(10_000);

      const now = Date.now();
      const replyInterval = mentionedMe ? 5000 : randomInterval(120_000, 240_000);
      if (now - lastReply < replyInterval) continue;

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
          const pick = valid[Math.floor(Math.random() * valid.length)];
          console.log(`\x1b[33m[AI]\x1b[0m "${pick.text}" \x1b[90m(${pick.reason})\x1b[0m`);
          await showInfoSubtitle(page, `💬 ${pick.text}`);
          await sendDanmaku(page, pick.text);
          myReplies.push(pick.text);
          recordMyMessage(roomCtx.streamerName, pick.text);
          totalInteractions++;
        }
      } catch {}
    }

    // 离开前：如果关系够了，发私信
    if (shouldSendDM(roomCtx.streamerName)) {
      const profileUrl = await getStreamerProfileUrl(page);
      if (profileUrl) {
        console.log(`\n[私信] 关系已到 ${memory.relationship}，尝试发私信...`);
        await sendDirectMessage(page, profileUrl, roomCtx.streamerName);
      }
    }

    const budget = getBudgetStatus();
    console.log(`\n[调度] 离开 ${roomCtx.streamerName} | 弹幕:${danmakuCount} | 互动:${totalInteractions} | 花费:¥${budget.spent}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
