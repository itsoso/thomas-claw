import { ChatSuggestionItem, LiveRoomContext, DanmakuMessage } from '../shared/types';
import { getRoomUnderstanding } from './room-context';
import { PERSONA, getMemory } from './persona';

function buildSystemPrompt(streamerName: string): string {
  const mem = getMemory(streamerName);
  const relationDesc = {
    stranger: '第一次来这个直播间，先观察氛围再自然加入',
    newcomer: '来过几次了，可以稍微熟络一点',
    regular: '常客了，可以开一些熟人之间的玩笑',
    familiar: '老朋友了，聊天可以更随意和深入',
  }[mem.relationship];

  const feedbackInfo = mem.streamerFeedback.length > 0
    ? `\n主播之前对你的反应：${mem.streamerFeedback.slice(-3).join('；')}`
    : '';

  return `你是"${PERSONA.nickname}"，${PERSONA.identity}。${PERSONA.style}。
兴趣爱好：${PERSONA.interests.join('、')}。

你在${streamerName}的直播间。${relationDesc}。来过${mem.visitCount}次。
${feedbackInfo}

## 规则
${PERSONA.dontDo.map(d => '- ' + d).join('\n')}
- 如果主播语音是歌词/背景音乐/自动广告语，返回空数组 []
- 如果没什么好说的，也返回 []，沉默比废话好
- 如果主播提到了你(tapool/太婆/tap)，一定要回应，抓住机会
- 回复要结合直播间画像和上下文

## 输出
- 0-2 条弹幕，JSON 数组 [{text, reason}]，每条 ≤15 字`;
}

function buildUserPrompt(
  context: LiveRoomContext,
  recentDanmaku: DanmakuMessage[],
  voiceTranscripts: string[],
  myRecentReplies: string[],
): string {
  const understanding = getRoomUnderstanding();
  const roomInfo = [
    understanding.appearance ? `画面：${understanding.appearance}` : '',
    understanding.currentActivity ? `正在：${understanding.currentActivity}` : '',
    understanding.mood ? `情绪：${understanding.mood}` : '',
    understanding.hotTopics.length ? `话题：${understanding.hotTopics.join('、')}` : '',
  ].filter(Boolean).join('\n');

  const voiceText = voiceTranscripts.length > 0
    ? '\n主播语音（判断是说话还是歌词）：\n' + voiceTranscripts.slice(-3).join('\n')
    : '';

  const danmakuText = recentDanmaku.slice(-8)
    .map(d => `${d.sender}: ${d.content}`).join('\n');

  const myReplies = myRecentReplies.length > 0
    ? '\n我最近发的（不要重复类似的话）：\n' + myRecentReplies.slice(-5).join('\n')
    : '';

  return `${roomInfo ? '直播间画像：\n' + roomInfo + '\n' : ''}${voiceText}

弹幕：
${danmakuText || '（无）'}${myReplies}

输出 JSON 数组。不该说话时返回 []。`;
}

export async function generateSuggestions(
  apiKey: string,
  context: LiveRoomContext,
  recentDanmaku: DanmakuMessage[],
  voiceTranscripts: string[] = [],
  myRecentReplies: string[] = [],
): Promise<ChatSuggestionItem[]> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      temperature: 0.9,
      messages: [
        { role: 'system', content: buildSystemPrompt(context.streamerName) },
        { role: 'user', content: buildUserPrompt(context, recentDanmaku, voiceTranscripts, myRecentReplies) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI: ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '[]';
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  return JSON.parse(match[0]) as ChatSuggestionItem[];
}

/** 送礼判断 */
export async function shouldSendGift(
  apiKey: string,
  voiceText: string,
  streamerName: string,
): Promise<{ should: boolean; reason: string }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      messages: [{
        role: 'system',
        content: `只在这些情况送小礼物：主播直接感谢tapool、唱完整首歌、说要下播。歌词/广告不送。JSON:{"should":false,"reason":""}`,
      }, {
        role: 'user',
        content: `${streamerName}说：「${voiceText}」`,
      }],
    }),
  });

  if (!response.ok) return { should: false, reason: '' };
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const m = text.match(/\{[\s\S]*?\}/);
    return m ? JSON.parse(m[0]) : { should: false, reason: '' };
  } catch { return { should: false, reason: '' }; }
}
