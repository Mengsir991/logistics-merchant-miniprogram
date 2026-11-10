const app = getApp();
const orderSvc = require('../../services/order');
const { fromNow } = require('../../utils/format');
const { STATUS_TABS, STATUS_TEXT, PAGE_SIZE } = require('../../utils/constants');
const { confirm, toast } = require('../../utils/cloud');

Page({
  data: {
    tabs: STATUS_TABS,
    status: '',
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    firstLoaded: false,
    selectedIds: [],
    selectedCount: 0,
    allChecked: false,
    error: ''
  },

  onLoad(options) {
    // 支持从其它页面带 status 参数进来（如 ?status=exception）
    if (options && options.status) {
      this.setData({ status: options.status });
    }
  },

  onShow() {
    // 从工作台点「待打印」跳过来时，globalData 里会带筛选状态
    const preset = app.globalData.presetStatus;
    if (preset) {
      app.globalData.presetStatus = '';
      app.globalData.needRefreshOrders = false;
      this.setData({ status: preset }, () => this.reload());
      return;
    }

    // 批量导入完成后需要强制刷新
    if (app.globalData.needRefreshOrders) {
      app.globalData.needRefreshOrders = false;
      this.setData({ status: '' }, () => this.reload());
      return;
    }

    // 首次进入或从其它页返回后需要刷新（打印完状态会变）
    if (!this.data.firstLoaded || this._dirty) {
      this._dirty = false;
      this.reload();
    }
  },

  onPullDownRefresh() {
    this.reload(true);
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadList(false);
  },

  /* ---------- 数据 ---------- */

  reload(isRefresh = false) {
    this.setData({ page: 1, hasMore: true, selectedIds: [], selectedCount: 0, allChecked: false });
    return this.loadList(false, isRefresh);
  },

  async loadList(isAppend = true, isRefresh = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });

    const page = isAppend ? this.data.page : 1;

    try {
      await app.ready();
      const res = await orderSvc.list({
        status: this.data.status,
        keyword: this.data.keyword,
        page,
        size: PAGE_SIZE
      });

      const decorated = (res.list || []).map(o => this.decorate(o));
      const list = isAppend ? this.data.list.concat(decorated) : decorated;

      // 关键：页码在成功后统一 +1，避免上拉时重复请求同一页
      this.setData({
        list,
        page: res.hasMore ? page + 1 : page,
        total: res.total,
        hasMore: !!res.hasMore,
        loading: false,
        firstLoaded: true,
        allChecked: false
      });
    } catch (err) {
      this.setData({ loading: false, firstLoaded: true, error: err.message || '加载失败' });
    } finally {
      if (isRefresh) wx.stopPullDownRefresh();
    }
  },

  decorate(o) {
    const map = {
      pending_waybill: 'tag-plain',
      pending_print: 'tag-warn',
      printed: 'tag-primary',
      shipped: 'tag-primary',
      signed: 'tag-success',
      exception: 'tag-danger',
      cancelled: 'tag-plain'
    };
    return {
      ...o,
      checked: false,
      statusText: STATUS_TEXT[o.status] || o.status,
      statusClass: map[o.status] || 'tag-plain',
      regionLine: [o.receiver.province, o.receiver.city, o.receiver.district].filter(Boolean).join(' '),
      timeText: fromNow(o.createdAt)
    };
  },

  /* ---------- 筛选与搜索 ---------- */

  onSwitchTab(e) {
    const status = e.currentTarget.dataset.key || '';
    if (status === this.data.status) return;
    this.setData({ status, keyword: '' }, () => this.reload());
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  onClearKeyword() {
    this.setData({ keyword: '' }, () => this.reload());
  },

  /* ---------- 选择 ---------- */

  onToggleSelect(e) {
    const index = Number(e.currentTarget.dataset.index);
    const key = `list[${index}].checked`;
    const next = !this.data.list[index].checked;

    this.setData({ [key]: next }, () => this.refreshSelection());
  },

  onToggleAll() {
    const next = !this.data.allChecked;
    const list = this.data.list.map(item => ({ ...item, checked: next }));
    this.setData({ list, allChecked: next }, () => this.refreshSelection());
  },

  refreshSelection() {
    const ids = this.data.list.filter(i => i.checked).map(i => i._id);
    this.setData({
      selectedIds: ids,
      selectedCount: ids.length,
      allChecked: this.data.list.length > 0 && ids.length === this.data.list.length
    });
  },

  /* ---------- 批量操作 ---------- */

  onBatchPrint() {
    const ids = this.data.selectedIds;
    if (!ids.length) return toast('请先勾选运单');

    // 提醒：取号会产生真实面单（mock 模式下不会）
    wx.navigateTo({
      url: `/pagesShip/print/print?ids=${ids.join(',')}`,
      success: () => {
        this._dirty = true;
      }
    });
  },

  async onBatchCancel() {
    const ids = this.data.selectedIds;
    if (!ids.length) return toast('请先勾选运单');

    const ok = await confirm(`确定取消选中的 ${ids.length} 个运单？已取号的面单会同步向服务商申请作废。`, '取消运单');
    if (!ok) return;

    wx.showLoading({ title: '处理中', mask: true });
    let success = 0;
    const errors = [];

    // 串行处理，避免服务商并发限流
    for (const id of ids) {
      try {
        await orderSvc.cancel(id);
        success += 1;
      } catch (err) {
        errors.push(err.message);
      }
    }

    wx.hideLoading();
    this._dirty = true;
    this.reload();

    if (errors.length) {
      wx.showModal({
        title: `成功 ${success} 个，失败 ${errors.length} 个`,
        content: errors.slice(0, 3).join('\n'),
        showCancel: false
      });
    } else {
      toast(`已取消 ${success} 个运单`, 'success');
    }
  },

  onTapOrder(e) {
    const id = e.currentTarget.dataset.id;
    this._dirty = true;
    wx.navigateTo({ url: `/pagesShip/order-detail/order-detail?id=${id}` });
  },

  onGoImport() {
    wx.navigateTo({ url: '/pagesShip/batch-import/batch-import' });
  }
});
