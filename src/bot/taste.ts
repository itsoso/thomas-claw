import fs from 'fs';
import path from 'path';
import os from 'os';

const TASTE_DIR = path.join(os.homedir(), '.thomas-claw-taste');
const PROFILE_FILE = path.join(TASTE_DIR, 'profile.json');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export interface TasteProfile {
  descriptions: string[];  // 每张参考图的描述
  summary: string;          // 合并后的品味画像
  updatedAt: number;
}

/** 加载品味画像 */
export function loadTasteProfile(): TasteProfile | null {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

/** 分析参考图片，生成品味画像 */
export async function trainTaste(): Promise<TasteProfile> {
  if (!fs.existsSync(TASTE_DIR)) fs.mkdirSync(TASTE_DIR, { recursive: true });

  // 找所有图片
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const images = fs.readdirSync(TASTE_DIR).filter(f =>
    exts.includes(path.extname(f).toLowerCase())
  );

  if (images.length === 0) {
    console.log(`[品味] 请把喜欢的主播/妹子图片放到: ${TASTE_DIR}/`);
    console.log('[品味] 支持 jpg/png/webp，放 3-5 张效果最好');
    return { descriptions: [], summary: '无特定偏好，年轻女性主播', updatedAt: Date.now() };
  }

  console.log(`[品味] 分析 ${images.length} 张参考图片...`);

  const descriptions: string[] = [];

  for (const img of images) {
    const imgPath = path.join(TASTE_DIR, img);
    const imgBuffer = fs.readFileSync(imgPath);
    const base64 = imgBuffer.toString('base64');
    const mimeType = img.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '用中文描述这个人的外貌特征（80字内）：年龄段、脸型、发型、气质风格、体型。只描述客观特征，不评价。' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' } },
          ],
        }],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const desc = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (desc) {
        descriptions.push(desc);
        console.log(`  [${img}] ${desc}`);
      }
    }
  }

  // 合并成品味画像
  let summary = '年轻女性主播';
  if (descriptions.length > 0) {
    const mergeResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `这些是用户喜欢的女生类型描述：\n${descriptions.join('\n')}\n\n总结共同特征，生成一句"品味画像"（50字内），用于筛选直播间主播。`,
        }],
      }),
    });
    if (mergeResp.ok) {
      const data = await mergeResp.json();
      summary = data.choices?.[0]?.message?.content?.trim() ?? summary;
    }
  }

  const profile: TasteProfile = { descriptions, summary, updatedAt: Date.now() };
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
  console.log(`[品味] 画像: ${summary}`);
  return profile;
}

/** 判断直播间截图是否符合品味 */
export async function matchesTaste(
  screenshotBase64: string,
  tasteProfile: TasteProfile,
): Promise<{ match: boolean; score: number; reason: string }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `用户品味：${tasteProfile.summary}\n\n这个直播间的主播是否符合？JSON: {"match":true/false,"score":1-10,"reason":"简短原因"}。\n如果看不清主播、不是女性直播间、录播/回放/电台/动画/纯文字画面，match=false。\n如果主播拿着麦克风在唱歌，score最多5分（我们更喜欢聊天互动类的直播间）。\n聊天/日常/互动类的直播间加2分。`,
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: 'low' },
          },
        ],
      }],
    }),
  });

  if (!response.ok) return { match: false, score: 0, reason: 'API error' };
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const m = text.match(/\{[\s\S]*?\}/);
    return m ? JSON.parse(m[0]) : { match: false, score: 0, reason: '' };
  } catch {
    return { match: false, score: 0, reason: 'parse error' };
  }
}
