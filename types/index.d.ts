/**
 * frontend-lib — TypeScript 类型定义
 *
 * ============================================================================
 * 🔴 为什么需要它
 * ---------------------------------------------------------------------------
 *   本库是**纯 JS + 零依赖**，但使用者（包括下游项目）接入时**没有任何类型提示**：
 *   参数名写错、要传几个字段、返回值是什么 —— 全靠读源码。
 *   ⇒ 接入成本高，且类型错误只会在**运行时**暴露。
 *
 *   ⭐ 解法：给有 JS API 的组件补 `.d.ts`。
 *   ⚠️ **不引入 TypeScript 作为依赖** —— 这些声明文件是纯文本，
 *      TS 项目会自动读取，JS 项目完全无感。
 *      （`/// <reference types="..." />` 也不需要）
 *
 * ============================================================================
 * 怎么用
 * ---------------------------------------------------------------------------
 *   // tsconfig.json
 *   { "compilerOptions": { "paths": { "frontend-lib": ["./types/index.d.ts"] } } }
 *
 *   import { Select } from 'frontend-lib';
 *   const s = Select.create(el, { label: '口径', onChange: (v) => … });
 *                                       ^^^^^^ 参数名写错会立刻报错
 * ============================================================================
 */

/** 组件通用：所有 create() 都返回这个形状 */
export interface ComponentInstance {
  /** 关闭/销毁（移除监听与 DOM 改动） */
  destroy(): void;
  /** 重新读取 DOM 上的初始值 */
  refresh?(): void;
}

/* ============================================================================
 * select —— 单选下拉
 * ========================================================================== */
export interface SelectOption {
  value: string;
  label: string;
  /** 语义色（success / warning / danger / info） */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  disabled?: boolean;
}

export interface SelectOptions {
  /** 无障碍名（读屏会读它） */
  label: string;
  options: SelectOption[];
  /** 初始选中值 */
  value?: string;
  /** 最多可选几个（1 = 单选，>1 = 多选） */
  max?: number;
  /** 至少要选几个（用于表单校验） */
  min?: number;
  placeholder?: string;
  disabled?: boolean;
  /** 变更回调（单选传字符串，多选传数组） */
  onChange?(value: string | string[]): void;
  /** 打开/关闭 */
  onOpen?(open: boolean): void;
}

/**
 * ⭐ API 与 `select.js` 的实际返回**逐项对齐**（ J2）。
 *   runtime 返回：`{ open, close, get value(), set value(v) }`
 *   ⇒ 这里**必须**用 `value` 属性（getter/setter），不是 getValue/setValue。
 */
export interface Select extends ComponentInstance {
  /** 展开下拉 */
  open(): void;
  /** 收起下拉 */
  close(): void;
  /** 当前值（可读写；写入会触发 onChange） */
  value: string | string[] | null;
}

/* ============================================================================
 * combobox —— 多选组合框
 * ========================================================================== */
export interface ComboboxOptions {
  label: string;
  options: SelectOption[];
  /** 最多可选几个 */
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** 变更回调（传已选的 value 数组） */
  onChange?(values: string[]): void;
  /** 自定义过滤（不传则用 label 的 includes 匹配） */
  filter?(input: string, opt: SelectOption): boolean;
}

/**
 * ⭐ 与 `combobox.js` 实际返回对齐：`{ add, remove, setOptions, tags }`
 *   ⚠️ 它**没有** getValue/setValue/close —— 之前的声明会误导使用者。
 */
export interface Combobox extends ComponentInstance {
  /** 已选中的 value 数组（只读快照） */
  tags(): string[];
  /** 追加一项 */
  add(value: string): void;
  /** 移除一项 */
  remove(value: string): void;
  /** 替换候选项 */
  setOptions(options: SelectOption[]): void;
}

/* ============================================================================
 * date-range —— 日期区间
 * ========================================================================== */
export interface DateRangeOptions {
  label: string;
  /** 预设（点击即填） */
  presets?: Array<{ label: string; from: string; to: string }>;
  /** 是否允许手动输入 */
  editable?: boolean;
  disabled?: boolean;
  /** 变更回调（YYYY-MM-DD） */
  onChange?(from: string, to: string): void;
}

/**
 * ⭐ 与 `date-range.js` 实际返回对齐：
 *   `{ from, to, valid, set, setPreset, clear, iso, quarterOf, quarterRange,
 *     addDays, addMonths }`
 *   ⚠️ 它**没有** getValue/setValue/open/close。
 */
export interface DateRange extends ComponentInstance {
  /** 起始日（YYYY-MM-DD，只读） */
  readonly from: string;
  /** 结束日（YYYY-MM-DD，只读） */
  readonly to: string;
  /** 区间是否有效（from <= to） */
  readonly valid: boolean;
  /** 设置区间 */
  set(from: string, to: string): void;
  /** 套用预设 */
  setPreset(from: string, to: string): void;
  /** 清空 */
  clear(): void;
  /** 输出 ISO 字符串 */
  iso(): string;
  /** 所在季度 */
  quarterOf(date: string): number;
  /** 某季度的起止 */
  quarterRange(q: number, year: number): { from: string; to: string };
  /** 加减天 */
  addDays(date: string, n: number): string;
  /** 加减月 */
  addMonths(date: string, n: number): string;
}

/* ============================================================================
 * DateRange 命名空间上的纯函数（可单独用，**已做参数防呆**）
 * ========================================================================== */
export interface DateRangeStatics {
  /** Date → 'YYYY-MM-DD'（本地时区，不用 toISOString） */
  iso(d: Date): string;
  /** 加天数（跨月/跨年/闰年都正确） */
  addDays(isoStr: string, n: number): string;
  /** 加月份，**月末夹取**（1/31 + 1 月 = 2/28 或 2/29） */
  addMonths(isoStr: string, n: number): string;
  /** 日期 → 季度。⚠️ 返回对象，`q` 是 **0-based**（0=Q1） */
  quarterOf(date: Date): { y: number; q: number };
  /** 季度 → 起止日。🔴 `q` **必须 0-3**，否则抛错（2026-10-06 加的防呆） */
  quarterRange(y: number, q: number): { from: string; to: string };
  create(root: HTMLElement, opt: DateRangeOptions): DateRange;
}

/* ============================================================================
 * 全局命名空间（组件脚本是 IIFE，挂到 window）
 * ========================================================================== */
export interface FrontendLibGlobal {
  DateRange: DateRangeStatics;
  Select: { create(root: HTMLElement, opt: SelectOptions): Select };
  Combobox: { create(root: HTMLElement, opt: ComboboxOptions): Combobox };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window extends FrontendLibGlobal {}
}

export declare const Select: FrontendLibGlobal['Select'];
export declare const Combobox: FrontendLibGlobal['Combobox'];
export declare const DateRange: DateRangeStatics;
