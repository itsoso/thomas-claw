import { ChatSuggestionItem, LiveRoomContext, DanmakuMessage } from '../shared/types';

const SYSTEM_PROMPT = `你是一个直播间弹幕高手，目标是帮用户(昵称tapool)在女主播直播间里建立存在感、留下深刻印象。

## 核心策略
- 做直播间里最有趣的人，不是最殷勤的
- 幽默、机智、有个性，让主播主动想跟你聊
- 对主播说的话做精准回应，不泛泛而谈
- 适当调侃（善意），制造记忆点
- 如果主播提到了"tapool"或读了你的弹幕，抓住机会深入互动
- 绝不舔、不跪、不表白

## 风格
- 像一个有趣的、见过世面的朋友
- 短、精、准，不废话
- 不用"哥/姐/亲/宝"
- 偶尔幽默调侃，偶尔认真走心

## 重要
- 如果"主播语音"内容明显是歌词（有韵律、不像对话），输出空数组 []，不要回复歌词
- 如果主播在放自动语音/广告（"点赞订阅转发"之类），也输出空数组 []
- 只回复主播真正在说话/聊天/互动的内容

## 输出
- 生成 1-3 条候选弹幕（如果不该回复就返回空数组 []）
- 每条不超过 15 个字
- JSON 数组，含 text 和 reason 字段`;

function buildUserPrompt(
  context: LiveRoomContext,
  recentDanmaku: DanmakuMessage[],
  voiceTranscripts: string[],
  myRecentReplies: string[],
): string {
  const danmakuText = recentDanmaku
    .slice(-8)
    .map((d) => `${d.isStreamer ? '[主播]' : ''}${d.sender}: ${d.content}`)
    .join('\n');

  const voiceText = voiceTranscripts.length > 0
    ? '\n主播语音（可能是说话也可能是歌词，请判断）：\n' + voiceTranscripts.slice(-3).join('\n')
    : '';

  const myReplies = myRecentReplies.length > 0
    ? '\n我(tapool)最近发过的弹幕（避免重复类似的话）：\n' + myRecentReplies.slice(-5).join('\n')
    : '';

  return `直播间：${context.streamerName}
${voiceText}

最近弹幕：
${danmakuText || '（暂无）'}
${myReplies}

如果主播在唱歌/放歌/放自动语音，返回 []。否则生成 1-2 条有趣的弹幕。直接输出 JSON。`;
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
      max_tokens: 200,
      temperature: 0.9,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(context, recentDanmaku, voiceTranscripts, myRecentReplies) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI: ${response.status}`);

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '[]';
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];
  const result = JSON.parse(jsonMatch[0]) as ChatSuggestionItem[];
  return result;
}

/** 判断是否是送礼好时机 */
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
      messages: [
        {
          role: 'system',
          content: `判断是否值得送小礼物(1毛钱)。只在这些情况送：主播直接感谢tapool、主播唱完一首歌、主播说要下播。其他都不送。如果是歌词/背景音乐也不送。JSON: {"should":true/false,"reason":""}`,
        },
        { role: 'user', content: `${streamerName}说：「${voiceText}」` },
      ],
    }),
  });

  if (!response.ok) return { should: false, reason: '' };
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const match = text.match(/\{[\s\S]*?\}/);
    return match ? JSON.parse(match[0]) : { should: false, reason: '' };
  } catch {
    return { should: false, reason: '' };
  }
}
