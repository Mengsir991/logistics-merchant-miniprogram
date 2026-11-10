/**
 * orderApi — 运单主接口
 *
 * 所有 action 都从 cloud.getWXContext().OPENID 取身份，前端传什么 merchantId 都不采信，
 * 这是防越权的第一道墙（前端可以随便改，服务端必须自己认人）。
 *
 * ⚠️ 部署后请在云开发控制台把本函数「超时时间」调到 20 秒，
 *    批量导入 200 条默认 3 秒会超时。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const { normalizeRow } = require('./lib/validate');
const delivery = require('./lib/delivery');

const COLL_ORDERS = 'orders';
const COLL_MERCHANTS = 'merchants';
const COLL_BATCHES = 'import_batches';

const OK = (data = null) => ({ code: 0, data });
const ERR = (msg, code = 400) => ({ code, msg });

/** 北京时间今日 0 点对应的 UTC 时间点（云函数运行在 UTC） */
function startOfTodayBJ() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = bj.getUTCFullYear();
  const m = bj.getUTCMonth();
  const d = bj.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 8 * 3600 * 1000);
}

async function getMerchant(openid) {
  const { data } = await db
    .collection(COLL_MERCHANTS)
    .where({ openid })
    .limit(1)
    .get();
  return data[0] || null;
}

async function getOwnOrder(openid, id) {
  if (!id) return null;
  const { data } = await db
    .collection(COLL_ORDERS)
    .where({ _id: id, openid })
    .limit(1)
    .get();
  return data[0] || null;
}

function buildSender(merchant) {
  const s = (merchant && merchant.defaultSender) || {};
  return {
    name: s.name || merchant.contact || merchant.name || '',
    phone: s.phone || merchant.phone || '',
    province: s.province || '',
    city: s.city || '',
    district: s.district || '',
    detail: s.detail || ''
  };
}

/* ============================ actions ============================ */

async function stats(openid) {
  const col = db.collection(COLL_ORDERS);
  const todayStart = startOfTodayBJ();

  const [today, pendingPrint, exception, total] = await Promise.all([
    col.where({ openid, createdAt: _.gte(todayStart) }).count(),
    col.where({ openid, status: 'pending_print' }).count(),
    col.where({ openid, status: 'exception' }).count(),
    col.where({ openid }).count()
  ]);

  return OK({
    today: today.total,
    pendingPrint: pendingPrint.total,
    exception: exception.total,
    total: total.total
  });
}

async function list(openid, { status, keyword, page = 1, size = 15 }) {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(size) || 15));
  const kw = String(keyword || '').trim().slice(0, 40);

  let condition = { openid };
  if (status) condition.status = status;

  if (kw) {
    const reg = db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
    condition = _.and([
      condition,
      _.or([
        { shopOrderNo: reg },
        { waybillNo: reg },
        { 'receiver.name': reg },
        { 'receiver.phone': reg }
      ])
    ]);
  }

  const col = db.collection(COLL_ORDERS);
  const [countRes, listRes] = await Promise.all([
    col.where(condition).count(),
    col
      .where(condition)
      .orderBy('createdAt', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()
  ]);

  return OK({
    total: countRes.total,
    page: pageNum,
    size: pageSize,
    hasMore: pageNum * pageSize < countRes.total,
    list: listRes.data
  });
}

async function detail(openid, id) {
  const order = await getOwnOrder(openid, id);
  if (!order) return ERR('运单不存在或无权查看', 404);
  return OK(order);
}

async function createBatch(openid, { rows, fileName }) {
  if (!Array.isArray(rows) || !rows.length) return ERR('没有可导入的数据');
  if (rows.length > 200) return ERR('单次最多导入 200 条，请分批导入');

  const merchant = await getMerchant(openid);
  if (!merchant) return ERR('商家信息不存在，请重新进入小程序', 403);
  if (merchant.status === 'disabled') return ERR('账号已停用，请联系管理员', 403);

  /* 1. 逐行校验 */
  const valid = [];
  const failed = [];
  rows.forEach((raw, i) => {
    const r = normalizeRow(raw || {}, i + 1);
    if (r.ok) {
      valid.push(r.data);
    } else {
      failed.push({
        rowIndex: r.rowIndex,
        shopOrderNo: (raw && raw.shopOrderNo) || '',
        reason: r.errors.join('；')
      });
    }
  });

  /* 2. 表内去重 */
  const seen = new Set();
  const deduped = [];
  valid.forEach(v => {
    if (seen.has(v.shopOrderNo)) {
      failed.push({ rowIndex: '-', shopOrderNo: v.shopOrderNo, reason: '本次导入中订单号重复' });
      return;
    }
    seen.add(v.shopOrderNo);
    deduped.push(v);
  });

  /* 3. 与库内已有订单去重（幂等，防止重复导入刷单量） */
  const existed = new Set();
  const nos = deduped.map(v => v.shopOrderNo);
  for (let i = 0; i < nos.length; i += 100) {
    const chunk = nos.slice(i, i + 100);
    const { data } = await db
      .collection(COLL_ORDERS)
      .where({ merchantId: merchant._id, shopOrderNo: _.in(chunk) })
      .field({ shopOrderNo: true })
      .get();
    data.forEach(d => existed.add(d.shopOrderNo));
  }

  const toInsert = deduped.filter(v => {
    if (existed.has(v.shopOrderNo)) {
      failed.push({ rowIndex: '-', shopOrderNo: v.shopOrderNo, reason: '订单号已存在，已跳过' });
      return false;
    }
    return true;
  });

  /* 4. 建批次记录，便于回溯「这批是怎么来的」 */
  const batchRes = await db.collection(COLL_BATCHES).add({
    data: {
      merchantId: merchant._id,
      openid,
      fileName: String(fileName || '').slice(0, 60),
      total: rows.length,
      successCount: 0,
      failCount: failed.length,
      status: 'processing',
      createdAt: db.serverDate()
    }
  });
  const batchId = batchRes._id;

  /* 5. 分批写入，每批 20 条并发，避免瞬时打爆数据库连接 */
  const sender = buildSender(merchant);
  let successCount = 0;

  for (let i = 0; i < toInsert.length; i += 20) {
    const chunk = toInsert.slice(i, i + 20);
    await Promise.all(
      chunk.map(v =>
        db.collection(COLL_ORDERS).add({
          data: {
            merchantId: merchant._id,
            openid,
            shopOrderNo: v.shopOrderNo,
            receiver: v.receiver,
            sender,
            goods: v.goods,
            expressCode: v.expressCode,
            expressName: delivery.EXPRESS_NAME[v.expressCode] || v.expressCode,
            waybillNo: '',
            label: null,
            status: 'pending_waybill', // 待取号
            printStatus: 'unprinted',
            importBatchId: batchId,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
      )
    );
    successCount += chunk.length;
  }

  /* 6. 回写批次结果 */
  await db
    .collection(COLL_BATCHES)
    .doc(batchId)
    .update({
      data: {
        successCount,
        failCount: failed.length,
        status: 'done',
        finishedAt: db.serverDate()
      }
    });

  return OK({
    batchId,
    total: rows.length,
    successCount,
    failCount: failed.length,
    // 只回传前 100 条失败明细，避免返回体过大
    failed: failed.slice(0, 100)
  });
}

async function createWaybill(openid, id) {
  const order = await getOwnOrder(openid, id);
  if (!order) return ERR('运单不存在或无权操作', 404);
  if (order.waybillNo) return OK({ waybillNo: order.waybillNo, label: order.label });
  if (['cancelled', 'signed'].includes(order.status)) return ERR('当前状态不可取号');

  const merchant = await getMerchant(openid);
  if (!merchant) return ERR('商家信息不存在', 403);

  let res;
  try {
    res = await delivery.createWaybill({ order, merchant });
  } catch (err) {
    console.error('[orderApi] 取号失败', err);
    return ERR('取号失败：' + (err.message || '服务商异常'));
  }

  await db
    .collection(COLL_ORDERS)
    .doc(id)
    .update({
      data: {
        waybillNo: res.waybillNo,
        label: res.label,
        status: 'pending_print',
        waybillCreatedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

  return OK({ waybillNo: res.waybillNo, label: res.label });
}

async function markPrinted(openid, ids) {
  if (!Array.isArray(ids) || !ids.length) return ERR('未选择运单');
  const safeIds = ids.filter(x => typeof x === 'string').slice(0, 100);
  if (!safeIds.length) return ERR('参数不合法');

  const col = db.collection(COLL_ORDERS);

  // 打印标记对全部选中单生效
  await col
    .where({ _id: _.in(safeIds), openid })
    .update({ data: { printStatus: 'printed', printedAt: db.serverDate(), updatedAt: db.serverDate() } });

  // 状态流转只对「待打印」的单生效，已发货/已签收的不动
  const r = await col
    .where({ _id: _.in(safeIds), openid, status: 'pending_print' })
    .update({ data: { status: 'printed' } });

  return OK({ updated: r.stats.updated });
}

async function cancel(openid, id) {
  const order = await getOwnOrder(openid, id);
  if (!order) return ERR('运单不存在或无权操作', 404);
  if (order.status === 'cancelled') return ERR('运单已取消');
  if (['shipped', 'signed'].includes(order.status)) return ERR('已发货/已签收的运单无法取消');

  // 已取号的单必须先向服务商取消，否则会占面单额度
  if (order.waybillNo) {
    const merchant = await getMerchant(openid);
    try {
      await delivery.cancelWaybill({ order, merchant });
    } catch (err) {
      return ERR('取消面单失败：' + (err.message || '服务商异常'));
    }
  }

  await db
    .collection(COLL_ORDERS)
    .doc(id)
    .update({
      data: { status: 'cancelled', cancelledAt: db.serverDate(), updatedAt: db.serverDate() }
    });

  return OK({ id });
}

async function trace(openid, id) {
  const order = await getOwnOrder(openid, id);
  if (!order) return ERR('运单不存在或无权查看', 404);
  if (!order.waybillNo) return OK([]);

  const merchant = await getMerchant(openid);
  try {
    const list = await delivery.queryTrace({ order, merchant });
    return OK(list || []);
  } catch (err) {
    return ERR('轨迹查询失败：' + (err.message || '服务商异常'));
  }
}

/* ============================ 入口 ============================ */

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return ERR('未获取到用户身份，请在小程序内访问', 401);

  const { action } = event;

  try {
    switch (action) {
      case 'stats':
        return await stats(OPENID);
      case 'list':
        return await list(OPENID, event);
      case 'detail':
        return await detail(OPENID, event.id);
      case 'createBatch':
        return await createBatch(OPENID, event);
      case 'createWaybill':
        return await createWaybill(OPENID, event.id);
      case 'markPrinted':
        return await markPrinted(OPENID, event.ids);
      case 'cancel':
        return await cancel(OPENID, event.id);
      case 'trace':
        return await trace(OPENID, event.id);
      default:
        return ERR('未知操作：' + action);
    }
  } catch (err) {
    console.error('[orderApi] 未捕获异常', action, err);
    return ERR('服务异常：' + (err.message || '未知错误'), 500);
  }
};
