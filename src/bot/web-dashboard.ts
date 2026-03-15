/**
 * Web Dashboard — 实时展示 OpenClaw 自动化每一步
 * 在浏览器中打开 http://localhost:3456 查看
 */
import http from 'http';

interface LogEntry {
  time: string;
  step: string;
  tag: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'ai' | 'voice' | 'danmaku' | 'gift' | 'dm' | 'system';
}

const logs: LogEntry[] = [];
const state = {
  currentStep: '',
  stepDesc: '',
  taste: '',
  discovered: [] as { name: string; score: number; reason: string }[],
  currentStreamer: '',
  roomImage: '',
  voiceText: '',
  aiReply: '',
  giftSent: '',
  dmMessage: '',
  stats: { danmaku: 0, replies: 0, gifts: 0, voice: 0, spent: '0', remaining: '500' },
  giftConfig: { maxPerGift: 100, strategy: 'AI动态决定: 1-100钻 (¥0.1-10)' },
  interactionLog: [] as { time: string; type: string; streamer: string; content: string }[],
  summaries: [] as { time: string; text: string }[],
};

export function dashLog(step: string, tag: string, message: string, type: LogEntry['type'] = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logs.push({ time, step, tag, message, type });
  // 同时打印到终端
  const colors: Record<string, string> = {
    info: '\x1b[90m', success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m',
    ai: '\x1b[33m', voice: '\x1b[35m', danmaku: '\x1b[36m', gift: '\x1b[35m', dm: '\x1b[34m', system: '\x1b[90m',
  };
  console.log(`  ${time} ${colors[type] || ''}[${tag}]\x1b[0m ${message}`);
}

export function dashLogInteraction(type: string, streamer: string, content: string) {
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  state.interactionLog.push({ time, type, streamer, content });
  if (state.interactionLog.length > 500) state.interactionLog = state.interactionLog.slice(-500);
  // 每10条互动持久化一次
  if (state.interactionLog.length % 10 === 0) saveDashboardState();
}

export function dashAddSummary(text: string) {
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  state.summaries.push({ time, text });
  // 持久化到文件
  saveDashboardState();
}

function saveDashboardState() {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const file = path.join(os.homedir(), '.thomas-claw-dashboard.json');
    const data = {
      interactionLog: state.interactionLog.slice(-200),
      summaries: state.summaries,
      stats: state.stats,
      lastSaved: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

export function loadDashboardState() {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const file = path.join(os.homedir(), '.thomas-claw-dashboard.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.interactionLog) state.interactionLog = data.interactionLog;
      if (data.summaries) state.summaries = data.summaries;
      console.log(`[看板] 加载历史数据: ${data.interactionLog?.length || 0}条互动, ${data.summaries?.length || 0}条总结`);
    }
  } catch {}
}

export function dashSetStep(step: string, desc: string) { state.currentStep = step; state.stepDesc = desc; }
export function dashSetTaste(t: string) { state.taste = t; }
export function dashAddDiscovered(d: { name: string; score: number; reason: string }) { state.discovered.push(d); }
export function dashSetStreamer(s: string) { state.currentStreamer = s; }
export function dashSetRoomImage(desc: string) { state.roomImage = desc; }
export function dashSetVoice(t: string) { state.voiceText = t; }
export function dashSetAI(t: string) { state.aiReply = t; }
export function dashSetGift(t: string) { state.giftSent = t; }
export function dashSetDM(t: string) { state.dmMessage = t; }
export function dashUpdateStats(s: Partial<typeof state.stats>) { Object.assign(state.stats, s); }

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenClaw Dashboard</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, 'SF Pro', sans-serif; background:#0a0a0f; color:#e0e0e0; }
.header { background:linear-gradient(135deg,#1a1a2e,#16213e); padding:20px 30px; border-bottom:1px solid #2a2a4a; }
.header h1 { font-size:22px; color:#00d4ff; }
.header p { font-size:12px; color:#888; margin-top:4px; }
.container { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:16px; padding:16px; height:calc(100vh - 80px); }
.panel { background:#12121f; border:1px solid #2a2a4a; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; }
.panel-title { padding:12px 16px; font-size:13px; font-weight:600; color:#00d4ff; border-bottom:1px solid #1a1a3a; background:#15152a; }
.panel-body { padding:12px 16px; overflow-y:auto; flex:1; font-size:12px; line-height:1.7; }
.step-badge { display:inline-block; background:#00d4ff22; color:#00d4ff; padding:2px 8px; border-radius:4px; font-size:11px; margin-right:6px; }
.step-active { background:#00d4ff; color:#000; font-weight:600; }
.log-entry { padding:3px 0; border-bottom:1px solid #1a1a2a; display:flex; gap:8px; align-items:flex-start; }
.log-time { color:#555; font-size:11px; min-width:60px; font-family:monospace; }
.log-tag { font-size:10px; padding:1px 6px; border-radius:3px; min-width:40px; text-align:center; }
.log-msg { flex:1; word-break:break-word; }
.tag-info { background:#2a2a4a; color:#aaa; }
.tag-success { background:#1a4a2a; color:#4ade80; }
.tag-warning { background:#4a3a1a; color:#fbbf24; }
.tag-error { background:#4a1a1a; color:#f87171; }
.tag-ai { background:#3a2a1a; color:#fbbf24; }
.tag-voice { background:#2a1a4a; color:#c084fc; }
.tag-danmaku { background:#1a2a4a; color:#38bdf8; }
.tag-gift { background:#4a1a3a; color:#f472b6; }
.tag-dm { background:#1a1a4a; color:#818cf8; }
.tag-system { background:#1a1a2a; color:#666; }
.stats-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.stat-card { background:#1a1a2e; padding:12px; border-radius:8px; text-align:center; }
.stat-value { font-size:24px; font-weight:700; color:#00d4ff; }
.stat-label { font-size:11px; color:#666; margin-top:4px; }
.current-info { padding:12px; background:#1a1a2e; border-radius:8px; margin-bottom:10px; }
.current-info .label { font-size:11px; color:#666; }
.current-info .value { font-size:14px; color:#e0e0e0; margin-top:2px; }
.discovered-item { padding:6px 10px; background:#1a1a2e; border-radius:6px; margin-bottom:6px; display:flex; justify-content:space-between; }
.score { color:#00d4ff; font-weight:600; }
.voice-text { background:#2a1a4a; padding:8px 12px; border-radius:6px; color:#c084fc; font-size:13px; margin-bottom:8px; }
.ai-text { background:#3a2a1a; padding:8px 12px; border-radius:6px; color:#fbbf24; font-size:13px; margin-bottom:8px; }
.dm-text { background:#1a1a4a; padding:8px 12px; border-radius:6px; color:#818cf8; font-size:13px; }
</style>
</head>
<body>
<div class="header">
  <h1>OpenClaw Dashboard</h1>
  <p>Powered by Playwright + GPT-4o | 实时自动化监控</p>
</div>
<div class="container">
  <div class="panel">
    <div class="panel-title">当前状态</div>
    <div class="panel-body" id="status">加载中...</div>
  </div>
  <div class="panel">
    <div class="panel-title">实时日志</div>
    <div class="panel-body" id="logs" style="font-family:monospace;"></div>
  </div>
  <div class="panel">
    <div class="panel-title">发现的主播</div>
    <div class="panel-body" id="discovered"></div>
  </div>
  <div class="panel">
    <div class="panel-title">统计</div>
    <div class="panel-body" id="stats"></div>
  </div>
  <div class="panel" style="grid-column:1/3">
    <div class="panel-title">互动记录 & 半小时总结</div>
    <div class="panel-body" id="interactions" style="display:flex;gap:16px;">
      <div style="flex:2;overflow-y:auto" id="ilog"></div>
      <div style="flex:1;border-left:1px solid #2a2a4a;padding-left:16px;overflow-y:auto" id="isummary"></div>
    </div>
  </div>
</div>
<script>
function update() {
  fetch('/api/state').then(r=>r.json()).then(d => {
    // Status
    var s = d.state;
    var html = '<div class="current-info"><div class="label">当前步骤</div><div class="value"><span class="step-badge step-active">' + (s.currentStep||'等待') + '</span> ' + (s.stepDesc||'') + '</div></div>';
    if (s.taste) html += '<div class="current-info"><div class="label">品味画像</div><div class="value">' + s.taste + '</div></div>';
    if (s.currentStreamer) html += '<div class="current-info"><div class="label">当前主播</div><div class="value" style="font-size:16px;color:#00d4ff">' + s.currentStreamer + '</div></div>';
    if (s.roomImage) html += '<div class="current-info"><div class="label">画面分析</div><div class="value">' + s.roomImage + '</div></div>';
    if (s.voiceText) html += '<div class="voice-text">🎤 ' + s.voiceText + '</div>';
    if (s.aiReply) html += '<div class="ai-text">💬 ' + s.aiReply + '</div>';
    if (s.dmMessage) html += '<div class="dm-text">✉️ ' + s.dmMessage + '</div>';
    if (s.giftSent) html += '<div class="current-info"><div class="label">送礼</div><div class="value">🎁 ' + s.giftSent + '</div></div>';
    html += '<div class="current-info"><div class="label">礼物策略</div><div class="value" style="font-size:12px;color:#f472b6">' + (s.giftConfig?.strategy || 'AI动态') + '</div></div>';
    document.getElementById('status').innerHTML = html;

    // Logs
    var logsHtml = '';
    var entries = d.logs.slice(-80);
    for (var i = entries.length-1; i >= 0; i--) {
      var e = entries[i];
      logsHtml += '<div class="log-entry"><span class="log-time">' + e.time + '</span><span class="log-tag tag-' + e.type + '">' + e.tag + '</span><span class="log-msg">' + e.message + '</span></div>';
    }
    document.getElementById('logs').innerHTML = logsHtml;

    // Discovered
    var dHtml = '';
    (s.discovered||[]).forEach(function(x) {
      dHtml += '<div class="discovered-item"><span>' + x.name + '</span><span class="score">' + x.score + '/10</span></div>';
    });
    document.getElementById('discovered').innerHTML = dHtml || '<div style="color:#555">搜索中...</div>';

    // Interaction log
    var iHtml = '';
    var il = (s.interactionLog||[]).slice(-50);
    for (var k = il.length-1; k >= 0; k--) {
      var ie = il[k];
      var tc = ie.type==='弹幕发送'?'#fbbf24':ie.type==='送礼'?'#f472b6':ie.type==='私信'?'#818cf8':'#888';
      iHtml += '<div style="padding:3px 0;border-bottom:1px solid #1a1a2a;font-size:11px"><span style="color:#555">' + ie.time.split(' ')[1] + '</span> <span style="color:'+tc+'">['+ie.type+']</span> <span style="color:#aaa">' + ie.streamer + '</span> ' + ie.content + '</div>';
    }
    document.getElementById('ilog').innerHTML = iHtml || '<div style="color:#555">等待互动...</div>';

    // Summaries
    var sumHtml = '<div style="font-size:12px;color:#00d4ff;margin-bottom:8px">每30分钟总结</div>';
    (s.summaries||[]).forEach(function(sm) {
      sumHtml += '<div style="padding:6px;background:#1a1a2e;border-radius:6px;margin-bottom:6px;font-size:11px"><div style="color:#555">' + sm.time + '</div><div style="color:#e0e0e0;margin-top:3px">' + sm.text + '</div></div>';
    });
    document.getElementById('isummary').innerHTML = sumHtml;

    // Stats
    var st = s.stats;
    document.getElementById('stats').innerHTML =
      '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-value">' + st.danmaku + '</div><div class="stat-label">弹幕捕获</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + st.replies + '</div><div class="stat-label">AI 回复</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + st.gifts + '</div><div class="stat-label">送礼次数</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + st.voice + '</div><div class="stat-label">语音转写</div></div>' +
      '<div class="stat-card"><div class="stat-value">¥' + st.spent + '</div><div class="stat-label">已花费</div></div>' +
      '<div class="stat-card"><div class="stat-value">¥' + st.remaining + '</div><div class="stat-label">剩余预算</div></div>' +
      '</div>';
  }).catch(()=>{});
}
setInterval(update, 1500);
update();
</script>
</body>
</html>`;

let server: http.Server | null = null;

export function startWebDashboard(port = 3456): void {
  if (server) return;
  server = http.createServer((req, res) => {
    if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ state, logs: logs.slice(-200) }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
    }
  });
  server.listen(port, () => {
    console.log(`\n  🌐 Dashboard: \x1b[1;36mhttp://localhost:${port}\x1b[0m\n`);
  });
}
