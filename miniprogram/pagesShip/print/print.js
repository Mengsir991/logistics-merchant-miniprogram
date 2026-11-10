const app = getApp();
const orderSvc = require('../../services/order');
const printer = require('../../utils/ble-printer');
const { toast, confirm } = require('../../utils/cloud');
const { formatTime, fullAddress } = require('../../utils/format');

// 100mm × 180mm 面单，203dpi 下约 800 × 1440 像素
const CANVAS_W = 800;
const CANVAS_H = 1440;

Page({
  data: {
    orders: [],
    index: 0,
    current: null,
    total: 0,
    loading: true,
    error: '',
    /** 有服务商返回的面单图时用 image 展示，否则用 canvas 画版式预览 */
    useImage: false,
    btConnected: false,
    printing: false,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H
  },

  onLoad(options) {
    const ids = String(options.ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!ids.length) {
      this.setData({ loading: false, error: '没有选择运单' });
      return;
    }
    this.setData({ ids });
    this.prepare();
  },

  onUnload() {
    printer.disconnect();
  },

  /* ============ 准备：取详情 + 缺号先取号 ============ */

  async prepare() {
    try {
      await app.ready();

      // 1. 拉详情（逐单，便于单条失败不影响整批）
      const details = [];
      for (const id of this.data.ids) {
        try {
          details.push(await orderSvc.detail(id));
        } catch (e) {
          // 无权/已删除，跳过
        }
      }
      if (!details.length) throw new Error('运单不存在或无权访问');

      // 2. 未取号的先取号
      const needWaybill = details.filter(d => !d.waybillNo && d.status !== 'cancelled');

      if (needWaybill.length) {
        const ok = await confirm(
          `本批 ${needWaybill.length} 单还没有运单号，需要先向快递服务商取号（会生成电子面单，可能产生费用）。`,
          '取号确认'
        );

        if (ok) {
          for (let i = 0; i < needWaybill.length; i++) {
            wx.showLoading({ title: `取号 ${i + 1}/${needWaybill.length}`, mask: true });
            const d = needWaybill[i];
            try {
              const r = await orderSvc.createWaybill(d._id);
              d.waybillNo = r.waybillNo;
              d.label = r.label || {};
              d.status = 'pending_print';
            } catch (err) {
              d._waybillError = err.message;
            }
          }
          wx.hideLoading();
        }
      }

      const printable = details.filter(d => d.waybillNo);
      if (!printable.length) {
        throw new Error('没有可打印的面单（取号未成功或运单已取消）');
      }

      this.setData(
        {
          orders: printable,
          total: printable.length,
          index: 0,
          loading: false
        },
        () => this.renderCurrent()
      );
    } catch (err) {
      this.setData({ loading: false, error: err.message || '准备失败' });
    }
  },

  /* ============ 渲染当前面单 ============ */

  renderCurrent() {
    const order = this.data.orders[this.data.index];
    if (!order) return;

    const label = order.label || {};
    const useImage = !!label.imageUrl;

    this.setData({ current: order, useImage }, () => {
      if (!useImage) this.paintLabelCanvas();
    });
  },

  paintLabelCanvas(retry = 0) {
    const order = this.data.current;
    if (!order) return;

    wx.createSelectorQuery()
      .in(this)
      .select('#label')
      .fields({ node: true, size: true })
      .exec(res => {
        const item = res && res[0];
        if (!item || !item.node) {
          // canvas 节点可能还没渲染出来，重试一次
          if (retry < 2) {
            setTimeout(() => this.paintLabelCanvas(retry + 1), 80);
          }
          return;
        }

        const canvas = item.node;
        const ctx = canvas.getContext('2d');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        this._canvas = canvas;

        this.paint(ctx, order);
      });
  },

  paint(ctx, order) {
    const label = order.label || {};
    const W = CANVAS_W;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 外框
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, W - 32, CANVAS_H - 32);

    let y = 60;
    const LEFT = 44;

    // ===== 表头 =====
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 46px sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(label.expressName || order.expressName || '快递', LEFT, y);

    ctx.font = '28px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('电子面单', W - LEFT, y + 14);

    y += 84;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LEFT, y);
    ctx.lineTo(W - LEFT, y);
    ctx.stroke();

    // ===== 运单号 =====
    y += 26;
    ctx.textAlign = 'left';
    ctx.font = 'bold 56px monospace';
    ctx.fillText(order.waybillNo || '', LEFT, y);
    y += 84;

    // ===== 条码占位 =====
    // 说明：真实条码必须能扫，只能由服务商返回或按 Code128 规范生成，
    // 本地不绘制假条码，避免快递员扫码失败。
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = '#9aa4b2';
    ctx.lineWidth = 2;
    ctx.strokeRect(LEFT, y, W - LEFT * 2, 190);
    ctx.restore();

    ctx.fillStyle = '#9aa4b2';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('条码区 · 正式打印由快递服务商生成', W / 2, y + 82);

    ctx.fillStyle = '#000000';
    y += 214;

    // ===== 三段码 / 大头笔 =====
    if (label.sortCode) {
      ctx.textAlign = 'left';
      ctx.font = '30px sans-serif';
      ctx.fillText('三段码', LEFT, y);
      ctx.font = 'bold 40px monospace';
      ctx.fillText(label.sortCode, LEFT + 130, y - 4);
      y += 60;
    }

    // ===== 收件人 =====
    y = this.paintBlock(ctx, y, '收', order.receiver, true);

    // ===== 寄件人 =====
    y = this.paintBlock(ctx, y, '寄', order.sender, false);

    // ===== 底部信息 =====
    y += 20;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LEFT, y);
    ctx.lineTo(W - LEFT, y);
    ctx.stroke();

    y += 20;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000000';
    ctx.font = '26px sans-serif';
    ctx.fillText(`订单号：${order.shopOrderNo || '—'}`, LEFT, y);

    ctx.textAlign = 'right';
    ctx.fillText(
      `${order.goods ? order.goods.weight : '—'}kg / ${order.goods ? order.goods.count : '—'}件`,
      W - LEFT,
      y
    );

    y += 46;
    ctx.textAlign = 'left';
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#555555';
    ctx.fillText(`打印时间：${formatTime(new Date())}`, LEFT, y);
  },

  /** 画一个收/寄件信息块，返回新的 y */
  paintBlock(ctx, y, tag, person, isReceiver) {
    const LEFT = 44;
    const W = CANVAS_W;
    if (!person) return y;

    // 左侧标记块
    ctx.fillStyle = '#000000';
    ctx.fillRect(LEFT, y, 56, 56);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(tag, LEFT + 28, y + 11);

    // 姓名 + 电话
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.font = `bold ${isReceiver ? 40 : 32}px sans-serif`;
    const nameLine = `${person.name || '—'}  ${person.phone || ''}`;
    ctx.fillText(nameLine, LEFT + 76, y + (isReceiver ? 6 : 10));

    y += isReceiver ? 66 : 58;

    // 地址
    const addr = fullAddress(person);
    ctx.font = `${isReceiver ? 32 : 26}px sans-serif`;
    const lines = this.wrapText(ctx, addr, W - LEFT * 2);

    lines.forEach(line => {
      ctx.fillText(line, LEFT, y);
      y += isReceiver ? 44 : 36;
    });

    return y + (isReceiver ? 14 : 8);
  },

  /** 按宽度折行（中英混排简单实现） */
  wrapText(ctx, text, maxWidth) {
    const chars = String(text || '').split('');
    const lines = [];
    let line = '';

    chars.forEach(ch => {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    });

    if (line) lines.push(line);
    return lines;
  },

  /* ============ 翻页 ============ */

  onPrev() {
    if (this.data.index <= 0) return toast('已经是第一单');
    this.setData({ index: this.data.index - 1 }, () => this.renderCurrent());
  },

  onNext() {
    if (this.data.index >= this.data.total - 1) return toast('已经是最后一单');
    this.setData({ index: this.data.index + 1 }, () => this.renderCurrent());
  },

  /* ============ 保存图片 ============ */

  async onSaveImage() {
    const order = this.data.current;
    if (!order) return;

    try {
      const tempPath = await this.getLabelImagePath();
      if (!tempPath) return;

      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempPath,
          success: resolve,
          fail: reject
        });
      });

      toast('已保存到相册', 'success');
    } catch (err) {
      const msg = (err && err.errMsg) || '';
      if (/auth deny|authorize/.test(msg)) {
        const r = await new Promise(resolve => {
          wx.showModal({
            title: '需要相册权限',
            content: '保存面单图片需要相册写入权限，去设置里打开？',
            success: res => resolve(res.confirm)
          });
        });
        if (r) wx.openSetting();
        return;
      }
      if (/cancel/.test(msg)) return;
      toast('保存失败');
    }
  },

  /**
   * 拿到当前面单的图片临时路径
   * 有服务商面单图 → 下载；否则 → canvas 导出
   */
  async getLabelImagePath() {
    const order = this.data.current;
    const imageUrl = order.label && order.label.imageUrl;

    if (imageUrl) {
      const res = await wx.cloud.downloadFile({ fileID: imageUrl });
      return res.tempFilePath;
    }

    if (!this._canvas) {
      toast('面单还没渲染完成');
      return '';
    }

    const res = await wx.canvasToTempFilePath({
      canvas: this._canvas,
      fileType: 'png',
      destWidth: CANVAS_W,
      destHeight: CANVAS_H
    });

    return res.tempFilePath;
  },

  /* ============ 蓝牙打印 ============ */

  async onBluetoothPrint() {
    if (this.data.printing) return;

    const ok = await confirm(
      '蓝牙位图打印受打印机固件影响，速度较慢（单张数秒到数十秒）。生产环境建议用服务商云打印机。继续？',
      '蓝牙打印'
    );
    if (!ok) return;

    try {
      this.setData({ printing: true });

      if (!printer.isConnected()) {
        wx.showLoading({ title: '搜索打印机', mask: true });
        const devices = await printer.scan(6000);
        wx.hideLoading();

        if (!devices.length) {
          this.setData({ printing: false });
          return toast('未发现蓝牙设备，请确认打印机已开机并靠近手机');
        }

        const picked = await this.pickDevice(devices);
        if (!picked) {
          this.setData({ printing: false });
          return;
        }

        wx.showLoading({ title: '连接中', mask: true });
        await printer.connect(picked.deviceId);
        wx.hideLoading();
        this.setData({ btConnected: true });
      }

      const tempPath = await this.getLabelImagePath();
      if (!tempPath) {
        this.setData({ printing: false });
        return;
      }

      wx.showLoading({ title: '生成打印数据', mask: true });
      const imageData = await this.getCanvasImageData();
      if (!imageData) {
        wx.hideLoading();
        this.setData({ printing: false });
        return toast('仅支持打印本地生成的面单');
      }

      const buffer = printer.buildRasterCommand(imageData.data, CANVAS_W, CANVAS_H, 160);

      wx.showLoading({ title: '打印中 0%', mask: true });
      // 分包写入由 ble-printer 内部完成，这里只给一个粗略进度提示
      const timer = setInterval(() => {
        const p = Math.min(95, Math.floor(Math.random() * 20) + 30);
        wx.showLoading({ title: `打印中 ${p}%`, mask: true });
      }, 800);

      await printer.writeBuffer(buffer);
      clearInterval(timer);
      wx.hideLoading();

      this.setData({ printing: false });
      await this.markCurrentPrinted();
      toast('已发送打印', 'success');
    } catch (err) {
      wx.hideLoading();
      this.setData({ printing: false });
      wx.showModal({ title: '打印失败', content: err.message || '请检查打印机状态', showCancel: false });
    }
  },

  pickDevice(devices) {
    return new Promise(resolve => {
      const list = devices.slice(0, 6);
      wx.showActionSheet({
        itemList: list.map(d => `${d.name}`),
        success: res => resolve(list[res.tapIndex]),
        fail: () => resolve(null)
      });
    });
  },

  /** 从 canvas 取像素数据 */
  getCanvasImageData() {
    if (!this._canvas) return null;
    const ctx = this._canvas.getContext('2d');
    return ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  },

  /* ============ 完成打印 ============ */

  async onDone() {
    await this.markCurrentPrinted();
    if (this.data.index < this.data.total - 1) {
      this.setData({ index: this.data.index + 1 }, () => this.renderCurrent());
    } else {
      toast('本批已全部处理', 'success');
      setTimeout(() => wx.navigateBack(), 800);
    }
  },

  async markCurrentPrinted() {
    const order = this.data.current;
    if (!order) return;
    try {
      await orderSvc.markPrinted([order._id]);
      // 同步本地状态，避免重复提交
      const key = `orders[${this.data.index}].status`;
      this.setData({ [key]: 'printed' });
    } catch (e) {
      console.warn('[print] 标记已打印失败', e);
    }
  },

  onCopyWaybill() {
    const order = this.data.current;
    if (!order || !order.waybillNo) return;
    wx.setClipboardData({ data: order.waybillNo });
  },

  onRetry() {
    this.setData({ loading: true, error: '' }, () => this.prepare());
  }
});
