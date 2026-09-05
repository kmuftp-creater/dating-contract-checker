/**
 * 封存轉檔：圖片一律轉 WebP 後才存檔與寄送，非圖片原樣保存。
 *
 * 注意這與 image.ts 的 extractImage 是兩條不同路徑：
 * 封存用 WebP（品質 88、不縮圖），送 AI 辨識用 JPEG（品質 90、限縮邊長），
 * 兩者不共用轉檔結果，避免二次壓縮讓合約上的小字更糊。
 */

import sharp, { type Sharp } from 'sharp';
import bmpJs from '@vingle/bmp-js';
import heicConvert from 'heic-convert';
import type { ArchiveResult } from '@/lib/types';
import { detectFormat } from './detect';

/** 封存圖片的 WebP 品質。 */
const ARCHIVE_WEBP_QUALITY = 88;

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

async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const jpegBytes = await heicConvert({
    buffer: new Uint8Array(buffer),
    format: 'JPEG',
    quality: 0.92,
  });
  return Buffer.from(jpegBytes);
}

/**
 * 把檔案轉成封存用的格式。
 *
 * @param buffer 檔案原始位元組。
 * @param filename 原始檔名，用於判斷格式。
 */
export async function toArchive(buffer: Buffer, filename: string): Promise<ArchiveResult> {
  const format = detectFormat(filename, buffer);

  switch (format) {
    case 'jpeg':
    case 'png': {
      const webp = await sharp(buffer).webp({ quality: ARCHIVE_WEBP_QUALITY }).toBuffer();
      return { data: webp, mime: 'image/webp', extension: '.webp', converted: true };
    }
    case 'bmp': {
      const webp = await decodeBmpToSharp(buffer)
        .webp({ quality: ARCHIVE_WEBP_QUALITY })
        .toBuffer();
      return { data: webp, mime: 'image/webp', extension: '.webp', converted: true };
    }
    case 'heic':
    case 'heif': {
      const jpegBuffer = await convertHeicToJpeg(buffer);
      const webp = await sharp(jpegBuffer)
        .webp({ quality: ARCHIVE_WEBP_QUALITY })
        .toBuffer();
      return { data: webp, mime: 'image/webp', extension: '.webp', converted: true };
    }
    case 'pdf':
      return { data: buffer, mime: 'application/pdf', extension: '.pdf', converted: false };
    case 'txt':
      return { data: buffer, mime: 'text/plain', extension: '.txt', converted: false };
    case 'docx':
      return {
        data: buffer,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: '.docx',
        converted: false,
      };
    case 'xlsx':
      return {
        data: buffer,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: '.xlsx',
        converted: false,
      };
    case 'xls':
      return { data: buffer, mime: 'application/vnd.ms-excel', extension: '.xls', converted: false };
    default:
      throw new Error(`不支援的檔案格式，無法封存：${filename}`);
  }
}
