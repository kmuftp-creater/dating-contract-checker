/**
 * 圖片抽取：JPEG、PNG、BMP、HEIC、HEIF 一律正規化為 JPEG，交給模型辨識。
 *
 * sharp 讀不了 BMP，先用 @vingle/bmp-js 解碼成原始像素；
 * sharp 也讀不了 HEIC／HEIF，先用 heic-convert 轉成 JPEG。
 */

import sharp, { type Sharp } from 'sharp';
import bmpJs from '@vingle/bmp-js';
import heicConvert from 'heic-convert';
import type { ExtractedImage, ExtractResult } from '@/lib/types';
import { detectFormat } from './detect';

/** 送給模型的圖片最長邊上限，超過則等比縮小，避免浪費 token。 */
const MAX_EDGE_PX = 2200;

/** 送給模型的 JPEG 品質。 */
const JPEG_QUALITY = 90;

/**
 * 把 BMP 位元組解碼成 sharp 看得懂的 RGBA 原始像素。
 *
 * @vingle/bmp-js 的 decode 第二參數傳 true 時，輸出的 data 通道順序
 * 即為 R、G、B、A（見套件原始碼 lib/decoder.js 的 locRed/locGreen/
 * locBlue/locAlpha 賦值，toRGBA 為 true 時依序為 0/1/2/3）。
 * 直接以 raw RGBA 交給 sharp，不需再自行交換通道。
 */
function decodeBmpToSharp(buffer: Buffer): Sharp {
  const bitmap = bmpJs.decode(buffer, true);
  return sharp(bitmap.data, {
    raw: {
      width: bitmap.width,
      height: bitmap.height,
      channels: 4,
    },
  });
}

/**
 * 把 HEIC／HEIF 位元組轉成 JPEG 位元組。
 *
 * heic-convert 只認 HEVC 編碼的 HEIC，遇到其他格式（例如同樣是 HEIF 容器
 * 但用 AV1 編碼的 AVIF）會直接拒絕，且錯誤訊息是英文。這裡換成使用者看得
 * 懂的說明，並保留原始訊息供後台排查。
 */
async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  try {
    const jpegBytes = await heicConvert({
      buffer: new Uint8Array(buffer),
      format: 'JPEG',
      quality: 0.92,
    });
    return Buffer.from(jpegBytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `這個 HEIC 檔案無法解碼，請改用 JPG 或 PNG 上傳。技術原因：${detail}`,
    );
  }
}

/** 依最長邊上限計算是否需要縮圖，回傳套用縮圖設定後的 sharp 實例。 */
function withMaxEdge(image: Sharp): Sharp {
  return image.resize({
    width: MAX_EDGE_PX,
    height: MAX_EDGE_PX,
    fit: 'inside',
    withoutEnlargement: true,
  });
}

/**
 * 抽取單張圖片，正規化為 JPEG 後包成 ExtractResult。
 *
 * @param buffer 圖片原始位元組。
 * @param filename 原始檔名，用於判斷格式與作為圖片標籤。
 */
export async function extractImage(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const format = detectFormat(filename, buffer);
  const notes: string[] = [];

  let source: Sharp;

  switch (format) {
    case 'jpeg':
    case 'png':
      source = sharp(buffer);
      break;
    case 'bmp':
      source = decodeBmpToSharp(buffer);
      break;
    case 'heic':
    case 'heif': {
      const jpegBuffer = await convertHeicToJpeg(buffer);
      source = sharp(jpegBuffer);
      break;
    }
    default:
      throw new Error(`不支援的圖片格式：${filename}`);
  }

  const jpegBuffer = await withMaxEdge(source)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const meta = await sharp(jpegBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const image: ExtractedImage = {
    data: jpegBuffer,
    mime: 'image/jpeg',
    label: filename,
    width,
    height,
  };

  return {
    text: '',
    images: [image],
    method: 'ocr',
    pageCount: 1,
    notes,
  };
}
