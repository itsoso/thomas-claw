import readline from 'readline';
import { launchBrowser, closeBrowser, BrowserSession } from './browser';
import { parseRoomContext } from './room-parser';
import { startMonitor, getHistory } from './danmaku-monitor';
import { sendDanmaku } from './danmaku-sender';
import { sendCheapGift, sendGiftByName, listGifts } from './gift-sender';
import { startVoiceMonitor, getTranscriptHistory } from './voice-monitor';
import { injectSubtitleOverlay, showVoiceSubtitle, showInfoSubtitle } from './subtitle-overlay';
import { followStreamer, joinFanClub, likeStream, detectActions } from './auto-actions';
import { startRoomAnalysis, getRoomUnderstanding } from './room-context';
import { recordVisit, recordMyMessage, recordStreamerFeedback, isDuplicate, getMemory } from './persona';
import { generateSuggestions, shouldSendGift } from './ai-suggest';
import { DanmakuMessage } from '../shared/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const isTTY = process.stdin.isTTY;

const GIFT_COOLDOWN = 300_000;     // 送礼冷却 5 分钟
const STATUS_INTERVAL = 120_000;

// 随机间隔：2-4 分钟
function randomReplyInterval(): number {
  return 120_000 + Math.floor(Math.random() * 120_000);
}

async function main() {
  const liveUrl = process.argv[2];
  if (!liveUrl || !liveUrl.includes('live.douyin.com')) {
    console.log('用法: npm start -- <直播间URL>');
    process.exit(1);
  }

  let session: BrowserSession;
  try {
    session = await launchBrowser(liveUrl);
  } catch (e: any) {
    console.error('启动失败:', e.message);
    process.exit(1);
  }

  const { page } = session;
  const roomContext = await parseRoomContext(page);
  if (!roomContext) {
    console.error('无法解析直播间');
    await closeBrowser(session);
    process.exit(1);
  }

  await injectSubtitleOverlay(page);

  // 记录访问 + 加载记忆
  const memory = recordVisit(roomContext.streamerName);

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Thomas Claw — 抖音直播助手                 ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  主播: ${roomContext.streamerName.padEnd(34)}║`);
  console.log(`║  房间: ${roomContext.roomId.padEnd(34)}║`);
  console.log(`║  关系: ${memory.relationship.padEnd(34)}║`);
  console.log(`║  来访: 第${memory.visitCount}次${' '.repeat(30 - String(memory.visitCount).length)}║`);
  console.log('╚════════════════════════════════════════════╝\n');

  let danmakuCount = 0;
  let lastAutoReply = 0;
  let nextReplyDelay = randomReplyInterval();
  let lastGiftTime = 0;
  let giftCount = 0;
  const myReplies: string[] = [];            // 我发过的弹幕
  const executedActions = new Set<string>();  // 已执行的动作
  let mentionedMe = false;                   // 主播是否提到我

  // 1. 弹幕监听
  await startMonitor(page, (msg: DanmakuMessage) => {
    danmakuCount++;
    const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const prefix = msg.isStreamer ? '\x1b[31m[主播]\x1b[0m' : '\x1b[36m[弹幕]\x1b[0m';
    console.log(`${ts} ${prefix} ${msg.sender}: ${msg.content}`);
  });

  // 2. 主播语音监听
  await startVoiceMonitor(page, async (voiceText: string) => {
    await showVoiceSubtitle(page, voiceText);

    // 检测主播是否提到我
    if (voiceText.includes('tapool') || voiceText.includes('TAP') ||
        voiceText.includes('tap') || voiceText.includes('太婆')) {
      if (!mentionedMe) {
        mentionedMe = true;
        console.log(`\x1b[32m[注意]\x1b[0m 主播提到了你！`);
        await showInfoSubtitle(page, '⭐ 主播提到了你！', 'rgba(241,196,15,0.9)');
        recordStreamerFeedback(roomContext.streamerName, voiceText);
        lastAutoReply = 0;
      }
    }

    // 检测主播指令
    const actions = detectActions(voiceText);
    for (const action of actions) {
      if (executedActions.has(action)) continue;

      if (action === 'follow') {
        executedActions.add(action);
        console.log(`\x1b[32m[指令]\x1b[0m 关注`);
        await showInfoSubtitle(page, '👆 关注中...', 'rgba(46,204,113,0.85)');
        await followStreamer(page);
      } else if (action === 'join_fan_club') {
        executedActions.add(action);
        console.log(`\x1b[32m[指令]\x1b[0m 加团`);
        await showInfoSubtitle(page, '⭐ 加团中...', 'rgba(46,204,113,0.85)');
        await joinFanClub(page);
      } else if (action === 'like') {
        // 点赞可以重复执行
        console.log(`\x1b[32m[指令]\x1b[0m 点赞`);
        await likeStream(page);
        await likeStream(page);
        await likeStream(page);
      }
    }

    // 智能送礼
    const now = Date.now();
    if (OPENAI_API_KEY && now - lastGiftTime >= GIFT_COOLDOWN) {
      try {
        const decision = await shouldSendGift(OPENAI_API_KEY, voiceText, roomContext.streamerName);
        if (decision.should) {
          lastGiftTime = now;
          giftCount++;
          console.log(`\x1b[33m[送礼]\x1b[0m ${decision.reason}`);
          await showInfoSubtitle(page, `🎁 ${decision.reason}`, 'rgba(231,76,60,0.85)');
          await sendCheapGift(page);
        }
      } catch {}
    }
  });

  // 3. 直播间持续理解
  await startRoomAnalysis(page, roomContext.streamerName, getHistory, getTranscriptHistory);

  // ─── 非交互模式 ───
  if (!isTTY) {
    console.log('[模式] 全自动 — 随机节奏回复 + 语音字幕 + 智能送礼\n');

    // AI 回复循环
    setInterval(async () => {
      const now = Date.now();
      const elapsed = now - lastAutoReply;

      // 主播提到我时立即回复，否则等随机间隔
      const shouldReply = mentionedMe || elapsed >= nextReplyDelay;
      if (!shouldReply || !OPENAI_API_KEY) return;

      const history = getHistory();
      const voice = getTranscriptHistory();
      if (history.length < 2 && voice.length < 1) return;

      try {
        lastAutoReply = now;
        nextReplyDelay = randomReplyInterval();
        if (mentionedMe) {
          nextReplyDelay = 5000; // 被提到时快速回复
          mentionedMe = false;
        }

        const ctx = (await parseRoomContext(page).catch(() => null)) || roomContext;
        const suggestions = await generateSuggestions(OPENAI_API_KEY, ctx, history, voice, myReplies);

        if (suggestions.length > 0) {
          // 去重：过滤掉跟最近发过的太像的
          const valid = suggestions.filter(s => !isDuplicate(roomContext.streamerName, s.text));
          const pick = valid.length > 0
            ? valid[Math.floor(Math.random() * valid.length)]
            : null;

          if (pick) {
            console.log(`\n\x1b[33m[AI]\x1b[0m "${pick.text}" \x1b[90m(${pick.reason})\x1b[0m`);
            await showInfoSubtitle(page, `💬 ${pick.text}`);
            await sendDanmaku(page, pick.text);
            myReplies.push(pick.text);
            if (myReplies.length > 10) myReplies.shift();
            recordMyMessage(roomContext.streamerName, pick.text);
          }
        }
      } catch (e: any) {
        console.log(`[AI] ${e.message}`);
      }
    }, 10_000);

    // 状态
    setInterval(async () => {
      const ru = getRoomUnderstanding();
      console.log(`\n[状态] ${new Date().toLocaleTimeString('zh-CN')} | 弹幕:${danmakuCount} | 语音:${getTranscriptHistory().length} | 送礼:${giftCount} | 下次回复:${Math.round(nextReplyDelay/1000)}s`);
      if (ru.currentActivity) console.log(`[画像] ${ru.currentActivity} | ${ru.mood} | ${ru.hotTopics.join(',')}`);
    }, STATUS_INTERVAL);

    process.on('SIGINT', async () => {
      console.log('\n[退出]');
      await closeBrowser(session);
      process.exit(0);
    });

    await new Promise(() => {});
    return;
  }

  // ─── 交互模式 ───
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\x1b[33m> \x1b[0m' });
  console.log(`\n命令: s=AI建议 | d <文>=发弹幕 | g=送礼 | gl=礼物列表 | i=信息 | q=退出\n`);
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    const [cmd, ...args] = input.split(' ');
    const arg = args.join(' ');
    try {
      switch (cmd) {
        case 's': {
          const sug = await generateSuggestions(OPENAI_API_KEY, roomContext, getHistory(), getTranscriptHistory(), myReplies);
          sug.forEach((s, i) => console.log(`  ${i+1}. "${s.text}" — ${s.reason}`));
          const ans = await new Promise<string>(r => rl.question('选择: ', r));
          const idx = parseInt(ans.trim()) - 1;
          if (idx >= 0 && idx < sug.length) { await sendDanmaku(page, sug[idx].text); myReplies.push(sug[idx].text); }
          break;
        }
        case 'd': if (arg) { await sendDanmaku(page, arg); myReplies.push(arg); } break;
        case 'g': arg ? await sendGiftByName(page, arg) : await sendCheapGift(page); break;
        case 'gl': (await listGifts(page)).forEach((g, i) => console.log(`  ${i+1}. ${g.name} (${g.price})`)); break;
        case 'i': {
          const c = await parseRoomContext(page); const v = getTranscriptHistory();
          console.log(`  主播: ${c?.streamerName}\n  弹幕: ${getHistory().length}\n  语音: ${v.length}\n  送礼: ${giftCount}\n  我的回复: ${myReplies.length}`);
          break;
        }
        case 'q': await closeBrowser(session); process.exit(0);
        default: await sendDanmaku(page, input); myReplies.push(input);
      }
    } catch (e: any) { console.error(e.message); }
    rl.prompt();
  });
  rl.on('close', async () => { await closeBrowser(session); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
