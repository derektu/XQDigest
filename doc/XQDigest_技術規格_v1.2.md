# XQDigest - 技術規格文件

> XQDigest: 財經資訊自動摘要工具  
> 本文件記錄專案需求、技術決策和實作規格,供 Claude Code 參考實作

## 📋 專案概述

**產品名稱**: XQDigest  
**產品定位**: 財經資訊自動摘要工具  
**目標平台**: Windows 和 macOS 桌面應用程式

### 產品簡介
XQDigest 是一款專為財經專業人士設計的桌面應用程式。透過自動監控多個資料來源(YouTube 頻道、RSS feed 等),結合 AI 大型語言模型,為您產生高品質的內容摘要與重點標記。所有資料儲存在本地,隨時可查閱、搜尋,並可無縫整合至 XQ 平台生態系統。

### 核心價值
- **自動化**: 定時監控資料源,無需手動檢查
- **AI 智能**: 運用 LLM 產生精煉摘要和關鍵重點
- **知識累積**: 建立個人化財經知識庫
- **本地優先**: 資料儲存在本地,隱私安全
- **整合就緒**: 未來可作為 XQKM (XQ Knowledge Management) 的資料來源

### 應用程式功能
**內容聚合與智能摘要工具**

1. **多源資料監控**
   - 支援資料源: YouTube 頻道、RSS、及其他來源
   - 定時自動檢查更新
   - 自動抓取新內容

2. **AI 智能摘要**
   - 整合 LLM (OpenAI、Gemini、OpenAI-compatible 節點)
   - 使用者可自訂 model 和 prompt
   - 自動為新內容產生摘要

3. **本地資料管理**
   - 資料存儲於本地資料庫
   - 提供 Web 介面檢視和搜尋
   - 支援 API 供外部程式整合

---

## ✅ 已確認的技術決策

### 1. 開發技術棧
- **框架**: Electron
- **理由**:
  - ✅ 跨平台支援 (Windows + macOS)
  - ✅ 完全獨立運行,無需系統額外安裝 runtime
  - ✅ Chromium 內建於應用程式目錄內
  - ✅ 不會與系統的 Chrome/Chromium 衝突
  - ✅ Claude Code 支援度高
  - ✅ 生態系統成熟,有完整的系統托盤和自動啟動解決方案

### 2. 安裝與部署需求
- **安裝方式**: 
  - Windows: `.exe` 安裝程式 或 綠色版 (portable)
  - macOS: `.dmg` 或 `.app` bundle
- **體積**: 約 100-200MB (包含完整 Chromium)
- **依賴**: 零系統依賴,所有檔案包在應用程式目錄內

---

## 📝 核心功能需求

### 1. 系統啟動自動開啟
- 程式需要在作業系統啟動時自動運行
- Windows: 加入啟動項目 (Registry 或 啟動資料夾)
- macOS: 加入 Login Items

### 2. 視窗最小化功能
- 程式視窗必須可以最小化
- **待確認**: 最小化行為 (到工作列 or 到系統托盤)

### 3. 系統托盤 (Tray) 整合
- **macOS**: Menu Bar 圖示
- **Windows**: System Tray (通知區域) 圖示
- 托盤圖示作為程式介面的入口

---

## 🏗️ 後端架構設計

### ✅ 技術選型

#### 後端服務架構
**全部使用 Node.js (內建在 Electron 主程序)**
- ✅ 零額外依賴,完全自包含
- ✅ 符合「最小 dependency」原則
- ✅ 開發維護簡單

#### 資料儲存方案
**混合儲存: SQLite + Markdown 檔案**

**SQLite 資料庫** - 負責元數據和索引
```sql
CREATE TABLE content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,        -- 'youtube', 'rss', 'other'
  source_id TEXT NOT NULL,          -- 資料源 ID
  item_id TEXT UNIQUE NOT NULL,     -- 內容項目 ID (video_id, article_id)
  title TEXT,
  url TEXT,
  author TEXT,                      -- 頻道名稱或作者
  published_date DATETIME,
  fetched_date DATETIME NOT NULL,
  markdown_file_path TEXT NOT NULL, -- 相對路徑
  summary TEXT,                     -- LLM 產生的摘要
  tags TEXT,                        -- JSON array
  status TEXT DEFAULT 'new',        -- 'new', 'processed', 'archived'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE data_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,        -- 'youtube', 'rss'
  source_name TEXT NOT NULL,        -- 使用者自訂名稱
  source_url TEXT NOT NULL,         -- 頻道 URL 或 RSS URL
  check_interval INTEGER DEFAULT 3600, -- 檢查間隔(秒),預設 1 小時,使用者可自訂
  last_check DATETIME,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE llm_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,           -- 'openai', 'gemini', 'openai-compatible'
  api_key TEXT,
  base_url TEXT,                    -- for openai-compatible
  model TEXT NOT NULL,
  system_prompt TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Markdown 檔案** - 負責完整內容保存
- 位置: `{app_data}/content/{source_type}/{YYYY-MM-DD}_{item_id}.md`
- 格式範例:
```markdown
---
title: 影片標題或文章標題
source: YouTube / RSS
item_id: abc123
author: 頻道名稱或作者
published: 2024-02-11T10:30:00Z
url: https://youtube.com/watch?v=abc123
fetched: 2024-02-11T12:00:00Z
---

# [標題]

## 原始內容

### YouTube 字幕
[完整字幕文字...]

### RSS 文章內容
[完整文章內容...]

## AI 摘要

[LLM 產生的摘要...]

## 關鍵重點

- 重點 1
- 重點 2
- 重點 3

## 元數據

- 來源: [來源名稱]
- 發布時間: [時間]
- 抓取時間: [時間]
```

**儲存優點:**
- ✅ SQLite 提供快速查詢和索引
- ✅ Markdown 易於 debug、閱讀、備份
- ✅ 可以直接用文字編輯器查看內容
- ✅ 提供「從 Markdown 重建索引」功能

### 資料處理流程

✅ **即時處理模式 (抓取後立即產生摘要)**

```
1. 定時任務觸發 (依各資料源設定的檢查間隔)
   ↓
2. 檢查資料源 (YouTube/RSS)
   ↓
3. 發現新內容
   ↓
4. 抓取原始內容 (字幕/文章)
   ↓
5. 建立 Markdown 檔案 (儲存原始內容)
   ↓
6. **立即呼叫 LLM 產生摘要**
   ↓
7. 更新 Markdown (加入 AI 摘要和重點)
   ↓
8. 寫入 SQLite (元數據 + 索引)
   ↓
9. 更新托盤圖示 (顯示未讀數字)
   ↓
10. 發送桌面通知
```

**檢查頻率設定:**
- 預設: 每小時 (3600 秒)
- 使用者可針對每個資料源自訂檢查間隔
- 範圍建議: 15 分鐘 ~ 24 小時

**資料保留策略:**
- ✅ 手動管理,不自動清理
- 使用者可以在 Web 介面中手動刪除不需要的內容
- 提供批次刪除功能 (依日期範圍、資料源等)

**錯誤處理與重試機制:**
- ✅ **自動重試策略**
  - LLM API 呼叫失敗時自動重試最多 3 次
  - 重試間隔: 指數退避 (1s, 2s, 4s)
  - 3 次都失敗後:
    - 記錄錯誤到日誌
    - 發送桌面通知告知使用者
    - 在 Web 介面顯示失敗項目
    - 提供手動重試按鈕
- **其他錯誤處理**
  - 資料源無法訪問: 記錄錯誤,下次繼續嘗試
  - 網路問題: 自動重試,最多 3 次
  - 資料解析錯誤: 記錄並跳過該項目

---

## 🎨 前端介面設計

### ✅ 技術選型
- **框架**: React
- **理由**: 生態系最大,元件豐富,開發效率高

### 功能頁面架構

#### 1. 內容清單頁 (主頁)
**功能:**
- 顯示所有抓取的內容和 AI 摘要
- 支援篩選 (依資料源、日期範圍、已讀/未讀)
- 支援排序 (時間、標題、來源)
- 點擊項目查看完整內容和原始字幕/文章
- 標記為已讀/未讀
- 刪除功能

**UI 元素:**
- 卡片式列表或表格式呈現
- 每個項目顯示:
  - 標題
  - 來源 (YouTube 頻道/RSS 源)
  - 發布時間
  - AI 摘要預覽
  - 未讀標記

#### 2. 資料源管理頁
**功能:**
- 查看所有已新增的資料源
- 新增資料源 (YouTube 頻道 URL / RSS Feed URL)
- 編輯資料源設定 (名稱、檢查間隔)
- 刪除資料源
- 啟用/停用資料源
- 顯示每個資料源的最後檢查時間和狀態

**UI 元素:**
- 資料源列表
- 新增按鈕 (彈出表單)
- 每個資料源顯示:
  - 類型圖示 (YouTube/RSS)
  - 名稱
  - URL
  - 檢查間隔
  - 最後檢查時間
  - 狀態 (啟用/停用)
  - 操作按鈕 (編輯/刪除/立即檢查)

#### 3. LLM 設定頁
**功能:**
- 管理 LLM 提供商設定
- 新增/編輯/刪除 LLM 設定
- 支援多個 LLM 設定 (可切換使用)
- 測試 API 連線
- 自訂摘要 prompt

**設定項目:**
- Provider (OpenAI / Gemini / OpenAI-compatible)
- API Key
- Base URL (for OpenAI-compatible)
- Model 選擇
- System Prompt / 摘要 Prompt
- 啟用/停用

#### 4. 搜尋功能
**功能:**
- 全文搜尋 (標題、摘要、原始內容)
- 進階篩選:
  - 資料源
  - 日期範圍
  - 內容類型 (YouTube/RSS)
- 搜尋結果高亮顯示

**整合方式:**
- 可以是獨立頁面
- 或整合在內容清單頁的搜尋欄

#### 5. 統計儀表板
**功能:**
- 總內容數量
- 各資料源內容數量 (圓餅圖/長條圖)
- 時間軸 (每日/每週新內容趨勢)
- LLM 使用統計 (API 呼叫次數、成功率)
- 資料源檢查狀態
- 儲存空間使用情況

**圖表工具建議:**
- `recharts` 或 `chart.js`

### 導航結構
```
側邊欄/頂部導航:
├─ 📋 內容清單 (預設首頁)
├─ 🔗 資料源管理
├─ 🤖 LLM 設定
├─ 🔍 搜尋 (或整合在內容清單)
├─ 📊 統計儀表板
└─ ⚙️ 應用程式設定
    ├─ 通知設定
    ├─ 開機自動啟動
    ├─ 主題 (淺色/深色模式,可選)
    └─ 關於
```

### 首次啟動體驗
✅ **空白啟動模式**
- 應用程式可以空白啟動,不強制要求立即設定
- 顯示友善的空狀態提示:
  - 內容清單頁: "尚無內容,請先設定資料源和 LLM 開始使用"
  - 提供快速連結到「資料源管理」和「LLM 設定」
- 建議流程提示:
  1. 先設定 LLM (API Key)
  2. 再新增資料源
  3. 等待系統自動抓取或手動觸發檢查

**優點:**
- 使用者可以自行探索介面
- 彈性更高
- 不會造成壓力

---

## 🔒 安全性設計

### API Key 儲存
✅ **使用系統 Keychain/Credential Manager 加密儲存**

**實作方式:**
- 使用 `keytar` 套件 (Electron 官方推薦)
- Windows: Windows Credential Manager
- macOS: Keychain Access
- Linux: libsecret

**流程:**
```javascript
const keytar = require('keytar');

// 儲存 API Key
await keytar.setPassword('xqdigest', 'openai-api-key', apiKey);

// 讀取 API Key
const apiKey = await keytar.getPassword('xqdigest', 'openai-api-key');

// 刪除 API Key
await keytar.deletePassword('xqdigest', 'openai-api-key');
```

**優點:**
- ✅ 系統級加密,安全性高
- ✅ 不會以明文儲存在設定檔
- ✅ 符合最佳安全實踐
- ✅ 跨平台一致性

**其他安全措施:**
- API Key 不會顯示在 Web 介面 (顯示為 `••••••••`)
- 日誌檔案不記錄敏感資訊
- 本地 API Server 只接受 localhost 連線

---

## 🎨 UI/UX 設計

### ✅ 已確認設計

#### 介面模式: **混合模式**
- 有主視窗 (顯示 Web 介面 - 管理資料源、檢視摘要、搜尋)
- 可以關閉主視窗,程式繼續在托盤背景運行
- 托盤圖示作為常駐入口

#### 托盤圖示互動
**左鍵點擊托盤圖示**:
- 顯示/隱藏主視窗 (toggle)
- 如果視窗已開啟但在背景,則將其帶到前景

**右鍵點擊托盤圖示**:
顯示快速操作選單:
```
├─ 開啟主視窗
├─ 立即檢查更新
├─ ──────────── (分隔線)
├─ 設定
├─ 開機自動啟動 ☑️
├─ ──────────── 
└─ 結束程式
```

#### 視覺狀態指示與通知

#### 托盤圖示狀態
- **閒置狀態**: 預設圖示
- **檢查中**: 圖示動畫或顏色變化 (可選)
- **有新內容**: 顯示未讀數字徽章

#### 新內容通知機制
✅ **桌面通知 (Desktop Notification)**
- 當有新內容抓取並產生摘要完成後發送
- 通知內容包含:
  - 標題: 資料源名稱
  - 內容: 新內容數量和簡短預覽
  - 點擊通知 → 開啟主視窗並導航至該內容

✅ **托盤圖示未讀徽章**
- 顯示未讀內容數量
- 開啟主視窗查看後清除徽章

#### 通知設定
- 使用者可以在設定中開啟/關閉桌面通知
- 可設定通知的詳細程度

#### 視窗行為
- **關閉按鈕**: 隱藏視窗到托盤 (不結束程式)
- **最小化按鈕**: 最小化到工作列 (傳統行為)
- **退出程式**: 只能從托盤選單的「結束程式」執行
- **首次啟動**: 顯示主視窗引導使用者設定

### 主視窗設計

#### 技術實作
✅ **通訊架構: 本地 HTTP Server (Express + REST API)**
- Electron 主程序啟動 Express Server (監聽 localhost)
- 前端使用 Web 技術 (HTML/CSS/JavaScript 或框架)
- 透過 RESTful API 與後端通訊
- 支援外部程式透過 API 整合

**優點:**
- API 可供外部程式使用 (符合需求)
- 前端開發更靈活,可使用任何前端框架
- 清晰的前後端分離
- 易於測試和 debug

#### 建議尺寸
- 最小尺寸: 800x600
- 預設尺寸: 1200x800
- 可調整大小
- 記住使用者的視窗尺寸和位置偏好

#### API 端點設計 (初步)
```
GET    /api/sources              - 取得所有資料源
POST   /api/sources              - 新增資料源
PUT    /api/sources/:id          - 更新資料源
DELETE /api/sources/:id          - 刪除資料源

GET    /api/content              - 取得內容列表 (支援分頁、搜尋)
GET    /api/content/:id          - 取得單一內容詳情
PUT    /api/content/:id/read     - 標記為已讀
DELETE /api/content/:id          - 刪除內容

GET    /api/llm/configs          - 取得 LLM 設定
POST   /api/llm/configs          - 新增 LLM 設定
PUT    /api/llm/configs/:id      - 更新 LLM 設定

POST   /api/check-now            - 手動觸發立即檢查
GET    /api/stats                - 取得統計資訊
```

---

## 🔧 技術實作要點

### Electron 核心套件
- `electron`: 主框架
- `electron-builder`: 打包和建立安裝程式
- `electron-store`: 持久化設定儲存
- `auto-launch`: 系統自動啟動 (跨平台)
- 內建 `Tray` 和 `Menu` API: 系統托盤

### 資料抓取與處理
- **YouTube 字幕下載** (擇一):
  - `youtube-transcript`: 輕量簡單,專注字幕下載
  - `youtubei.js`: 功能完整,可取得更多資訊
- **RSS 解析**:
  - `rss-parser`: RSS/Atom feed 解析
- **HTTP 請求**:
  - `axios`: 通用 HTTP 請求

### 資料庫與排程
- `better-sqlite3`: SQLite 操作 (同步 API,效能佳)
- `node-cron` 或 `node-schedule`: 定時任務排程

### LLM 整合
- `openai`: OpenAI API SDK
- `@google/generative-ai`: Google Gemini API SDK
- `axios`: 通用 HTTP 請求 (for OpenAI-compatible endpoints)

### Web 介面與 API
✅ **選用方案: Express + REST API**
- `express`: 本地 HTTP Server
- `cors`: CORS 處理 (允許前端框架開發)
- `body-parser`: 請求解析
- **前端**: React + 相關生態系
  - `react` + `react-dom`
  - `react-router-dom`: 路由管理
  - `axios` 或 `fetch`: API 請求
  - UI 組件庫 (可選): Material-UI, Ant Design, 或 Tailwind CSS
  - 圖表: `recharts` 或 `chart.js`
  - 狀態管理 (可選): Context API 或 Redux Toolkit

**Server 設定:**
- 監聽: `http://localhost:{動態端口}`
- 只接受 localhost 連線 (安全性)
- 隨機可用端口或固定端口 (如 37291)

### 檔案與路徑處理
- `fs-extra`: 增強的檔案系統操作
- `path`: Node.js 內建路徑處理
- `gray-matter`: Markdown Front Matter 解析

### 安全性
- `keytar`: 系統 Keychain/Credential Manager 整合 (加密儲存 API Key)

### 專案結構建議
```
xqdigest/
├── package.json
├── electron-builder.yml          # 打包配置
├── .gitignore
├── README.md
│
├── src/
│   ├── main/                     # Electron 主程序
│   │   ├── index.js              # 主程序入口
│   │   ├── tray.js               # 托盤管理
│   │   ├── window.js             # 視窗管理
│   │   ├── autoLaunch.js         # 自動啟動
│   │   │
│   │   ├── api/                  # Express API Server
│   │   │   ├── server.js         # API Server 入口
│   │   │   ├── routes/
│   │   │   │   ├── sources.js    # 資料源 API
│   │   │   │   ├── content.js    # 內容 API
│   │   │   │   ├── llm.js        # LLM 設定 API
│   │   │   │   └── stats.js      # 統計 API
│   │   │   └── middleware/
│   │   │
│   │   ├── services/             # 業務邏輯
│   │   │   ├── scheduler.js      # 定時任務管理
│   │   │   ├── fetcher/
│   │   │   │   ├── youtube.js    # YouTube 抓取
│   │   │   │   └── rss.js        # RSS 抓取
│   │   │   ├── llm/
│   │   │   │   ├── openai.js     # OpenAI 整合
│   │   │   │   ├── gemini.js     # Gemini 整合
│   │   │   │   └── compatible.js # OpenAI-compatible
│   │   │   ├── storage.js        # 儲存管理 (Markdown + DB)
│   │   │   └── notification.js   # 通知服務
│   │   │
│   │   ├── database/             # 資料庫
│   │   │   ├── db.js             # SQLite 連線
│   │   │   ├── schema.sql        # 資料庫 Schema
│   │   │   └── migrations/       # 資料庫遷移
│   │   │
│   │   └── utils/
│   │       ├── logger.js         # 日誌
│   │       ├── config.js         # 設定管理
│   │       └── security.js       # 安全性 (Keytar)
│   │
│   ├── renderer/                 # 前端 (React)
│   │   ├── public/
│   │   │   ├── index.html
│   │   │   └── assets/
│   │   │
│   │   ├── src/
│   │   │   ├── App.jsx           # 主元件
│   │   │   ├── index.jsx         # 入口
│   │   │   │
│   │   │   ├── pages/            # 頁面元件
│   │   │   │   ├── ContentList.jsx
│   │   │   │   ├── SourceManager.jsx
│   │   │   │   ├── LLMSettings.jsx
│   │   │   │   ├── Search.jsx
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   └── Settings.jsx
│   │   │   │
│   │   │   ├── components/       # 共用元件
│   │   │   │   ├── Layout.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   ├── ContentCard.jsx
│   │   │   │   └── ...
│   │   │   │
│   │   │   ├── services/         # API 呼叫
│   │   │   │   └── api.js
│   │   │   │
│   │   │   ├── hooks/            # 自訂 Hooks
│   │   │   ├── context/          # React Context
│   │   │   └── utils/
│   │   │
│   │   └── package.json          # 前端獨立 package.json
│   │
│   └── preload/                  # 預載腳本
│       └── preload.js
│
├── assets/                       # 靜態資源
│   ├── icons/                    # 應用程式圖示
│   │   ├── icon.icns             # macOS
│   │   ├── icon.ico              # Windows
│   │   ├── icon.png
│   │   └── tray/                 # 托盤圖示 (多尺寸)
│   │       ├── icon.png
│   │       ├── icon@2x.png
│   │       └── icon-template.png # macOS template
│   └── screenshots/
│
├── data/                         # 使用者資料 (不納入版控)
│   ├── database/
│   │   └── content.db
│   └── content/                  # Markdown 檔案
│       ├── youtube/
│       └── rss/
│
└── logs/                         # 日誌檔案 (不納入版控)
```

---

## 📦 打包配置

### Windows
- 輸出格式: `.exe` (NSIS 安裝程式) + portable 版本
- 圖示: `.ico` 格式
- 自動啟動: Registry 或 Shell:Startup

### macOS
- 輸出格式: `.dmg` + `.app`
- 圖示: `.icns` 格式
- 自動啟動: Login Items (LaunchAgents)

---

## 🚀 下一步

1. ✅ 確認 UI 互動模式
2. ✅ 討論應用程式的具體功能
3. ✅ 完善技術規格細節
4. ✅ 規格文件完成,準備交付給 Claude Code 實作

---

## 🧪 POC (Proof of Concept) 階段

### POC 目標
在開發完整介面之前,先實作核心功能驗證資料抓取流程的正確性。

### POC 範圍與限制

#### ✅ POC 包含功能
1. **資料抓取核心**
   - YouTube 字幕下載
   - RSS 內容抓取
   - LLM 摘要生成
   - 儲存到 SQLite + Markdown

2. **佇列管理系統**
   - 下載任務佇列
   - 並發控制 (concurrent download limit)
   - 避免過度消耗頻寬

3. **定時排程**
   - 基本的定時檢查機制

#### ❌ POC 不包含
- Web 介面 (React)
- 托盤圖示和系統整合
- 桌面通知
- 使用者互動 UI

### POC 設定方式

#### 使用 JSON 設定檔
所有設定透過 JSON 檔案管理,程式可以 reload 設定檔。

**設定檔位置**: `config/settings.json`

**設定檔格式範例**:
```json
{
  "version": "1.0",
  "app": {
    "checkInterval": 3600,
    "logLevel": "info",
    "dataPath": "./data"
  },
  "download": {
    "concurrentLimit": 3,
    "retryAttempts": 3,
    "retryDelay": 1000,
    "timeoutMs": 30000
  },
  "dataSources": [
    {
      "id": "source-1",
      "type": "youtube",
      "name": "Tech Channel",
      "url": "https://www.youtube.com/@channelname",
      "checkInterval": 3600,
      "enabled": true
    },
    {
      "id": "source-2",
      "type": "rss",
      "name": "Tech Blog",
      "url": "https://example.com/feed.xml",
      "checkInterval": 7200,
      "enabled": true
    }
  ],
  "llm": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini",
    "baseUrl": null,
    "systemPrompt": "你是一個專業的內容摘要助手。請用繁體中文總結以下內容的重點,並列出 3-5 個關鍵要點。",
    "maxTokens": 1000,
    "temperature": 0.7
  }
}
```

#### 設定檔 Reload 機制
```javascript
// 監聽設定檔變更
const chokidar = require('chokidar');

const watcher = chokidar.watch('config/settings.json');
watcher.on('change', (path) => {
  console.log('Config file changed, reloading...');
  reloadConfig();
  restartScheduler(); // 重新啟動排程器
});

function reloadConfig() {
  const config = JSON.parse(fs.readFileSync('config/settings.json', 'utf8'));
  // 更新全域設定
  // 更新佇列設定
  // 更新資料源
  return config;
}
```

### 下載佇列設計

#### 佇列架構
```
下載佇列系統
├── Task Queue (任務佇列)
│   ├── Pending Tasks (待處理)
│   ├── Active Tasks (進行中)
│   └── Completed Tasks (已完成)
│
├── Concurrency Controller
│   ├── 最大並發數限制
│   ├── 任務分配邏輯
│   └── 頻寬控制
│
└── Retry Manager
    ├── 失敗重試邏輯
    ├── 指數退避
    └── 錯誤追蹤
```

#### 實作建議
```javascript
class DownloadQueue {
  constructor(concurrentLimit = 3) {
    this.concurrentLimit = concurrentLimit;
    this.queue = [];           // 待處理任務
    this.active = [];          // 進行中任務
    this.completed = [];       // 已完成任務
    this.failed = [];          // 失敗任務
  }

  async addTask(task) {
    this.queue.push(task);
    await this.processQueue();
  }

  async processQueue() {
    while (this.queue.length > 0 && this.active.length < this.concurrentLimit) {
      const task = this.queue.shift();
      this.active.push(task);
      
      this.executeTask(task)
        .then(() => {
          this.onTaskComplete(task);
        })
        .catch((error) => {
          this.onTaskFailed(task, error);
        });
    }
  }

  async executeTask(task) {
    // 執行下載任務
    // 包含重試邏輯
  }

  onTaskComplete(task) {
    const index = this.active.indexOf(task);
    this.active.splice(index, 1);
    this.completed.push(task);
    this.processQueue(); // 處理下一個任務
  }

  onTaskFailed(task, error) {
    const index = this.active.indexOf(task);
    this.active.splice(index, 1);
    
    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      this.queue.unshift(task); // 重新加入佇列
    } else {
      this.failed.push(task);
    }
    
    this.processQueue();
  }

  updateConcurrentLimit(newLimit) {
    this.concurrentLimit = newLimit;
    this.processQueue();
  }
}
```

#### 佇列設定參數
- **concurrentLimit**: 並發下載數量 (預設 3)
- **retryAttempts**: 重試次數 (預設 3)
- **retryDelay**: 重試延遲 (指數退避: 1s, 2s, 4s)
- **timeoutMs**: 單個任務超時時間 (預設 30 秒)

### POC 執行流程

```
1. 程式啟動
   ↓
2. 讀取 settings.json
   ↓
3. 初始化:
   - SQLite 資料庫
   - 下載佇列 (設定並發限制)
   - 定時排程器
   ↓
4. 定時檢查資料源
   ↓
5. 發現新內容 → 加入下載佇列
   ↓
6. 佇列依並發限制處理任務:
   - 下載字幕/RSS 內容
   - 儲存 Markdown
   - 呼叫 LLM (也受佇列管理)
   - 更新 SQLite
   ↓
7. 輸出日誌到 console / 日誌檔
   ↓
8. 監聽 settings.json 變更 → reload
```

### POC 日誌輸出

**Console 輸出範例**:
```
[2024-02-11 10:00:00] [INFO] Application started
[2024-02-11 10:00:00] [INFO] Config loaded: 2 data sources, concurrent limit: 3
[2024-02-11 10:00:01] [INFO] Scheduler started, check interval: 3600s
[2024-02-11 10:05:00] [INFO] Checking source: Tech Channel (youtube)
[2024-02-11 10:05:02] [INFO] Found 3 new videos
[2024-02-11 10:05:02] [INFO] Added to queue: Video 1 (queue: 3, active: 0)
[2024-02-11 10:05:02] [INFO] Added to queue: Video 2 (queue: 3, active: 0)
[2024-02-11 10:05:02] [INFO] Added to queue: Video 3 (queue: 3, active: 0)
[2024-02-11 10:05:03] [INFO] Processing: Video 1 (active: 1/3)
[2024-02-11 10:05:03] [INFO] Processing: Video 2 (active: 2/3)
[2024-02-11 10:05:03] [INFO] Processing: Video 3 (active: 3/3)
[2024-02-11 10:05:10] [INFO] Downloaded transcript: Video 1
[2024-02-11 10:05:11] [INFO] Calling LLM for summary: Video 1
[2024-02-11 10:05:15] [SUCCESS] Completed: Video 1 (saved to data/content/youtube/2024-02-11_abc123.md)
[2024-02-11 10:05:15] [INFO] Queue status: pending: 0, active: 2, completed: 1
[2024-02-11 10:05:20] [ERROR] Failed to download: Video 2 (retry 1/3)
[2024-02-11 10:05:22] [INFO] Retry: Video 2 (active: 3/3)
```

### POC 驗證清單

#### ✅ 功能驗證
- [ ] YouTube 字幕下載正常
- [ ] RSS 內容抓取正常
- [ ] LLM 摘要生成正確
- [ ] Markdown 檔案格式正確
- [ ] SQLite 資料正確寫入
- [ ] 佇列並發控制有效
- [ ] 重試機制正常運作
- [ ] JSON 設定 reload 正常

#### ✅ 效能驗證
- [ ] 並發下載不超過設定限制
- [ ] 頻寬使用在可接受範圍
- [ ] 記憶體使用穩定
- [ ] 長時間運行無記憶體洩漏

#### ✅ 錯誤處理驗證
- [ ] 網路中斷後能正確重試
- [ ] API Key 錯誤能正確提示
- [ ] 資料源無法訪問能正確處理
- [ ] 資料解析錯誤能正確跳過

### POC 所需套件 (簡化版)

**package.json** (POC 階段):
```json
{
  "name": "xqdigest-poc",
  "version": "0.1.0",
  "description": "XQDigest POC - Financial Content Aggregator and Summarizer",
  "main": "src/poc/index.js",
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "youtube-transcript": "^1.0.6",
    "rss-parser": "^3.13.0",
    "openai": "^4.20.0",
    "@google/generative-ai": "^0.1.0",
    "axios": "^1.6.0",
    "node-cron": "^3.0.3",
    "chokidar": "^3.5.3",
    "fs-extra": "^11.2.0",
    "gray-matter": "^4.0.3"
  }
}
```

### POC 專案結構 (簡化版)

```
xqdigest-poc/
├── package.json
├── config/
│   └── settings.json          # 設定檔
│
├── src/
│   └── poc/
│       ├── index.js           # POC 入口
│       ├── config.js          # 設定管理與 reload
│       ├── queue.js           # 下載佇列
│       ├── scheduler.js       # 定時任務
│       ├── fetchers/
│       │   ├── youtube.js
│       │   └── rss.js
│       ├── llm/
│       │   ├── openai.js
│       │   └── gemini.js
│       ├── storage.js         # 儲存管理
│       └── logger.js          # 日誌
│
├── data/                      # 資料目錄
│   ├── database/
│   │   └── content.db
│   └── content/
│       ├── youtube/
│       └── rss/
│
└── logs/
    └── app.log
```

---

## 💡 開發建議與注意事項

### 開發流程建議

**修正後的階段規劃**:

0. **Phase 0: POC (優先)** ⭐
   - 實作核心資料抓取流程
   - 實作下載佇列系統
   - 驗證整個資料流程正確性
   - 使用 JSON 設定檔管理
   - **目標**: 確保核心邏輯正確後再開發介面
0. **Phase 0: POC (優先)** ⭐
   - 實作核心資料抓取流程
   - 實作下載佇列系統
   - 驗證整個資料流程正確性
   - 使用 JSON 設定檔管理
   - **目標**: 確保核心邏輯正確後再開發介面

1. **Phase 1: 基礎架構**
   - 設定 Electron 專案
   - 建立托盤和視窗管理
   - 實作自動啟動功能
   - 整合 POC 的核心功能到 Electron

2. **Phase 2: 後端 API**
   - 建立 Express API Server
   - 將 POC 功能封裝為 API
   - 實作設定管理介面

3. **Phase 3: 前端開發**
   - 建立 React 專案結構
   - 實作各功能頁面
   - 整合 API
   - UI/UX 優化

4. **Phase 4: 整合與測試**
   - 前後端整合
   - 通知功能測試
   - 錯誤處理測試
   - 跨平台測試

5. **Phase 5: 打包與部署**
   - 配置 electron-builder
   - 產生安裝程式
   - 測試安裝流程

### 關鍵注意事項

#### 效能優化
- SQLite 使用索引加速查詢
- 大量內容時使用分頁載入
- **下載佇列並發控制** (POC 階段驗證)
- **LLM API 呼叫使用佇列管理,避免並發過多** (POC 階段驗證)
- 監控記憶體使用,避免佇列過長導致 OOM

#### 資料完整性
- 確保 Markdown 和 SQLite 的資料一致性
- 提供「重建索引」功能 (從 Markdown 掃描重建 SQLite)
- 定期備份資料庫
- **佇列任務失敗時確保不會遺失資料**

#### 錯誤處理
- 所有 async 操作都要有 try-catch
- 記錄詳細的錯誤日誌
- 提供友善的錯誤訊息給使用者
- **佇列重試機制使用指數退避** (POC 階段驗證)
- **區分可重試和不可重試的錯誤**

#### 安全性
- API Key 使用 keytar 加密儲存
- 本地 API Server 只監聽 localhost
- 不在日誌中記錄敏感資訊

#### 使用者體驗
- 長時間操作顯示進度指示
- 提供取消操作的選項
- 離線狀態的友善提示
- 儲存使用者偏好設定 (視窗大小、主題等)

### 測試建議
- 單元測試: 資料抓取、LLM 呼叫、資料庫操作
- 整合測試: API 端點、資料流程
- 手動測試: UI 互動、托盤功能、通知
- 跨平台測試: Windows + macOS

### 文檔
- API 文檔 (供外部整合使用)
- 使用者手冊
- 開發者文檔

---

## 📘 產品資訊

### 產品名稱
**XQDigest**

### 品牌定位
- **主品牌**: XQ (財經平台)
- **產品線**: XQDigest (資訊摘要工具)
- **未來整合**: XQKM (XQ Knowledge Management) 資料來源

### Slogan
**中文**: 財經資訊自動摘要工具  
**英文**: Your Financial Knowledge Feeder

### 目標使用者
- 財經專業人士
- 投資研究分析師
- 主動投資人
- 財經內容創作者

### 使用情境
1. **資訊追蹤**: 追蹤特定財經 YouTuber 和財經媒體 RSS
2. **研究整理**: 自動整理每日財經資訊並產生摘要
3. **知識累積**: 建立個人財經知識庫,方便日後查詢
4. **效率提升**: 節省手動閱讀和整理時間

---

## 📚 參考資源

### Electron
- [Electron 官方文檔](https://www.electronjs.org/docs)
- [electron-builder 文檔](https://www.electron.build/)

### 套件文檔
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [node-cron](https://github.com/node-cron/node-cron)
- [youtube-transcript](https://github.com/Kakulukian/youtube-transcript)
- [rss-parser](https://github.com/rbren/rss-parser)
- [keytar](https://github.com/atom/node-keytar)

### API 文檔
- [OpenAI API](https://platform.openai.com/docs)
- [Google Gemini API](https://ai.google.dev/docs)

---

**最後更新**: 2026-02-11

**規格版本**: 1.2 (正式命名為 XQDigest)

**產品名稱**: XQDigest - 財經資訊自動摘要工具

**狀態**: ✅ 完成 - 準備交付給 Claude Code 實作

**建議**: 🚀 優先實作 Phase 0 (POC) 驗證核心流程
