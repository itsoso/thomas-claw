import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

export type VoiceCallback = (text: string) => void;

const RECORD_SECONDS = 10;
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
    const text = (await resp.text()).trim();
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
