/**
 * auth 云函数：静默登录 + 商家身份识别
 *
 * 安全要点：
 * 1. openid 一律从 cloud.getWXContext() 取，绝不接受前端传入，防止越权
 * 2. 首页自动建档只是开发期便利，生产环境请改为「邀请码/后台开通」，
 *    否则任何人打开小程序都会生成一条商家记录
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event = {}) => {
  const { OPENID, UNIONID } = cloud.getWXContext();
  if (!OPENID) {
    return { code: 401, msg: '未获取到用户身份，请在小程序内访问' };
  }

  try {
    const { data } = await db
      .collection('merchants')
      .where({ openid: OPENID })
      .limit(1)
      .get();

    let merchant = data[0];

    if (!merchant) {
      // 首次进入，自动建档（status: pending，业务功能按需放行）
      const addRes = await db.collection('merchants').add({
        data: {
          openid: OPENID,
          unionid: UNIONID || '',
          name: '未命名商家',
          contact: '',
          phone: '',
          role: 'owner',
          status: 'pending', // pending | active | disabled
          expressAccounts: [], // [{ code:'SF', name:'顺丰速运', customerNo:'', customerPwd:'' }]
          createdAt: db.serverDate(),
          lastLoginAt: db.serverDate()
        }
      });
      merchant = {
        _id: addRes._id,
        name: '未命名商家',
        role: 'owner',
        status: 'pending',
        expressAccounts: []
      };
    } else {
      await db
        .collection('merchants')
        .doc(merchant._id)
        .update({ data: { lastLoginAt: db.serverDate() } });
    }

    // 不返回 expressAccounts 里的账号密码等敏感字段
    const safeMerchant = {
      _id: merchant._id,
      name: merchant.name,
      contact: merchant.contact || '',
      phone: merchant.phone || '',
      role: merchant.role || 'owner',
      status: merchant.status || 'pending',
      expressCount: Array.isArray(merchant.expressAccounts) ? merchant.expressAccounts.length : 0
    };

    return { code: 0, data: { openid: OPENID, merchant: safeMerchant } };
  } catch (err) {
    console.error('[auth] 失败', err);
    return { code: 500, msg: '登录服务异常：' + (err.message || '未知错误') };
  }
};
