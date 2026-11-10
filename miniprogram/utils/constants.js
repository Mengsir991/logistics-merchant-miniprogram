/**
 * 全局常量
 * 注意：快递公司编码需与你签约的电子面单服务商（微信物流助手 / 快递鸟 / 各家开放平台）
 * 提供的编码保持一致，此处为常见编码示例，接入前请对照服务商文档核实。
 */

// TODO: 换成你自己的云开发环境 ID（开发者工具 - 云开发控制台 - 设置 - 环境ID）
const ENV_ID = 'your-env-id';

// 快递公司列表（code 为服务商侧编码，务必核实）
const EXPRESS_LIST = [
  { code: 'SF', name: '顺丰速运' },
  { code: 'YTO', name: '圆通速递' },
  { code: 'ZTO', name: '中通快递' },
  { code: 'STO', name: '申通快递' },
  { code: 'YD', name: '韵达速递' },
  { code: 'JTSD', name: '极兔速递' },
  { code: 'JD', name: '京东物流' },
  { code: 'EMS', name: '中国邮政EMS' }
];

// 运单状态机
const ORDER_STATUS = {
  PENDING_WAYBILL: 'pending_waybill', // 待取号
  PENDING_PRINT: 'pending_print',     // 待打印
  PRINTED: 'printed',                 // 已打印
  SHIPPED: 'shipped',                 // 运输中
  SIGNED: 'signed',                   // 已签收
  EXCEPTION: 'exception',             // 异常件
  CANCELLED: 'cancelled'              // 已取消
};

const STATUS_TEXT = {
  pending_waybill: '待取号',
  pending_print: '待打印',
  printed: '已打印',
  shipped: '运输中',
  signed: '已签收',
  exception: '异常',
  cancelled: '已取消'
};

// 列表页顶部分段筛选
const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'pending_print', label: '待打印' },
  { key: 'shipped', label: '运输中' },
  { key: 'exception', label: '异常' },
  { key: 'signed', label: '已签收' }
];

// 批量导入：CSV / 粘贴文本的列顺序约定
const IMPORT_COLUMNS = [
  '订单号', '收件人', '收件电话', '省', '市', '区/县',
  '详细地址', '重量(kg)', '件数', '快递编码'
];

const PAGE_SIZE = 15;

module.exports = {
  ENV_ID,
  EXPRESS_LIST,
  ORDER_STATUS,
  STATUS_TEXT,
  STATUS_TABS,
  IMPORT_COLUMNS,
  PAGE_SIZE
};
