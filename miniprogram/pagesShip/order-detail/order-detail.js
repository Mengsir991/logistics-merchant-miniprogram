const app = getApp();
const orderSvc = require('../../services/order');
const { formatTime, fullAddress } = require('../../utils/format');
const { STATUS_TEXT } = require('../../utils/constants');
const { toast, confirm } = require('../../utils/cloud');

Page({
  data: {
    order: null,
    trace: [],
    loading: true,
    error: '',
    tracing: false,
    canCancel: false
  },

  onLoad(options) {
    this.orderId = options.id;
    if (!this.orderId) {
      this.setData({ loading: false, error: '缺少运单参数' });
      return;
    }
    this.load();
  },

  async load() {
    try {
      await app.ready();
      const order = await orderSvc.detail(this.orderId);

      const canCancel = !['cancelled', 'shipped', 'signed'].includes(order.status);

      this.setData({
        order: {
          ...order,
          statusText: STATUS_TEXT[order.status] || order.status,
          receiverAddr: fullAddress(order.receiver),
          senderAddr: fullAddress(order.sender),
          createdText: formatTime(order.createdAt)
        },
        canCancel,
        loading: false
      });

      if (order.waybillNo) this.loadTrace();
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  async loadTrace() {
    this.setData({ tracing: true });
    try {
      const trace = await orderSvc.trace(this.orderId);
      this.setData({ trace: trace || [], tracing: false });
    } catch (err) {
      this.setData({ tracing: false });
    }
  },

  onCopy(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) return;
    wx.setClipboardData({ data: String(value) });
  },

  onPrint() {
    if (!this.data.order.waybillNo) {
      return toast('该运单还未取号，先取号再打印');
    }
    wx.navigateTo({ url: `/pagesShip/print/print?ids=${this.orderId}` });
  },

  async onCancel() {
    const ok = await confirm('取消后该运单不可恢复，已取号的面单会同步作废。', '取消运单');
    if (!ok) return;

    wx.showLoading({ title: '处理中', mask: true });
    try {
      await orderSvc.cancel(this.orderId);
      wx.hideLoading();
      toast('已取消', 'success');
      this.load();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({ title: '取消失败', content: err.message, showCancel: false });
    }
  },

  onRetry() {
    this.setData({ loading: true, error: '' }, () => this.load());
  }
});
