import React, { useState } from "react";

// 簡単なBinary Plist（bplist00）の簡易ヘッダーチェック
const isBinaryPlist = (buffer: ArrayBuffer): boolean => {
  const arr = new Uint8Array(buffer.slice(0, 8));
  const header = String.fromCharCode(...Array.from(arr));
  return header.startsWith("bplist00");
};

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

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setImages([]);

    try {
      const arrayBuffer = await file.arrayBuffer();

      if (!isBinaryPlist(arrayBuffer)) {
        throw new Error(
          "選択されたファイルは有効なApple Webarchive（bplist00）形式ではない可能性があります。"
        );
      }

      // 【重要】ブラウザ上でバイナリPLISTをオブジェクトに変換する処理
      // 本来は 'bplist-parser' 等のロジックをブラウザ用にバンドルして使用します。
      // ここでは概念の実証として、外部ライブラリを想定したパース処理のプレースホルダーとします。
      const parsedArchive = await parseBinaryPlistInBrowser(arrayBuffer);

      // Webarchiveの構造ツリー（通常、最上位に WebMainResource と WebSubresources がある）
      const subresources = parsedArchive.WebSubresources || [];
      const extracted: ExtractedImage[] = [];

      // サブリソース（画像、CSS、JSなど）を走査
      subresources.forEach((resource: any, index: number) => {
        const mimeType = resource.WebResourceMIMEType || "";

        // 画像リソース（image/jpeg, image/png, image/gifなど）をフィルタリング
        if (mimeType.startsWith("image/")) {
          // バイナリデータ（通常はUint8ArrayまたはArrayBufferとしてパースされる）
          const rawData = resource.WebResourceData;

          if (rawData) {
            const blob = new Blob([rawData], { type: mimeType });
            const objectUrl = URL.createObjectURL(blob);

            // ファイル名の特定（URLの末尾などから取得）
            const resourceUrl = resource.WebResourceURL || "";
            const filename = resourceUrl.split("/").pop() || `image_${index}`;

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
        setError("ファイル内から画像が見つかりませんでした。");
      } else {
        setImages(extracted);
      }
    } catch (err: any) {
      setError(err.message || "ファイルの解析中にエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  // ※ブラウザ環境で動作するbplistデコーダーのダミー関数（実際には「bplist-parser」等の移植を使用）
  const parseBinaryPlistInBrowser = async (
    buffer: ArrayBuffer
  ): Promise<any> => {
    // 実際の実装では、ここでバイナリデータを走査し、Dictionary、Array、Dataオブジェクトを復元します。
    // 手法としては、GitHub等で公開されているPure JavaScript製のbplistデコーダーコードをプロジェクト内に配置します。
    // 例: return pureJsBplistParser(buffer);
    throw new Error(
      "ブラウザ用Binary PLISTパーサーモジュールが未配置です。オープンソースの純JS製パーサーコードをここに統合してください。"
    );
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>iPhone Webアーカイブ画像抽出ツール</h1>
      <p>サーバー送信なし。ブラウザ内だけで安全に画像を抽出します。</p>

      <div style={{ margin: "20px 0" }}>
        <input
          type="file"
          accept=".webarchive"
          onChange={handleFileChange}
          disabled={loading}
        />
      </div>

      {loading && <p>解析中...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: "15px",
          marginTop: "20px",
        }}
      >
        {images.map((img) => (
          <div
            key={img.id}
            style={{
              border: "1px solid #ccc",
              padding: "10px",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <img
              src={img.url}
              alt={img.filename}
              style={{
                maxWidth: "100%",
                maxHeight: "120px",
                objectFit: "contain",
              }}
            />
            <div
              style={{
                fontSize: "12px",
                marginTop: "8px",
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {img.filename}
            </div>
            <a
              href={img.url}
              download={img.filename}
              style={{
                display: "inline-block",
                marginTop: "5px",
                fontSize: "12px",
                color: "#0066cc",
                textDecoration: "none",
              }}
            >
              ダウンロード
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
