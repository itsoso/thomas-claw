import fs from 'fs';
import path from 'path';
import os from 'os';

const BUDGET_FILE = path.join(os.homedir(), '.thomas-claw-budget.json');

interface BudgetData {
  totalLimit: number;     // 总预算（元）
  perGiftLimit: number;   // 单次上限（元）
  spent: number;          // 已花费（元）
  giftCount: number;      // 送礼次数
  history: { time: number; amount: number; streamer: string; gift: string }[];
}

const DIAMOND_TO_YUAN = 0.1; // 1钻 = 0.1元

function load(): BudgetData {
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
    }
  } catch {}
  return { totalLimit: 500, perGiftLimit: 1, spent: 0, giftCount: 0, history: [] };
}

function save(data: BudgetData): void {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2));
}

/** 检查是否可以送礼 */
export function canAfford(diamondCost: number): boolean {
  const data = load();
  const yuanCost = diamondCost * DIAMOND_TO_YUAN;
  return yuanCost <= data.perGiftLimit && (data.spent + yuanCost) <= data.totalLimit;
}

/** 记录一次花费 */
export function recordSpending(diamondCost: number, streamer: string, giftName: string): void {
  const data = load();
  const yuanCost = diamondCost * DIAMOND_TO_YUAN;
  data.spent += yuanCost;
  data.giftCount++;
  data.history.push({ time: Date.now(), amount: yuanCost, streamer, gift: giftName });
  if (data.history.length > 200) data.history = data.history.slice(-200);
  save(data);
}

/** 获取预算状态 */
export function getBudgetStatus(): { spent: number; remaining: number; count: number; limit: number } {
  const data = load();
  return {
    spent: Math.round(data.spent * 100) / 100,
    remaining: Math.round((data.totalLimit - data.spent) * 100) / 100,
    count: data.giftCount,
    limit: data.totalLimit,
  };
}
