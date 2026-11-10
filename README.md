# 发货助手 · 物流商家端小程序

微信原生小程序 + 微信云开发。面向**电商商家/企业客户**的批量发货打单工具。

主链路：**批量导入订单 → 向快递服务商取号（电子面单）→ 打印面单 → 回传状态 → 查轨迹**

---

## 一、跑起来（5 步）

### 1. 用微信开发者工具打开本项目

- 打开「微信开发者工具」→ 导入项目 → 选择本目录 `logistics-merchant-miniprogram`
- AppID 填你自己的小程序 AppID（云开发**必须**用真实 AppID，测试号不支持）
- 确认 `project.config.json` 里 `miniprogramRoot` = `miniprogram/`、`cloudfunctionRoot` = `cloudfunctions/`

### 2. 开通云开发并填入环境 ID

- 工具顶部「云开发」→ 开通（有免费额度）
- 复制环境 ID，改 `miniprogram/utils/constants.js` 第一行：

```js
const ENV_ID = 'your-env-id';   // ← 换成你的环境 ID
```

### 3. 建数据库集合

云开发控制台 → 数据库 → 新建以下 3 个集合（**权限都选「仅创建者可读写」或「所有用户不可读写」**，代码全部走云函数，前端不直连数据库）：

| 集合 | 用途 |
|---|---|
| `merchants` | 商家账号 |
| `orders` | 运单 |
| `import_batches` | 批量导入批次记录 |

### 4. 建索引（很重要，否则数据一多就慢）

`orders` 集合：

| 索引字段 | 类型 | 说明 |
|---|---|---|
| `openid`(升序) + `createdAt`(降序) | 复合，非唯一 | 列表主查询 |
| `status`(升序) + `createdAt`(降序) | 复合，非唯一 | 按状态筛选 |
| `merchantId`(升序) + `shopOrderNo`(升序) | 复合，**唯一** | 导入幂等去重（防重复导入） |
| `waybillNo`(升序) | 单字段，非唯一 | 按运单号搜 |

`merchants` 集合：

| 索引字段 | 类型 |
|---|---|
| `openid`(升序) | **唯一** |

### 5. 部署云函数（右键 → 上传并部署：云端安装依赖）

- `cloudfunctions/auth`
- `cloudfunctions/orderApi`

**部署后必做**：云开发控制台 → 云函数 → `orderApi` → 配置 → 把「超时时间」从默认 3 秒改成 **20 秒**。
批量导入 200 条在 3 秒内跑不完，不改必然超时报错。

---

## 二、跑通后你会看到什么

| 页面 | 路径 | 功能 |
|---|---|---|
| 工作台 | `pages/index/index` | 今日单量/待打印/异常/累计 + 快捷入口 + 最近运单 |
| 运单管理 | `pages/order-list/order-list` | 状态筛选、关键词搜索、勾选批量取号打印/取消 |
| 我的 | `pages/mine/mine` | 商家信息、账号入口、隐私指引 |
| 批量导入 | `pagesShip/batch-import/batch-import` | 粘贴文本 / 选 CSV，解析预览后提交 |
| 运单详情 | `pagesShip/order-detail/order-detail` | 收寄件信息、轨迹时间轴、取消/打印 |
| 打单 | `pagesShip/print/print` | 面单预览、保存图片、蓝牙打印 |

**第一次体验建议**：批量导入页 → 点「填入示例数据」→ 解析并预览 → 确认导入 → 回运单列表勾选 → 取号并打印。

---

## 三、⚠️ 关于面单：必须先看这段

这套代码里**面单取号是 mock 的**，运单号是本地造的假号。原因很简单：

> 电子面单不是微信一家的能力，必须和快递公司/聚合服务商签约拿到账号密钥，才能真实取号。

### 三种可选服务商

| 方案 | 说明 | 适合 |
|---|---|---|
| 微信物流助手 | 微信官方快递能力，商家在后台绑定快递公司账号 | 单量不大、想少对接 |
| 快递鸟 / 菜鸟开放平台 | 聚合多家快递，一套接口全通 | 多快递混发 |
| 各家直连（顺丰丰桥、中通、圆通…） | 价格最优、对接最重 | 单一大客户、量大 |

> 各平台的具体接口参数、签名算法、快递公司编码字典**必须以对应官方文档为准**，本仓库不内置任何一家的实现，避免给出过时参数。

### 接入方式（只改一个文件）

所有服务商差异都关在 `cloudfunctions/orderApi/lib/delivery.js`：

```js
async function createWaybill({ order, merchant })  // 取号
async function cancelWaybill({ order })            // 作废面单
async function queryTrace({ order })               // 查轨迹
```

1. 在云函数 `orderApi` 的**环境变量**里配 `DELIVERY_MODE` 和密钥（密钥绝不能写进小程序代码）
2. 在 `delivery.js` 里实现对应分支
3. 页面和业务逻辑一行都不用改

### 打印的现实约束

- **面单上的条码/二维码必须能扫**，所以正式打印要用服务商返回的面单图（`label.imageUrl`）。本地 canvas 画出来的只是**版式预览**，条码区是虚线占位，不能拿去发货。
- 小程序走不了经典蓝牙 SPP，只能 BLE。`utils/ble-printer.js` 是实验性实现，位图打印数据量 100KB+，单张要数秒到数十秒。
- 生产环境建议：**服务商云打印机（HTTP 下发）** > 电脑端打印 > 蓝牙。

---

## 四、审核合规：提审前先确认这几件事

> 以下为常见要求，**微信平台政策会更新，请以 [官方类目资质说明](https://developers.weixin.qq.com/miniprogram/product/material/category.html) 与 [运营规范](https://developers.weixin.qq.com/miniprogram/product/reject.html) 为准**。

1. **类目资质**：涉及快递/物流服务，通常需要《快递业务经营许可证》。若你只是给自己店铺发货用的内部工具，类目选择要按官方说明走，选错会直接驳回。
2. **隐私保护指引**：本工具收集收件人姓名、电话、地址，属于个人信息。必须在公众平台配置《用户隐私保护指引》并声明收集目的，否则审核不通过。
3. **不得对外开放注册**：当前 `auth` 云函数会在首次进入时自动建档。若小程序对外可见，建议改成邀请码/后台开通，否则任何人都能生成商家账号（也容易被判定为平台类业务）。
4. **测试账号**：提审时在备注里说明「商家内部发货管理工具，需登录后使用」，并提供可用的测试账号/白名单。

---

## 五、已知限制与下一步

| 项 | 状态 | 说明 |
|---|---|---|
| Excel `.xlsx` 直接导入 | 未做 | 需在 `orderApi` 装解析库（如 `node-xlsx`），当前支持粘贴 + CSV |
| 默认寄件人配置表单 | 未做 | 现在需手动在 `merchants.defaultSender` 写数据 |
| 快递账户管理页 | 未做 | 多快递账号切换 |
| 导入记录列表 | 未做 | `import_batches` 已有数据，页面待做 |
| 真实面单取号 | 待接入 | 见上方第三节 |
| 订阅消息通知 | 未做 | 签收/异常时推送给商家 |
| 权限分级（员工子账号） | 未做 | 当前按 openid 隔离，一人一号 |

---

## 六、目录结构

```
logistics-merchant-miniprogram/
├── project.config.json
├── miniprogram/
│   ├── app.js / app.json / app.wxss / sitemap.json
│   ├── components/         empty-state、load-more
│   ├── pages/              主包：工作台、运单列表、我的
│   ├── pagesShip/          分包：批量导入、运单详情、打单
│   ├── services/           order.js（云函数调用封装）
│   └── utils/              constants、format、cloud、parse-import、ble-printer
└── cloudfunctions/
    ├── auth/               静默登录 + 商家识别
    └── orderApi/           运单主接口
        └── lib/            validate.js（校验）、delivery.js（面单适配层）
```
