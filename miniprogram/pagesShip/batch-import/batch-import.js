const app = getApp();
const orderSvc = require('../../services/order');
const { parseRows } = require('../../utils/parse-import');
const { toast, confirm } = require('../../utils/cloud');

const SAMPLE = [
  'ORD20261110001\t张三\t13800138000\t四川省\t成都市\t武侯区\t天府大道北段1号1栋101\t1.5\t1\tSF',
  'ORD20261110002\t李四\t13900139000\t四川省\t绵阳市\t涪城区\t临园路东段2号\t0.8\t2\tYTO'
].join('\n');

const MAX_ROWS = 200;

Page({
  data: {
    mode: 'paste', // paste | file
    fileName: '',
    rawText: '',
    rows: [],
    validCount: 0,
    invalidCount: 0,
    parsed: false,
    submitting: false,
    result: null
  },

  onLoad() {
    app.ready().catch(() => {});
  },

  /* ---------- 输入 ---------- */

  onModeSwitch(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode });
  },

  onTextInput(e) {
    this.setData({ rawText: e.detail.value, parsed: false, rows: [] });
  },

  onFillSample() {
    this.setData({ rawText: SAMPLE, parsed: false, rows: [] }, () => this.doParse());
  },

  onClearText() {
    this.setData({ rawText: '', fileName: '', rows: [], parsed: false, validCount: 0, invalidCount: 0 });
  },

  /** 从聊天记录选择 CSV / TXT 文件 */
  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;

        // 大小保护：>5MB 的文本几乎不可能是几百条订单
        if (file.size > 5 * 1024 * 1024) {
          return toast('文件过大，请拆分后导入');
        }

        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf-8',
          success: r => {
            this.setData(
              { rawText: r.data, fileName: file.name, parsed: false, rows: [] },
              () => this.doParse()
            );
          },
          fail: () => {
            wx.showModal({
              title: '读取失败',
              content: '若文件是 Excel 另存的 CSV，请确认编码为 UTF-8（Excel 默认 GBK 会乱码）。',
              showCancel: false
            });
          }
        });
      },
      fail: err => {
        if (err && /cancel/.test(err.errMsg || '')) return;
        toast('选择文件失败');
      }
    });
  },

  /* ---------- 解析预览 ---------- */

  doParse() {
    const text = this.data.rawText;
    if (!String(text || '').trim()) return toast('请先粘贴内容或选择文件');

    const { rows, validCount, invalidCount } = parseRows(text);

    if (!rows.length) return toast('没有解析到有效行，请检查格式');

    this.setData({ rows, validCount, invalidCount, parsed: true });

    if (rows.length > MAX_ROWS) {
      wx.showModal({
        title: '超出单次上限',
        content: `本次解析到 ${rows.length} 行，单次最多导入 ${MAX_ROWS} 条，请拆分文件后分批导入。`,
        showCancel: false
      });
    }
  },

  /** 删除某一行（格式错的行可以直接剔掉，不用回去改原文件） */
  onRemoveRow(e) {
    const index = Number(e.currentTarget.dataset.index);
    const rows = this.data.rows.slice();
    rows.splice(index, 1);
    const validCount = rows.filter(r => r.ok).length;
    this.setData({ rows, validCount, invalidCount: rows.length - validCount, parsed: rows.length > 0 });
  },

  /* ---------- 提交 ---------- */

  async onSubmit() {
    if (this.data.submitting) return;

    const valid = this.data.rows.filter(r => r.ok);
    if (!valid.length) return toast('没有可提交的数据');
    if (valid.length > MAX_ROWS) return toast(`单次最多 ${MAX_ROWS} 条`);

    const ok = await confirm(
      `本次将导入 ${valid.length} 条订单${this.data.invalidCount ? `（另有 ${this.data.invalidCount} 条格式错误将被跳过）` : ''}，导入后可在运单列表取号打印。`,
      '确认导入'
    );
    if (!ok) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: '导入中', mask: true });

    try {
      const res = await orderSvc.createBatch(valid.map(r => r.raw), this.data.fileName || '粘贴导入');
      wx.hideLoading();
      // 通知工作台和运单列表刷新
      app.globalData.needRefreshDashboard = true;
      app.globalData.needRefreshOrders = true;
      this.setData({ submitting: false, result: res });
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showModal({
        title: '导入失败',
        content: err.message || '请稍后重试',
        showCancel: false
      });
    }
  },

  /* ---------- 结果页操作 ---------- */

  onGoOrders() {
    app.globalData.presetStatus = '';
    app.globalData.needRefreshOrders = true; // 通知运单列表强制刷新
    wx.switchTab({ url: '/pages/order-list/order-list' });
  },

  onReset() {
    this.setData({
      rawText: '',
      fileName: '',
      rows: [],
      parsed: false,
      validCount: 0,
      invalidCount: 0,
      result: null
    });
  }
});
