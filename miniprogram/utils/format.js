/** 通用格式化工具 */

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** Date|string|number -> 2026-11-10 14:05 */
function formatTime(input, withTime = true) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对时间：刚刚 / 5分钟前 / 3小时前 / 昨天 14:05 */
function fromNow(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  const diff = Date.now() - d.getTime();
  if (isNaN(diff)) return '';
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 48 * 60 * 60 * 1000) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  return formatTime(d, false);
}

/** 手机号脱敏：138****8000 */
function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

/** 手机号校验（大陆 11 位） */
function isPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

/** 重量显示：0.5 -> 0.5kg */
function weightText(w) {
  const n = Number(w);
  if (!n || n <= 0) return '—';
  return (Math.round(n * 100) / 100) + 'kg';
}

/** 省市区 + 详细地址 拼一行 */
function fullAddress(addr) {
  if (!addr) return '';
  return [addr.province, addr.city, addr.district, addr.detail]
    .filter(Boolean)
    .join('');
}

module.exports = {
  formatTime,
  fromNow,
  maskPhone,
  isPhone,
  weightText,
  fullAddress
};
