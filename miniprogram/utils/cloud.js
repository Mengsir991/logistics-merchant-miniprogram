/**
 * 云函数统一调用封装
 * 约定：云函数返回 { code: 0, data } 表示成功，非 0 为业务失败
 */
function call(name, data = {}, options = {}) {
  return wx.cloud
    .callFunction({ name, data })
    .then(res => {
      const r = (res && res.result) || {};
      if (r.code !== 0) {
        const err = new Error(r.msg || '操作失败');
        err.code = r.code;
        throw err;
      }
      return r.data;
    })
    .catch(err => {
      // 网络异常 / 云函数未部署 时这里兜底，避免页面拿到 undefined
      if (err && err.code) throw err;
      console.error(`[cloud] ${name} 调用失败`, err);
      throw new Error(err && err.errMsg ? err.errMsg : '网络异常，请稍后重试');
    });
}

/** 轻提示 */
function toast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 1800 });
}

/** 确认弹窗，返回 Promise<boolean> */
function confirm(content, title = '提示') {
  return new Promise(resolve => {
    wx.showModal({
      title,
      content,
      confirmColor: '#2563eb',
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false)
    });
  });
}

module.exports = { call, toast, confirm };
