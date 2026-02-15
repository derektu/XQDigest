# XQDigest - Claude Code 開發規範

## 專案概述
XQDigest 是財經資訊自動摘要工具，目前處於 Phase 0 (POC) 階段，純 Node.js (CommonJS) 專案。

## 測試規範

### 測試框架
- 使用 Node.js 內建 `node:test` 模組
- 斷言使用 `node:assert/strict`
- 不依賴外部測試框架

### 必須遵守的規則
- **任何模組的新增或修改，都必須同步新增或更新對應的測試檔案**
- 測試檔案位於 `tests/` 目錄，命名格式為 `test-{模組名稱}.js`
- 完成修改後執行 `npm test` 確認全部通過

### 測試執行方式
```bash
npm test                            # 執行所有測試（自動掃描 tests/test-*.js）
node --test tests/test-config.js    # 執行單一模組測試
```

### 修改程式碼時的 checklist
1. 修改模組 → 更新對應的 `tests/test-{模組}.js`
2. 新增模組 → 建立對應的測試檔案
3. 修改設定檔格式 → 更新 `tests/test-config.js`
4. 修改資料庫 schema → 更新 `tests/test-db.js` 和 `tests/test-storage.js`

### 測試撰寫格式

#### 基本結構

```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const MyModule = require('../src/my-module');

describe('MyModule', () => {
  before(() => { /* 整個 suite 執行前一次 */ });
  after(() => { /* 整個 suite 結束後一次 */ });

  it('methodA() 應回傳正確結果', () => {
    assert.equal(actual, expected);
  });

  it('methodB() 非同步操作', async () => {
    const result = await myModule.doAsync();
    assert.ok(result);
  });
});
```

#### 生命週期 hooks 使用時機

| Hook | 用途 |
|------|------|
| `before` / `after` | 整個 describe 共用的資源（DB 連線、一次性 setup） |
| `beforeEach` / `afterEach` | 每個 it 都需要乾淨狀態時（每次重建暫存目錄） |

#### 暫存檔案管理

- 暫存目錄放在 `tests/` 下，使用 `_tmp_` 前綴
- 在 `before` 或 `beforeEach` 建立，`after` 或 `afterEach` 清除

```javascript
const TMP_DIR = path.join(__dirname, '_tmp_mymodule');

before(() => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  // ... setup
});

after(() => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
});
```

#### Mock 物件

依賴注入的模組用簡單的物件 mock，不需要 mock 框架：

```javascript
// 靜默 logger
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// Mock fetcher（回傳固定資料）
function mockRSS(items = []) {
  return { fetchItems: async () => items };
}

// Mock with 呼叫追蹤
let called = false;
const mockLLM = {
  summarize: async () => { called = true; return { summary: 'Mock', keyPoints: ['P1'] }; },
};
```

#### 測試資料 factory

重複使用的測試資料用 factory function，支援 override：

```javascript
function makeItem(overrides = {}) {
  return {
    source_type: 'youtube',
    source_id: 'source-1',
    item_id: 'vid-001',
    title: 'Test Video',
    // ...其他預設值
    ...overrides,
  };
}

// 使用
db.insertContentItem(makeItem());
db.insertContentItem(makeItem({ item_id: 'vid-002', title: 'Video 2' }));
```

#### 常用斷言

```javascript
assert.equal(a, b)             // 嚴格相等 (===)
assert.deepEqual(a, b)         // 深度相等（物件/陣列）
assert.ok(value)               // truthy
assert.match(str, /regex/)     // 正規匹配
assert.throws(() => fn())      // 同步拋錯
await assert.rejects(() => asyncFn())  // 非同步拋錯
```

#### 需要網路的測試

外部 API 測試用 try/catch 包裹，網路不可用時 graceful 跳過：

```javascript
describe('RSSFetcher (需要網路)', () => {
  it('fetchItems() 應能解析真實 RSS feed', async () => {
    let items;
    try {
      items = await fetcher.fetchItems(FEED_URL);
    } catch {
      return; // 網路不可用時跳過
    }
    assert.ok(items.length > 0);
  });
});
```

#### it 描述命名慣例

- 用中文描述行為，格式：`{方法名}() {應/不應}{做什麼}`
- 例：`it('getItems() 應回傳篩選後的結果')`
- 例：`it('重複 item_id 插入應被忽略')`
- 例：`it('無效 URL 應拋出錯誤')`

## 專案結構
- `src/` — 原始碼
- `tests/` — 測試程式
- `config/` — 設定檔
- `doc/` — 文件
- `data/` — 運行時資料 (git ignored)
- `logs/` — 日誌 (git ignored)
