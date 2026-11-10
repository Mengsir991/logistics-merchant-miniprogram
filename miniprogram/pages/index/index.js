const app = getApp();
const orderSvc = require('../../services/order');
const { fromNow, formatTime } = require('../../utils/format');
const { STATUS_TEXT } = require('../../utils/constants');

Page({
  data: {
    merchant: null,
    greeting: '',
    todayText: '',
    stats: { today: 0, pendingPrint: 0, exception: 0, total: 0 },
    recent: [],
    loading: true,
    error: ''
  },

  onShow() {
    // 刚导入过订单，强制刷新一次（绕过下面的节流）
    if (app.globalData.needRefreshDashboard) {
      app.globalData.needRefreshDashboard = false;
      this._lastLoad = 0;
    }
    // E-07：切回页面不做无条件高频请求，30 秒内复用上次结果
    if (this._lastLoad && Date.now() - this._lastLoad < 30000) return;
    this.loadAll();
  },

  onPullDownRefresh() {
    this._lastLoad = 0;
    this.loadAll(true);
  },

  async loadAll(isRefresh = false) {
    this.setData({ loading: !isRefresh, error: '' });

    try {
      const session = await app.ready();
      const [stats, recent] = await Promise.all([
        orderSvc.stats(),
        orderSvc.list({ page: 1, size: 5 })
      ]);

      this._lastLoad = Date.now();
      this.setData({
        merchant: session.merchant,
        greeting: this.pickGreeting(),
        todayText: formatTime(new Date(), false),
        stats,
        recent: (recent.list || []).map(o => this.decorate(o)),
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    } finally {
      if (isRefresh) wx.stopPullDownRefresh();
    }
  },

  pickGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 12) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },

  statusClass(status) {
    const map = {
      pending_waybill: 'tag-plain',
      pending_print: 'tag-warn',
      printed: 'tag-primary',
      shipped: 'tag-primary',
      signed: 'tag-success',
      exception: 'tag-danger',
      cancelled: 'tag-plain'
    };
    return map[status] || 'tag-plain';
  },

  decorate(o) {
    return {
      ...o,
      statusText: STATUS_TEXT[o.status] || o.status || '—',
      statusClass: this.statusClass(o.status),
      regionLine: [o.receiver && o.receiver.province, o.receiver && o.receiver.city, o.receiver && o.receiver.district]
        .filter(Boolean)
        .join(' '),
      timeText: fromNow(o.createdAt)
    };
  },

  /* ---------- 交互 ---------- */

  onGoBatchImport() {
    wx.navigateTo({ url: '/pagesShip/batch-import/batch-import' });
  },

  onGoOrderList() {
    wx.switchTab({ url: '/pages/order-list/order-list' });
  },

  /** 带筛选状态跳到运单页（tabBar 页不能带参数，走 globalData 传递） */
  onGoPendingPrint() {
    app.globalData.presetStatus = 'pending_print';
    wx.switchTab({ url: '/pages/order-list/order-list' });
  },

  onGoException() {
    app.globalData.presetStatus = 'exception';
    wx.switchTab({ url: '/pages/order-list/order-list' });
  },

  onGoMine() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  onTapOrder(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pagesShip/order-detail/order-detail?id=${id}` });
  },

  onRetry() {
    this._lastLoad = 0;
    this.loadAll();
  },

  onShareAppMessage() {
    return {
      title: '发货助手 - 批量发货打单',
      path: '/pages/index/index'
    };
  }
});
