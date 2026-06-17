import React, { useState } from 'react';

// ============================================================================
// 1. 純JavaScript製 Binary PLIST パーサーエンジン (ブラウザ専用・スタンドアロン)
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
    // ヘッダーチェック (bplist00)
    const header = String.fromCharCode(...Array.from(this.buffer.slice(0, 8)));
    if (!header.startsWith('bplist00')) {
      throw new Error('有効なBinary PLIST (bplist00) 形式ではありません。');
    }

    // 末尾32バイトのトレーラーを解析
    const trailerOffset = this.buffer.length - 32;
    this.offsetSize = this.view.getUint8(trailerOffset + 6);
    this.objectRefSize = this.view.getUint8(trailerOffset + 7);
    
    // getUint64の代用 (4GB超のファイルでなければ下位4バイトで十分)
    this.numObjects = this.view.getUint32(trailerOffset + 12);
    this.topObject = this.view.getUint32(trailerOffset + 20);
    this.offsetTableOffset = this.view.getUint32(trailerOffset + 28);

    // オフセットテーブルの読み込み
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

    // 1. ヌル・ブール値
    if (objType === 0x00) {
      if (objInfo === 0x00) return null;
      if (objInfo === 0x08) return false;
      if (objInfo === 0x09) return true;
      return null;
    }

    // 2. 整数値 (Integer)
    if (objType === 0x10) {
      const length = 1 << objInfo;
      return this.readInt(offset + 1, length);
    }

    // 3. 浮動小数点数 (Real)
    if (objType === 0x20) {
      const length = 1 << objInfo;
      if (length === 4) return this.view.getFloat32(offset + 1);
      if (length === 8) return this.view.getFloat64(offset + 1);
      return 0;
    }

    // データ長の拡張チェック
    let currentOffset = offset + 1;
    if (objInfo === 0x0F) {
      const lenType = this.buffer[currentOffset];
      const lenInfo = lenType & 0x0F;
      const lenLength = 1 << lenInfo;
      objInfo = this.readInt(currentOffset + 1, lenLength);
      currentOffset += 1 + lenLength;
    }

    // 4. データ (Data) -> 画像等のバイナリはここに入る
    if (objType === 0x40) {
      return this.buffer.slice(currentOffset, currentOffset + objInfo);
    }

    // 5. ASCII 文字列
    if (objType === 0x50) {
      const bytes = this.buffer.slice(currentOffset, currentOffset + objInfo);
      return String.fromCharCode(...Array.from(bytes));
    }

    // 6. UTF-16 文字列
    if (objType === 0x60) {
      let str = '';
      for (let i = 0; i < objInfo; i++) {
        str += String.fromCharCode(this.view.getUint16(currentOffset + i * 2));
      }
      return str;
    }

    // 7. 配列 (Array)
    if (objType === 0xA0) {
      const arr: any[] = [];
      for (let i = 0; i < objInfo; i++) {
        const ref = this.readInt(currentOffset + i * this.objectRefSize, this.objectRefSize);
        arr.push(this.parseObject(ref));
      }
      return arr;
    }

    // 8. 辞書 (Dictionary) -> キーと値のペア
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
// 2. React アプリケーション メインコンポーネント
// ============================================================================
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

      // 内蔵したブラウザ用バイナリPlistパーサーを実行
      const parser = new BinaryPlistParser(arrayBuffer);
      const parsedArchive = parser.parse();

      // Webarchiveからサブリソース群を取得
      const subresources = parsedArchive.WebSubresources || [];
      const extracted: ExtractedImage[] = [];

      subresources.forEach((resource: any, index: number) => {
        const mimeType = resource.WebResourceMIMEType || '';
        
        // 画像ファイルを検出
        if (mimeType.startsWith('image/')) {
          const rawData = resource.WebResourceData; // Uint8Array
          
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
        setError('ファイル内から画像リソース（image/*）が見つかりませんでした。');
      } else {
        setImages(extracted);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'ファイルの解析中にエラーが発生しました。構造が特殊なパターンの可能性があります。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <header style={{ borderBottom: '1px solid #eee', paddingBottom: '15px', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', margin: '0 0 8px 0' }}>📦 Webアーカイブ 画像取り出しツール</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          iPhoneのSafariで保存した <code style={{ background: '#f5f5f5', padding: '2px 4px', borderRadius: '4px' }}>.webarchive</code> ファイルから画像のみを抽出します。
          <strong>（処理はブラウザ内で完結し、サーバーへのデータ送信は一切行われません）</strong>
        </p>
      </header>

      <main>
        <div style={{ 
          border: '2px dashed #ccc', 
          borderRadius: '8px', 
          padding: '30px', 
          textAlign: 'center',
          background: '#fafafa',
          cursor: 'pointer'
        }}>
          <input 
            type="file" 
            accept=".webarchive" 
            onChange={handleFileChange} 
            disabled={loading}
            style={{ fontSize: '16px' }}
          />
        </div>

        {loading && <p style={{ textAlign: 'center', color: '#666', marginTop: '20px' }}>⏳ バイナリ構造を解析中...</p>}
        {error && <p style={{ color: '#ff3333', background: '#ffe6e6', padding: '12px', borderRadius: '6px', marginTop: '20px' }}>❌ {error}</p>}

        {images.length > 0 && (
          <div style={{ marginTop: '30px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '15px' }}>抽出された画像 ({images.length}件)</h2>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', 
              gap: '20px' 
            }}>
              {images.map((img) => (
                <div key={img.id} style={{ 
                  border: '1px solid #e0e0e0', 
                  borderRadius: '8px', 
                  padding: '12px', 
                  background: '#fff',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f9f9', borderRadius: '4px', overflow: 'hidden' }}>
                    <img 
                      src={img.url} 
                      alt={img.filename} 
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
                    />
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#333', 
                      textOverflow: 'ellipsis', 
                      overflow: 'hidden', 
                      whiteSpace: 'nowrap',
                      marginBottom: '2px'
                    }} title={img.filename}>
                      {img.filename}
                    </div>
                    <div style={{ fontSize: '10px', color: '#999', marginBottom: '8px' }}>{img.mimeType}</div>
                    <a 
                      href={img.url} 
                      download={img.filename} 
                      style={{ 


display: 'block',textAlign: 'center',background: '#007aff',color: '#fff',textDecoration: 'none',fontSize: '12px',padding: '6px 0',borderRadius: '4px',fontWeight: 'bold'}}>保存))})});}
