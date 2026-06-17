import React, { useState } from 'react';

// ============================================================================
// 1. 超軽量・単一ファイル用 ZIP 生成エンジン（フォルダ階層対応版）
// ============================================================================
class SimpleZipWriter {
  private files: { name: string; data: Uint8Array }[] = [];

  // ファイルを追加する（フォルダ名を含んだパス「フォルダ名/ファイル名」を受け取り可能）
  addFile(path: string, data: Uint8Array) {
    this.files.push({ name: path, data });
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
// 3. 画像フォーマット変換エンジン（WebP -> JPEG）
// ============================================================================
const convertWebPToJPG = (blob: Blob): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvasの初期化に失敗しました'));
        return;
      }
      // 白背景を敷く（透過部分が黒くなるのを防ぐため）
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((jpgBlob) => {
        if (!jpgBlob) {
          reject(new Error('JPGへの変換に失敗しました'));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(new Uint8Array(reader.result));
          } else {
            reject(new Error('バイナリの読み込みに失敗しました'));
          }
        };
        reader.readAsArrayBuffer(jpgBlob);
      }, 'image/jpeg', 0.9); // 品質 90%
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
  });
};
// ============================================================================
// 4. React メインコンポーネント (フォルダ分け＆WebP→JPG変換対応版)
// ============================================================================
interface ExtractedImage {
  id: string;
  rawData: Uint8Array;
  blob: Blob;
  url: string;
  mimeType: string;
  filename: string;
}

export default function App() {
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [zipName, setZipName] = useState<string>('extracted_images');
  const [loading, setLoading] = useState<boolean>(false);
  const [zipLoading, setZipLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // HTMLのバイナリ(Uint8Array)から最初のh1〜h6タグの文字を抽出する関数
  const extractHeadingText = (htmlData: any): string | null => {
    if (!htmlData || !(htmlData instanceof Uint8Array)) return null;
    try {
      const decoder = new TextDecoder('utf-8');
      const htmlText = decoder.decode(htmlData);
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      for (const tag of headingTags) {
        const element = doc.querySelector(tag);
        if (element && element.textContent) {
          const text = element.textContent.trim();
          if (text) return text;
        }
      }
    } catch (e) {
      console.error('hタグの解析に失敗しました:', e);
    }
    return null;
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setImages([]);
    setZipName('extracted_images');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parser = new BinaryPlistParser(arrayBuffer);
      const parsedArchive = parser.parse();

      // メインHTMLリソースからhタグテキストを抽出してZIP名にする
      const mainResource = parsedArchive.WebMainResource;
      if (mainResource && mainResource.WebResourceData) {
        const foundTitle = extractHeadingText(mainResource.WebResourceData);
        if (foundTitle) {
          const cleanedTitle = foundTitle
            .replace(/[\\/:*?"<>|\r\n]/g, '')
            .substring(0, 50);
          if (cleanedTitle) {
            setZipName(cleanedTitle);
          }
        }
      }

      // 画像リソースの抽出処理
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
              blob,
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

  // ZIP生成・フォルダ仕分け・WebP→JPG同時変換
  const downloadAllAsZip = async () => {
    if (images.length === 0) return;
    setZipLoading(true);
    setError(null);

    try {
      const zipWriter = new SimpleZipWriter();
      const usedNamesWebP = new Set<string>();
      const usedNamesJPG = new Set<string>();

      // すべての画像をループ処理
      for (const img of images) {
        const isWebP = img.mimeType.includes('webp') || img.filename.toLowerCase().endsWith('.webp');

        if (isWebP) {
          // --- 1. 元のWebP画像を「webp/」フォルダへ格納 ---
          let uniqueWebPName = img.filename;
          let counterWebP = 1;
          while (usedNamesWebP.has(uniqueWebPName)) {
            const dots = img.filename.lastIndexOf('.');
            const base = dots !== -1 ? img.filename.substring(0, dots) : img.filename;
            const ext = dots !== -1 ? img.filename.substring(dots) : '.webp';
            uniqueWebPName = `${base}_${counterWebP}${ext}`;
            counterWebP++;
          }
          usedNamesWebP.add(uniqueWebPName);
          // パス形式で渡すことでZIP内にフォルダが自動作成されます
          zipWriter.addFile(`webp/${uniqueWebPName}`, img.rawData);

          // --- 2. JPEGに変換して「jpg/」フォルダへ格納 ---
          try {
            const jpgData = await convertWebPToJPG(img.blob);
            
            // ファイル拡張子を.jpgに変更
            const dots = img.filename.lastIndexOf('.');
            const baseName = dots !== -1 ? img.filename.substring(0, dots) : img.filename;
            let uniqueJPGName = `${baseName}.jpg`;
            
            let counterJPG = 1;
            while (usedNamesJPG.has(uniqueJPGName)) {
              uniqueJPGName = `${baseName}_${counterJPG}.jpg`;
              counterJPG++;
            }
            usedNamesJPG.add(uniqueJPGName);
            zipWriter.addFile(`jpg/${uniqueJPGName}`, jpgData);
          } catch (convErr) {
            console.error(`${img.filename} のJPG変換に失敗しました:`, convErr);
            // 変換に失敗した場合は、最悪スキップするか元のデータをそのままjpgフォルダに置く等の対処
          }
        } else {
          // WebP以外の画像（PNGやJPEGなど）は、そのまま「jpg/」または共通フォルダに振る仕様
          // 今回はjpgフォルダ側に統一して格納する形で名前のクレンジングを行います
          let uniqueNormalName = img.filename;
          
          // もし拡張子がjpegなら、フォルダ名に合わせて見た目を.jpgに統一
          if (uniqueNormalName.toLowerCase().endsWith('.jpeg')) {
            uniqueNormalName = uniqueNormalName.substring(0, uniqueNormalName.length - 5) + '.jpg';
          }

          let counterNormal = 1;
          while (usedNamesJPG.has(uniqueNormalName)) {
            const dots = uniqueNormalName.lastIndexOf('.');
            const base = dots !== -1 ? uniqueNormalName.substring(0, dots) : uniqueNormalName;
            const ext = dots !== -1 ? uniqueNormalName.substring(dots) : '';
            uniqueNormalName = `${base}_${counterNormal}${ext}`;
            counterNormal++;
          }
          usedNamesJPG.add(uniqueNormalName);
          zipWriter.addFile(`jpg/${uniqueNormalName}`, img.rawData);
        }
      }

      // バイナリをZIPに変換してダウンロード発火
      const zipBlob = zipWriter.generateBlob();
      const zipUrl = URL.createObjectURL(zipBlob);

      const link = document.createElement('a');
      link.href = zipUrl;
      link.download = `${zipName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(zipUrl);
    } catch (err: any) {
      console.error(err);
      setError('ZIPファイルの生成・変換中にエラーが発生しました。');
    } finally {
      setZipLoading(false);
    }
  };

  return (
    <div>
      <h1>Webアーカイブ 画像抽出ツール</h1>
      <p>サーバーなし・ブラウザ内完結（WebPのJPG変換フォルダ分け機能付き）</p>

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
          <p>予定ファイル名: <strong>{zipName}.zip</strong></p>
          <p style={{ fontSize: '12px', color: '#666' }}>
            ※一括保存すると、ZIPの中に「webp」フォルダと「jpg」フォルダが自動作成され、WebP画像は自動的に両方に仕分け・変換格納されます。
          </p>
          <button 
            onClick={downloadAllAsZip} 
            disabled={zipLoading}
          >
            {zipLoading ? '⏳ 画像をJPGへ変換＆ZIPを作成中...' : '📦 フォルダ分けしてZIPで一括保存'}
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
            <a href={img.url} download={img.filename}>個別で保存（元の形式）</a>
          </div>
        ))}
      </div>
    </div>
  );
}
