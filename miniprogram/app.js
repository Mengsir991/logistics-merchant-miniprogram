const { ENV_ID } = require('./utils/constants');

let loginPromise = null;

App({
  globalData: {
    merchant: null,
    openid: '',
    loginError: ''
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[app] 当前基础库不支持云开发，请升级开发者工具/基础库');
      return;
    }
    // traceUser: true 便于在云开发控制台查看用户访问记录
    wx.cloud.init({ env: ENV_ID, traceUser: true });

    this.setupPrivacy();
    // 静默登录：拿 openid + 商家绑定关系，失败不阻塞页面渲染
    this.ready().catch(err => console.warn('[app] 登录失败', err.message));
  },

  /**
   * 页面统一用：const app = getApp(); const session = await app.ready();
   * 内部做 Promise 缓存，多页面并发调用只发一次请求
   */
  ready() {
    if (!loginPromise) {
      loginPromise = this.login().catch(err => {
        loginPromise = null; // 失败后允许下一页重试
        throw err;
      });
    }
    return loginPromise;
  },

  async login() {
    const res = await wx.cloud.callFunction({
      name: 'auth',
      data: { action: 'login' }
    });
    const r = res.result || {};
    if (r.code !== 0) {
      this.globalData.loginError = r.msg || '登录失败';
      throw new Error(this.globalData.loginError);
    }
    this.globalData.openid = r.data.openid;
    this.globalData.merchant = r.data.merchant;
    return r.data;
  },

  /** 隐私协议：低版本基础库没有该 API，需做存在性判断 */
  setupPrivacy() {
    if (!wx.getPrivacySetting) return;
    wx.getPrivacySetting({
      success: res => {
        if (res.needAuthorization) {
          // 真正调用隐私接口时系统会自动拉起授权弹窗，这里只做日志
          console.log('[app] 隐私协议待授权');
        }
      },
      fail: () => {}
    });
  }
});
