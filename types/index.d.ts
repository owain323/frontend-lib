/**
 * frontend-lib — TypeScript 类型定义
 *
 * ============================================================================
 * 为什么需要它
 * ---------------------------------------------------------------------------
 *   本库是**纯 JS + 零依赖**，但使用者接入时没有任何类型提示：
 *   参数名写错、要传几个字段、返回值是什么 —— 全靠读源码。
 *   ⇒ 接入成本高，且类型错误只会在**运行时**暴露。
 *
 *   ⭐ 解法：给有 JS API 的组件补 `.d.ts`。
 *   ⚠️ **不引入 TypeScript 作为运行时依赖** —— 这些声明文件是纯文本，
 *      TS 项目会自动读取，JS 项目完全无感。
 *
 * ============================================================================
 * ⭐ 本文件的每一行都由门禁核对过（2026-10-06 起）
 * ---------------------------------------------------------------------------
 *   曾经的教训：类型里写满了 runtime 根本没有的 API，而门禁抓不到——
 *   因为旧门禁只比对「方法名是否出现」，不比对「是方法还是属性」。
 *
 *   实际发生过的错误（全部已修，并由 `api-contract` 门禁防复发）：
 *     ① Select.value 声明成 string[]，实际是标量
 *     ② ComponentInstance.destroy() —— select/combobox/date-range 都没有
 *     ③ Combobox.tags 声明成方法()，实际是 getter
 *     ④ DateRange 实例声明了 iso/quarterOf 等**静态**函数
 *     ⑤ PresetName 列的 'today'/'week' 全部不存在
 *     ⑥ DateRange.onChange 签名是两个字符串，实际是 (对象, 布尔)
 *
 *   ⇒ 改本文件前先跑：
 *       python3 05-audit/api-contract.py         # 看 runtime 真实形状
 *       npx tsc --noEmit -p type-tests/          # 看类型自洽
 *
 * ============================================================================
 * 怎么用
 * ---------------------------------------------------------------------------
 *   // tsconfig.json
 *   { "compilerOptions": { "paths": { "frontend-lib": ["./types/index.d.ts"] } } }
 *
 *   import { Select } from 'frontend-lib';
 *   const s = Select.create(el, { label: '口径', onChange: (v, text) => … });
 *                                                       ^^^^^^^^^^^^^^ 参数名/个数写错会立刻报错
 */

/* ============================================================================
 * 基础形状
 * ========================================================================== */

/**
 * ⭐ **不再有一个统一的 ComponentInstance**。
 *
 *   之前所有组件都 `extends ComponentInstance`，而那个接口带 `destroy()`。
 *   实测：只有 dropdown / tree / bar / sparkline 提供 destroy()，
 *   select / combobox / date-range / popover / tooltip **都没有**。
 *   ⇒ 一个共用接口必然对一部分组件说谎。
 *
 *   ⇒ 改为：每个组件单独声明它**真实拥有**的成员。
 *      需要销毁能力的组件自己带 `destroy()`（下面 accordion/dropdown 等）。
 */
export interface Destroyable {
  /** 销毁：移除监听、清空生成的 DOM */
  destroy(): void;
}

/* ============================================================================
 * select —— 单选下拉
 * ========================================================================== */
export interface SelectOption {
  value: string;
  label: string;
  /** 语义色（success / warning / danger / info /neutral） */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  disabled?: boolean;
}

export interface SelectOptions {
  /** 无障碍名（读屏会读它） */
  label: string;
  options: SelectOption[];
  /** 初始选中值 */
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * ⭐ 变更回调。**两个参数**，不是数组。
   *   runtime：`opt.onChange(selected, 显示文本)`
   *
   * ⚠️ 本组件**只支持单选** —— 内部状态是标量。
   *   早期类型里写过 `string[]` 与 `max`/`min`，实现从未支持，
   *   属于「声明了却没有」⇒ 已移除。需要多选请用 combobox。
   */
  onChange?(value: string | null, text: string): void;
  /**
   * 打开/关闭。
   * ⚠️ runtime 是 `opt.onOpen()`，**不传参数**。
   *   想知道是开是关，请自己在 onChange 里判断，或观察 DOM。
   */
  onOpen?(): void;
}

/**
 * ⭐ 与 `select.js` 的实际返回逐项对齐。
 *   runtime 返回：`{ open, close, get value(), set value(v) }`
 *   ⇒ 用 `value` 属性（getter/setter），**不是** getValue/setValue。
 *   ⇒ 没有 destroy()：卸载请直接移除节点（组件无全局监听）。
 */
export interface Select {
  /** 展开下拉 */
  open(): void;
  /** 收起下拉 */
  close(): void;
  /** 当前值（可读写；写入会触发 onChange） */
  value: string | null;
}

/* ============================================================================
 * combobox —— 多选组合框
 * ========================================================================== */
export interface ComboboxOptions {
  label: string;
  options: SelectOption[];
  /** 最多可选几个（超出会关闭下拉） */
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** 变更回调（传已选的 value 数组） */
  onChange?(values: string[]): void;
  /**
   * 自定义过滤（不传则用 label/value 的 includes 匹配）。
   * ⚠️ **必须同步返回布尔值** —— 会被逐项调用，不能在里面做异步过滤。
   */
  filter?(input: string, opt: SelectOption): boolean;
}

/**
 * ⭐ 与 `combobox.js` 实际返回对齐。
 *   runtime 返回：`{ get tags(), add, remove, setOptions }`
 *
 * ⚠️ `tags` 是**属性（getter）**，不是方法 —— 用 `c.tags`，不是 `c.tags()`。
 *   早期类型写成方法，于是文档与实际用法对不上。
 *   ⚠️ 它**没有** destroy()。
 */
export interface Combobox {
  /** 已选中的 value 数组（只读快照，每次访问返回新数组） */
  readonly tags: string[];
  /** 追加一项（空值会被忽略） */
  add(value: string): boolean;
  /** 移除一项 */
  remove(value: string): void;
  /** 替换候选项 */
  setOptions(options: SelectOption[]): void;
}

/* ============================================================================
 * date-range —— 日期区间
 * ========================================================================== */

/**
 * ⭐ 内置预设区间名。
 *
 *   ⚠️ 这五个是**实现里真实存在的全部值**，取自 `date-range.js` 的 PRESETS：
 *       thisQ（���季度） / lastQ（上季度） / lastM（上月）
 *       thisY（今年）   / yoy（去年同期）
 *
 *   之前类型里写的是'today' / 'week' / 'month' / 'lastMonth' /
 *   'thisYear' / 'lastYear' —— 这些 preset **一个都不存在**，
 *   而类型却放它们过关 ⇒ TS 放行、runtime 静默无反应。
 */
export type PresetName = 'thisQ' | 'lastQ' | 'lastM' | 'thisY' | 'yoy';

export interface DateRangeOptions {
  label: string;
  /**
   * 要显示哪些快捷区间（取值为预设名）。
   * ⚠️ 传了但 DOM 里没有对应 `data-dr-preset` 按钮的，会被静默忽略。
   */
  presets?: PresetName[];
  /** 是否允许手动输入 */
  editable?: boolean;
  disabled?: boolean;
  /**
   * ⭐ 变更回调。**第一个参数是对象，第二个是布尔**。
   *   runtime：`opt.onChange({ from, to, valid }, valid)`
   *
   *   之前类型写成 `(from: string, to: string)` ——
   *   调用方按类型写 `onChange: (from, to) => ...`，to 会拿到 undefined。
   */
  onChange?(value: { from: string; to: string; valid: boolean },
            valid: boolean): void;
}

/**
 * ⭐ 与 `date-range.js` 实际返回对齐：
 *   `{ get from(), get to(), get valid(), set, setPreset, clear }`
 *
 * ⚠️ **它没有** iso / quarterOf / quarterRange / addDays / addMonths ——
 *   那些是 `DateRange` 命名空间上的**静态**函数，见 DateRangeStatics。
 *   之前把它们声明成实例方法，于是 `dr.addDays(...)` 类型通过、
 *   运行时 `dr.addDays is not a function`。
 */
export interface DateRange {
  /** 起始日（YYYY-MM-DD，只读） */
  readonly from: string;
  /** 结束日（YYYY-MM-DD，只读） */
  readonly to: string;
  /** 区间是否有效（from <= to） */
  readonly valid: boolean;
  /** 设置区间 */
  set(from: string, to: string): void;
  /**
   * 套用预设。
   * ⚠️ 参数是**预设名**（`thisQ` / `lastM` / …），不是日期区间。
   *   之前类型写成 `setPreset(from, to)` ⇒ 完全错误的用法被类型放行。
   *   传入未渲染的 preset 名会**静默无反应**（找不到对应按钮）。
   */
  setPreset(preset: PresetName): void;
  /** 清空 */
  clear(): void;
}

/* ============================================================================
 * DateRange 命名空间上的静态函数（可脱离组件单独用）
 * ========================================================================== */
export interface DateRangeStatics {
  /** Date → 'YYYY-MM-DD'（**本地时区**，不用 toISOString，避免时区偏移） */
  iso(d: Date): string;
  /** 加天数（跨月/跨年/闰年都正确） */
  addDays(isoStr: string, n: number): string;
  /** 加月份，**月末夹取**（1/31 + 1 月 = 2/28 或 2/29） */
  addMonths(isoStr: string, n: number): string;
  /** 日期 → 季度。⚠️ 返回对象，`q` 是 **0-based**（0=Q1） */
  quarterOf(date: Date): { y: number; q: number };
  /** 季度 → 起止日。🔴 `q` **必须 0-3**，否则抛错 */
  quarterRange(y: number, q: number): { from: string; to: string };
  /** 挂载一个日期区间组件 */
  create(root: HTMLElement, opt: DateRangeOptions): DateRange;
}

/* ============================================================================
 * dropdown —— 下拉菜单（唯一带 destroy 的常用组件之一）
 * ========================================================================== */
export interface Dropdown {
  open(): void;
  close(): void;
  destroy(): void;
}

/* ============================================================================
 * tree —— 树形导航
 * ========================================================================== */
export interface TreeOptions {
  /** 无障碍名（读屏会读它） */
  label?: string;
}

/* ============================================================================
 * tree —— 树形导航
 * ========================================================================== */
export interface Tree {
  /** 让第 n 项（按可见顺序）获得焦点 */
  focusAt(n: number): void;
  /**
   * 当前选中项。
   * ⚠️ 返回的是**列表项 DOM 元素**，不是 value 字符串
   *   （runtime：`list[cur]`，list 是可见项数组）。没有选中项时为 null。
   */
  readonly selected: HTMLElement | null;
  destroy(): void;
}

/* ============================================================================
 * 全局命名空间（组件脚本是 IIFE，挂到 window）
 * ========================================================================== */
export interface FrontendLibGlobal {
  DateRange: DateRangeStatics;
  Select: { create(root: HTMLElement, opt: SelectOptions): Select };
  Combobox: { create(root: HTMLElement, opt: ComboboxOptions): Combobox };
  Dropdown: { create(root: HTMLElement, opt?: object): Dropdown };
  Tree: { create(root: HTMLElement, opt?: TreeOptions): Tree };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window extends FrontendLibGlobal {}
}

export declare const Select: FrontendLibGlobal['Select'];
export declare const Combobox: FrontendLibGlobal['Combobox'];
export declare const DateRange: DateRangeStatics;
export declare const Dropdown: FrontendLibGlobal['Dropdown'];
export declare const Tree: FrontendLibGlobal['Tree'];