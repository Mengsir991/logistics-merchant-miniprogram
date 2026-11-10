const { call } = require('../utils/cloud');

/** 运单相关接口，全部走同一个云函数 orderApi，用 action 分发 */
const api = (action, payload = {}) => call('orderApi', { action, ...payload });

module.exports = {
  /** 工作台统计：今日单量/待打印/异常/累计 */
  stats: () => api('stats'),

  /** 列表：{ status, keyword, page, size } */
  list: params => api('list', params),

  /** 详情 */
  detail: id => api('detail', { id }),

  /** 批量创建：rows 为已校验的行数组 */
  createBatch: (rows, fileName) => api('createBatch', { rows, fileName }),

  /** 取号（生成电子面单） */
  createWaybill: id => api('createWaybill', { id }),

  /** 标记已打印 */
  markPrinted: ids => api('markPrinted', { ids }),

  /** 取消运单 */
  cancel: id => api('cancel', { id }),

  /** 物流轨迹 */
  trace: id => api('trace', { id })
};
