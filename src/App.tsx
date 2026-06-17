import React, { useState } from 'react';

// ============================================================================
// 1. 超軽量・単一ファイル用 ZIP 生成エンジン
// ============================================================================
class SimpleZipWriter {
  private files: { name: string; data: Uint8Array }[] = [];

  addFile(name: string, data: Uint8Array) {
    this.files.push({ name, data });
  }

  generateBlob(): Blob {
    const parts: Uint8Array[] = [];
    const localHeaders: { offset: number; size: number; crc: number; nameBytes: Uint8Array }[] = [];
    let currentOffset = 0;

    const crc32 = (data: Uint8Array): number => {
      let crc = 0 ^ (-1);
      for (let i = 0; i < data.length; i++) {
        let byte = data[i];
        for (let j = 0; j < 8; j++) {
          if ((crc ^ byte) & 1) {
            crc = (crc >>> 1) ^ 0xEDB88320;
          } else {
            crc = crc >>> 1;
          }
          byte = byte >>> 1;
        }
      }
      return (crc ^ (-1)) >>> 0;
    };

    const encoder = new TextEncoder();

    for (const file of this.files) {
      const nameBytes = encoder.encode(file.name);
      const fileCrc = crc32(file.data);
      
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 10, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint32(14, fileCrc, true);
      view.setUint32(18, file.data.length, true);
      view.setUint32(22, file.data.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      header.set(nameBytes, 30);

      parts.push(header);
      parts.push(file.data);

      localHeaders.push({
        offset: currentOffset,
        size: file.data.length,
        crc: fileCrc,
        nameBytes
      });

      currentOffset += header.length + file.data.length;
    }

    const centralDirectoryOffset = currentOffset;
    let centralDirectorySize = 0;

    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      const lh = localHeaders[i];
      
      const cdRecord = new Uint8Array(46 + lh.nameBytes.length);
      const view = new DataView(cdRecord.buffer);
      
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 10, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 0, true);
      view.setUint32(16, lh.crc, true);
      view.setUint32(20, lh.size, true);
      view.setUint32(24, lh.size, true);
      view.setUint16(28, lh.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, lh.offset, true);
      cdRecord.set(lh.nameBytes, 46);

      parts.push(cdRecord);
      centralDirectorySize += cdRecord.length;
      currentOffset += cdRecord.length;
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, this.files.length, true);
    eocdView.setUint16(10, this.files.length, true);
    eocdView.setUint32(12, centralDirectorySize, true);
    eocdView.setUint32(16, centralDirectoryOffset, true);
    eocdView.setUint16(20, 0, true);

    parts.push(eocd);
    return new Blob(parts, { type: 'application/zip' });
  }
}

// ============================================================================
// 2. 純JavaScript製 Binary PLIST パーサーエンジン
// ============================================================================
class BinaryPlistParser {
  private buffer: Uint8Array;
  private view: DataView;
  private offsetSize = 0;
  private objectRefSize = 0;
  private numObjects = 0;
  private topObject = 0;
  private offsetTableOffset = 0;
  private offsetTable: number[] = [];

  constructor(arrayBuffer: ArrayBuffer) {
    this.buffer = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);
  }

  parse(): any {
    const header = String.fromCharCode(...Array.from(this.buffer.slice(0, 8)));
    if (!header.startsWith('bplist00')) {
      throw new Error('有効なBinary PLIST (bplist00) 形式ではありません。');
    }

    const trailerOffset = this.buffer.length - 32;
    this.offsetSize = this.view.getUint8(trailerOffset + 6);
    this.objectRefSize = this.view.getUint8(trailerOffset + 7);
    this.numObjects = this.view.getUint32(trailerOffset + 12);
    this.topObject = this.view.getUint32(trailerOffset + 20);
    this.offsetTableOffset = this.view.getUint32(trailerOffset + 28);

    this.offsetTable = [];
    for (let i = 0; i < this.numObjects; i++) {
      const off = this.offsetTableOffset + i * this.offsetSize;
      this.offsetTable.push(this.readInt(off, this.offsetSize));
    }

    return this.parseObject(this.topObject);
  }

  private readInt(offset: number, size: number): number {
    let res = 0;
    for (let i = 0; i < size; i++) {
      res = (res << 8) | this.buffer[offset + i];
    }
    return res;
  }

  private parseObject(objRef: number): any {
    const offset = this.offsetTable[objRef];
    const typeByte = this.buffer[offset];
    const objType = typeByte & 0xF0;
    let objInfo = typeByte & 0x0F;

    if (objType === 0x00) {
      if (objInfo === 0x00) return null;
      if (objInfo === 0x08) return false;
      if (objInfo === 0x09) return true;
      return null;
    }

    if (objType === 0x10) {
      const length = 1 << objInfo;
      return this.readInt(offset + 1, length);
    }

    if (objType === 0x20) {
      const length = 1 << objInfo;
      if (length === 4) return this.view.getFloat32(offset + 1);
      if (length === 8) return this.view.getFloat64(offset + 1);
      return 0;
    }

    let currentOffset = offset + 1;
    if (objInfo === 0x0F) {
      const lenType = this.buffer[currentOffset];
      const lenInfo = lenType & 0x0F;
      const lenLength = 1 << lenInfo;
      objInfo = this.readInt(currentOffset + 1, lenLength);
      currentOffset += 1 + lenLength;
    }

    if (objType === 0x40) {
      return this.buffer.slice(currentOffset, currentOffset + objInfo);
    }

    if (objType === 0x50) {
      const bytes = this.buffer.slice(currentOffset, currentOffset + objInfo);
      return String.fromCharCode(...Array.from(bytes));
    }

    if (objType === 0x60) {
      let str = '';
      for (let i = 0; i < objInfo; i++) {
        str += String.fromCharCode(this.view.getUint16(currentOffset + i * 2));
      }
      return str;
    }

    if (objType === 0xA0) {
      const arr: any[] = [];
      for (let i = 0; i < objInfo; i++) {
        const ref = this.readInt(currentOffset + i * this.objectRefSize, this.objectRefSize);
        arr.push(this.parseObject(ref));
      }
      return arr;
    }

    if (objType === 0xD0) {
      const dict: { [key: string]: any } = {};
      const keyRefs: number[] = [];
      const valRefs: number[] = [];

      for (let i = 0; i < objInfo; i++) {
        keyRefs.push(this.readInt(currentOffset + i * this.objectRefSize, this.objectRefSize));
      }
      const valOffset = currentOffset + objInfo * this.objectRefSize;
      for (let i = 0; i < objInfo; i++) {
        valRefs.push(this.readInt(valOffset + i * this.objectRefSize, this.objectRefSize));
      }

      for (let i = 0; i < objInfo; i++) {
        const key = this.parseObject(keyRefs[i]);
        const val = this.parseObject(valRefs[i]);
        dict[key] = val;
      }
      return dict;
    }
    return null;
  }
}
// ============================================================================
// 3. React メインコンポーネント (エラー対策＆完全自己完結版)
// ============================================================================
interface ExtractedImage {
  id: string;
  rawData: Uint8Array;
  url: string;
  mimeType: string;
  filename: string;
}

export default function App() {
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [zipLoading, setZipLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setImages([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parser = new BinaryPlistParser(arrayBuffer);
      const parsedArchive = parser.parse();

      const subresources = parsedArchive.WebSubresources || [];
      const extracted: ExtractedImage[] = [];

      subresources.forEach((resource: any, index: number) => {
        const mimeType = resource.WebResourceMIMEType || '';
        
        if (mimeType.startsWith('image/')) {
          const rawData = resource.WebResourceData;
          
          if (rawData && rawData instanceof Uint8Array) {
            const blob = new Blob([rawData], { type: mimeType });
            const objectUrl = URL.createObjectURL(blob);
            
            const resourceUrl = resource.WebResourceURL || '';
            let rawFilename = resourceUrl.split('/').pop() || `image_${index}`;
            
            rawFilename = rawFilename.split('?')[0];

            if (!rawFilename.includes('.')) {
              const ext = mimeType.split('/')[1] || 'png';
              rawFilename = `${rawFilename}.${ext}`;
            }

            extracted.push({
              id: `${index}-${rawFilename}`,
              rawData,
              url: objectUrl,
              mimeType,
              filename: rawFilename,
            });
          }
        }
      });

      if (extracted.length === 0) {
        setError('ファイル内に画像が見つかりませんでした。');
      } else {
        setImages(extracted);
      }
    } catch (err: any) {
      console.error(err);
      setError('ファイルの解析中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  const downloadAllAsZip = async () => {
    if (images.length === 0) return;
    setZipLoading(true);
    setError(null);

    try {
      const zipWriter = new SimpleZipWriter();
      const usedNames = new Set<string>();

      images.forEach((img) => {
        let uniqueName = img.filename;
        let counter = 1;

        while (usedNames.has(uniqueName)) {
          const dots = img.filename.lastIndexOf('.');
          if (dots !== -1) {
            const base = img.filename.substring(0, dots);
            const ext = img.filename.substring(dots);
            uniqueName = `${base}_${counter}${ext}`;
          } else {
            uniqueName = `${img.filename}_${counter}`;
          }
          counter++;
        }
        usedNames.add(uniqueName);
        zipWriter.addFile(uniqueName, img.rawData);
      });

      const zipBlob = zipWriter.generateBlob();
      const zipUrl = URL.createObjectURL(zipBlob);

      const link = document.createElement('a');
      link.href = zipUrl;
      link.download = 'extracted_images.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(zipUrl);
    } catch (err: any) {
      console.error(err);
      setError('ZIPファイルの生成に失敗しました。');
    } finally {
      setZipLoading(false);
    }
  };

  return (
    <div>
      <h1>Webアーカイブ 画像抽出ツール</h1>
      <p>サーバーなし・ブラウザ内完結</p>

      <div>
        <input 
          type="file" 
          accept=".webarchive" 
          onChange={handleFileChange} 
          disabled={loading}
        />
      </div>

      {loading && <p>解析中...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {images.length > 0 && (
        <div style={{ marginTop: '20px', padding: '10px', background: '#f0f0f0' }}>
          <h3>📊 抽出結果</h3>
          <p>画像の総数: <strong>{images.length} 件</strong></p>
          <button 
            onClick={downloadAllAsZip} 
            disabled={zipLoading}
          >
            {zipLoading ? '⏳ ZIPを作成中...' : '📦 すべての画像をZIPで一括保存'}
          </button>
        </div>
      )}

      <div>
        {images.map((img) => (
          <div key={img.id} style={{ margin: '20px 0', border: '1px solid gray', padding: '10px' }}>
            <img 
              src={img.url} 
              alt={img.filename} 
              style={{ maxWidth: '200px', display: 'block' }} 
            />
            <p>{img.filename} ({img.mimeType})</p>
            <a href={img.url} download={img.filename}>個別で保存</a>
          </div>
        ))}
      </div>
    </div>
  );
}
