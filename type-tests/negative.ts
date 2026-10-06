/**
 * 类型反例（反向控制）—— 这些用法**必须编译失败**。
 *
 * ============================================================================
 * ⭐ 为什么这份文件比正例更重要
 * ---------------------------------------------------------------------------
 *   只写正例的门禁是**假绿**：只要 tsc 根本没在跑（或配置指向错文件），
 *   「全部通过」照样成立。
 *
 *   这里的每一条都对应一个**真实发生过的错误类型**（评审与自查发现）：
 *     ① select.destroy()            —— select 没有 destroy
 *     ② sel.value = ['a','b']       —— 单选不是数组
 *     ③ cb.tags()                    —— tags 是属性不是方法
 *     ④ dr.setPreset(from, to)      —— 参数是预设名不是日期
 *     ⑤ dr.addDays(...)             —— 那是静态函数，实例上没有
 *     ⑥ presets: ['today']          —— 这个 preset 不存在
 *     ⑦ onChange: (from, to) =>     —— 第一个参数是对象
 *     ⑧ tree.selected.trim()        —— selected 是 HTMLElement
 *
 *   ⇒ tsc-gate 逐条断言「这些行确实报错」。
 *      哪天类型被改松了，这里立刻红。
 *
 *   ⚠️ 本文件**故意编译不过**，所以 tsconfig 把它排除在主配置之外
 *      （见 tsc-gate.ts：它单独调用 tsc 并检查期望的错误信息）。
 */
import { Select, Combobox, DateRange, Tree } from 'frontend-lib';

declare const root: HTMLElement;
declare const treeRoot: HTMLElement;
declare const sel: ReturnType<typeof Select.create>;
declare const cb: ReturnType<typeof Combobox.create>;
declare const dr: ReturnType<typeof DateRange.create>;
declare const tree: ReturnType<typeof Tree.create>;

/* ① select 没有 destroy —— 早期类型让它通过，运行时 TypeError */
sel.destroy();

/* ② 单选的值是标量，不是数组 */
sel.value = ['a', 'b'];

/* ③ tags 是 getter，不是方法 */
cb.tags();

/* ④ setPreset 的参数是预设名 */
dr.setPreset('2026-01-01', '2026-03-31');

/* ⑤ addDays 是 DateRange 命名空间的静态函数，实例上没有 */
dr.addDays('2026-01-01', 1);
dr.quarterOf(new Date());

/* ⑥ 'today' 不在 PRESETS 里（真实值只有 thisQ/lastQ/lastM/thisY/yoy） */
DateRange.create(root, { label: 'x', presets: ['today'] });

/* ⑦ onChange 第一个参数是对象，不是两个字符串 */
DateRange.create(root, {
  label: 'x',
  onChange: (from: string, to: string) => { void from; void to; },
});

/* ⑧ tree.selected 是 HTMLElement，不是 string */
const bad: string = tree.selected;

/* ⑨ 类型里没有的整体画饼 */
Select.prototype;
export { bad, root, treeRoot };