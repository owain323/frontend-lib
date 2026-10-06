/**
 * 类型正例 —— 这些用法必须**编译通过**。
 *
 * ⭐ 每条都对着runtime 实现核过（不是照着类型文件抄的）。
 *    判据来源见 types/index.d.ts 顶部的说明。
 */
import {
  Select, Combobox, DateRange, Dropdown, Tree,
  type SelectOption, type PresetName,
} from 'frontend-lib';

declare const root: HTMLElement;
declare const treeRoot: HTMLElement;
declare const ddRoot: HTMLElement;

const opts: SelectOption[] = [
  { value: 'a', label: '甲', tone: 'success' },
  { value: 'b', label: '乙', disabled: true },
];

/* ---------------- Select：单选，值是标量 ---------------- */
const sel = Select.create(root, {
  label: '口径',
  options: opts,
  value: 'a',
  placeholder: '请选择',
  onChange: (value, text) => {
    // value: string | null（**不是** string[]）
    const s: string | null = value;
    const t: string = text;
    void s; void t;
  },
  onOpen: () => { /* runtime 是无参调用 */ },
});
sel.open();
sel.close();
const cur: string | null = sel.value;
sel.value = 'b';
void cur;

/* ---------------- Combobox：多选，tags 是**属性** ---------------- */
const cb = Combobox.create(root, {
  label: '标签',
  options: opts,
  max: 3,
  onChange: (values) => {
    const arr: string[] = values;
    void arr;
  },
  filter: (input, opt) => opt.label.indexOf(input) >= 0,
});
// ⭐ tags 是 getter，不是方法
const tags: string[] = cb.tags;
const added: boolean = cb.add('c');
cb.remove('c');
cb.setOptions(opts);
void tags; void added;

/* ---------------- DateRange：预设名 + 对象回调 ---------------- */
const presets: PresetName[] = ['thisQ', 'lastQ', 'lastM', 'thisY', 'yoy'];
const dr = DateRange.create(root, {
  label: '区间',
  presets,
  editable: true,
  onChange: (value, valid) => {
    // ⭐ 第一个参数是对象，第二个是布尔
    const from: string = value.from;
    const to: string = value.to;
    const ok: boolean = valid;
    void from; void to; void ok;
  },
});
const from: string = dr.from;
const to: string = dr.to;
const valid: boolean = dr.valid;
dr.set('2026-01-01', '2026-03-31');
dr.setPreset('thisQ');
dr.clear();
void from; void to; void valid;

/* ---------------- DateRange 静态函数 ---------------- */
const isoStr: string = DateRange.iso(new Date());
const d1: string = DateRange.addDays('2026-01-31', 1);
const d2: string = DateRange.addMonths('2026-01-31', 1);
const q: { y: number; q: number } = DateRange.quarterOf(new Date());
const qr: { from: string; to: string } = DateRange.quarterRange(2026, 0);
void isoStr; void d1; void d2; void q; void qr;

/* ---------------- 有 destroy 的组件 ---------------- */
const dd = Dropdown.create(ddRoot);
dd.open(); dd.close(); dd.destroy();

const tree = Tree.create(treeRoot, { label: '目录' });
tree.focusAt(0);
// ⭐ selected 是 HTMLElement，不是 string
const node: HTMLElement | null = tree.selected;
tree.destroy();
void node;

export {};