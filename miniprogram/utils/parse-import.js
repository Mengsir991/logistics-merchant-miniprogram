/**
 * 批量导入文本/CSV 解析
 *
 * 列顺序（与 utils/constants.js 的 IMPORT_COLUMNS 一致）：
 *   订单号, 收件人, 收件电话, 省, 市, 区/县, 详细地址, 重量(kg), 件数, 快递编码
 *
 * 支持：
 *   - 制表符分隔（从 Excel 直接复制粘贴，最常用）
 *   - 英文逗号 / 中文逗号分隔（CSV）
 *   - 自动跳过表头行
 *   - 快递公司中文名 / 编码混用
 *
 * 不支持：xlsx 二进制（需在云函数装解析库，见项目档案待办）
 */

const EXPRESS_ALIAS = {
  顺丰: 'SF',
  顺丰速运: 'SF',
  圆通: 'YTO',
  圆通速递: 'YTO',
  中通: 'ZTO',
  中通快递: 'ZTO',
  申通: 'STO',
  申通快递: 'STO',
  韵达: 'YD',
  韵达速递: 'YD',
  极兔: 'JTSD',
  极兔速递: 'JTSD',
  京东: 'JD',
  京东物流: 'JD',
  EMS: 'EMS',
  邮政: 'EMS'
};

const VALID_CODES = ['SF', 'YTO', 'ZTO', 'STO', 'YD', 'JTSD', 'JD', 'EMS'];
const DEFAULT_EXPRESS = 'SF';

function trim(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

/** 按分隔符切片：优先 tab，其次逗号（含中文逗号） */
function splitLine(line) {
  if (line.indexOf('\t') > -1) return line.split('\t');
  return line.split(/[,，]/);
}

function normalizeExpress(v) {
  const raw = trim(v);
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (VALID_CODES.includes(upper)) return upper;
  return EXPRESS_ALIAS[raw] || upper;
}

/** 判断是否为表头行 */
function isHeader(cells) {
  const joined = cells.join('');
  return /订单(号|编号)?/.test(joined) && /(收件|收货|姓名|电话)/.test(joined);
}

/**
 * @param {string} text 原始文本
 * @returns {{ rows: Array, validCount:number, invalidCount:number }}
 */
function parseRows(text) {
  const raw = String(text || '').replace(/^\uFEFF/, ''); // 去 BOM
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.replace(/\s+$/, ''))
    .filter(l => l.trim());

  const rows = [];
  let headerSkipped = false;

  lines.forEach((line, i) => {
    const cells = splitLine(line).map(trim);

    if (!headerSkipped && i === 0 && isHeader(cells)) {
      headerSkipped = true;
      return;
    }

    const errors = [];

    const shopOrderNo = cells[0] || '';
    const receiverName = cells[1] || '';
    const receiverPhone = (cells[2] || '').replace(/[\s-]/g, '');
    const province = cells[3] || '';
    const city = cells[4] || '';
    const district = cells[5] || '';
    const detail = cells[6] || '';
    const weightRaw = cells[7] || '';
    const countRaw = cells[8] || '';
    const expressRaw = cells[9] || '';

    const expressCode = normalizeExpress(expressRaw) || DEFAULT_EXPRESS;
    const weight = Number(weightRaw);
    const count = countRaw === '' ? 1 : Number(countRaw);

    if (cells.length < 7) errors.push('列数不足，至少需要 7 列');
    if (!shopOrderNo) errors.push('订单号为空');
    if (!receiverName) errors.push('收件人为空');
    if (!/^1[3-9]\d{9}$/.test(receiverPhone)) errors.push('电话格式错误');
    if (!province) errors.push('省份为空');
    if (!city) errors.push('城市为空');
    if (!detail) errors.push('详细地址为空');
    if (!weightRaw) {
      errors.push('重量为空');
    } else if (!weight || weight <= 0 || weight > 1000) {
      errors.push('重量需在 0~1000kg');
    }
    if (!count || count < 1 || count > 999) errors.push('件数需为 1~999');
    if (!VALID_CODES.includes(expressCode)) errors.push('快递编码不支持：' + expressRaw);

    rows.push({
      lineNo: i + 1,
      ok: errors.length === 0,
      errors,
      raw: {
        shopOrderNo,
        receiverName,
        receiverPhone,
        province,
        city,
        district,
        detail,
        weight: weightRaw,
        count: String(count),
        expressCode
      }
    });
  });

  const validCount = rows.filter(r => r.ok).length;
  return { rows, validCount, invalidCount: rows.length - validCount };
}

module.exports = { parseRows, normalizeExpress, VALID_CODES, DEFAULT_EXPRESS };
