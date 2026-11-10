/**
 * 蓝牙热敏打印机（BLE）—— 实验性模块
 *
 * ⚠️ 现实约束（务必先读）：
 *   1. 小程序只能走 BLE，无法使用经典蓝牙 SPP，因此只能对接「支持 BLE 的打印机」。
 *   2. 位图打印要把整张面单按行打包成 ESC/POS 光栅指令，数据量约 100~150KB，
 *      分包写入耗时数秒到数十秒，不同固件差异极大。
 *   3. 生产环境更推荐：① 服务商提供的云打印机（HTTP 下发，最稳）
 *                     ② 保存面单图片 → 用打印机厂商 App / 电脑端打印
 *
 * 本模块只做两件事：连接打印机 + 写入光栅指令，不含任何具体品牌适配。
 */

const CHUNK_FALLBACK = 20; // 未协商 MTU 时的安全分包大小

let conn = { deviceId: '', serviceId: '', charId: '', mtu: 20 };

function toPromise(fn, options = {}) {
  return new Promise((resolve, reject) => {
    fn({ ...options, success: resolve, fail: reject });
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function openAdapter() {
  await toPromise(wx.openBluetoothAdapter);
}

async function closeAdapter() {
  await toPromise(wx.closeBluetoothAdapter).catch(() => {});
  conn = { deviceId: '', serviceId: '', charId: '', mtu: 20 };
}

/**
 * 扫描周边打印机
 * @param {number} duration 扫描时长 ms
 * @returns {Promise<Array<{deviceId:string,name:string,RSSI:number}>>}
 */
async function scan(duration = 6000) {
  await openAdapter();
  await toPromise(wx.startBluetoothDevicesDiscovery, { allowDuplicatesKey: false });
  await delay(duration);
  const res = await toPromise(wx.getBluetoothDevices);
  await toPromise(wx.stopBluetoothDevicesDiscovery).catch(() => {});
  return (res.devices || [])
    .filter(d => d.name || d.localName)
    .map(d => ({ deviceId: d.deviceId, name: d.name || d.localName, RSSI: d.RSSI }))
    .sort((a, b) => (b.RSSI || -999) - (a.RSSI || -999));
}

/**
 * 连接设备并找到可写特征值
 * 多数热敏打印机使用服务 0xFF00 / 特征值 0xFF02，但不同厂商不同，这里做遍历匹配。
 */
async function connect(deviceId) {
  await toPromise(wx.createBLEConnection, { deviceId, timeout: 10000 });
  await delay(600);

  // 尽量协商大 MTU（仅部分平台支持），失败不影响流程
  if (wx.setBLEMTU) {
    try {
      const r = await toPromise(wx.setBLEMTU, { deviceId, mtu: 512 });
      conn.mtu = Math.max(20, Math.min(512, (r && r.mtu) || 20));
    } catch (e) {
      conn.mtu = 20;
    }
  } else {
    conn.mtu = 20;
  }

  const svcRes = await toPromise(wx.getBLEDeviceServices, { deviceId });
  const services = (svcRes.services || []).filter(s => s.isPrimary !== false);

  for (const svc of services) {
    let chars = [];
    try {
      const c = await toPromise(wx.getBLEDeviceCharacteristics, {
        deviceId,
        serviceId: svc.uuid
      });
      chars = c.characteristics || [];
    } catch (e) {
      continue;
    }

    const writable = chars.find(
      ch => ch.properties && (ch.properties.write || ch.properties.writeNoResponse)
    );

    if (writable) {
      conn = { deviceId, serviceId: svc.uuid, charId: writable.uuid, mtu: conn.mtu || 20 };
      return { serviceId: svc.uuid, characteristicId: writable.uuid, mtu: conn.mtu };
    }
  }

  throw new Error('该设备未找到可写入特征值，可能不是热敏打印机');
}

/** 分包写入一个 ArrayBuffer */
async function writeBuffer(buffer) {
  if (!conn.deviceId) throw new Error('打印机未连接');

  // ATT 开销 3 字节，实际负载 = mtu - 3
  const chunkSize = Math.max(CHUNK_FALLBACK, (conn.mtu || 20) - 3);
  const total = buffer.byteLength;

  for (let offset = 0; offset < total; offset += chunkSize) {
    const piece = buffer.slice(offset, Math.min(offset + chunkSize, total));
    await toPromise(wx.writeBLECharacteristicValue, {
      deviceId: conn.deviceId,
      serviceId: conn.serviceId,
      characteristicId: conn.charId,
      value: piece
    });
    // 给打印机留出处理时间，太快会丢数据
    await delay(12);
  }
}

/**
 * 把 ImageData 打包成 ESC/POS 光栅位图指令（GS v 0）
 * @param {Uint8ClampedArray} data RGBA 像素
 * @param {number} width  像素宽（建议 8 的整数倍，如 576 / 800）
 * @param {number} height 像素高
 * @param {number} threshold 二值化阈值 0~255
 */
function buildRasterCommand(data, width, height, threshold = 160) {
  const widthBytes = Math.ceil(width / 8);
  const dataLen = widthBytes * height;

  const out = new Uint8Array(8 + dataLen);
  out[0] = 0x1d; // GS
  out[1] = 0x76; // v
  out[2] = 0x30; // 0
  out[3] = 0x00;
  out[4] = widthBytes & 0xff;
  out[5] = (widthBytes >> 8) & 0xff;
  out[6] = height & 0xff;
  out[7] = (height >> 8) & 0xff;

  let p = 8;
  for (let y = 0; y < height; y++) {
    for (let xb = 0; xb < widthBytes; xb++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xb * 8 + bit;
        let dark = 0;
        if (x < width) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          // 亮度加权 + 透明度处理（透明视为白）
          const lum = a < 40 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
          dark = lum < threshold ? 1 : 0;
        }
        byte |= dark << (7 - bit);
      }
      out[p++] = byte;
    }
  }

  // 走纸 + 切纸
  const feed = new Uint8Array([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]);
  const result = new Uint8Array(out.length + feed.length);
  result.set(out, 0);
  result.set(feed, out.length);
  return result.buffer;
}

async function disconnect() {
  if (!conn.deviceId) return;
  try {
    await toPromise(wx.closeBLEConnection, { deviceId: conn.deviceId });
  } catch (e) {}
  await closeAdapter();
}

module.exports = {
  scan,
  connect,
  writeBuffer,
  buildRasterCommand,
  disconnect,
  isConnected: () => !!conn.deviceId
};
