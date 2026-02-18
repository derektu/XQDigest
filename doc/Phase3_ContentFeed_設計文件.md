# Phase 3: Content Feed 設計文件

## 概述

Phase 3 實現了 Feed 閱讀系統，讓使用者在三欄介面中瀏覽、篩選和閱讀已摘要的財經內容。使用者可透過左欄選擇資料源、中欄瀏覽內容卡片、右欄閱讀完整 Markdown 摘要，並追蹤已讀 / 未讀狀態。

## 架構

### 整體資料流

```
React UI (FeedPage) → fetch('/api/...') → api-routes.js → db.js → SQLite
```

### 三欄佈局

```
SourceNav (200px 固定)  ←→  ContentCard 列表 (340px 可調)  ←→  ContentDetail (flex: 1)
左欄：資料源導航                中欄：內容卡片 + 無限滾動          右欄：Markdown 摘要渲染
ThemeControls 置底
```

- **左欄**（固定 200px）：列出全部資料源，顯示各資料源未讀計數徽章；`ThemeControls` 置於底部
- **中欄**（預設 340px，可拖拽調整）：卡片列表，支援無限滾動；欄寬上限 200~600px，持久化至 `localStorage`
- **右欄**（`flex: 1`，佔剩餘空間）：渲染選中項目的完整 Markdown 摘要

## 新增 REST API 端點（`src/api-routes.js`）

| Method | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/content` | 內容列表（分頁、可按資料源篩選，僅回傳 `status='processed'`） |
| GET | `/api/content/unread-counts` | 全局及各資料源未讀計數 |
| GET | `/api/content/:id` | 取得單筆完整內容（含 `source_name`） |
| PATCH | `/api/content/:id/read` | 標記已讀 / 未讀，body: `{ "is_read": 1 \| 0 }` |

**列表查詢參數**：

| 參數 | 預設 | 說明 |
|------|------|------|
| `sourceId` | 無（全部） | 篩選指定資料源 |
| `limit` | `20` | 每頁筆數 |
| `offset` | `0` | 分頁偏移 |

**回應差異**：
- `GET /api/content`：`summary` 欄位截斷至 300 字元（卡片預覽用）
- `GET /api/content/:id`：回傳完整 `summary`

## 資料庫異動（`src/database/schema.sql`）

`content_items` 表新增欄位：

```sql
is_read INTEGER DEFAULT 0    -- 0=未讀, 1=已讀
```

此欄位在 `db.js` 的建表邏輯中同步加入，並以 `ALTER TABLE` 方式處理既有資料庫的升級（欄位不存在時才新增）。

## 新增元件清單

```
renderer/src/
  ├── ThemeContext.jsx          — 全局主題狀態（mode/fontSize），CSS 變數 + localStorage 持久化
  ├── theme.js                  — CSS 變數定義（light/dark 雙主題、字體大小類別）
  ├── pages/
  │   └── FeedPage.jsx          — 三欄容器，中欄拖拽調整寬度（localStorage 持久化）
  ├── components/
  │   ├── SourceNav.jsx         — 左欄：資料源導航 + 未讀計數徽章 + ThemeControls
  │   ├── ContentCard.jsx       — 中欄卡片：標題、摘要預覽、meta（來源/時間/badge）
  │   ├── ContentDetail.jsx     — 右欄：完整 Markdown 摘要渲染（react-markdown + remark-gfm）
  │   └── ThemeControls.jsx     — 深淺模式切換 + 字體大小調整（小/中/大）
  └── hooks/
      └── useContentFeed.js     — 內容列表、分頁、篩選、未讀計數、已讀標記狀態管理
```

## 各元件設計說明

### `useContentFeed`（核心 Hook）

所有 Feed 頁面的狀態邏輯集中於此 hook，暴露給 `FeedPage` 使用：

- `selectedSourceId` 改變時重置分頁並重新載入
- `loadItems()` 使用 `loadingRef` 防止並發請求
- `selectItem()` 自動標記已讀，並以**樂觀更新**同步 `items[]` 和 `unreadCounts`（無需等待 API 回應）
- `markUnread()` 供 ContentDetail 呼叫，逆向操作（將已讀改回未讀）
- `fetchUnreadCounts()` 每次篩選切換後重新拉取，確保徽章數字準確

### `FeedPage`

三欄容器，負責佈局和中欄拖拽邏輯：

- 中欄寬度拖拽：`mousedown` / `mousemove` / `mouseup` 事件，範圍限制 200~600px
- Intersection Observer 監聽列表底部的哨兵元素，滾動到底自動呼叫 `loadMore()`
- `localStorage['feed-card-width']` 持久化中欄寬度

### `ContentCard`

- **標題**：14px，未讀時 `fontWeight: 600`，已讀時 `fontWeight: 400`；超過 2 行截斷
- **meta 排列**：`來源名稱 · 相對時間 · [YT/RSS badge]`，badge 置末（視線流程：標題 → 來源/時間 → 類型）
- **preview**：12px，3 行截斷，純文字（stripped markdown，去除 `#`、`*` 等符號）
- **卡片樣式**：白底圓角（`borderRadius: 6`）+ margin，浮於灰色背景

### `ContentDetail`

- 使用 `react-markdown` + `remark-gfm` 渲染摘要（支援 GFM 表格、task list）
- 顯示：完整標題、source badge、日期、作者、原始連結、「標記為未讀」按鈕
- 「標記為未讀」呼叫 `markUnread()`，同步更新 hook 內部狀態與未讀計數

### 主題系統

- **`ThemeContext`**：React Context，管理 `mode`（`light` / `dark`）和 `fontSize`（`small` / `medium` / `large`）
- **`theme.js`**：輸出 `CSS_VARS` 字串（`:root` + `.dark` 選擇器 CSS 變數定義），在 `main.jsx` 注入 `<style>` tag
- **深淺切換**：`document.documentElement.classList.toggle('dark', mode === 'dark')`
- **字體大小**：`document.body.className = 'font-${fontSize}'`，搭配 CSS 中 `.font-small`、`.font-medium`、`.font-large` 類別
- 兩者皆持久化到 `localStorage`

### `ThemeControls`

嵌入 `SourceNav` 底部，提供：

- 深色 / 淺色模式切換按鈕
- 字體大小三段調整（小 / 中 / 大）

## IPC API 層異動（`renderer/src/ipc.js`）

新增 `content` 命名空間：

```javascript
export const content = {
  list:         ({ sourceId, limit, offset }) => GET /api/content?sourceId=...&limit=...&offset=...
  get:          (id)                           => GET /api/content/:id
  markRead:     (id, isRead)                   => PATCH /api/content/:id/read  { is_read: isRead }
  unreadCounts: ()                             => GET /api/content/unread-counts
};
```

## 設計決策

| 面向 | 決策 | 理由 |
|------|------|------|
| 資料讀取 | offset-based 分頁，`limit=20` | 簡單，不需 cursor；內容列表不常更新，翻頁穩定 |
| 無限滾動 | Intersection Observer | 原生 API，無額外依賴 |
| 已讀狀態 | 存 DB，即時樂觀更新 UI | DB 持久化保留狀態；樂觀更新 UI 即時性佳 |
| 主題系統 | CSS 變數 + `localStorage` | 不引入 CSS-in-JS；主題切換無 flash |
| Markdown 渲染 | `react-markdown` + `remark-gfm` | 支援 GFM（表格、task list）；輕量 |
| badge 位置 | meta 末尾 | 視線流程優先：標題 → 來源 / 時間 → 類型 |
| 摘要截斷 | 列表 300 字元，詳情完整 | 降低列表請求資料量；詳情需完整內容渲染 |
