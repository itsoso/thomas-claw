/**
 * 反检测策略 — 让行为更像真人，避免被抖音风控
 */
import { Page } from 'playwright';

// ─── 1. 随机延迟（拟人化） ───

/** 真人打字速度：每个字 80-200ms 随机 */
export function humanDelay(): number {
  return 80 + Math.floor(Math.random() * 120);
}

/** 随机等待：模拟真人思考时间 */
export function thinkDelay(): Promise<void> {
  const ms = 2000 + Math.floor(Math.random() * 5000); // 2-7秒
  return new Promise(r => setTimeout(r, ms));
}

/** 动作间隔：两次操作之间的随机间隔 */
export function actionGap(): Promise<void> {
  const ms = 500 + Math.floor(Math.random() * 2000); // 0.5-2.5秒
  return new Promise(r => setTimeout(r, ms));
}

// ─── 2. 随机行为注入（模拟真人浏览习惯） ───

/** 随机滚动页面（真人会上下滑动） */
export async function randomScroll(page: Page): Promise<void> {
  const direction = Math.random() > 0.5 ? 1 : -1;
  const amount = 100 + Math.floor(Math.random() * 300);
  await page.evaluate((args) => {
    window.scrollBy(0, args.d * args.a);
  }, { d: direction, a: amount });
}

/** 随机鼠标移动（真人鼠标不会静止不动） */
export async function randomMouseMove(page: Page): Promise<void> {
  const x = 200 + Math.floor(Math.random() * 800);
  const y = 200 + Math.floor(Math.random() * 500);
  await page.mouse.move(x, y, { steps: 3 + Math.floor(Math.random() * 5) });
}

/** 模拟一次"真人闲逛"动作（滚动/移动鼠标/暂停） */
export async function humanIdle(page: Page): Promise<void> {
  const action = Math.random();
  if (action < 0.3) {
    await randomScroll(page);
  } else if (action < 0.6) {
    await randomMouseMove(page);
  }
  // 40% 什么都不做（真人也会发呆）
}

// ─── 3. 发言节奏控制 ───

/** 计算下次发言的等待时间（加入随机抖动） */
export function nextReplyDelay(base: number): number {
  // 基础时间 ± 30% 随机抖动
  const jitter = base * 0.3;
  return base + Math.floor(Math.random() * jitter * 2 - jitter);
}

/** 判断当前是否应该"休息"一下（避免持续活跃） */
export function shouldTakeBreak(
  messagesSent: number,
  minutesInRoom: number,
): boolean {
  // 每发 4-6 条消息，有 30% 概率休息 1-2 分钟
  if (messagesSent > 0 && messagesSent % (4 + Math.floor(Math.random() * 3)) === 0) {
    return Math.random() < 0.3;
  }
  // 在一个直播间待超过 15 分钟，活跃度自然降低
  if (minutesInRoom > 15) {
    return Math.random() < 0.1; // 10% 概率每轮跳过
  }
  return false;
}

// ─── 4. 弹幕内容反检测 ───

/** 给弹幕加入微小变化（避免完全一样的文本被检测） */
export function humanizeText(text: string): string {
  // 随机加空格位置变化
  if (Math.random() < 0.2 && text.length > 4) {
    const pos = 1 + Math.floor(Math.random() * (text.length - 2));
    return text.slice(0, pos) + ' ' + text.slice(pos);
  }
  // 随机加尾部符号
  if (Math.random() < 0.15) {
    const tails = ['~', '！', '哈', '呀', '嘿', ''];
    return text + tails[Math.floor(Math.random() * tails.length)];
  }
  return text;
}

// ─── 5. 会话级别反检测 ───

/** 浏览器指纹混淆（在页面注入） */
export async function injectFingerprint(page: Page): Promise<void> {
  await page.addScriptTag({ content: `
    // 隐藏 webdriver 标记
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // 随机化 canvas 指纹
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      var ctx = this.getContext('2d');
      if (ctx) {
        var imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (var i = 0; i < imageData.data.length; i += 100) {
          imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.5 ? 1 : 0);
        }
        ctx.putImageData(imageData, 0, 0);
      }
      return origToDataURL.apply(this, arguments);
    };

    // 模拟真实的 plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // 隐藏 automation 相关属性
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  `}).catch(() => {});
}

// ─── 6. 直播间行为模式 ───

/** 模拟真人进入直播间的行为序列 */
export async function simulateHumanEntry(page: Page): Promise<void> {
  // 1. 先看几秒不说话（真人进来先看看）
  await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

  // 2. 随机滚动看看弹幕
  await randomScroll(page);
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

  // 3. 可能移动鼠标到视频区域（看视频）
  await randomMouseMove(page);
}

/** 生成随机的打招呼（不要每次一样） */
export function randomGreeting(): string {
  const greetings = [
    '来了', '路过', '嗨', '晚上好', '刚到',
    '溜达过来了', '逛到这了', '人呢', '来看看',
    '刚刷到', '好久不见', '又来了', '凑个热闹',
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}
