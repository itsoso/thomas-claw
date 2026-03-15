import { ChatSuggestionItem, LiveRoomContext, DanmakuMessage } from '../shared/types';
import { getRoomUnderstanding } from './room-context';
import { PERSONA, getMemory } from './persona';

function buildSystemPrompt(streamerName: string): string {
  const mem = getMemory(streamerName);
  const relationDesc = {
    stranger: '第一次来，先观察再出手',
    newcomer: '来过几次了，可以稍微熟络',
    regular: '常客了，可以开熟人之间的玩笑',
    familiar: '老朋友了，随意聊',
  }[mem.relationship];

  const feedbackInfo = mem.streamerFeedback.length > 0
    ? `\n主播之前对你的反应：${mem.streamerFeedback.slice(-3).join('；')}`
    : '';

  return `你是抖音直播间的活跃观众"${PERSONA.nickname}"。${relationDesc}。来过${mem.visitCount}次。
${feedbackInfo}

## 核心风格
- 短句为王：每条弹幕5-15字，绝不超过20字
- 自信不舔：像老朋友聊天，不是粉丝仰望
- 略带撩人：暧昧留白、双关语、幽默调侃
- 及时接话：主播说什么立刻接，保持节奏
- 护花使者：有人黑主播时用幽默化解

## 绝对不能
- 发超过20字的长句
- 连续发类似的夸奖（"好听""真棒""太美"不能连着发）
- 像AI一样有固定句式
- 正式语言（不说"我觉得""非常好"这种）
- 主播在弹琴/唱歌/演奏且不说话时疯狂发弹幕

## 经典参考（不要机械套用）
夸人："笑不笑都好看 这就是实力" / "不是美颜亮 是人发光"
撩人："遇到好看的就不高冷了 怪我咯" / "被你看穿了 确实在偷偷观察"
调侃："一看就走不了了" / "笑场了就对了 高冷人设崩了"
接话："你猜" / "来自你的粉丝团" / "说多了怕你骄傲"

## 频率
- 主播直接跟你说话 → 立刻回，每条间隔5-8秒
- 主播跟别人聊/唱歌 → 每30-60秒最多一条
- 连续3条没人回应 → 停下来等

## 输出
- 直接输出一条弹幕文本（JSON: [{"text":"...", "reason":"..."}]）
- 不该发言时返回空数组 []
- 主播语音是歌词/背景音乐/广告 → 返回 []`;
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
  ].filter(Boolean).join('\n');

  const voiceText = voiceTranscripts.length > 0
    ? '\n[字幕] ' + voiceTranscripts.slice(-3).join(' | ')
    : '';

  const danmakuText = recentDanmaku.slice(-15)
    .map(d => `${d.sender}: ${d.content}`).join('\n');

  const myReplies = myRecentReplies.length > 0
    ? '\n我最近发的（不要重复类似的）：' + myRecentReplies.slice(-5).join(' | ')
    : '';

  return `${roomInfo}${voiceText}

[弹幕]
${danmakuText || '（无）'}${myReplies}

输出一条弹幕或[]。`;
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
      max_tokens: 100,
      temperature: 0.95,
      messages: [
        { role: 'system', content: buildSystemPrompt(context.streamerName) },
        { role: 'user', content: buildUserPrompt(context, recentDanmaku, voiceTranscripts, myRecentReplies) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI: ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '[]';

  // 支持两种格式：JSON 数组 或 纯文本
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed as ChatSuggestionItem[];
  }

  // 纯文本回复（非[等待]）
  const trimmed = text.trim();
  if (trimmed && !trimmed.includes('[等待]') && trimmed.length <= 20) {
    return [{ text: trimmed, reason: '直觉回复' }];
  }

  return [];
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
        content: `判断是否值得送小礼物。只在这些情况送：主播直接感谢小西瓜、唱完整首歌、说要下播、主播被黑需要安慰。歌词/广告不送。大部分时候不送。JSON:{"should":false,"reason":""}`,
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
