import { ChatSuggestionItem, LiveRoomContext } from './types';

const SYSTEM_PROMPT = `你是一个直播间弹幕助手，帮助用户生成自然、有趣的弹幕回复。

## 你的风格
- 像真人说话，自然随意
- 有个性，不千篇一律
- 不谄媚、不油腻、不低俗
- 适当幽默，但不强行搞笑
- 不用"哥/姐/亲"等称呼

## 输出要求
- 生成 3 条候选弹幕
- 每条不超过 20 个字
- 每条附带简短理由（为什么推荐）
- 以 JSON 数组格式输出，每个元素包含 text 和 reason 字段

## 示例输出
[
  {"text": "这个操作太秀了吧", "reason": "对主播精彩操作的自然反应"},
  {"text": "笑死 怎么做到的", "reason": "带好奇心的互动"},
  {"text": "学到了学到了", "reason": "表示认可，简洁真实"}
]`;

function buildUserPrompt(context: LiveRoomContext): string {
  const danmakuText = context.recentDanmaku
    .slice(-10)
    .map((d) => `${d.isStreamer ? '[主播]' : ''}${d.sender}: ${d.content}`)
    .join('\n');

  return `当前直播间信息：
- 主播：${context.streamerName}
- 标题：${context.title}
- 在线人数：${context.viewerCount}

最近弹幕：
${danmakuText || '（暂无弹幕）'}

请根据以上直播间氛围，生成 3 条自然的弹幕建议。直接输出 JSON 数组，不要其他内容。`;
}

export async function generateSuggestions(
  apiKey: string,
  context: LiveRoomContext,
  baseUrl: string = 'https://api.openai.com',
): Promise<ChatSuggestionItem[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(context) },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '[]';

  // 提取 JSON（兼容可能的 markdown code block）
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Failed to parse suggestions from API response');

  return JSON.parse(jsonMatch[0]) as ChatSuggestionItem[];
}
