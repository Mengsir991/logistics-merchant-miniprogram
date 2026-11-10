/**
 * ============================================================
 *  电子面单服务商适配层（核心解耦点）
 * ============================================================
 *
 * 为什么单独一层：
 *   面单取号没有「微信一家通吃」的接口 —— 你要么走微信物流助手，
 *   要么走快递鸟/菜鸟/顺丰丰桥等第三方聚合，要么直接对接各家快递公司。
 *   各家请求参数、签名方式、返回结构都不一样。把差异全部关在这个文件里，
 *   换服务商时只改这里，页面和业务逻辑一行都不用动。
 *
 * 当前模式：mock（本地造号，用于打通前端全流程，不能真实发货）
 *
 * 切换真实接口的步骤：
 *   1. 云开发控制台 → 云函数 orderApi → 配置 → 环境变量，写入：
 *        DELIVERY_MODE = kdn / wxlogistics / sf / ...
 *        DELIVERY_APP_KEY / DELIVERY_APP_SECRET / DELIVERY_CUSTOMER_NO ...
 *      （密钥只放服务端环境变量，绝不可写进小程序代码）
 *   2. 按服务商文档实现下面三个函数的 real 分支
 *   3. 云函数需要在「云开发控制台 → 设置 → 环境 → 静态资源/外网访问」确认可出网
 *
 * ⚠️ 以下三家平台的真实接口参数、签名算法、编码字典，必须以各自官方文档为准，
 *    本文件不内置任何平台的接口细节，避免给出过时或错误的参数导致你白调。
 *      · 微信物流助手：微信开放社区「物流助手」能力文档
 *      · 快递鸟：快递鸟开放平台（即时查询 / 电子面单接口）
 *      · 菜鸟开放平台 / 顺丰丰桥：对应开放平台文档
 */

const MODE = process.env.DELIVERY_MODE || 'mock';

const EXPRESS_NAME = {
  SF: '顺丰速运',
  YTO: '圆通速递',
  ZTO: '中通快递',
  STO: '申通快递',
  YD: '韵达速递',
  JTSD: '极兔速递',
  JD: '京东物流',
  EMS: '中国邮政EMS'
};

/** 生成模拟运单号：真实场景由服务商返回 */
function mockWaybillNo(expressCode) {
  const prefix = { SF: 'SF', YTO: 'YT', ZTO: 'ZT', STO: 'ST', YD: 'YD', JTSD: 'JT', JD: 'JD', EMS: 'EA' }[expressCode] || 'EX';
  const ts = String(Date.now()).slice(-9);
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return prefix + ts + rand;
}

/** 模拟三段码/大头笔，真实值由服务商按收件地址解析返回 */
function mockSortCode(order) {
  const city = order.receiver.city || '';
  const d = order.receiver.district || '';
  return (city.slice(0, 1) || 'A') + '-' + (d.slice(0, 1) || 'B') + '-' + String(Math.floor(Math.random() * 900) + 100);
}

/**
 * 取号：下单并获取电子面单数据
 * @param {{order:object, merchant:object}} ctx
 * @returns {Promise<{waybillNo:string, label:object}>}
 */
async function createWaybill({ order, merchant }) {
  if (MODE === 'mock') {
    const waybillNo = mockWaybillNo(order.expressCode);
    return {
      waybillNo,
      label: {
        waybillNo,
        expressCode: order.expressCode,
        expressName: EXPRESS_NAME[order.expressCode] || order.expressCode,
        sortCode: mockSortCode(order),
        // 面单二维码内容：真实场景由服务商给（一般是运单号或加密串）
        qrContent: waybillNo,
        receiver: order.receiver,
        sender: order.sender,
        goods: order.goods,
        shopOrderNo: order.shopOrderNo,
        // 打印模板：不同快递公司面单版式不同，真实接入时这里换成服务商返回的模板ID
        templateId: 'standard_100x180'
      }
    };
  }

  // ===== 真实接入位置 =====
  // switch (MODE) {
  //   case 'kdn':        return await kdnCreate({ order, merchant });
  //   case 'wxlogistics':return await wxLogisticsCreate({ order, merchant });
  //   case 'sf':         return await sfCreate({ order, merchant });
  //   default: throw new Error('未支持的 DELIVERY_MODE: ' + MODE);
  // }
  throw new Error('面单服务商未配置：当前 DELIVERY_MODE=' + MODE + '，请先实现对应分支');
}

/**
 * 取消运单（已取号的单必须先向服务商取消，否则会占额度/产生费用）
 */
async function cancelWaybill({ order }) {
  if (MODE === 'mock') {
    return { ok: true };
  }
  throw new Error('面单服务商取消接口未实现：DELIVERY_MODE=' + MODE);
}

/**
 * 查询物流轨迹
 * @returns {Promise<Array<{time:string, desc:string}>>}
 */
async function queryTrace({ order }) {
  if (MODE === 'mock') {
    if (!order.waybillNo) return [];
    const base = Date.now();
    const fmt = ms => {
      const d = new Date(ms);
      const p = n => (n < 10 ? '0' + n : n);
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    return [
      { time: fmt(base - 30 * 60 * 1000), desc: '【已签收】快件已由本人签收，感谢使用' },
      { time: fmt(base - 5 * 3600 * 1000), desc: '【派送中】快递员正在派送，请保持电话畅通' },
      { time: fmt(base - 14 * 3600 * 1000), desc: `【运输中】快件已到达【${order.receiver.city}转运中心】` },
      { time: fmt(base - 30 * 3600 * 1000), desc: '【已揽收】快件已揽收，准备发往下一站' }
    ];
  }
  throw new Error('面单服务商轨迹接口未实现：DELIVERY_MODE=' + MODE);
}

module.exports = { createWaybill, cancelWaybill, queryTrace, MODE, EXPRESS_NAME };
