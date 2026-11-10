const app = getApp();
const { toast, confirm } = require('../../utils/cloud');

Page({
  data: {
    merchant: null,
    initial: '商',
    statusText: '待开通',
    loading: true
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const session = await app.ready();
      const m = session.merchant || {};
      const statusMap = { pending: '待开通', active: '正常', disabled: '已停用' };

      this.setData({
        merchant: m,
        initial: (m.name || '商').slice(0, 1),
        statusText: statusMap[m.status] || '待开通',
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  /* ---------- 各项入口 ---------- */

  onSenderInfo() {
    wx.showModal({
      title: '发货信息',
      content: '默认寄件人信息用于生成面单的寄件方。下一版将做成可编辑表单（姓名/电话/省市区/详细地址），目前需在云数据库 merchants 集合的 defaultSender 字段中配置。',
      showCancel: false
    });
  },

  onExpressAccount() {
    wx.showModal({
      title: '快递账户',
      content: '电子面单需要与快递公司或聚合服务商签约，拿到月结账号和密钥后，在服务端环境变量中配置（不可写在小程序里）。',
      showCancel: false
    });
  },

  onImportRecords() {
    wx.showModal({
      title: '导入记录',
      content: '每次批量导入都会在 import_batches 集合留一条批次记录（文件名、总条数、成功数、失败数），用于回溯。后续可在这一页做成列表。',
      showCancel: false
    });
  },

  onPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => toast('请先在后台配置《用户隐私保护指引》')
      });
    } else {
      toast('当前基础库不支持，请升级微信');
    }
  },

  async onClearCache() {
    const ok = await confirm('清除本地缓存不会删除云端运单数据，仅重置本地登录态。', '清除缓存');
    if (!ok) return;
    wx.clearStorageSync();
    toast('已清除', 'success');
  },

  onAbout() {
    wx.showModal({
      title: '发货助手',
      content: '版本 1.0.0\n物流商家端批量发货打单工具\n原生小程序 + 微信云开发',
      showCancel: false
    });
  },

  onContact() {
    wx.showModal({
      title: '联系客服',
      content: '需在微信公众平台配置客服人员并开启「客服消息」后，这里可换成 <button open-type="contact"> 直接进会话。',
      showCancel: false
    });
  }
});
