import React, { useState } from 'react';

// 1. 純JavaScript製 Binary PLIST パーサーエンジン
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

// 2. React メインコンポーネント (装飾なしシンプル版)
interface ExtractedImage {
  id: string;
  url: string;
  mimeType: string;
  filename: string;
}

export default function App() {
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
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
            const filename = resourceUrl.split('/').pop() || `image_${index}`;

            extracted.push({
              id: `${index}-${filename}`,
              url: objectUrl,
              mimeType,
              filename,
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

      <div>
        {images.map((img) => (
          <div key={img.id} style={{ margin: '20px 0', border: '1px solid gray', padding: '10px' }}>
            <img 
              src={img.url} 
              alt={img.filename} 
              style={{ maxWidth: '200px', display: 'block' }} 
            />
            <p>{img.filename} ({img.mimeType})</p>
            <a href={img.url} download={img.filename}>保存する</a>
          </div>
        ))}
      </div>
    </div>
  );
}
