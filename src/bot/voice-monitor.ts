import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

export type VoiceCallback = (text: string) => void;

const RECORD_SECONDS = 10;

// 常用繁简对照（覆盖 Whisper 高频输出的繁体字）
const T2S: Record<string, string> = {
  '們':'们','這':'这','說':'说','個':'个','來':'来','時':'时','會':'会','對':'对','裡':'里','過':'过',
  '後':'后','從':'从','還':'还','進':'进','開':'开','點':'点','頭':'头','現':'现','問':'问','間':'间',
  '應':'应','動':'动','機':'机','關':'关','長':'长','當':'当','經':'经','發':'发','學':'学','讓':'让',
  '給':'给','話':'话','將':'将','與':'与','車':'车','東':'东','見':'见','書':'书','電':'电','門':'门',
  '寫':'写','聽':'听','歡':'欢','買':'买','賣':'卖','錢':'钱','認':'认','請':'请','謝':'谢','準':'准',
  '邊':'边','選':'选','愛':'爱','樂':'乐','飛':'飞','結':'结','親':'亲','離':'离','難':'难','號':'号',
  '聲':'声','師':'师','節':'节','圖':'图','廣':'广','領':'领','條':'条','連':'连','觀':'观','歲':'岁',
  '響':'响','設':'设','變':'变','體':'体','議':'议','嗎':'吗','麼':'么','際':'际','實':'实','種':'种',
  '義':'义','產':'产','備':'备','歷':'历','華':'华','區':'区','報':'报','場':'场','環':'环','組':'组',
  '構':'构','統':'统','導':'导','誰':'谁','幾':'几','陽':'阳','貓':'猫','鑰':'钥','匙':'匙','願':'愿',
  '棄':'弃','齊':'齐','傳':'传','滿':'满','簡':'简','係':'系','寶':'宝','屬':'属','訂':'订','閱':'阅',
  '轉':'转','賞':'赏','歌':'歌','網':'网','題':'题','遊':'游','養':'养','視':'视','頻':'频','壞':'坏',
  '懂':'懂','靈':'灵','歸':'归','鬧':'闹','遠':'远','園':'园','禮':'礼','藝':'艺','燈':'灯','達':'达',
  '覺':'觉','嘩':'哗','遼':'辽','廳':'厅','塊':'块','寧':'宁','確':'确','壓':'压',
  '漲':'涨','憶':'忆','紅':'红','綠':'绿','藍':'蓝','黃':'黄','黑':'黑','鳳':'凤','龍':'龙','複':'复',
};

function toSimplified(text: string): string {
  let result = '';
  for (const ch of text) {
    result += T2S[ch] || ch;
  }
  return result;
}
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const RECORDER_SCRIPT = `
  window.__startRec = function(secs) {
    var videos = document.querySelectorAll('video');
    var video = null;
    for (var i = 0; i < videos.length; i++) {
      if (videos[i].readyState >= 2) { video = videos[i]; break; }
    }
    if (!video) return Promise.resolve(null);

    // 确保不静音
    video.muted = false;

    var stream;
    try { stream = video.captureStream(); } catch(e) { return Promise.resolve(null); }
    var audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return Promise.resolve(null);

    var audioStream = new MediaStream(audioTracks);
    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    var recorder = new MediaRecorder(audioStream, {mimeType: mimeType});
    var chunks = [];
    recorder.ondataavailable = function(e) { if(e.data.size>0) chunks.push(e.data); };

    return new Promise(function(resolve) {
      recorder.onstop = function() {
        if (chunks.length === 0) { resolve(null); return; }
        var blob = new Blob(chunks, {type: mimeType});
        var reader = new FileReader();
        reader.onloadend = function() {
          resolve(reader.result.split(',')[1]);
        };
        reader.readAsDataURL(blob);
      };
      recorder.start(1000);
      setTimeout(function() { try { recorder.stop(); } catch(e) { resolve(null); } }, secs * 1000);
    });
  };
`;

async function transcribe(base64: string): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `tc-audio-${Date.now()}.webm`);
  fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));

  const fileSize = fs.statSync(tmpFile).size;
  if (fileSize < 2000) { fs.unlinkSync(tmpFile); return null; }

  try {
    const fileBuffer = fs.readFileSync(tmpFile);
    const boundary = '----Boundary' + Date.now();
    const parts: Buffer[] = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nzh\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n请用简体中文转写。\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!resp.ok) return null;
    let text = (await resp.text()).trim();
    // 繁体→简体常用字转换
    text = toSimplified(text);
    return text.length > 1 ? text : null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// 最近的语音转写记录
const transcriptHistory: string[] = [];

export function getTranscriptHistory(): string[] {
  return transcriptHistory;
}

export async function startVoiceMonitor(
  page: Page,
  onTranscript: VoiceCallback,
): Promise<void> {
  if (!OPENAI_API_KEY) {
    console.log('[语音] 未设置 OPENAI_API_KEY');
    return;
  }

  // 重置历史
  transcriptHistory.length = 0;

  // 取消 video 静音
  await page.evaluate(() => {
    document.querySelectorAll('video').forEach(function(v) { v.muted = false; });
  }).catch(() => {});

  await page.addScriptTag({ content: RECORDER_SCRIPT }).catch(() => {});
  console.log('[语音] 主播语音监听已启动');

  let lastText = '';

  const loop = async () => {
    while (true) {
      try {
        const base64 = await page.evaluate(
          (secs: number) => (window as any).__startRec(secs),
          RECORD_SECONDS,
        );

        if (base64) {
          const text = await transcribe(base64);
          if (text && text !== lastText && text.length > 3) {
            lastText = text;
            transcriptHistory.push(text);
            if (transcriptHistory.length > 20) transcriptHistory.shift();

            console.log(`\x1b[35m[主播语音]\x1b[0m ${text}`);
            onTranscript(text);
          }
        }
      } catch {
        await page.waitForTimeout(3000);
      }
      // 录完休息 2 秒
      await page.waitForTimeout(2000);
    }
  };

  loop().catch(() => {});
}
