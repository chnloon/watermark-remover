/**
 * 生成微信小程序 tabBar PNG 图标
 * 使用 Node.js 内置模块生成最小有效 PNG 文件
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_DIR = path.resolve(__dirname, '../../client/assets/icons');

// PNG 文件生成器
function createPNG(width, height, r, g, b, shape = 'fill') {
  // 生成 RGBA 像素数据
  const rawData = Buffer.alloc(width * height * 4, 0);

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.35;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let draw = false;

      if (shape === 'fill') {
        draw = true;
      } else if (shape === 'circle') {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radius * radius) draw = true;
      } else if (shape === 'rounded') {
        // 圆角矩形
        const margin = width * 0.2;
        const rx = width * 0.15;
        if (x >= margin && x < width - margin && y >= margin && y < height - margin) {
          // 检查是否在圆角范围内
          const leftEdge = margin;
          const rightEdge = width - margin;
          const topEdge = margin;
          const bottomEdge = height - margin;
          const cx = (x < leftEdge + rx) ? leftEdge + rx : (x > rightEdge - rx) ? rightEdge - rx : x;
          const cy = (y < topEdge + rx) ? topEdge + rx : (y > bottomEdge - rx) ? bottomEdge - rx : y;
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= rx * rx) draw = true;
          else if (x >= leftEdge + rx && x <= rightEdge - rx) draw = true;
          else if (y >= topEdge + rx && y <= bottomEdge - rx) draw = true;
        }
      }

      if (draw) {
        rawData[idx] = r;     // R
        rawData[idx + 1] = g; // G
        rawData[idx + 2] = b; // B
        rawData[idx + 3] = 255; // A
      }
    }
  }

  return encodePNG(rawData, width, height);
}

function encodePNG(rawData, width, height) {
  // 1. PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // 2. IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // 3. IDAT chunk - raw pixel data with filter byte per row
  const filteredData = Buffer.alloc(width * height * 4 + height);
  for (let y = 0; y < height; y++) {
    filteredData[y * (width * 4 + 1)] = 0; // filter: None
    rawData.copy(filteredData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(filteredData);
  const idat = createChunk('IDAT', compressed);

  // 4. IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 解析图标 - 蓝色圆圈(搜索/解析)
function createParseIcon() {
  const size = 48;
  // 蓝色圆形背景
  const bg = createPNG(size, size, 26, 26, 46, 'circle');
  return bg;
}

// 解析图标(选中) - 深色版本
function createParseActiveIcon() {
  const size = 48;
  // 深蓝圆形
  const bg = createPNG(size, size, 10, 10, 30, 'circle');
  return bg;
}

// 历史图标 - 灰色圆角方形
function createHistoryIcon() {
  const size = 48;
  const bg = createPNG(size, size, 153, 153, 153, 'rounded');
  return bg;
}

// 历史图标(选中) - 深色版本
function createHistoryActiveIcon() {
  const size = 48;
  const bg = createPNG(size, size, 26, 26, 46, 'rounded');
  return bg;
}

// 生成所有图标
function generateAllIcons() {
  if (!fs.existsSync(ICON_DIR)) {
    fs.mkdirSync(ICON_DIR, { recursive: true });
  }

  const icons = [
    { name: 'parse.png', data: createParseIcon() },
    { name: 'parse_active.png', data: createParseActiveIcon() },
    { name: 'history.png', data: createHistoryIcon() },
    { name: 'history_active.png', data: createHistoryActiveIcon() },
  ];

  for (const icon of icons) {
    const filePath = path.join(ICON_DIR, icon.name);
    fs.writeFileSync(filePath, icon.data);
    console.log(`✅ 已生成: ${icon.name} (${icon.data.length} bytes)`);
  }
}

generateAllIcons();
console.log('🎉 所有图标生成完成！');
