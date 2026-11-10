/**
 * 批量导入行校验
 * 原则：服务端必须二次校验，前端校验只用来提升体验，不能作为安全边界
 */

// 常见快递编码，需与你签约的服务商文档核实后调整
const EXPRESS_CODES = ['SF', 'YTO', 'ZTO', 'STO', 'YD', 'JTSD', 'JD', 'EMS'];
const DEFAULT_EXPRESS = 'SF';

const s = v => String(v === null || v === undefined ? '' : v).trim();

/**
 * @param {object} raw 前端解析后的一行（字段已命名）
 * @param {number} index 行号，仅用于报错定位
 * @returns {{ ok:boolean, data?:object, errors?:string[] }}
 */
function normalizeRow(raw, index) {
  const errors = [];

  const shopOrderNo = s(raw.shopOrderNo).slice(0, 40);
  const receiverName = s(raw.receiverName).slice(0, 20);
  const receiverPhone = s(raw.receiverPhone).replace(/[\s-]/g, '');
  const province = s(raw.province).slice(0, 20);
  const city = s(raw.city).slice(0, 20);
  const district = s(raw.district).slice(0, 20);
  const detail = s(raw.detail).slice(0, 100);
  const expressCode = s(raw.expressCode).toUpperCase() || DEFAULT_EXPRESS;
  const weight = Number(raw.weight);
  const count = raw.count === '' || raw.count === undefined ? 1 : Number(raw.count);

  if (!shopOrderNo) errors.push('订单号为空');
  if (!receiverName) errors.push('收件人为空');
  if (!/^1[3-9]\d{9}$/.test(receiverPhone)) errors.push('收件电话格式错误');
  if (!province) errors.push('省份为空');
  if (!city) errors.push('城市为空');
  if (!detail) errors.push('详细地址为空');
  if (!EXPRESS_CODES.includes(expressCode)) errors.push('快递编码不支持：' + expressCode);
  if (!weight || weight <= 0 || weight > 1000) errors.push('重量需在 0~1000kg 之间');
  if (!count || count < 1 || count > 999 || !Number.isInteger(count)) errors.push('件数需为 1~999 的整数');

  if (errors.length) {
    return { ok: false, errors, rowIndex: index, raw };
  }

  return {
    ok: true,
    data: {
      shopOrderNo,
      receiver: {
        name: receiverName,
        phone: receiverPhone,
        province,
        city,
        district,
        detail
      },
      goods: {
        weight: Math.round(weight * 100) / 100,
        count
      },
      expressCode
    }
  };
}

module.exports = { normalizeRow, EXPRESS_CODES, DEFAULT_EXPRESS };
