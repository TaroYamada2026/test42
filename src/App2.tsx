import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function App2() {
  // 入力された文字列を管理するステート
  const [text, setText] = useState<string>('https://example.com');

  // 入力フォームの変更ハンドラー
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  // QRコードをリセットするハンドラー
  const handleClear = () => {
    setText('');
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>QRコード生成アプリ</h1>
      
      <div style={styles.inputContainer}>
        <input
          type="text"
          value={text}
          onChange={handleChange}
          placeholder="変換したい文字列を入力してください"
          style={styles.input}
        />
        {text && (
          <button onClick={handleClear} style={styles.clearButton}>
            クリア
          </button>
        )}
      </div>

      <div style={styles.qrContainer}>
        {text ? (
          <>
            <QRCodeSVG 
              value={text} 
              size={200} 
              bgColor="#ffffff" 
              fgColor="#000000" 
              level="M" // 誤り訂正レベル (L, M, Q, H)
              includeMargin={true}
            />
            <p style={styles.textPreview}>現在の文字列: <code>{text}</code></p>
          </>
        ) : (
          <p style={styles.placeholderText}>文字列を入力するとここにQRコードが表示されます</p>
        )}
      </div>
    </div>
  );
}

// 簡易的なインラインスタイルの定義
const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'sans-serif',
    padding: '20px',
    maxWidth: '500px',
    margin: '0 auto',
  },
  title: {
    fontSize: '24px',
    marginBottom: '20px',
    color: '#333',
  },
  inputContainer: {
    display: 'flex',
    width: '100%',
    marginBottom: '30px',
    position: 'relative',
  },
  input: {
    width: '100%',
    padding: '12px 40px 12px 12px',
    fontSize: '16px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    outline: 'none',
  },
  clearButton: {
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#999',
    cursor: 'pointer',
    fontSize: '14px',
  },
  qrContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px',
    border: '1px dashed #bbb',
    borderRadius: '8px',
    backgroundColor: '#f9f9f9',
    minWidth: '240px',
    minHeight: '240px',
    justifyContent: 'center',
  },
  textPreview: {
    marginTop: '15px',
    fontSize: '14px',
    color: '#666',
    wordBreak: 'break-all',
    textAlign: 'center',
  },
  placeholderText: {
    color: '#999',
    fontSize: '14px',
    textAlign: 'center',
  },
};
