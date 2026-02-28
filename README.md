# View Bomber

ローカルフォルダ内のドキュメントをまとめて閲覧する Tauri + React アプリです。

## 対応ファイル

- `Markdown`: `.md`, `.markdown`
- `HTML`: `.html`, `.htm`
- `JSON`: `.json`（ツリービュー表示）
- `CSV/TSV`: `.csv`, `.tsv`（テーブル表示、区切り文字自動推定: comma/tab/semicolon）
- `Image`: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif`
- `PDF`: `.pdf`
  - `pdf.js` ベースの内蔵ビューア（ページ移動 / ズーム / 幅合わせ）

## 検索

- サイドバー検索はテキスト系ファイルのみ対象
- 検索対象フィルタ: `All / Markdown / HTML / JSON`
  - `CSV` も検索対象に含む

## 使い方

```bash
npm install
npm run tauri dev
```

## 技術スタック

- Tauri v2
- React 19 + TypeScript
- Vite
- pdf.js (`pdfjs-dist`)
